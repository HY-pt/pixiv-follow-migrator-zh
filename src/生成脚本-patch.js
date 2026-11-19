// 把 Pixiv Follow Migrator v3.0 改造成中文界面 + 修复若干行为问题的本地增强版
// 输入：原版v3.0-备份.user.js（从 Edge/Tampermonkey 存储里导出的原始脚本）
// 输出：pixiv-follow-migrator-zh.user.js
const fs = require('fs');
const path = require('path');

// 仓库根目录（本文件位于 src/）
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'upstream', 'pixiv-follow-migrator-v3.0.user.js');
const OUT = path.join(ROOT, 'pixiv-follow-migrator-zh.user.js');

// ── 0. 应用图标（1254² 原图 → 96px PNG，构建时转 base64 data URI）──────────────
// 标题栏与悬浮图标共用同一份图标。内嵌为 data URI 后 user.js 仍是单文件：
// 不依赖外部图片，也不依赖 emoji 字体（各系统对 的渲染差异很大）。
const ICON_URI = 'data:image/png;base64,' +
  fs.readFileSync(path.join(ROOT, 'assets', 'icon-96.png')).toString('base64');

let s = fs.readFileSync(SRC, 'utf8');
const before = s;
const report = [];
const counts = new Map();

// ── 1. 脚本头 ───────────────────────────────────────────────────────────────
s = s.replace(/^\/\/ @version .*$/m, '// @version 3.7.0');
s = s.replace(/^\/\/ @description .*$/m,
  '// @description 在 Pixiv 账号之间迁移关注列表 —— 分页抓取全部关注、区分公开/私密、随机抖动防限流、断点续传。界面由本仓库自行汉化（上游为英文界面）并修复缺陷。');
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
  '//    界面汉化由本分支自行完成（上游 v3.0 为英文界面）；在汉化之外还修了：\n' +
  '//    ①抓取只翻一页就停（pixiv 单页上限 100）②关注节奏过于规律被限流\n' +
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
  // 标题栏图标：与悬浮图标同一张图，18px 与 14px 粗体标题视觉齐平
  ['.pfm-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }',
   '.pfm-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }\n' +
   '    .pfm-title-icon { width: 18px; height: 18px; display: block; flex: 0 0 auto; }'],
  ['🔁 Pixiv Migrator <span class="pfm-title-version">v3.0</span>',
   '<img class="pfm-title-icon" src="${PFM_ICON_URI}" width="18" height="18" alt=""> Pixiv 关注迁移 <span class="pfm-title-version">v3.7.0 中文</span>'],
  // 卡片 1 的「本页标记」小行（仅 DOM 逐页抓取时用）
  ['    .pfm-methods { display: flex; flex-direction: column; gap: 8px; }',
   '    .pfm-methods { display: flex; flex-direction: column; gap: 8px; }\n' +
   '    .pfm-scrape-tag { display: flex; align-items: center; justify-content: center; gap: 6px;\n' +
   '      margin-top: 2px; font-size: 11px; color: ${sub}; }\n' +
   '    .pfm-tag-select { width: auto; padding: 3px 8px; border-radius: 6px; font-size: 11px;\n' +
   '      border: 1px solid ${border2}; background: ${bg}; color: ${text}; cursor: pointer; }'],

  // 合并「最小化」与「关闭」：只保留一个按钮
  ["          <button id=\"pfm-min\" title=\"Minimize\">—</button>\n          <button id=\"pfm-x\" title=\"Close\">✕</button>",
   "          <button id=\"pfm-min\" class=\"pfm-winbtn\" title=\"最小化到悬浮图标\" aria-label=\"最小化\"><svg viewBox=\"0 0 12 12\" width=\"12\" height=\"12\" aria-hidden=\"true\"><rect x=\"2.2\" y=\"7.4\" width=\"7\" height=\"1.8\" rx=\".5\" fill=\"currentColor\"/></svg></button>"],
  ["'Open Pixiv Migrator'", "'打开 Pixiv 关注迁移'"],
  ['>Ready to migrate.<', '>准备就绪。<'],

  ['1. Grab Following List', '1. 获取关注列表'],
  ['Note: Only one method is needed.', '抓取对象为当前登录账号的关注列表。'],
  ['⚡ Auto-Fetch All (Fast)', '自动抓取全部'],
  ['>OR<', '>或<'],
  ['<button class="pfm-btn pfm-btn-outline" id="pfm-scrape">📄 Scrape Page (Slow)</button>',
   '<button class="pfm-btn pfm-btn-outline" id="pfm-scrape">仅抓取当前页</button>\n' +
   '              <div class="pfm-scrape-tag">本页标记为\n' +
   '                <select id="pfm-restrict" class="pfm-tag-select">\n' +
   '                  <option value="0">公开</option>\n' +
   '                  <option value="1">私密</option>\n' +
   '                </select>\n' +
   '              </div>'],

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
  ['🚀 Start Auto Follow', '开始自动关注'],

  ['⏸ Paused', '已暂停'],
  ['>⏸ Pause<', '>暂停<'],
  ['▶ Resumed', '已继续'],
  ['>▶ Resume<', '>继续<'],
  ['⏹ Stopping...', '正在停止…'],
  ['>⏹ Stop<', '>停止<'],

  ['👁 View List', '查看列表'],
  ['💾 Export list', '导出列表'],
  ['📂 Import list', '导入列表'],
  ['🗑 Clear list', '清空列表'],
  // 署名：本分支作者 + 上游来源（MIT 要求保留上游署名）
  // 原版这行只是个不可点的 div（却有 hover 变色，看着像按钮），改成指向仓库的链接
  ['<div class="pfm-footer-credit">Made by Misery</div>',
   '<a class="pfm-footer-credit" href="https://github.com/HY-pt/pixiv-follow-migrator-zh"' +
   ' target="_blank" rel="noopener noreferrer" title="在 GitHub 打开本仓库">' +
   '作者 HY-pt · 上游 godlessX v3.0 (MIT)</a>'],
  // 链接态：去掉下划线与浏览器默认的链接蓝，hover 时才给下划线做可点反馈
  ['      font-size: 10px; color: ${sub}; font-weight: 500; opacity: 0.8; transition: color .15s;',
   '      font-size: 10px; color: ${sub}; font-weight: 500; opacity: 0.8; transition: color .15s;\n' +
   '      text-decoration: none; cursor: pointer;'],
  ['    .pfm-footer-credit:hover { color: ${text}; }',
   '    .pfm-footer-credit:hover { color: ${text}; text-decoration: underline; }\n' +
   '    .pfm-footer-credit:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; border-radius: 4px; }'],

  ['✅ ${added} users found & saved on this page', '本页找到并保存 ${added} 位用户'],
  ['❌ Go to a user profile first.', '请先登录 Pixiv 并打开任一用户主页。'],
  ['❌ List is empty.', '列表为空。'],

  ['👥 Users (${list.length})', '用户（${list.length}）'],
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
  // ── 应用图标常量：标题栏与悬浮图标共用，base64 只展开一份 ──
  ["  function initUI() {\n    const theme = getPixivTheme();",
   "  function initUI() {\n    // 应用图标：96px PNG → base64 data URI，user.js 单文件自包含\n    const PFM_ICON_URI = '" + ICON_URI + "';\n    const theme = getPixivTheme();"],

  // ── 合并最小化与关闭：原版两个按钮功能重复，都只是隐藏面板 + 显示图标 ──
  ["    $('pfm-min').addEventListener('click', () => {\n      const b = $('pfm-body');\n      const minimized = b.style.display === 'none';\n      b.style.display = minimized ? 'flex' : 'none';\n      $('pfm-min').textContent = minimized ? '—' : '▢';\n    });",
   "    // 最小化：整块面板收进右下角的圆形图标（唯一的最小化入口）\n    // 注：原版把「最小化」和「关闭」做成两个按钮，但两者都只是\"隐藏面板 + 显示图标\"，\n    //     属重复实现，故合并为一个。双击标题栏同样可收起。\n    $('pfm-min').addEventListener('click', () => {\n      panel.style.display = 'none';\n      summon.style.display = 'flex';\n    });\n    $('pfm-header').addEventListener('dblclick', e => {\n      if (e.target.closest('button')) return;\n      panel.style.display = 'none';\n      summon.style.display = 'flex';\n    });"],

  // ── 关闭按钮的 handler 整段移除（功能已并入最小化）──
  ["    $('pfm-x').addEventListener('click', () => {\n      panel.style.display = 'none';\n      summon.style.display = 'flex';\n    });",
   "    // 「关闭」已并入「最小化」，不再单独存在"],

  // ── 悬浮图标改为应用图标（96px PNG 的 base64 data URI）──
  ["    summon.textContent = '🔁';",
   "    // 悬浮图标：与应用图标同一张图（96px PNG 内嵌，不依赖 emoji 字体）\n    summon.innerHTML = '<img class=\"pfm-summon-icon\" src=\"' + PFM_ICON_URI + '\" width=\"96\" height=\"96\" alt=\"\" style=\"width:100%;height:100%;display:block;object-fit:contain\">';"],

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
   '    /* 折叠区：实线边框 + 浅底 + 主文字色，确保一眼看出可点开 */\n' +
   '    #pfm-adv { border: 1px solid ${border2}; border-radius: 10px; padding: 0 12px 12px;\n' +
   '      background: ${cardHover}; }\n' +
   '    #pfm-adv > summary { cursor: pointer; padding: 10px 2px; font-size: 12px; font-weight: 700;\n' +
   '      color: ${text};\n' +
   '      list-style: none; display: flex; justify-content: space-between; align-items: center; }\n' +
   '    #pfm-adv > summary::-webkit-details-marker { display: none; }\n' +
   '    #pfm-adv > summary::after { content: \'展开 ▾\'; font-size: 11px; font-weight: 600;\n' +
   '      color: ${accent}; white-space: nowrap; }\n' +
   '    #pfm-adv[open] > summary::after { content: \'收起 ▴\'; }\n' +
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
   '                <select id="pfm-import-mode" class="pfm-input" title="全部：按文件内的标记归位；公开 / 私密：整份并入对应关注表（增量合并，同 ID 覆盖可见性）">\n' +
   '                  <option value="auto">全部</option>\n' +
   '                  <option value="pub">公开</option>\n' +
   '                  <option value="priv">私密</option>\n' +
   '                </select>\n' +
   '              </div>'],

  // 4.4 校验 / 清理 / 撤销 三个独立按钮（校验不再自动删人）
  // 4.35 高级设置折叠 + 四个主按钮
  ['<button class="pfm-btn pfm-btn-primary" id="pfm-paste">开始自动关注</button>',
   '<details id="pfm-adv">\n' +
   '              <summary>高级</summary>\n' +
   '              <div class="pfm-settings-grid" style="margin-top:6px;">\n' +
   '                <div class="pfm-setting-item">\n                  <label>长休眠间隔</label>\n' +
   '                  <input id="pfm-batch" class="pfm-input" type="number" value="50" min="0" max="500" step="10" title="每关注 N 位后长休眠一次；0 表示不启用">\n' +
   '                </div>\n' +
   '                <div class="pfm-setting-item">\n                  <label>长休眠时长（秒）</label>\n' +
   '                  <input id="pfm-rest" class="pfm-input" type="number" value="30" min="5" max="600" step="5">\n' +
   '                </div>\n' +
   '                <div class="pfm-setting-item pfm-settings-row">\n                  <label>关注顺序</label>\n' +
   '                  <select id="pfm-order" class="pfm-input">\n' +
   '                    <option value="reverse">还原原账号顺序（推荐）</option>\n' +
   '                    <option value="keep">按列表顺序（关注顺序会反转）</option>\n' +
   '                  </select>\n' +
   '                </div>\n' +
   '                <div class="pfm-setting-item pfm-settings-row">\n                  <label>限流处理</label>\n' +
   '                  <select id="pfm-wall" class="pfm-input">\n' +
   '                    <option value="pause">暂停后自动继续（推荐）</option>\n' +
   '                    <option value="stop">立即停止，保留进度</option>\n' +
   '                    <option value="refollow">取消关注后重新关注（对方会收到通知）</option>\n' +
   '                  </select>\n' +
   '                </div>\n' +
   '              </div>\n' +
   '            </details>\n' +
   '            <button class="pfm-btn pfm-btn-primary" id="pfm-paste" style="margin-top:8px;">开始自动关注</button>\n' +
   '            <button class="pfm-btn pfm-btn-outline" id="pfm-verify" style="margin-top:6px;" title="只比对关注状态，不改动列表">校验关注状态</button>\n' +
   '            <button class="pfm-btn pfm-btn-outline" id="pfm-prune" style="margin-top:5px;" title="从本地列表移除已确认在关注的用户，移除前自动备份">移除已关注记录</button>\n' +
   '            <button class="pfm-btn pfm-btn-outline" id="pfm-undo" style="margin-top:5px;">撤销移除</button>'],

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