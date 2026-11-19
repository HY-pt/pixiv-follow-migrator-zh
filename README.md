# Pixiv Follow Migrator · 中文增强版

在 Pixiv 账号之间迁移关注列表的浏览器油猴脚本（Tampermonkey / Violentmonkey）。

**这是 [Pixiv Follow Migrator v3.0](https://greasyfork.org/scripts/576458-pixiv-follow-migrator) 的中文化 + 修 bug 分支，不是原创脚本。**

---

## 魔改来源与声明

| 项目 | 说明 |
| --- | --- |
| **上游原作者** | godlessX（Greasy Fork 账号 [godlessX](https://greasyfork.org/users/1548720-godlessx)） |
| **上游脚本** | [Pixiv Follow Migrator v3.0](https://greasyfork.org/scripts/576458-pixiv-follow-migrator)，发布于 2026-05-03 |
| **上游许可证** | MIT |
| **本分支维护者** | [HY-pt](https://github.com/HY-pt) |
| **本分支性质** | 界面汉化 + 修复上游若干行为缺陷 + 增加功能 |

上游脚本自 2026-05-03 发布后**从未更新**（`code_updated_at` 与 `created_at` 相同），作者未提供任何联系方式、主页或 GitHub 仓库。

需要说明的是：脚本头部原本写的是 `@author Misery`，但**这不是 Greasy Fork 用户名** —— 该账号实际叫 `godlessX`。因此搜 "Misery" 找不到人属正常。

本分支依 MIT 许可证分发：**上游版权声明已完整保留在 [LICENSE](LICENSE) 中**，本仓库仅就自己的修改部分声明版权。

---

## 与上游的差异

### 界面

- 全部界面文案汉化（面板、状态栏、弹窗、确认框）
- 面板支持最小化 / 拖动 / 视口内夹取，状态栏吸顶
- 高级设置折叠，默认只显示常用项

### 修复的缺陷

| # | 上游问题 | 本分支的处理 |
| --- | --- | --- |
| 1 | 抓取只翻一页就停 | 根因是 `limit=100` 时服务端忽略 `offset`；改用 `limit=24` 并按实际返回数前进 |
| 2 | 深翻页时提前中断 | 不再把「本页不足 limit」当「已到底」，只有空页 / 整页重复 / 到达 total 才结束 |
| 3 | 关注节奏过于规律被限流 | 默认间隔 1200ms + 1~3 倍随机抖动 + 每 50 个长休眠 30 秒 |
| 4 | 迁移后关注顺序整体颠倒 | pixiv 是「最新关注排最前」，新增「关注顺序」选项，默认 reverse 还原原顺序 |
| 5 | 撞墙后列表可能整个丢失 | 只移除「确认成功 / 确认已在关注」的记录，失败与未轮到的全部保留 |
| 6 | 可重复点击执行 | 加执行锁 + 断点续抓游标 |
| 7 | 校验会直接删人且不可撤销 | **拆成三个按钮**：校验（只读、只出报告）/ 执行清理（删前备份）/ 撤销清理 |
| 8 | 私密关注抓成 0/23 | 空页区分「第一页就空」（失败）与「尾部空页」（注销账号，正常损耗） |
| 9 | 总数对不上 | 显式说明差额来自已注销 / 被冻结账号 |

### 新增功能

- **公开 / 私密分离**：每条记录带自己的可见性标记，关注时按各自的标记发送
- **导入模式三选一**：全部（总表）/ 公开（并入公开表）/ 私密（并入私密表），增量覆盖
- **三种撞墙策略**：暂停续跑（默认）/ 立即停止 / 取消关注再关注回来
- **断点续抓**：中断后保留游标，再次点击从断点继续

---

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（Edge / Chrome）或 Violentmonkey
2. 打开 [`pixiv-follow-migrator-zh.user.js`](pixiv-follow-migrator-zh.user.js)，点「安装」
3. 或者从 GitHub Release 下载最新附件：
   https://github.com/HY-pt/pixiv-follow-migrator-zh/releases/latest
4. 或者从 Greasy Fork 安装（自动更新来源）：
   ```
   https://raw.githubusercontent.com/HY-pt/pixiv-follow-migrator-zh/main/pixiv-follow-migrator-zh.user.js
   ```

> **与上游并存提示**：本分支的 `@name`（含「中文增强版」后缀）与 `@namespace`
> 都已与上游区分，因此在 Tampermonkey 里会被视为**独立脚本**。
> **安装前请先删掉上游旧版**，否则会同时出现两个面板。
>
> **更新渠道**：GitHub Release 只提供文件快照与下载；自动更新统一走 Greasy Fork。
> 因此本脚本刻意**不含** `@downloadURL` / `@updateURL`（Greasy Fork 规则禁止指向外部替代源）。

---

## 使用要点

1. **抓取**：登录 pixiv 后打开面板，点「自动抓取全部」抓当前账号的关注列表（公开 + 私密分别抓取，自动断点续抓）
2. **导入**：把导出的 JSON 导入，按「导入模式」决定并入哪张表
3. **校验**：先点「校验并生成报告」，确认有 N 位已在关注中；确认无误再点「执行清理」
4. **关注**：设置间隔与抖动，点「开始自动关注」；每条按自己的公开/私密标记发送

### 关于「取消关注再关注回来」策略

该策略会触发对方收到**重复关注通知**。有用户因被反复关注而投诉甚至拉黑，请谨慎使用，默认策略是「暂停等待后自动续跑」。

---

## 已知限制

- **深翻页限制**：pixiv 对 `offset` 较深的位置有限制，可能返回空页。此时会自动保留进度，多点几次即可推进
- **注销账号**：`total` 统计包含已注销 / 冻结账号，这些账号接口不返回、网页也看不到，属正常损耗
- **`rest=hide` 只对本人有效**：拿别人的 ID + 自己的 Cookie 请求私密关注，pixiv 会静默降级返回公开关注
- **未在真实 pixiv 页面做全量验证**：测试基于假后端（分页 / 限流 / 短页 / 忽略 offset）模拟，实际行为请以真机为准

---

## 开发

脚本由生成器从上游原版拼接而来，不直接手改产物：

```
upstream/pixiv-follow-migrator-v3.0.user.js   # 上游原版（只读基准）
生成脚本-patch.js                              # 生成器：文本替换 + 四段代码拼接
片段-数据层.js / 片段-抓取.js / 片段-关注.js / 片段-列表.js
pixiv-follow-migrator-zh.user.js              # 产物
pixiv-follow-migrator-zh.meta.js              # 产物（仅 UserScript 头，供更新比对）
```

重新生成：

```bash
node 生成脚本-patch.js
node --check pixiv-follow-migrator-zh.user.js
```

跑测试（每个用例独立进程）：

```bash
node 行为测试-behavior.js fetch-all      # 也支持 verify / order / restrict / lock / jitter / ratelimit 等
node 测试-导入模式.js
node 测试-v340.js verify-readonly
node 测试-私密首页空.js
node 测试-抓取当前页.js
```

测试用 `vm.createContext` + DOM 桩 + 假 pixiv fetch，不需要真实登录。

---

## 许可证

[MIT](LICENSE)。上游版权归 godlessX，本分支修改部分归 HY-pt。