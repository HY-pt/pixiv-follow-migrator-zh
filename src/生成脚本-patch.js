// 把 Pixiv Follow Migrator v3.0 改造成中文界面 + 修复若干行为问题的本地增强版
// 输入：原版v3.0-备份.user.js（从 Edge/Tampermonkey 存储里导出的原始脚本）
// 输出：pixiv-follow-migrator-zh.user.js
const fs = require('fs');
const path = require('path');

// 仓库根目录（本文件位于 src/）
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'upstream', 'pixiv-follow-migrator-v3.0.user.js');
const OUT = path.join(ROOT, 'pixiv-follow-migrator-zh.user.js');
let s = fs.readFileSync(SRC, 'utf8');
const before = s;
const report = [];
const counts = new Map();

// ── 1. 脚本头 ───────────────────────────────────────────────────────────────
s = s.replace(/^\/\/ @version .*$/m, '// @version 3.5.0');
s = s.replace(/^\/\/ @description .*$/m,
  '// @description 在 Pixiv 账号之间迁移关注列表 —— 分页抓取全部关注、区分公开/私密、随机抖动防限流、断点续传。中文界面本地增强版。');
s = s.replace(/^\/\/ @downloadURL .*\r?\n/m, '');
s = s.replace(/^\/\/ @updateURL .*\r?\n/m, '');

// ── 1b. 署名与仓库元数据（本分支由 HY-pt 维护；上游 MIT 版权见 LICENSE）─────
const REPO = 'HY-pt/pixiv-follow-migrator-zh';
// 发布到 Greasy Fork 时必须区分于上游（避免同名劫持判定），并用自己的 namespace。
// 同时**不得**带 @downloadURL / @updateURL 指向外部源——Greasy Fork 规则禁止
// "alternate download URLs"，它会自行注入其站内地址作为更新源。
s = s.replace(/^\/\/ @name .*$/m, '// @name Pixiv Follow Migrator 中文增强版');
s = s.replace(/^\/\/ @namespace .*$/m, '// @namespace https://github.com/' + REPO);
s = s.replace(/^\/\/ @author .*$/m, '// @author HY-pt');
s = s.replace('// @license MIT',
  '// @license MIT\n' +
  '// @homepageURL https://github.com/' + REPO + '\n' +
  '// @supportURL https://github.com/' + REPO + '/issues');

s = s.replace('// ==/UserScript==',
  '// ==/UserScript==\n' +
  '// ── 中文界面 · 本地增强版 · 上游：Pixiv Follow Migrator v3.0 by godlessX (MIT) ──\n' +
  '//    本分支维护者：HY-pt  https://github.com/HY-pt/pixiv-follow-migrator-zh\n' +
  '//    在汉化基础上修了：①抓取只翻一页就停（pixiv 单页上限 100）②关注节奏过于规律被限流\n' +
  '//    ③列表不区分公开/私密 ④撞到限流后可能丢失待办列表 ⑤可重复点击执行 ⑥迁移后关注顺序整体颠倒。\n' +
  '//    分发：GitHub release 提供文件快照，Greasy Fork 作为更新源（站内自动托管 updateURL）。\n' +
  '//    因此本文件刻意不含 @downloadURL / @updateURL —— Greasy Fork 规则禁止指向外部替代源。\n' +
  '//    @name / @namespace 与上游区分，避免同名混淆；安装前请先卸载上游旧版，否则会并存两个面板。');

// ── 2. 注释小节标题 ─────────────────────────────────────────────────────────
const commentPairs = [
  [/^([ \t]*)\/\/ ── CSRF Interceptor[^\n]*/m, '$1// ── CSRF 令牌拦截（在 Pixiv 自身脚本之前执行） ─────────────────────────────'],
  [/^([ \t]*)\/\/ ── Theme Detection[^\n]*/m, '$1// ── 主题检测 ────────────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── Styles[^\n]*/m, '$1// ── 样式 ────────────────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── Helpers[^\n]*/m, '$1// ── 工具函数 ────────────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── Build Panel[^\n]*/m, '$1// ── 构建面板 ────────────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── Drag[^\n]*/m, '$1// ── 拖动 ────────────────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── Minimize \/ Close[^\n]*/m, '$1// ── 最小化 / 关闭 ───────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── 1\. Scrape DOM[^\n]*/m, '$1// ── 1. 抓取当前页 ───────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── 2\. API Fetch[^\n]*/m, '$1// ── 2. 通过 API 抓取 ────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── 3\. Paste \(Auto Follow\)[^\n]*/m, '$1// ── 3. 自动关注 ──────────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\/ ── 4\. Modals and Exports[^\n]*/m, '$1// ── 4. 弹窗与导出 ───────────────────────────────────────────────────────────'],
  [/^([ \t]*)\/\* Progress \*\//m, '$1/* 进度条 */'],
  [/^([ \t]*)\/\* Modal \*\//m, '$1/* 弹窗 */'],
];

// ── 3. 界面文案 ─────────────────────────────────────────────────────────────
const textPairs = [
  ['🔁 Pixiv Migrator <span class="pfm-title-version">v3.0</span>',
   '🔁 Pixiv 关注迁移 <span class="pfm-title-version">v3.5.0 中文</span>'],
  ['title="Minimize"', 'title="最小化"'],
  ['title="Close"', 'title="关闭"'],
  ["'Open Pixiv Migrator'", "'打开 Pixiv 关注迁移'"],
  ['>Ready to migrate.<', '>准备就绪。<'],

  ['1. Grab Following List', '1. 获取关注列表'],
  ['Note: Only one method is needed.', '提示：抓取的是「当前登录账号」的关注列表。'],
  ['⚡ Auto-Fetch All (Fast)', '⚡ 自动抓取全部（快速）'],
  ['>OR<', '>或<'],
  ['📄 Scrape Page (Slow)', '📄 抓取当前页（较慢）'],

  ['2. Transfer to New Account', '2. 迁移到新账号'],
  ['>Follow Limit<', '>关注上限<'],

  // 关注上限与默认可见性并排，省一行高度
  ['<div class="pfm-setting-item pfm-settings-row">\n                <label>关注上限</label>',
   '<div class="pfm-setting-item">\n                <label>关注上限</label>'],
  ['placeholder="All users"', 'placeholder="全部用户"'],
  ['>Delay (ms)<', '>间隔（毫秒）<'],

  // 默认间隔按反爬调研调整：650ms 偏激进（PBD 用固定 1600ms 仍被 429），基准改 1200ms
  ['<input id="pfm-delay" class="pfm-input" type="number" value="650" min="300" step="50">',
   '<input id="pfm-delay" class="pfm-input" type="number" value="1200" min="300" step="100">'],
  ['>Visibility<', '>默认可见性<'],
  ['>Public<', '>公开<'],
  ['>Private<', '>私密<'],
  ['🚀 Start Auto Follow', '🚀 开始自动关注'],

  ['⏸ Paused', '⏸ 已暂停'],
  ['>⏸ Pause<', '>⏸ 暂停<'],
  ['▶ Resumed', '▶ 已继续'],
  ['>▶ Resume<', '>▶ 继续<'],
  ['⏹ Stopping...', '⏹ 正在停止…'],
  ['>⏹ Stop<', '>⏹ 停止<'],

  ['👁 View List', '👁 查看列表'],
  ['💾 Export list', '💾 导出列表'],
  ['📂 Import list', '📂 导入列表'],
  ['🗑 Clear list', '🗑 清空列表'],
  ['Made by Misery', '原作者：Misery'],

  ['✅ ${added} users found & saved on this page', '✅ 本页找到并保存 ${added} 位用户'],
  ['❌ Go to a user profile first.', '❌ 请先登录 pixiv 并打开任意用户主页。'],
  ['❌ List is empty.', '❌ 列表为空。'],

  ['👥 Users (${list.length})', '👥 用户（${list.length}）'],
  ['Search name or ID...', '搜索昵称或 ID…'],
  ['>Clear All<', '>全部清空<'],
  ['No results.', '没有匹配结果。'],
  ['${wList.length} total', '共 ${wList.length} 位'],
  ['ID: ${u.id}', 'ID：${u.id}'],

  ["'User ' + u.userId", "'用户 ' + u.userId"],
  ["startsWith('User ')", "startsWith('用户 ')"],
  ["u.name||'User'", "u.name||'用户'"],

  ['font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;',
   'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Microsoft YaHei\', \'微软雅黑\', \'PingFang SC\', Roboto, Helvetica, Arial, sans-serif;'],
];

// ── 4. 结构与代码改动 ───────────────────────────────────────────────────────
const codePairs = [
  // 4.1 面板高度上限：窗口不最大化时标题栏不再被顶出视口
  ['      position: fixed; bottom: 20px; right: 20px; z-index: 999999;\n' +
   '      width: 320px; background: ${bg}; border: 1px solid ${border};',
   '      position: fixed; bottom: 20px; right: 20px; z-index: 999999;\n' +
   '      width: 320px; max-height: calc(100vh - 40px);\n' +
   '      display: flex; flex-direction: column;\n' +
   '      background: ${bg}; border: 1px solid ${border};'],
  ['    #pfm-header {\n      display: flex; justify-content: space-between; align-items: center;',
   '    #pfm-header {\n      flex: 0 0 auto;\n      display: flex; justify-content: space-between; align-items: center;'],
  ['    #pfm-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; background: ${panelBg}; }',
   '    /* 压缩：上下 padding 收窄、卡片间距 16→10，整体高度降下来。 */\n' +
   '    #pfm-body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; background: ${panelBg};\n' +
   '      overflow-y: auto; min-height: 0; flex: 1 1 auto; overscroll-behavior: contain; }\n' +
   '    /* body 是 flex column，子项默认 flex-shrink:1，窗口一矮卡片会被压成几像素高而不滚动，\n' +
   '       这里禁止收缩，内容才保持自然高度并触发 overflow-y 滚动。 */\n' +
   '    #pfm-body > * { flex: 0 0 auto; }\n' +
   '    /* 状态栏吸顶：滚到任何位置都能看到最新提示，不会被卡片顶出视野。 */\n' +
   '    #pfm-status { position: sticky; top: 0; z-index: 6; margin: 0 -12px; border-radius: 0;\n' +
   '      border-left: 0; border-right: 0; box-shadow: 0 2px 8px rgba(0,0,0,.10); }\n' +
   '    /* 高级设置折叠：默认收起，把 8 行压到 4 行。 */\n' +
   '    #pfm-adv { border: 1px dashed ${border2}; border-radius: 10px; padding: 0 10px 10px; }\n' +
   '    #pfm-adv > summary { cursor: pointer; padding: 8px 2px; font-size: 11px; font-weight: 600; color: ${sub};\n' +
   '      list-style: none; display: flex; justify-content: space-between; align-items: center; }\n' +
   '    #pfm-adv > summary::-webkit-details-marker { display: none; }\n' +
   '    #pfm-adv > summary::after { content: \'▾\'; transition: transform .15s; }\n' +
   '    #pfm-adv[open] > summary::after { transform: rotate(180deg); }\n' +
   '    #pfm-adv .pfm-settings-grid { margin-bottom: 0; }\n' +
   '    /* 关键：作者样式 display:grid 优先级高于浏览器默认的 details 折叠规则，\n' +
   '       不显式隐藏的话 <details> 收起时内容照样渲染（高度根本降不下来）。 */\n' +
   '    #pfm-adv:not([open]) > *:not(summary) { display: none !important; }'],

  // 4.2 公开/私密标签 + 筛选按钮样式
  ['    .pfm-uid { font-size: 11px; color: ${sub}; margin-top: 2px; }',
   '    .pfm-uid { font-size: 11px; color: ${sub}; margin-top: 2px; }\n' +
   '    .pfm-utag { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; cursor: pointer;\n' +
   '      border: 1px solid transparent; flex-shrink: 0; background: none; }\n' +
   '    .pfm-utag-0 { background: ${cardHover}; color: ${accent}; border-color: ${accent}; }\n' +
   '    .pfm-utag-1 { background: ${dangerBg}; color: ${danger}; border-color: ${dangerBorder}; }\n' +
   '    .pfm-fbtn { font-size: 11px; padding: 4px 10px; border-radius: 6px; border: 1px solid ${border2};\n' +
   '      background: ${bg}; color: ${sub}; cursor: pointer; }'],

  // 4.3 设置区重排：常用项在外；「导入模式」三选一；其余收进可折叠的「高级设置」
  //     注意：这里对原版「默认可见性」整块做替换（含 <option> 与闭合标签），
  //     只替换开头标签会留下孤儿 <option>，导致 HTML 结构损坏。
  ['              <div class="pfm-setting-item">\n                <label>默认可见性</label>\n' +
   '                <select id="pfm-restrict" class="pfm-input">\n' +
   '                  <option value="0">公开</option>\n' +
   '                  <option value="1">私密</option>\n' +
   '                </select>\n' +
   '              </div>',
   '              <div class="pfm-setting-item">\n                <label>抖动上限（倍）</label>\n' +
   '                <input id="pfm-jitter" class="pfm-input" type="number" value="3" min="1" max="10" step="0.5">\n' +
   '              </div>\n' +
   '              <div class="pfm-setting-item">\n                <label>导入模式</label>\n' +
   '                <select id="pfm-import-mode" class="pfm-input" title="全部=按文件里的标记；公开/私密=整份并入对应的关注表（增量合并，同 ID 覆盖可见性）">\n' +
   '                  <option value="auto">全部</option>\n' +
   '                  <option value="pub">公开</option>\n' +
   '                  <option value="priv">私密</option>\n' +
   '                </select>\n' +
   '              </div>'],

  // 4.4 校验 / 清理 / 撤销 三个独立按钮（校验不再自动删人）
  // 4.35 高级设置折叠 + 四个主按钮
  ['<button class="pfm-btn pfm-btn-primary" id="pfm-paste">🚀 开始自动关注</button>',
   '<details id="pfm-adv">\n' +
   '              <summary>高级设置（长休眠 · 关注顺序 · 撞墙处理）</summary>\n' +
   '              <div class="pfm-settings-grid" style="margin-top:6px;">\n' +
   '                <div class="pfm-setting-item">\n                  <label>每 N 个长休眠</label>\n' +
   '                  <input id="pfm-batch" class="pfm-input" type="number" value="50" min="0" max="500" step="10" title="0 = 关闭">\n' +
   '                </div>\n' +
   '                <div class="pfm-setting-item">\n                  <label>长休眠时长（秒）</label>\n' +
   '                  <input id="pfm-rest" class="pfm-input" type="number" value="30" min="5" max="600" step="5">\n' +
   '                </div>\n' +
   '                <div class="pfm-setting-item pfm-settings-row">\n                  <label>关注顺序</label>\n' +
   '                  <select id="pfm-order" class="pfm-input">\n' +
   '                    <option value="reverse">还原原账号顺序（推荐）</option>\n' +
   '                    <option value="keep">按列表顺序（会整体颠倒）</option>\n' +
   '                  </select>\n' +
   '                </div>\n' +
   '                <div class="pfm-setting-item pfm-settings-row">\n                  <label>抓取页标记（DOM 抓取用）</label>\n                  <select id="pfm-restrict" class="pfm-input">\n                    <option value="0">公开</option>\n                    <option value="1">私密</option>\n                  </select>\n                </div>\n                <div class="pfm-setting-item pfm-settings-row">\n                  <label>撞墙处理</label>\n' +
   '                  <select id="pfm-wall" class="pfm-input">\n' +
   '                    <option value="pause">暂停等待后自动续跑（推荐）</option>\n' +
   '                    <option value="stop">立即停止，保留进度</option>\n' +
   '                    <option value="refollow">取消关注再关注回来（会通知对方）</option>\n' +
   '                  </select>\n' +
   '                </div>\n' +
   '              </div>\n' +
   '            </details>\n' +
   '            <button class="pfm-btn pfm-btn-primary" id="pfm-paste" style="margin-top:8px;">🚀 开始自动关注</button>\n' +
   '            <button class="pfm-btn pfm-btn-outline" id="pfm-verify" style="margin-top:6px;">🔍 校验并生成报告（不改列表）</button>\n' +
   '            <button class="pfm-btn pfm-btn-outline" id="pfm-prune" style="margin-top:5px;">🗑 执行清理（移除已关注）</button>\n' +
   '            <button class="pfm-btn pfm-btn-outline" id="pfm-undo" style="margin-top:5px;">↩️ 撤销清理</button>'],

  // 4.5 拖动夹取到视口内
  ["    document.addEventListener('mousemove', e => {\n" +
   "      if (!drag) return;\n" +
   "      panel.style.right = panel.style.bottom = 'auto';\n" +
   "      panel.style.left = (e.clientX - ox) + 'px';\n" +
   "      panel.style.top = (e.clientY - oy) + 'px';\n" +
   "    });",
   "    document.addEventListener('mousemove', e => {\n" +
   "      if (!drag) return;\n" +
   "      panel.style.right = panel.style.bottom = 'auto';\n" +
   "      const r = panel.getBoundingClientRect();\n" +
   "      const maxLeft = Math.max(0, window.innerWidth - r.width);\n" +
   "      const maxTop = Math.max(0, window.innerHeight - r.height);\n" +
   "      // 夹在视口内，保证标题栏上的最小化/关闭永远点得到\n" +
   "      panel.style.left = Math.min(Math.max(0, e.clientX - ox), maxLeft) + 'px';\n" +
   "      panel.style.top = Math.min(Math.max(0, e.clientY - oy), maxTop) + 'px';\n" +
   "    });"],

  // 4.6 窗口缩放时把面板拉回可见区域
  ["    document.addEventListener('mouseup', () => drag = false);",
   "    document.addEventListener('mouseup', () => drag = false);\n" +
   "\n" +
   "    function clampPanel() {\n" +
   "      if (panel.style.display === 'none') return;\n" +
   "      if (!panel.style.top || panel.style.top === 'auto') return; // 默认右下角吸附\n" +
   "      const r = panel.getBoundingClientRect();\n" +
   "      const maxTop = Math.max(0, window.innerHeight - r.height);\n" +
   "      const maxLeft = Math.max(0, window.innerWidth - r.width);\n" +
   "      panel.style.top = Math.min(Math.max(0, r.top), maxTop) + 'px';\n" +
   "      panel.style.left = Math.min(Math.max(0, r.left), maxLeft) + 'px';\n" +
   "    }\n" +
   "    window.addEventListener('resize', clampPanel);\n" +
   "    clampPanel();"],
];

// ── 5. 应用文案与结构改动 ───────────────────────────────────────────────────
for (const [re, to] of commentPairs) {
  const m = s.match(re);
  if (!m) report.push(['MISS(comment)', String(re)]);
  else s = s.replace(re, to);
}
for (const [from, to] of textPairs) {
  const n = s.split(from).length - 1;
  counts.set(from, n);
  if (n === 0) report.push(['MISS(text)', from]);
  else s = s.split(from).join(to);
}
for (const [from, to] of codePairs) {
  if (!s.includes(from)) report.push(['MISS(code)', from.split('\n')[0].slice(0, 60)]);
  else s = s.split(from).join(to);
}

// ── 6. 整段替换行为逻辑（数据层 / 抓取 / 关注 / 列表） ──────────────────────
// 用「首尾锚点 + 整段替换」。片段文件自带正确缩进，这里不再额外加空格。
function splice(src, startAnchor, endAnchor, file) {
  const i = src.indexOf(startAnchor);
  if (i < 0) return { ok: false, why: '找不到起点：' + startAnchor.slice(0, 40) };
  const j = src.indexOf(endAnchor, i);
  if (j < 0) return { ok: false, why: '找不到终点：' + endAnchor.slice(0, 40) };
  const body = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\s+$/, '');
  return { ok: true, src: src.slice(0, i) + body + '\n\n' + src.slice(j) };
}

const spliced = [
  ['  function loadList()', '  // ── 构建面板', '片段-数据层.js'],
  ['    // ── 1. 抓取当前页', '    // ── 3. 自动关注', '片段-抓取.js'],
  ["    $('pfm-paste').addEventListener('click', async () => {", '    // ── 4. 弹窗与导出', '片段-关注.js'],
  ["    $('pfm-view').addEventListener('click', () => {", "  }\n\n  if (document.readyState === 'loading')", '片段-列表.js'],
];
for (const [a, b, f] of spliced) {
  const r = splice(s, a, b, f);
  if (!r.ok) report.push(['MISS(splice)', f + ' · ' + r.why]);
  else s = r.src;
}

fs.writeFileSync(OUT, s, 'utf8');

console.log('原文件字符:', before.length, '→ 新文件字符:', s.length);
const multi = [...counts.entries()].filter(([, n]) => n > 1);
if (multi.length) console.log('出现多次（属正常）:', JSON.stringify(multi));
if (report.length) {
  console.log('!! 未匹配项:');
  for (const r of report) console.log('   ', r[0], '|', r[1]);
  process.exitCode = 1;
} else {
  console.log('全部替换成功，无未匹配项。');

// 生成 .meta.js：只含 UserScript 头，供 @updateURL 做版本比对
const headerEnd = s.indexOf('// ==/UserScript==');
if (headerEnd > 0) {
  const meta = s.slice(0, headerEnd + '// ==/UserScript=='.length) + '\n';
  fs.writeFileSync(path.join(ROOT, 'pixiv-follow-migrator-zh.meta.js'), meta);
  console.log('已生成 pixiv-follow-migrator-zh.meta.js（' + meta.length + ' 字符）');
}
}