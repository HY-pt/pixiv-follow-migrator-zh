# Pixiv 反爬机制调研（2026-11-19）

基于 6 个开源项目的源码/文档/提交记录核实，不是推测。每个结论后面标了来源。

---

## 一、四层防线总览

| 层 | 手段 | 触发表现 | 影响本项目？ |
|---|---|---|---|
| 1. CDN 防盗链 | `i.pximg.net` 校验 `Referer` | 403，无错误说明 | 否（我们不拉图片） |
| 2. Cloudflare | WAF + JS 挑战 | 403 / 5xx | 可能（视地区/IP） |
| 3. 频率限制 | 滑动窗口 + 突发计数 | **429** | **是，主要矛盾** |
| 4. 登录态校验 | Cookie + CSRF token + 设备指纹 | 空数据 / 未登录态 | 是 |

---

## 二、逐层证据

### 1. 图片 CDN 防盗链（Referer 校验）

`i.pximg.net` **只要 Referer 不含 pixiv.net 就返回 403**，且**没有描述性错误信息**。

来源：
- [Pixiv 图片反向代理讨论](https://github.com/xueelf/blog/discussions/46)：「i.pximg.net 有盗链保护，只要 Referer 不是来自 Pixiv 的请求都会返回 403」
- [Referer Modifier 用户反馈](https://addons.mozilla.org/zh-CN/firefox/addon/referer-modifier/reviews/2037358/)：「delivers a 403 Forbidden if the referrer does not contain pixiv.net」

**对我们的意义**：不需要处理，但解释了为什么很多下载器要伪造 Referer。
我们直接走 `www.pixiv.net` 的 AJAX 接口，同源，天然带 Referer。

### 2. Cloudflare 保护

Pixiv 站点**前置了 Cloudflare**，且部分区域会触发 JS 挑战。

来源：
- [Cultured-Downloader-Logic 源码注释](https://pkg.go.dev/github.com/KJHJason/Cultured-Downloader-Logic@v1.0.2/api/pixiv/mobile)：
  「pixiv.net is protected by cloudflare, so to prevent the user's IP reputation from going down, delays are added」
- [PixivPy 更新日志](https://github.com/upbit/pixivpy)：2020/10/17「Use cloudscraper to bypass Cloudflare, fixed issue #140」

**对我们的意义**：浏览器内运行天然通过（有真实 Cookie、真实指纹、真实 TLS）。
这是油猴脚本相对裸 HTTP 爬虫的**结构性优势** —— 我们不需要 cloudscraper。

### 3. 频率限制（核心）

**不是简单计数器，是「滑动窗口 + 突发检测」的组合**。

PixivFE（第三方前端，Go 写的）源码里的限流常量：

```
BurstWindowSeconds = 20     // 突发窗口
BurstMaxRequests   = 15     // 20 秒内最多 15 次（非可疑用户）
// 另有更长窗口的限流
```

来源：[PixivFE commit 1383bef](https://git.gay/kita/PixivFE/commit/1383bef8c41f701a49b6a55d7f512b4309c51e55)（tune constants）
另见 [PixivFE commit 6758f2e](https://git.gay/kita/PixivFE/commit/6758f2e3a31c197661f2bf2eb8402e5af844e292.patch)：
把关注接口 `limit=100` 改成 `limit=12`，注释 `API uses limit=12` —— **100 是坏边界值**（印证我们 v3.2.0 的发现）。

其他项目的量化经验：

| 项目 | 结论 |
|---|---|
| [PixivBatchDownloader](https://github.com/xuejianxianzun/PixivBatchDownloader/releases/tag/v17.0.0) | 曾用 **1600ms** 间隔，用户仍报 429，于是加了「减慢抓取速度」设置项 |
| [PixiC](https://github.com/Coder-Sakura/PixiC/releases) | 「触发 pixiv 限制后大约会限制 **3min**，期间会周期性请求」 |
| [PixivPy](https://github.com/lei-mu/pixivpy-async) | 「Pixiv API has a strict policy on access frequency」 |
| [雪见仙尊实测](https://afdian.com/p/3e8d4834294e11ee977752540025c377) | 批量关注建议**每天不超过 500 个**；慢速模式下 1000 个未被限制 |

**关键结论**：
- 限流是**按账号 + IP 双维度**的，不只是 IP
- 触发后**持续 3 分钟左右**（PixiC 实测），不是永久封禁
- **均匀间隔最容易被识别** —— PixivBatchDownloader 用固定 1600ms 依然被打，说明不是"够慢就行"，而是**节奏的规律性**也被检测

这正是我们 v3.1.0 把均匀抖动改成 `650ms × [1, 3]` 随机倍数的依据。
不过对比 PixivBatchDownloader 的 1600ms 仍被打，**我们默认 650ms 偏激进** —— 建议调高，见第五节。

### 4. 登录态与设备指纹

| 机制 | 说明 | 来源 |
|---|---|---|
| `PHPSESSID` Cookie | 核心登录态 | PixivFE 源码注释 |
| `x-csrf-token` | 所有写操作（关注/收藏）必需 | 我们脚本已拦截 |
| `X-Client-Time` / `X-Client-Hash` | App API 专用，基于时间戳的 HMAC 签名 | [PixivPy 更新日志 2019/09/03](https://github.com/upbit/pixivpy) |
| `Referer: https://www.pixiv.net/` | AJAX 接口也校验 | 多个项目一致 |

**私密关注的额外限制**（源码级证据）：
[PixivFE `GetUserFollowingURL`](https://git.gay/kita/PixivFE/commit/6758f2e3a31c197661f2bf2eb8402e5af844e292.patch) 的注释写着：

> Attempting to retrieve private follows for a user other than the one
> for which a PHPSESSID is provided returns their public follows instead

**含义**：`rest=hide` 只对**自己**有效。拿别人的 ID + 自己的 Cookie 去要私密关注，
**不会报错，而是静默降级返回公开关注**。

这解释了我们遇到的 `私密 0/23` 类问题 —— 有可能不是失败，而是被静默降级了。
（我们现在的实现是用 `getCurrentUserId()`，抓的是自己账号，逻辑正确。）

---

## 三、对我们脚本的直接影响

| 现有设计 | 评估 |
|---|---|
| 用 `limit=24` | ✅ 正确，避开了 100 这个坏值 |
| `650ms × [1,3]` 随机 | ⚠️ **偏激进**，PBD 用 1600ms 都被打 |
| 429 立即停 | ✅ 正确，符合「不要硬刚」的共识 |
| 连续失败 8 次停 | ✅ 合理 |
| 不伪造 Referer/UA | ✅ 同源请求，无需伪造 |
| 走浏览器真实会话 | ✅ 天然通过 Cloudflare |

---

## 四、几个开源项目值得借鉴的做法

### PixivBatchDownloader（最成熟，长期维护）

- **可配置的抓取间隔**（默认较慢，用户可调）
- 429 时**暂停几分钟后自动重试**，而不是放弃
- 抓取结果**先落地成本地数据**，显示时不经 pixiv 处理（避免二次请求）
- [Issue #477](https://github.com/xuejianxianzun/PixivBatchDownloader/issues/477) 记录：「即使触发 429，下载器也会自动处理以完成抓取」

### PixiC

- **周期性轮询 + 休眠**：触发限制后会周期性试探，而不是一次性放弃
- 明确记录「限制 3 分钟后解除」

### PixivPy

- `cloudscraper` 绕 Cloudflare（浏览器内不需要）
- `X-Client-Hash` 设备签名（App API 才需要）

### PixivFE

- 明确的**双层限流常量**（突发窗口 20s/15 次 + 长期窗口）
- 关注接口 `limit=12` 这个安全值

---

## 五、建议

**把默认间隔从 650ms 调高到 1200ms 左右**，抖动上限保持 2~3 倍。

理由：
1. PBD 用 1600ms 仍有用户报 429，说明 650ms 太激进
2. 但 PBD 是下载场景（每个作品多次请求），我们关注是单次请求，可以略快
3. 综合取 1200ms 作为基准，实际落在 1200~3600ms，比 PBD 的固定 1600ms 更"不像机器"

**另外可以考虑**：连续成功 N 次后**主动插入一次长休眠**（如每 50 个休息 30 秒），
模拟人类操作节奏 —— PBD 的"慢速模式"就是这个思路。

---

## 六、来源清单

- [PixivPy](https://github.com/upbit/pixivpy) — cloudscraper、X-Client-Hash
- [PixivFE](https://git.gay/kita/PixivFE) — 限流常量、limit=12、私密关注降级
- [PixivBatchDownloader](https://github.com/xuejianxianzun/PixivBatchDownloader) — 1600ms 间隔、429 自动重试、可配置限速
- [PixiC](https://github.com/Coder-Sakura/PixiC) — 3 分钟限制、周期轮询
- [Cultured-Downloader-Logic](https://pkg.go.dev/github.com/KJHJason/Cultured-Downloader-Logic@v1.0.2/api/pixiv/mobile) — Cloudflare、IP 声誉
- [pixiv-ajax-api-docs](https://github.com/daydreamer-json/pixiv-ajax-api-docs) — Web AJAX 接口参数
