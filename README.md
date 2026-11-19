# Pixiv Follow Migrator · 中文增强版

在 Pixiv 账号之间迁移关注列表的浏览器用户脚本（Tampermonkey / Violentmonkey）。

上游 [Pixiv Follow Migrator v3.0](https://greasyfork.org/scripts/576458-pixiv-follow-migrator) 由 godlessX 以 MIT 许可发布，**只有英文界面**，2026-05-03 之后未再更新。本仓库在保留上游版权声明的前提下做三件事：

1. **自行完成全部界面汉化**（面板、状态栏、弹窗、确认框、报错文案）
2. 修复影响实际使用的缺陷（抓取漏页、关注顺序颠倒、限流丢列表等）
3. 补上公开 / 私密分离、断点续抓等新能力

> 这是**衍生分支，不是原创脚本**；汉化与修改都由本仓库完成，不是上游自带。

## 来源与声明

| 项目 | 说明 |
| --- | --- |
| 上游作者 | godlessX（Greasy Fork 账号 [godlessX](https://greasyfork.org/users/1548720-godlessx)） |
| 上游脚本 | [Pixiv Follow Migrator v3.0](https://greasyfork.org/scripts/576458-pixiv-follow-migrator)，2026-05-03 发布，英文界面 |
| 上游许可证 | MIT |
| 本分支维护 | [HY-pt](https://github.com/HY-pt) |
| 本分支工作 | 界面汉化（自行完成）+ 修复 9 处缺陷 + 新增公开/私密分离等能力 |

两点说明：

- 上游脚本头部写的是 `@author Misery`，但 Misery **不是** Greasy Fork 用户名 —— 该账号实际叫 `godlessX`，因此搜 "Misery" 找不到人属正常。
- MIT 要求保留上游版权：完整的上游声明在 [LICENSE](LICENSE)，本仓库仅就自己的修改部分声明版权。上游原版源码留在 [`upstream/`](upstream/)，作为生成器的只读基准。

## 与上游的差异

### 界面（本仓库自行汉化）

- 全部界面文案汉化，包括按钮、状态栏、弹窗与 `confirm` 提示；界面不使用 emoji，状态靠文字与颜色区分
- 最小化收进右下角圆形图标；面板可拖动、自动夹在视口内；双击标题栏收起
- 状态栏吸顶，滚动时始终可见；「高级」折叠区默认收起，只显示常用项
- 应用图标与底部署名链接（v3.5.x 起）

### 修复的缺陷

| # | 上游问题 | 本分支的处理 |
| --- | --- | --- |
| 1 | 抓取只翻一页就停 | 根因是 `limit=100` 时服务端忽略 `offset`；改用 `limit=24`，按实际返回数前进 |
| 2 | 深翻页时提前中断 | 不再把「本页不足 limit」当「已到底」，只有空页 / 整页重复 / 到达 total 才结束 |
| 3 | 关注节奏过于规律被限流 | 默认间隔 1200ms + 1~3 倍随机抖动 + 每 50 个长休眠 30 秒 |
| 4 | 迁移后关注顺序整体颠倒 | pixiv 是「最新关注排最前」，新增「关注顺序」选项，默认 reverse 还原原顺序 |
| 5 | 触发限流后列表可能整个丢失 | 只移除「确认成功 / 确认已在关注」的记录，失败与未轮到的全部保留 |
| 6 | 可重复点击执行 | 加执行锁 + 断点续抓游标 |
| 7 | 校验会直接删人且不可撤销 | 拆成三个按钮：校验关注状态（只读）/ 移除已关注记录（移除前备份）/ 撤销移除 |
| 8 | 私密关注抓成 0/23 | 空页区分「第一页就空」（请求失败）与「尾部空页」（账号已注销，正常损耗） |
| 9 | 抓取总数对不上 | 说明差额来自已注销 / 被冻结账号 —— pixiv 仍计入 `total`，但接口不返回 |

### 新增能力

- **公开 / 私密分离**：每条记录带自己的可见性标记，关注时按各自标记发送
- **导入模式三选一**：全部（总表）/ 公开（并入公开表）/ 私密（并入私密表），增量覆盖
- **三种限流策略**：暂停后自动继续（默认）/ 立即停止 / 取消关注后重新关注（会通知对方）
- **断点续抓**：中断后保留游标，再次点击从断点继续
- **逐页补漏**：全量抓取漏人时（接口异常、深翻页空页），可在关注列表页逐页点「仅抓取当前页」补齐，按标签页自动归类

## 安装

1. 先装 [Tampermonkey](https://www.tampermonkey.net/)（Edge / Chrome）或 Violentmonkey
2. **推荐：装 raw 地址** —— 脚本管理器会记住这个地址，之后据此检查更新

   ```
   https://raw.githubusercontent.com/HY-pt/pixiv-follow-migrator-zh/main/pixiv-follow-migrator-zh.user.js
   ```

3. 或者从 [最新 Release](https://github.com/HY-pt/pixiv-follow-migrator-zh/releases/latest) 下载 `pixiv-follow-migrator-zh.user.js`。

   这样得到的是**一次性快照**，不会自动更新
4. Greasy Fork：**尚未发布**，发布后在这里补链接

> **与上游并存提示**：本分支的 `@name`（含「中文增强版」后缀）与 `@namespace` 都与上游区分，会被识别为独立脚本。
> **安装前请先删掉上游旧版**，否则会同时出现两个面板。

> **关于更新来源**：脚本刻意**不含** `@downloadURL` / `@updateURL` —— Greasy Fork 规则禁止指向外部替代源。
> 从上面的 raw 地址安装时由脚本管理器按安装地址检查更新；从 Release 下载的附件需手动替换。

## 使用要点

1. **抓取**：登录 pixiv 后打开面板，点击「自动抓取全部」，抓取当前账号的关注列表（公开 + 私密分别抓，自动断点续抓）。
   「仅抓取当前页」作为补漏：只补列表里还没有的用户，可见性按当前标签页自动判断（私密页 URL 带 `?rest=hide`），已有条目的标记不会被改动
2. **导入**：把导出的 JSON 导入，按「导入模式」决定并入哪张表
3. **校验**：先点「校验关注状态」确认有多少位已在关注中，确认无误再点「移除已关注记录」
4. **关注**：设置间隔与抖动，点击「开始自动关注」，每条按自己的公开 / 私密标记发送

### 关于「取消关注再关注回来」

该策略会让对方收到**重复关注通知**，已有用户因被反复关注而投诉甚至拉黑。默认策略是「暂停等待后自动续跑」，这条只在确实需要时手动选。

## 已知限制

- **深翻页限制**：pixiv 对较深的 `offset` 有限制，可能返回空页。此时会保留进度，多点几次可以逐步推进
- **注销账号**：`total` 包含已注销 / 冻结账号，接口不返回、网页也看不到，属正常损耗
- **`rest=hide` 只对本人有效**：拿别人的 ID 配自己的 Cookie 请求私密关注，pixiv 会静默降级返回公开关注
- **验证范围**：抓取 / 限流 / 关注等网络行为基于假后端测试（分页、限流、短页、忽略 offset）；界面与交互在真实 pixiv 页面做过抽查，未做全量真机验证，实际行为以真机为准

## 开发

产物由生成器从上游原版拼接，不直接手改：

```
upstream/pixiv-follow-migrator-v3.0.user.js   上游原版（只读基准）
src/生成脚本-patch.js                          生成器：文本替换 + 四段代码拼接
src/片段-数据层.js / 片段-抓取.js
src/片段-关注.js / 片段-列表.js
assets/icon-96.png                            应用图标（构建时转 base64 内嵌）
pixiv-follow-migrator-zh.user.js              产物
pixiv-follow-migrator-zh.meta.js              产物（仅 UserScript 头，供更新比对）
```

重新生成并检查语法：

```bash
node src/生成脚本-patch.js
node --check pixiv-follow-migrator-zh.user.js
```

跑测试（每个用例独立进程）：

```bash
node tests/冒烟测试-smoke.js
node tests/测试-导入模式.js
node tests/测试-抓取当前页.js
node tests/测试-私密首页空.js
node tests/测试-v340.js verify-readonly
node tests/行为测试-behavior.js fetch-all    # 也支持 verify / order / restrict / lock / jitter / ratelimit
```

测试用 `vm.createContext` + DOM 桩 + 假 pixiv fetch，不需要真实登录。

## 版本与反馈

- 改动记录见 [CHANGELOG.md](CHANGELOG.md)，每个版本的安装包见 [Releases](https://github.com/HY-pt/pixiv-follow-migrator-zh/releases)
- 问题与建议：[Issues](https://github.com/HY-pt/pixiv-follow-migrator-zh/issues)

## 许可证

[MIT](LICENSE)。上游版权归 godlessX，本分支的汉化与修改部分归 HY-pt。