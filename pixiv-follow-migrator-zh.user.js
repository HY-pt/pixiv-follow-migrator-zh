// ==UserScript==
// @name Pixiv Follow Migrator 中文增强版
// @namespace https://github.com/HY-pt/pixiv-follow-migrator-zh
// @version 3.7.1
// @description 在 Pixiv 账号之间迁移关注列表 —— 分页抓取全部关注、区分公开/私密、随机抖动防限流、断点续传。界面由本仓库自行汉化（上游为英文界面）并修复缺陷。
// @author HY-pt
// @license MIT
// @homepageURL https://github.com/HY-pt/pixiv-follow-migrator-zh
// @supportURL https://github.com/HY-pt/pixiv-follow-migrator-zh/issues
// @match https://www.pixiv.net/*
// @grant GM_setValue
// @grant GM_getValue
// @grant unsafeWindow
// @run-at document-start
// ==/UserScript==
// ── 中文界面 · 本地增强版 · 上游：Pixiv Follow Migrator v3.0 by godlessX (MIT) ──
//    本分支维护者：HY-pt  https://github.com/HY-pt/pixiv-follow-migrator-zh
//    界面汉化由本分支自行完成（上游 v3.0 为英文界面）；在汉化之外还修了：
//    ①抓取只翻一页就停（pixiv 单页上限 100）②关注节奏过于规律被限流
//    ③列表不区分公开/私密 ④撞到限流后可能丢失待办列表 ⑤可重复点击执行 ⑥迁移后关注顺序整体颠倒。
//    分发：GitHub release 提供文件快照，Greasy Fork 作为更新源（站内自动托管 updateURL）。
//    因此本文件刻意不含 @downloadURL / @updateURL —— Greasy Fork 规则禁止指向外部替代源。
//    @name / @namespace 与上游区分，避免同名混淆；安装前请先卸载上游旧版，否则会并存两个面板。
(function () {
  'use strict';
  // ── CSRF 令牌拦截（在 Pixiv 自身脚本之前执行） ─────────────────────────────
  let _token = null;
  window.addEventListener('pfm-csrf-intercept', function(e) {
      if (e.detail) {
          _token = e.detail;
      }
  });

  const injectInterceptor = document.createElement('script');
  injectInterceptor.textContent = `
    (function() {
      const _origFetch = window.fetch;
      window.fetch = function (resource, config) {
        try {
          if (config && config.headers) {
            let headers = config.headers;
            let tok = null;
            if (typeof headers.get === 'function') {
              tok = headers.get('x-csrf-token') || headers.get('X-CSRF-Token');
            } else if (Array.isArray(headers)) {
              for (const [k, v] of headers) {
                if (k.toLowerCase() === 'x-csrf-token') tok = v;
              }
            } else {
              for (const k in headers) {
                if (k.toLowerCase() === 'x-csrf-token') tok = headers[k];
              }
            }
            if (tok) window.dispatchEvent(new CustomEvent('pfm-csrf-intercept', {detail: tok}));
          }
        } catch (_) {}
        return _origFetch.apply(this, arguments);
      };
      const _origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
        if (typeof header === 'string' && header.toLowerCase() === 'x-csrf-token') {
            window.dispatchEvent(new CustomEvent('pfm-csrf-intercept', {detail: value}));
        }
        return _origSetHeader.apply(this, arguments);
      };
    })();
  `;
  document.documentElement.appendChild(injectInterceptor);
  injectInterceptor.remove();

  // ── 主题检测 ────────────────────────────────────────────────────────────────
  function getPixivTheme() {
    try {
      const raw = localStorage.getItem('user-settings-appearance');
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.colorMode === 'dark' || p?.colorMode === 1) return 'dark';
        if (p?.colorMode === 'light' || p?.colorMode === 0) return 'light';
      }
    } catch (_) {}
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number);
      if (rgb?.length >= 3) {
        const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
        return lum < 0.45 ? 'dark' : 'light';
      }
    } catch (_) {}
    return 'light';
  }

  // ── 样式 ────────────────────────────────────────────────────────────────────
  function buildStyles(theme) {
    const d = theme === 'dark';
    const bg = d ? '#0f172a' : '#ffffff';
    const panelBg = d ? '#1e293b' : '#f8fafc';
    const border = d ? '#334155' : '#f1f5f9';
    const border2 = d ? '#475569' : '#e2e8f0';
    const text = d ? '#f8fafc' : '#0f172a';
    const sub = d ? '#94a3b8' : '#64748b';
    const cardBg = d ? '#0f172a' : '#ffffff';
    const cardDim = d ? '#1e293b' : '#f8fafc';
    const cardHover = d ? '#334155' : '#eff6ff';
    const accent = '#2563eb';
    const accentHover = '#1d4ed8';
    const danger = '#dc2626';
    const dangerBg = d ? '#7f1d1d' : '#fef2f2';
    const dangerBorder = d ? '#991b1b' : '#fecaca';

    return `
    #pfm {
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      width: 320px; max-height: calc(100vh - 40px);
      display: flex; flex-direction: column;
      background: ${bg}; border: 1px solid ${border};
      border-radius: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px; color: ${text};
      box-shadow: 0 20px 25px -5px rgba(0,0,0,${d ? '.3' : '.05'}), 0 8px 10px -6px rgba(0,0,0,${d ? '.3' : '.05'});
      user-select: none; overflow: hidden;
    }
    #pfm * { box-sizing: border-box; }
    #pfm-header {
      flex: 0 0 auto;
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; background: ${bg}; border-bottom: 1px solid ${border};
      cursor: move;
    }
    .pfm-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }
    .pfm-title-icon { width: 18px; height: 18px; display: block; flex: 0 0 auto; }
    .pfm-title-version { font-size: 10px; color: ${sub}; font-weight: 500; padding: 2px 6px; background: ${panelBg}; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    #pfm-hbtns { display: flex; gap: 4px; }
    #pfm-hbtns button {
      background: none; border: none; color: ${sub}; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 4px; border-radius: 4px; transition: background .15s, color .15s;
    }
    #pfm-hbtns button:hover { color: ${text}; background: ${panelBg}; }

    /* 压缩：上下 padding 收窄、卡片间距 16→10，整体高度降下来。 */
    #pfm-body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; background: ${panelBg};
      overflow-y: auto; min-height: 0; flex: 1 1 auto; overscroll-behavior: contain; }
    /* body 是 flex column，子项默认 flex-shrink:1，窗口一矮卡片会被压成几像素高而不滚动，
       这里禁止收缩，内容才保持自然高度并触发 overflow-y 滚动。 */
    #pfm-body > * { flex: 0 0 auto; }
    /* 状态栏吸顶：滚到任何位置都能看到最新提示，不会被卡片顶出视野。 */
    #pfm-status { position: sticky; top: 0; z-index: 6; margin: 0 -12px; border-radius: 0;
      border-left: 0; border-right: 0; box-shadow: 0 2px 8px rgba(0,0,0,.10); }
    /* 高级设置折叠：默认收起，把 8 行压到 4 行。 */
    /* 折叠区：实线边框 + 浅底 + 主文字色，确保一眼看出可点开 */
    #pfm-adv { border: 1px solid ${border2}; border-radius: 10px; padding: 0 12px;
      background: ${cardHover}; }
    /* 收起时不留下边距；展开时才补上，避免折叠行被撑高 */
    #pfm-adv[open] { padding-bottom: 12px; }
    #pfm-adv > summary { cursor: pointer; padding: 6px 2px; font-size: 12px; font-weight: 700; line-height: 18px;
      color: ${text};
      list-style: none; display: flex; justify-content: space-between; align-items: center; }
    #pfm-adv > summary::-webkit-details-marker { display: none; }
    #pfm-adv > summary::after { content: '展开 ▾'; font-size: 11px; font-weight: 600;
      color: ${accent}; white-space: nowrap; }
    #pfm-adv[open] > summary::after { content: '收起 ▴'; }
    #pfm-adv .pfm-settings-grid { margin-bottom: 0; }
    /* 关键：作者样式 display:grid 优先级高于浏览器默认的 details 折叠规则，
       不显式隐藏的话 <details> 收起时内容照样渲染（高度根本降不下来）。 */
    #pfm-adv:not([open]) > *:not(summary) { display: none !important; }

    #pfm-status {
      font-size: 12px; font-weight: 500; color: ${text}; padding: 8px 12px;
      background: ${cardBg}; border-radius: 8px; text-align: center; border: 1px solid ${border}; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
    }

    .pfm-card {
      border: 1px solid ${border}; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
    }
    .pfm-card-header {
      background: ${cardBg}; padding: 10px 12px; font-weight: 600; font-size: 12px; border-bottom: 1px solid ${border};
    }
    .pfm-card-body { padding: 12px; background: ${cardDim}; }

    .pfm-methods-desc { font-size: 11px; color: ${sub}; margin-bottom: 10px; text-align: center; }
    .pfm-methods { display: flex; flex-direction: column; gap: 8px; }

    .pfm-btn {
      width: 100%; padding: 8px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all .15s ease; border: 1px solid transparent;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .pfm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pfm-btn:active:not(:disabled) { transform: scale(0.98); }

    .pfm-btn-primary { background: ${accent}; color: white; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2), 0 2px 4px -2px rgba(37, 99, 235, 0.2); }
    .pfm-btn-primary:hover:not(:disabled) { background: ${accentHover}; }

    .pfm-btn-outline { background: ${bg}; border: 1px solid ${border2}; color: ${text}; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); }
    .pfm-btn-outline:hover:not(:disabled) { border-color: ${accent}; background: ${cardHover}; color: ${accent}; }

    .pfm-or-divider {
      display: flex; align-items: center; text-align: center; color: ${sub}; font-size: 10px; margin: 2px 0;
    }
    .pfm-or-divider::before, .pfm-or-divider::after {
      content: ''; flex: 1; border-bottom: 1px solid ${border2};
    }
    .pfm-or-divider:not(:empty)::before { margin-right: .5em; }
    .pfm-or-divider:not(:empty)::after { margin-left: .5em; }

    .pfm-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .pfm-settings-row { grid-column: 1 / -1; }
    .pfm-setting-item { display: flex; flex-direction: column; gap: 4px; }
    .pfm-setting-item label { font-size: 11px; color: ${sub}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .pfm-input {
      width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid ${border2};
      background: ${bg}; color: ${text}; font-size: 12px; outline: none; transition: border-color 0.15s;
    }
    .pfm-input:focus { border-color: ${accent}; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1); }

    .pfm-actions-tray {
      display: flex; flex-direction: column; gap: 8px; padding-top: 12px;
      border-top: 1px solid ${border2}; margin-top: 4px;
    }
    .pfm-view-btn {
      width: 100%; padding: 8px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;
      background: ${bg}; border: 1px solid ${border2}; color: ${text};
      cursor: pointer; transition: all .15s; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
      display: flex; justify-content: center; align-items: center; gap: 6px;
    }
    .pfm-view-btn:hover { border-color: ${accent}; color: ${accent}; background: ${cardHover}; }
    .pfm-view-btn:active { transform: scale(0.98); }

    .pfm-manage-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 0;
    }
    .pfm-action-btn {
      background: ${bg}; border: 1px solid ${border2}; color: ${sub}; font-size: 11px;
      padding: 6px 10px; border-radius: 8px; cursor: pointer; transition: all .15s; font-weight: 500; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
      display: flex; justify-content: center; align-items: center; gap: 4px;
    }
    .pfm-action-btn:hover { background: ${cardHover}; color: ${text}; }
    .pfm-action-btn:active { transform: scale(0.98); }
    .pfm-action-delete { color: ${danger}; border-color: ${dangerBorder}; }
    .pfm-action-delete:hover { border-color: ${dangerBorder}; color: ${danger}; background: ${dangerBg}; }

    .pfm-footer-credit {
      text-align: center; margin-top: 8px; padding-bottom: 4px;
      font-size: 10px; color: ${sub}; font-weight: 500; opacity: 0.8; transition: color .15s;
      text-decoration: none; cursor: pointer;
    }
    .pfm-footer-credit:hover { color: ${text}; text-decoration: underline; }
    .pfm-footer-credit:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; border-radius: 4px; }

    /* 进度条 */
    #pfm-prog { display: none; margin-top: 8px; }
    #pfm-track { background: ${border}; border-radius: 99px; height: 6px; overflow: hidden; }
    #pfm-bar { height: 100%; width: 0%; background: ${accent}; transition: width .3s ease; }
    #pfm-blabel { margin-top: 6px; font-size: 11px; color: ${sub}; text-align: center; font-variant-numeric: tabular-nums; }

    #pfm-controls { display: none; gap: 8px; justify-content: center; margin-top: 12px; }
    .pfm-btn-small { padding: 6px 12px; font-size: 11px; border-radius: 8px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .pfm-c-yellow { background: ${d ? '#3b2f15' : '#fef9c3'}; color: #d97706; border-color: #fde047; }
    .pfm-c-green { background: ${d ? '#12301f' : '#dcfce7'}; color: #15803d; border-color: #86efac; }
    .pfm-c-red { background: ${d ? '#3a1a1a' : '#fee2e2'}; color: #dc2626; border-color: #fca5a5; }

    /* 弹窗 */
    #pfm-backdrop {
      position: fixed; inset: 0; z-index: 9999998; background: rgba(15, 23, 42, .4);
      display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
    }
    #pfm-modal {
      background: ${bg}; border: 1px solid ${border}; border-radius: 16px;
      width: 380px; max-height: 80vh; display: flex; flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,.25); overflow: hidden;
      font-family: inherit; font-size: 13px; color: ${text};
    }
    #pfm-mhead {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; background: ${bg}; border-bottom: 1px solid ${border}; font-weight: 600; font-size: 14px;
    }
    #pfm-mhead button { background: none; border: none; color: ${sub}; cursor: pointer; font-size: 18px; transition: color .1s; }
    #pfm-mhead button:hover { color: ${text}; }
    #pfm-msearch {
      margin: 16px 20px 8px; padding: 10px 14px; background: ${bg}; border: 1px solid ${border2};
      border-radius: 8px; color: ${text}; font-size: 12px; outline: none; box-sizing: border-box;
      width: calc(100% - 40px); transition: border-color .15s;
    }
    #pfm-msearch:focus { border-color: ${accent}; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1); }
    #pfm-mlist {
      overflow-y: auto; padding: 0 20px 20px; display: flex; flex-direction: column; gap: 6px; flex: 1;
    }
    .pfm-urow {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px;
      background: ${bg}; transition: all .15s; border: 1px solid ${border};
    }
    .pfm-urow:hover { background: ${cardHover}; border-color: ${accent}; }
    .pfm-unum { font-size: 11px; color: ${sub}; width: 24px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .pfm-uinfo { flex: 1; min-width: 0; }
    .pfm-uname { font-size: 13px; font-weight: 500; color: ${text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; display: block; }
    .pfm-uname:hover { color: ${accent}; text-decoration: underline; }
    .pfm-uid { font-size: 11px; color: ${sub}; margin-top: 2px; }
    .pfm-utag { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; cursor: pointer;
      border: 1px solid transparent; flex-shrink: 0; background: none; }
    .pfm-utag-0 { background: ${cardHover}; color: ${accent}; border-color: ${accent}; }
    .pfm-utag-1 { background: ${dangerBg}; color: ${danger}; border-color: ${dangerBorder}; }
    .pfm-fbtn { font-size: 11px; padding: 4px 10px; border-radius: 6px; border: 1px solid ${border2};
      background: ${bg}; color: ${sub}; cursor: pointer; }
    .pfm-uremove {
      background: none; border: none; color: ${sub}; cursor: pointer; font-size: 14px; padding: 4px 8px; border-radius: 6px;
      opacity: 0; transition: all .15s; flex-shrink: 0;
    }
    .pfm-urow:hover .pfm-uremove { opacity: 1; }
    .pfm-uremove:hover { color: ${danger}; background: ${dangerBg}; }
    #pfm-mfoot {
      padding: 16px 20px; border-top: 1px solid ${border}; background: ${panelBg};
      display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: ${sub};
    }
    #pfm-mfoot button {
      background: ${bg}; border: 1px solid ${dangerBorder}; border-radius: 8px; color: ${danger};
      font-size: 12px; padding: 8px 16px; cursor: pointer; transition: all .15s; font-weight: 500; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
    }
    #pfm-mfoot button:hover { background: ${dangerBg}; }
    `;
  }

  // ── 工具函数 ────────────────────────────────────────────────────────────────
  function isValidToken(t) { return typeof t === 'string' && /^[a-f0-9]{32}$/i.test(t); }
  function getCsrfToken() {
    if (_token && isValidToken(_token)) return _token;
    try {
      const csrfMeta = document.querySelector('meta[name="csrf-token"], meta[property="csrf-token"], meta[id="csrf-token"]');
      if (csrfMeta && isValidToken(csrfMeta.content)) return (_token = csrfMeta.content);
    } catch (_) {}
    try {
      const meta = document.querySelector('meta[name="global-data"], meta[id="meta-global-data"]');
      if (meta) {
        let contentStr = meta.content;
        if (contentStr.startsWith('&quot;')) contentStr = contentStr.replace(/&quot;/g, '"');
        const d = JSON.parse(contentStr);
        if (isValidToken(d.token)) return (_token = d.token);
      }
    } catch (_) {}
    try {
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        const json = JSON.parse(nd.textContent);
        let t = json?.props?.pageProps?.token || json?.props?.initialProps?.token || json?.props?.pageProps?.userData?.token;
        if (isValidToken(t)) return (_token = t);
      }
    } catch (_) {}
    try {
      const htmlText = document.documentElement.innerHTML;
      const m = htmlText.match(/"(?:csrf)?token"\s*:\s*"([a-f0-9]{32})"/i) || htmlText.match(/name="csrf-token"\s+content="([a-f0-9]{32})"/i);
      if (m && isValidToken(m[1])) return (_token = m[1]);
    } catch (_) {}
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.pixiv?.context?.token && isValidToken(unsafeWindow.pixiv.context.token)) return (_token = unsafeWindow.pixiv.context.token);
    return null;
  }

  async function getCsrfTokenWithFallback() {
    let fast = getCsrfToken();
    if (fast) return fast;
    try {
      const token = await new Promise((resolve) => {
        const ifr = document.createElement('iframe');
        ifr.style.display = 'none';
        ifr.src = 'https://www.pixiv.net/';
        let done = false;
        const complete = (tok) => { if (done) return; done = true; ifr.remove(); resolve(tok); };
        ifr.onload = () => {
          try {
            const doc = ifr.contentDocument || ifr.contentWindow.document;
            let t = doc.querySelector('meta[name="csrf-token"], meta[id="csrf-token"]')?.content;
            complete(isValidToken(t) ? t : null);
          } catch (e) { complete(null); }
        };
        document.body.appendChild(ifr);
        setTimeout(() => complete(null), 4500);
      });
      if (token) return (_token = token);
    } catch (_) {}
    return getCsrfToken();
  }

  function getCurrentUserId() {
    try {
      const meta = document.querySelector('meta[name="global-data"]');
      if (meta) { const d = JSON.parse(meta.content); if (d.userData?.id) return String(d.userData.id); }
    } catch (_) {}
    const urlM = location.pathname.match(/\/users\/(\d+)/);
    if (urlM) return urlM[1];
    return null;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // ── 列表数据层：每条记录都带 restrict（'0' 公开 / '1' 私密），并兼容旧版无字段的数据 ──
  function normalizeItem(u, fallbackRestrict) {
    if (!u) return null;
    const id = String((u.id != null ? u.id : u.userId) || '').trim();
    if (!id) return null;
    const name = String((u.name != null ? u.name : u.userName) || ('用户 ' + id));
    let r = u.restrict;
    if (r === 1 || r === '1' || r === 'hide') r = '1';
    else if (r === 0 || r === '0' || r === 'show') r = '0';
    else r = fallbackRestrict === '1' ? '1' : '0';
    return { id: id, name: name, restrict: r };
  }

  function loadList() {
    let raw = [];
    try { raw = JSON.parse(GM_getValue('pfm_list', '[]')); } catch (_) { raw = []; }
    if (!Array.isArray(raw)) raw = [];
    const out = [], seen = new Set();
    for (const u of raw) {
      const it = normalizeItem(u, '0');
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id); out.push(it);
    }
    return out;
  }

  // 写回时统一结构；返回实际写入的数组，方便调用方继续使用
  function saveList(arr) {
    const seen = new Set(), clean = [];
    for (const u of (arr || [])) {
      const it = normalizeItem(u, '0');
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id); clean.push(it);
    }
    GM_setValue('pfm_list', JSON.stringify(clean));
    return clean;
  }

  function countByRestrict(arr) {
    let pub = 0, priv = 0;
    for (const u of (arr || [])) { if (u && u.restrict === '1') priv++; else pub++; }
    return { pub: pub, priv: priv };
  }

  // 执行锁：抓取 / 关注 / 校验 同一时间只允许跑一个，防止重复执行把状态搅乱
  let pfmTaskLock = null;
  const PFM_LOCK_LABEL = { scrape: '抓取当前页', fetch: '自动抓取', follow: '自动关注', verify: '校验关注状态' };

  // ── 校验快照：校验只产出报告，销毁必须单独确认；销毁前留一份可撤销的备份 ──────
  const PFM_VERIFY_KEY = 'pfm_verify_report';
  const PFM_BACKUP_KEY = 'pfm_list_backup';

  function loadVerifyReport() {
    try { return JSON.parse(GM_getValue(PFM_VERIFY_KEY, 'null')); } catch (_) { return null; }
  }
  function saveVerifyReport(r) {
    try { GM_setValue(PFM_VERIFY_KEY, JSON.stringify(r || null)); } catch (_) {}
  }
  function clearVerifyReport() {
    try { GM_setValue(PFM_VERIFY_KEY, 'null'); } catch (_) {}
  }
  // 销毁前备份（只留最近一次，避免占空间）
  function backupList() {
    try { GM_setValue(PFM_BACKUP_KEY, GM_getValue('pfm_list', '[]')); return true; } catch (_) { return false; }
  }
  function restoreList() {
    let raw = null;
    try { raw = GM_getValue(PFM_BACKUP_KEY, null); } catch (_) {}
    if (!raw) return 0;
    try {
      GM_setValue('pfm_list', raw);
      GM_setValue(PFM_BACKUP_KEY, '');   // 用掉就清掉，避免反复撤销覆盖新数据
      const n = loadList().length;
      clearVerifyReport();
      return n;
    } catch (_) { return 0; }
  }
  function hasBackup() {
    try { return !!GM_getValue(PFM_BACKUP_KEY, ''); } catch (_) { return false; }
  }

  // ── 构建面板 ────────────────────────────────────────────────────────────────
  function initUI() {
    // 应用图标：96px PNG → base64 data URI，user.js 单文件自包含
    const PFM_ICON_URI = 'data:image/png;base64,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';
    const theme = getPixivTheme();
    const styleEl = document.createElement('style');
    styleEl.textContent = buildStyles(theme);
    document.head.appendChild(styleEl);

    const panel = document.createElement('div');
    panel.id = 'pfm';
    panel.innerHTML = `
      <div id="pfm-header">
        <div class="pfm-title"><img class="pfm-title-icon" src="${PFM_ICON_URI}" width="18" height="18" alt=""> Pixiv 关注迁移 <span class="pfm-title-version">v3.7.1 中文</span></div>
        <div id="pfm-hbtns">
          <button id="pfm-min" class="pfm-winbtn" title="最小化到悬浮图标" aria-label="最小化"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="2.2" y="7.4" width="7" height="1.8" rx=".5" fill="currentColor"/></svg></button>
        </div>
      </div>

      <div id="pfm-body">
        <div id="pfm-status">准备就绪。</div>

        <div class="pfm-card">
          <div class="pfm-card-header">1. 获取关注列表</div>
          <div class="pfm-card-body">
            <div class="pfm-methods-desc">抓取对象为当前登录账号的关注列表。</div>
            <div class="pfm-methods">
              <button class="pfm-btn pfm-btn-outline" id="pfm-fetch">自动抓取全部</button>
              <div class="pfm-or-divider">或</div>
              <button class="pfm-btn pfm-btn-outline" id="pfm-scrape">仅抓取当前页</button>
            </div>
          </div>
        </div>

        <div class="pfm-card">
          <div class="pfm-card-header">2. 迁移到新账号</div>
          <div class="pfm-card-body">
            <div class="pfm-settings-grid">
              <div class="pfm-setting-item">
                <label>关注上限</label>
                <input id="pfm-limit" class="pfm-input" type="number" min="1" placeholder="全部用户">
              </div>
              <div class="pfm-setting-item">
                <label>间隔（毫秒）</label>
                <input id="pfm-delay" class="pfm-input" type="number" value="1200" min="300" step="100">
              </div>
              <div class="pfm-setting-item">
                <label>抖动上限（倍）</label>
                <input id="pfm-jitter" class="pfm-input" type="number" value="3" min="1" max="10" step="0.5">
              </div>
              <div class="pfm-setting-item">
                <label>导入模式</label>
                <select id="pfm-import-mode" class="pfm-input" title="全部：按文件内的标记归位；公开 / 私密：整份并入对应关注表（增量合并，同 ID 覆盖可见性）">
                  <option value="auto">全部</option>
                  <option value="pub">公开</option>
                  <option value="priv">私密</option>
                </select>
              </div>
            </div>
            <details id="pfm-adv">
              <summary>高级</summary>
              <div class="pfm-settings-grid" style="margin-top:6px;">
                <div class="pfm-setting-item">
                  <label>长休眠间隔</label>
                  <input id="pfm-batch" class="pfm-input" type="number" value="50" min="0" max="500" step="10" title="每关注 N 位后长休眠一次（最后一位不补）；0 表示不启用">
                </div>
                <div class="pfm-setting-item">
                  <label>长休眠时长（秒）</label>
                  <input id="pfm-rest" class="pfm-input" type="number" value="30" min="5" max="600" step="5">
                </div>
                <div class="pfm-setting-item pfm-settings-row">
                  <label>关注顺序</label>
                  <select id="pfm-order" class="pfm-input">
                    <option value="reverse">还原原账号顺序（推荐）</option>
                    <option value="keep">按列表顺序（关注顺序会反转）</option>
                  </select>
                </div>
                <div class="pfm-setting-item pfm-settings-row">
                  <label>限流处理</label>
                  <select id="pfm-wall" class="pfm-input">
                    <option value="pause">暂停后自动继续（推荐）</option>
                    <option value="stop">立即停止，保留进度</option>
                    <option value="refollow">取消关注后重新关注（对方会收到通知）</option>
                  </select>
                </div>
              </div>
            </details>
            <button class="pfm-btn pfm-btn-primary" id="pfm-paste" style="margin-top:8px;">开始自动关注</button>
            <button class="pfm-btn pfm-btn-outline" id="pfm-verify" style="margin-top:6px;" title="只比对关注状态，不改动列表">校验关注状态</button>
            <button class="pfm-btn pfm-btn-outline" id="pfm-prune" style="margin-top:5px;" title="从本地列表移除已确认在关注的用户，移除前自动备份">移除已关注记录</button>
            <button class="pfm-btn pfm-btn-outline" id="pfm-undo" style="margin-top:5px;">撤销移除</button>

            <div id="pfm-prog">
              <div id="pfm-track"><div id="pfm-bar"></div></div>
              <div id="pfm-blabel">0/0</div>
            </div>

            <div id="pfm-controls">
              <button class="pfm-btn-small pfm-c-yellow" id="pfm-pause">暂停</button>
              <button class="pfm-btn-small pfm-c-green" id="pfm-resume" style="display:none;">继续</button>
              <button class="pfm-btn-small pfm-c-red" id="pfm-stop">停止</button>
            </div>
          </div>
        </div>

        <div class="pfm-actions-tray">
          <button class="pfm-view-btn" id="pfm-view">查看列表</button>

          <div class="pfm-manage-row">
            <button class="pfm-action-btn" id="pfm-export">导出列表</button>
            <button class="pfm-action-btn" id="pfm-import">导入列表</button>
          </div>
          <div style="width: 100%;">
            <button class="pfm-action-btn pfm-action-delete" style="width: 100%;" id="pfm-clear">清空列表</button>
          </div>
        </div>

        <a class="pfm-footer-credit" href="https://github.com/HY-pt/pixiv-follow-migrator-zh" target="_blank" rel="noopener noreferrer" title="在 GitHub 打开本仓库">作者 HY-pt · 上游 godlessX v3.0 (MIT)</a>
      </div>
    `;
    document.body.appendChild(panel);

    const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    const statusEl = panel.querySelector('#pfm-status');
    const progEl = panel.querySelector('#pfm-prog');
    const barEl = panel.querySelector('#pfm-bar');
    const bLabel = panel.querySelector('#pfm-blabel');
    const $ = id => panel.querySelector('#' + id);

    function flash(msg, color) {
      statusEl.textContent = msg;
      statusEl.style.color = color || '';
      statusEl.style.borderColor = color ? color + '44' : '';
    }

    function setProgress(done, total) {
      barEl.style.width = total > 0 ? Math.round((done / total) * 100) + '%' : '0%';
      bLabel.textContent = `${done} / ${total}`;
    }

    const BTNS = ['pfm-scrape','pfm-fetch','pfm-paste','pfm-view','pfm-export','pfm-export-csv','pfm-import','pfm-clear'];
    function setBusy(on) { BTNS.forEach(id => { const b = $(id); if (b) b.disabled = on; }); }

    // ── 拖动 ────────────────────────────────────────────────────────────────────
    let drag = false, ox = 0, oy = 0;
    $('pfm-header').addEventListener('mousedown', e => {
      if (e.target.closest('#pfm-hbtns')) return;
      drag = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.right = panel.style.bottom = 'auto';
      const r = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - r.width);
      const maxTop = Math.max(0, window.innerHeight - r.height);
      // 夹在视口内，保证标题栏上的最小化/关闭永远点得到
      panel.style.left = Math.min(Math.max(0, e.clientX - ox), maxLeft) + 'px';
      panel.style.top = Math.min(Math.max(0, e.clientY - oy), maxTop) + 'px';
    });
    document.addEventListener('mouseup', () => drag = false);

    function clampPanel() {
      if (panel.style.display === 'none') return;
      if (!panel.style.top || panel.style.top === 'auto') return; // 默认右下角吸附
      const r = panel.getBoundingClientRect();
      const maxTop = Math.max(0, window.innerHeight - r.height);
      const maxLeft = Math.max(0, window.innerWidth - r.width);
      panel.style.top = Math.min(Math.max(0, r.top), maxTop) + 'px';
      panel.style.left = Math.min(Math.max(0, r.left), maxLeft) + 'px';
    }
    window.addEventListener('resize', clampPanel);
    clampPanel();

    // ── 最小化 / 关闭 ───────────────────────────────────────────────────────────
    // 最小化：整块面板收进右下角的圆形图标（唯一的最小化入口）
    // 注：原版把「最小化」和「关闭」做成两个按钮，但两者都只是"隐藏面板 + 显示图标"，
    //     属重复实现，故合并为一个。双击标题栏同样可收起。
    $('pfm-min').addEventListener('click', () => {
      panel.style.display = 'none';
      summon.style.display = 'flex';
    });
    $('pfm-header').addEventListener('dblclick', e => {
      if (e.target.closest('button')) return;
      panel.style.display = 'none';
      summon.style.display = 'flex';
    });

    const summon = document.createElement('div');
    summon.id = 'pfm-summon';
    summon.title = '打开 Pixiv 关注迁移';
    // 悬浮图标：与应用图标同一张图（96px PNG 内嵌，不依赖 emoji 字体）
    summon.innerHTML = '<img class="pfm-summon-icon" src="' + PFM_ICON_URI + '" width="96" height="96" alt="" style="width:100%;height:100%;display:block;object-fit:contain">';
    summon.style.cssText = `
      display: none; position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      width: 44px; height: 44px; border-radius: 50%;
      background: ${theme === 'dark' ? '#1a1a24' : '#ffffff'}; border: 1px solid ${theme === 'dark' ? '#2e2e3a' : '#eaeaea'};
      box-shadow: 0 4px 16px rgba(0,0,0,.15); cursor: pointer; font-size: 20px;
      align-items: center; justify-content: center; transition: all .2s;
    `;
    summon.addEventListener('mouseenter', () => summon.style.transform = 'scale(1.1)');
    summon.addEventListener('mouseleave', () => summon.style.transform = '');
    summon.addEventListener('click', () => { panel.style.display = ''; summon.style.display = 'none'; });
    document.body.appendChild(summon);

    // 「关闭」已并入「最小化」，不再单独存在

    // ── 1. 抓取当前页（DOM） ───────────────────────────────────────────────────
    // 局限说明：DOM 里读不到跨页的全局顺序；可见性按当前标签页判断
    //（私密关注页是 ?rest=hide，公开页没有该参数），不需要手动切换。
    // 顺序靠「追加」保证：pixiv 关注页是 1→N 由新到旧，从第 1 页开始逐页抓，
    // 每页内部按 DOM 顺序 push，拼起来就是完整的「新→旧」顺序。
    $('pfm-scrape').addEventListener('click', () => {
      if (pfmTaskLock) return flash(`正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      const existing = loadList();
      const existingIds = new Set(existing.map(u => String(u.id)));
      const myId = getCurrentUserId();
      // 私密关注页 URL 带 rest=hide；其余一律按公开
      let tabRestrict = '0';
      try {
        if (location.search.indexOf('rest=hide') >= 0) tabRestrict = '1';
      } catch (_) {}
      const found = [];
      const foundIds = new Set();

      // 页码提示：能从 URL 读到 p= 就显示，读不到就按点击次数计数
      let pageNo = null;
      try {
        const pm = location.search.match(/[?&]p=(\d+)/);
        if (pm) pageNo = Number(pm[1]);
      } catch (_) {}
      let seq = 0;
      try { seq = Number(GM_getValue('pfm_scrape_seq', '0')) || 0; } catch (_) {}
      seq++;
      try { GM_setValue('pfm_scrape_seq', String(seq)); } catch (_) {}

      document.querySelectorAll('a[href*="/users/"]').forEach(link => {
        const m = link.href.match(/\/users\/(\d+)/);
        if (!m) return;
        const id = m[1];
        if (id === myId || foundIds.has(id)) return;
        let n = link.textContent.trim();
        if (!n) {
          const img = link.querySelector('img');
          n = img && (img.alt || img.title) || '';
        }
        if (!n) return;
        foundIds.add(id);
        found.push({ id: id, name: n, restrict: tabRestrict });
      });

      if (!found.length) return flash('未在页面中找到用户链接，请确认当前位于关注列表页面。', '#ef4444');

      let added = 0;
      for (const u of found) {
        if (existingIds.has(u.id)) continue;
        existing.push(u); existingIds.add(u.id); added++;
      }
      const saved = saveList(existing);
      const c = countByRestrict(saved);
      const where = pageNo !== null ? `第 ${pageNo} 页` : `第 ${seq} 次抓取`;

      const head = added > 0
        ? `${where}：新增 ${added} 位`
        : `${where}：本页 ${found.length} 位均已在列表中`;
      const tip = added > 0 ? '顺序按逐页追加拼接，请从第 1 页开始依次抓取。' : '';
      flash(`${head}，列表共 ${saved.length} 位（公开 ${c.pub} / 私密 ${c.priv}）。` +
            `本页按「${tabRestrict === '1' ? '私密' : '公开'}」归类${tip ? '；' + tip : ''}`, '#10b981');
    });

    // ── 2. 通过 API 抓取（分页到底 + 断点续抓 + 公开/私密分开入库） ─────────────
    // 关键两点：
    //   ① limit=100 时服务端会忽略 offset（见 README），所以用 24；
    //   ② 不能因为「本页不足 24 条」就判定结束 —— pixiv 在深翻页时会返回不完整的页，
    //      提前 break 就会停在 4 页左右（96 条），这正是「只抓到 95/128」的成因。
    const PFM_PAGE = 24;
    const PFM_CURSOR_KEY = 'pfm_cursor';

    function loadCursor(userId) {
      try {
        const c = JSON.parse(GM_getValue(PFM_CURSOR_KEY, '{}'));
        if (c && String(c.userId) === String(userId)) {
          return { show: Number(c.show) || 0, hide: Number(c.hide) || 0 };
        }
      } catch (_) {}
      return { show: 0, hide: 0 };
    }
    function saveCursor(userId, cur) {
      try {
        GM_setValue(PFM_CURSOR_KEY, JSON.stringify({
          userId: String(userId), show: Number(cur.show) || 0, hide: Number(cur.hide) || 0
        }));
      } catch (_) {}
    }
    function clearCursor() { try { GM_setValue(PFM_CURSOR_KEY, '{}'); } catch (_) {} }

    async function apiFetchSegment(userId, rest, startOffset, onPage) {
      let offset = Math.max(0, Number(startOffset) || 0);
      let total = null;
      let pages = 0;
      let reason = null;
      let stuck = 0;                 // 连续「零新增」的次数
      const ids = [];
      const seen = new Set();

      while (pages < 400) {
        let json = null, lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await fetch(`https://www.pixiv.net/ajax/user/${userId}/following?offset=${offset}&limit=${PFM_PAGE}&rest=${rest}&lang=en`,
              { credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }});
            if (res.status === 429 || res.status === 403) {
              lastErr = 'HTTP ' + res.status + '（请求过于频繁，触发限流）';
              await sleep(1200 * attempt);
              continue;
            }
            if (!res.ok) { lastErr = 'HTTP ' + res.status; await sleep(800 * attempt); continue; }
            const j = await res.json();
            if (j && j.error) { lastErr = j.message || '接口返回错误'; await sleep(800 * attempt); continue; }
            json = j;
            break;
          } catch (e) {
            lastErr = e.message || String(e);
            await sleep(800 * attempt);
          }
        }
        if (!json || !json.body || !Array.isArray(json.body.users)) { reason = lastErr || '接口未返回用户列表'; break; }

        if (total === null) total = Number(json.body.total) || null;
        const users = json.body.users;

        // 空页分两种情况，不能一概而论：
        //   ① offset > 0 且 total 还有余量 → 多半是已注销/冻结账号占着总数，属正常损耗；
        //   ② offset == 0 就空（还没拿到任何人）→ 这是请求失败/权限问题，绝不能当成「已完成」，
        //      否则会像之前那样把私密关注整段判成 0/23 并清掉游标。
        if (!users.length) {
          if (offset === 0) {
            reason = lastErr || '首页即返回空数据（可能未登录、接口异常或权限不足）';
          } else if (total !== null && offset < total) {
            reason = 'TAIL_EMPTY';
          }
          break;
        }

        const restrict = rest === 'hide' ? '1' : '0';
        let fresh = 0;
        for (const u of users) {
          const id = String(u.userId);
          if (seen.has(id)) continue;
          seen.add(id); fresh++;
          ids.push({ id: id, name: u.userName || '用户 ' + u.userId, restrict: restrict });
        }

        pages++;
        if (onPage) onPage(ids.length, total, offset);

        // 整页都是重复：offset 被忽略或已到底
        if (fresh === 0) {
          stuck++;
          if (stuck >= 2) { reason = '服务端反复返回同一页（offset 未生效）'; break; }
        } else {
          stuck = 0;
        }

        // 按「实际拿到的条数」前进，避免服务端返回不满页时漏掉尾部
        offset += users.length;
        if (total !== null && offset >= total) break;
        await sleep(300 + Math.random() * 250);
      }

      const done = !reason && (total === null || offset >= total);
      const tail = reason === 'TAIL_EMPTY';   // 尾部空页：正常损耗，不是错误
      return {
        ids: ids, total: total, pages: pages,
        reason: tail ? null : reason,
        tail: tail,
        nextOffset: (done || tail) ? 0 : offset,
        done: done || tail,
      };
    }

    $('pfm-fetch').addEventListener('click', async () => {
      if (pfmTaskLock) return flash(`正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      // 抓的是「当前登录账号」的关注列表 —— 迁移就是从自己账号搬到另一个账号，这里就该用登录身份
      const pageUserId = getCurrentUserId();
      if (!pageUserId) return flash('请先登录 Pixiv 并打开任一用户主页。', '#ef4444');

      pfmTaskLock = 'fetch';
      setBusy(true);
      const cur = loadCursor(pageUserId);
      const resuming = cur.show > 0 || cur.hide > 0;

      try {
        flash(resuming ? `续抓上次进度（公开第 ${cur.show + 1} 位、私密第 ${cur.hide + 1} 位）…` : '正在抓取公开关注…', '#3b82f6');

        const pub = await apiFetchSegment(pageUserId, 'show', cur.show, (n, t, off) => {
          flash(`抓取公开关注：已获取 ${n}${t ? '/' + t : ''} 位（offset ${off}）…`, '#3b82f6');
        });
        flash('正在抓取私密关注…', '#3b82f6');
        let priv = { ids: [], total: 0, reason: null, pages: 0, nextOffset: 0, done: true };
        try {
          priv = await apiFetchSegment(pageUserId, 'hide', cur.hide, (n, t, off) => {
            flash(`抓取私密关注：已获取 ${n}${t ? '/' + t : ''} 位（offset ${off}）…`, '#3b82f6');
          });
        } catch (e) {
          // 私密抓取失败不能静默吞掉 —— 空 catch 会让状态栏显示「私密 0/23」，看着像本来就没数据
          priv = { ids: [], total: 0, reason: '私密抓取出错：' + ((e && e.message) || e), pages: 0, nextOffset: cur.hide, done: false };
        }

        const incoming = pub.ids.concat(priv.ids);
        const existing = loadList();
        const existingIds = new Set(existing.map(u => u.id));
        let addedPub = 0, addedPriv = 0;
        for (const u of incoming) {
          if (existingIds.has(u.id)) continue;
          existing.push(u); existingIds.add(u.id);
          if (u.restrict === '1') addedPriv++; else addedPub++;
        }
        const saved = saveList(existing);
        const c = countByRestrict(saved);

        // 记住进度：下次点击从这里继续，不再从第 1 页重来
        const allDone = pub.done && priv.done;
        if (allDone) clearCursor();
        else saveCursor(pageUserId, { show: pub.nextOffset, hide: priv.nextOffset });

        const detail = `公开 ${pub.ids.length}/${pub.total || '?'}（${pub.pages} 页）· 私密 ${priv.ids.length}/${priv.total || '?'}（${priv.pages} 页）`;
        const reason = pub.reason || priv.reason;

        // 差额归因：total 是 pixiv 记录的关注数，接口给不出的部分通常是
        // 「已注销 / 被冻结 / 小号被限制」的账号 —— 页面上也看不到，属正常损耗。
        const gapPub = (pub.total || 0) - pub.ids.length;
        const gapPriv = (priv.total || 0) - priv.ids.length;
        let gapNote = '';
        if (allDone && (gapPub > 0 || gapPriv > 0)) {
          const parts = [];
          if (gapPub > 0) parts.push(`公开缺 ${gapPub} 位`);
          if (gapPriv > 0) parts.push(`私密缺 ${gapPriv} 位`);
          gapNote = ` 其中 ${parts.join('、')} 位无法获取：账号已注销或被冻结，Pixiv 仍计入总数但不返回数据，属正常损耗。`;
        }

        if (allDone) {
          flash(`抓取完成：${detail}。新增公开 ${addedPub} 位、私密 ${addedPriv} 位，列表共 ${saved.length} 位。${gapNote}`, '#10b981');
        } else {
          const why = reason ? `原因：${reason}。` : '';
          // 注意：这里的「第 N 位」是游标 offset，不是行号；offset 可能因深翻页不满额而推进很慢，
          // 所以同时把「已入库数量」和 total 一起报出来，避免用户看到「从第 1 位继续」这种费解数字。
          const pubGot = pub.ids.length, privGot = priv.ids.length;
          const nextShow = (pub.nextOffset || 0), nextHide = (priv.nextOffset || 0);
          const nudge = `已保存进度：公开 ${pubGot}/${pub.total || '?'}、私密 ${privGot}/${priv.total || '?'}；` +
            `再次点击将从 offset=${nextShow}（私密 offset=${nextHide}）继续。` +
            `若持续在同一 offset 停止，通常是服务端限制了深翻页，多次重试可逐步推进。`;
          flash(`抓取未完成：${detail}。${why}${nudge}`, '#f59e0b');
        }
      } catch (e) {
        flash(`出错：${e.message}`, '#ef4444');
      } finally {
        pfmTaskLock = null;
        setBusy(false);
      }
    });

    // ── 3. 自动关注 ──────────────────────────────────────────────────────────────
    let isPaused = false, shouldStop = false;

    // ── 3. 自动关注（执行锁 + 开始前校验 + 按条走公开/私密 + 撞墙不丢列表） ─────
    // 拉「当前登录账号」现有的关注，用来判断列表里哪些其实已经关注过了
    async function fetchExistingFollowIds() {
      const myId = getCurrentUserId();
      if (!myId) return null;
      const ids = new Set();
      for (const rest of ['show', 'hide']) {
        let offset = 0, total = null;
        while (true) {
          let json = null;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const res = await fetch(`https://www.pixiv.net/ajax/user/${myId}/following?offset=${offset}&limit=100&rest=${rest}&lang=en`,
                { credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }});
              if (!res.ok) { await sleep(900 * attempt); continue; }
              const j = await res.json();
              if (j && j.error) { await sleep(900 * attempt); continue; }
              json = j; break;
            } catch (_) { await sleep(900 * attempt); }
          }
          if (!json) break;
          if (total === null) total = Number(json.body && json.body.total) || null;
          const users = (json.body && json.body.users) || [];
          if (!users.length) break;
          for (const u of users) ids.add(String(u.userId));
          offset += 100;
          if (total !== null && offset >= total) break;
          if (users.length < 100) break;
          await sleep(350 + Math.random() * 250);
        }
      }
      return ids;
    }

    // ── 校验（只读）：比对目标账号已有收藏，产出报告，【绝不修改列表】 ──────────
    // 旧版在这里直接 saveList(remain)，一校验就永久删人，且没有中间态、无法撤销。
    // 现在拆成两步：本函数只算差异；真正删除由「移除已关注记录」按钮单独确认。
    async function buildVerifyReport() {
      const before = loadList();
      if (!before.length) return { ok: false, why: '列表为空' };
      flash('正在比对目标账号已有的关注…', '#3b82f6');
      const have = await fetchExistingFollowIds();
      // have === null 表示连自己的 UID 都取不到；空 Set 表示页面都失败 —— 都不足以下结论
      if (!have) return { ok: false, why: '无法获取当前账号信息（请确认已登录 Pixiv）' };
      if (have.size === 0) {
        return { ok: false, why: '目标账号关注列表返回 0 条，可能未登录或触发限流；已中止比对以避免误删' };
      }
      const already = [], remain = [];
      for (const u of before) (have.has(u.id) ? already : remain).push(u);
      const report = {
        ok: true,
        at: Date.now(),
        total: before.length,
        alreadyCount: already.length,
        remainCount: remain.length,
        alreadyIds: already.map(u => u.id),
        remainIds: remain.map(u => u.id),
      };
      saveVerifyReport(report);
      return report;
    }

    // 「校验关注状态」：只算差异，不改动列表
    $('pfm-verify').addEventListener('click', async () => {
      if (pfmTaskLock) return flash(`正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      pfmTaskLock = 'verify';
      setBusy(true);
      try {
        const r = await buildVerifyReport();
        if (!r.ok) return flash(`校验中止：${r.why}。列表未做改动。`, '#f59e0b');
        if (r.alreadyCount === 0) {
          flash(`校验完成：列表中 ${r.total} 位均未关注，无需移除。列表未改动。`, '#10b981');
        } else {
          flash(`校验完成：共 ${r.total} 位，其中 ${r.alreadyCount} 位已在关注、${r.remainCount} 位待关注。` +
                `列表未改动；如需移除这 ${r.alreadyCount} 位，请点击「移除已关注记录」。`, '#3b82f6');
        }
      } catch (e) {
        flash(`校验失败：${e.message}。列表未改动。`, '#ef4444');
      } finally {
        pfmTaskLock = null;
        setBusy(false);
      }
    });

    // 「移除已关注记录」：真正删除，删除前备份，可一键撤销
    $('pfm-prune').addEventListener('click', async () => {
      if (pfmTaskLock) return flash(`正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      const rep = loadVerifyReport();
      if (!rep || !rep.ok) return flash('尚无可用校验结果，请先执行「校验关注状态」。', '#f59e0b');
      if (!rep.alreadyCount) return flash('无需移除：上次校验显示这些用户均未关注。', '#10b981');

      const cur = loadList();
      const curIds = new Set(cur.map(u => u.id));
      const toRemove = rep.alreadyIds.filter(id => curIds.has(id)).length;
      if (!toRemove) return flash('ℹ️ 上次校验标记的已关注用户已不在列表中，无需移除。', '#3b82f6');

      if (!confirm(`将从列表移除 ${toRemove} 位已确认在关注的用户。\n列表数量：${cur.length} → ${cur.length - toRemove}。\n\n移除前会自动备份，可通过「撤销移除」恢复。是否继续？`)) return;

      pfmTaskLock = 'verify';
      setBusy(true);
      try {
        backupList();
        const drop = new Set(rep.alreadyIds);
        const next = cur.filter(u => !drop.has(u.id));
        const saved = saveList(next);
        clearVerifyReport();
        flash(`已移除 ${toRemove} 位，列表剩余 ${saved.length} 位。可通过「撤销移除」恢复。`, '#10b981');
      } catch (e) {
        flash(`移除失败：${e.message}`, '#ef4444');
      } finally {
        pfmTaskLock = null;
        setBusy(false);
      }
    });

    // 「撤销移除」：把上一次清理前的列表恢复回来
    $('pfm-undo').addEventListener('click', () => {
      if (pfmTaskLock) return flash(`正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      if (!hasBackup()) return flash('ℹ️ 没有可撤销的移除备份。', '#3b82f6');
      const n = restoreList();
      if (n > 0) flash(`已恢复到移除前的列表（${n} 位）。`, '#10b981');
      else flash('撤销失败：备份数据不可用。', '#ef4444');
    });

    $('pfm-paste').addEventListener('click', async () => {
      if (pfmTaskLock) return flash(`正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      const list = loadList();
      if (!list.length) return flash('列表中暂无用户。', '#ef4444');

      pfmTaskLock = 'follow';
      setBusy(true);
      let token = null;
      try {
        flash('正在初始化…', '#3b82f6');
        token = await getCsrfTokenWithFallback();
        if (!token) { flash('未获取到 CSRF 令牌。请先在页面上手动关注一位用户，然后重试。', '#ef4444'); return; }

        const limitVal = parseInt($('pfm-limit').value, 10);
        const baseDelay = Math.max(200, parseInt($('pfm-delay').value, 10) || 1200);
        const jitterMax = Math.max(1, Math.min(10, parseFloat($('pfm-jitter').value) || 3));
        // 长休眠：每处理 batchN 个就休息 restSec 秒，模拟人类节奏（PBD 的「慢速模式」思路）
        const batchN = Math.max(0, parseInt($('pfm-batch') && $('pfm-batch').value, 10) || 0);
        const restSec = Math.max(5, Math.min(600, parseInt($('pfm-rest') && $('pfm-rest').value, 10) || 30));
        // 撞墙策略：pause=暂停等待续跑 / stop=立即停 / refollow=取消再关注（会通知对方）
        const wallMode = ($('pfm-wall') && $('pfm-wall').value) || 'pause';

        // ── 开始前先比对：已关注的人【只跳过、不删除】──────────────────────────
        // 旧版这里直接移除，用户在毫无察觉的情况下丢数据 —— 这是「列表自毁」的第二处来源。
        let skipSet = new Set();
        let preSkipped = 0;
        try {
          const have = await fetchExistingFollowIds();
          if (have && have.size > 0) {
            const cur = loadList();
            skipSet = new Set(cur.filter(u => have.has(u.id)).map(u => u.id));
            preSkipped = skipSet.size;
            if (preSkipped > 0) {
              flash(`ℹ️ ${preSkipped} 位已在关注中，将自动跳过；列表不受影响。`, '#3b82f6');
            }
          }
        } catch (_) {}

        const current = loadList();
        if (!current.length) { flash('列表为空，无需执行。', '#10b981'); return; }
        const pending = current.filter(u => !skipSet.has(u.id));
        if (!pending.length) {
          flash(`列表中 ${current.length} 位均已在关注，无需执行。列表未改动，可通过「移除已关注记录」手动移除。`, '#10b981');
          return;
        }
        // ── 顺序处理 ──────────────────────────────────────────────────────────
        // pixiv 的关注列表是「最新关注的排最前」。抓取时按接口顺序（最新→最早）入库，
        // 若就按这个顺序依次关注，每关注一个人就插到目标账号列表最前，最终显示顺序整个翻转。
        // 所以默认 reverse：从最早关注的开始关注，最后关注的那位才会排最前，还原源账号顺序。
        const orderMode = ($('pfm-order') && $('pfm-order').value) || 'reverse';
        const ordered = orderMode === 'reverse' ? pending.slice().reverse() : pending;
        const toFollow = (limitVal > 0) ? ordered.slice(0, limitVal) : ordered;
        const jobs = toFollow.map(u => ({ id: u.id, name: u.name, restrict: u.restrict === '1' ? '1' : '0' }));
        const pubN = jobs.filter(j => j.restrict === '0').length;
        const privN = jobs.length - pubN;

        const restNote = batchN > 0 ? `每 ${batchN} 个长休眠 ${restSec} 秒。` : '不启用长休眠。';
        const wallNote = wallMode === 'refollow'
          ? '限流处理为「取消关注后重新关注」：对方会收到重复关注通知，请谨慎使用。'
          : (wallMode === 'pause' ? '限流时暂停，冷却后自动继续。' : '限流时立即停止并保留当前进度。');
        if (!confirm(`将关注 ${jobs.length} 位用户（公开 ${pubN} / 私密 ${privN}）。\n` +
                     `间隔基准 ${baseDelay} 毫秒，实际按 1–${jitterMax} 倍随机浮动。\n${restNote}\n${wallNote}`)) return;

        const controls = $('pfm-controls');
        controls.style.display = 'flex';
        $('pfm-pause').style.display = 'inline-block';
        $('pfm-resume').style.display = 'none';

        isPaused = false; shouldStop = false; window.runFlag = true;
        progEl.style.display = 'block'; setProgress(0, jobs.length);

        let done = 0, failed = 0, skipped = 0, streakFail = 0, rateLimited = false;
        const confirmed = new Set();   // 只有「确认成功」或「确认已关注」的才允许移出列表

        function nextDelay(streak) {
          const mult = 1 + Math.random() * (jitterMax - 1);
          let d = baseDelay * mult;
          if (streak > 0) d = Math.min(60000, baseDelay * Math.pow(2, Math.min(streak, 6)) * (0.8 + Math.random() * 0.4));
          return Math.round(d);
        }

        $('pfm-pause').onclick = () => { isPaused = true; $('pfm-pause').style.display = 'none'; $('pfm-resume').style.display = 'inline-block'; flash('已暂停', '#f59e0b'); };
        $('pfm-resume').onclick = () => { isPaused = false; $('pfm-pause').style.display = 'inline-block'; $('pfm-resume').style.display = 'none'; flash('已继续', '#10b981'); };
        $('pfm-stop').onclick = () => { shouldStop = true; window.runFlag = false; flash('正在停止…', '#ef4444'); };

        for (let i = 0; i < jobs.length; i++) {
          const u = jobs[i];
          if (!window.runFlag || shouldStop) break;
          while (isPaused && !shouldStop) await sleep(200);
          if (shouldStop) break;

          flash(`正在关注（${u.restrict === '1' ? '私密' : '公开'}）：${u.name}（${i + 1}/${jobs.length}）`, '#3b82f6');
          let verdict = 'fail';
          try {
            const fd = new URLSearchParams();
            fd.append('mode', 'add_bookmark_user');
            fd.append('restrict', u.restrict);
            fd.append('user_id', u.id);

            const res = await fetch('https://www.pixiv.net/touch/ajax_api/ajax_api.php', {
              method: 'POST', credentials: 'include',
              headers: { 'Accept': 'application/json', 'x-csrf-token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: fd.toString()
            });

            if (res.status === 429 || res.status === 403) { rateLimited = true; verdict = 'fail'; }
            else if (res.ok) {
              const data = await res.json().catch(() => ({}));
              const msg = String(data && data.message || '').toLowerCase();
              if (data && data.isSucceed) verdict = 'ok';
              else if (msg.includes('already') || msg.includes('すでに') || msg.includes('フォロー済み')) verdict = 'skip';
            }
          } catch (_) {}

          if (verdict === 'ok') { done++; confirmed.add(u.id); streakFail = 0; }
          else if (verdict === 'skip') { skipped++; confirmed.add(u.id); streakFail = 0; }
          else { failed++; streakFail++; }

          setProgress(done + failed + skipped, jobs.length);

          // ── 限流处理 ──────────────────────────────────────────────────────
          if (rateLimited || streakFail >= 8) {
            const why = rateLimited ? '被 Pixiv 限流（429/403）' : '连续 8 次失败';
            if (wallMode === 'pause') {
              // 方案 A：暂停等待，然后原地重试（成功率最高、最不冒犯）
              const coolMin = 3 + Math.round(Math.random() * 2);   // 3~5 分钟，贴合 PixiC 实测
              for (let left = coolMin * 60; left > 0 && !shouldStop; left -= 5) {
                flash(`${why}，冷却中：剩余 ${Math.ceil(left / 60)} 分钟（可随时停止）`, '#f59e0b');
                await sleep(5000);
              }
              if (shouldStop) break;
              rateLimited = false; streakFail = 0;
              i--;   // 重试当前这位
              flash('冷却结束，继续。', '#3b82f6');
              continue;
            }
            if (wallMode === 'refollow') {
              // 方案 B：取消关注 → 等一会儿 → 重新关注
              // 代价：对方会收到「又被关注了」的通知；且会改变他在对方列表里的位置。
              flash(`${why}，正在重新关注 ${u.name}…`, '#f59e0b');
              try {
                const del = new URLSearchParams();
                del.append('mode', 'remove_bookmark_user');
                del.append('user_id', u.id);
                await fetch('https://www.pixiv.net/touch/ajax_api/ajax_api.php', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Accept': 'application/json', 'x-csrf-token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: del.toString()
                });
                await sleep(3000 + Math.random() * 2000);
                const add = new URLSearchParams();
                add.append('mode', 'add_bookmark_user');
                add.append('restrict', u.restrict);
                add.append('user_id', u.id);
                const rr = await fetch('https://www.pixiv.net/touch/ajax_api/ajax_api.php', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Accept': 'application/json', 'x-csrf-token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: add.toString()
                });
                if (rr.ok) {
                  const dd = await rr.json().catch(() => ({}));
                  if (dd && dd.isSucceed) {
                    done++; confirmed.add(u.id); failed = Math.max(0, failed - 1);
                    rateLimited = false; streakFail = 0;
                    setProgress(done + failed + skipped, jobs.length);
                    flash(`已重新关注：${u.name}`, '#10b981');
                    continue;
                  }
                }
              } catch (_) {}
              shouldStop = true;
              flash(`${why}，重新关注仍未成功，已停止。建议 10–30 分钟后重试。`, '#ef4444');
              break;
            }
            // 方案 C：直接停
            shouldStop = true;
            flash(`${why}。已停止，建议 10–30 分钟后重新开始。`, '#ef4444');
            break;
          }

          // ── 长休眠：每 batchN 个休息一次 ────────────────────────────────────
          const handled = done + failed + skipped;
          if (batchN > 0 && handled > 0 && handled % batchN === 0 && handled < jobs.length) {
            flash(`长休眠 ${restSec} 秒…已处理 ${handled} 个（可随时停止）`, '#3b82f6');
            for (let left = restSec; left > 0 && !shouldStop; left -= 1) await sleep(1000);
            if (shouldStop) break;
          }

          const d = nextDelay(streakFail);
          flash(`已处理 ${handled}/${jobs.length}，${(d / 1000).toFixed(1)} 秒后继续…`, '#3b82f6');
          await sleep(d);
        }

        // ── 收尾：只移除「确认已完成」的；失败的、没轮到的全部保留 ──────────────
        const remain = loadList().filter(u => !confirmed.has(u.id));
        saveList(remain);
        const c = countByRestrict(remain);

        if (rateLimited) {
          flash(`触发限流，已中止：成功 ${done} · 跳过 ${skipped} · 失败 ${failed}。未完成的 ${remain.length} 位仍保留在列表中（公开 ${c.pub} / 私密 ${c.priv}），建议 10–30 分钟后继续。`, '#ef4444');
        } else if (shouldStop) {
          flash(`已停止：成功 ${done} · 跳过 ${skipped} · 失败 ${failed}。未完成的 ${remain.length} 位仍保留在列表中（公开 ${c.pub} / 私密 ${c.priv}）。`, '#f59e0b');
        } else {
          flash(`已完成：成功 ${done} · 跳过 ${skipped} · 失败 ${failed}。列表剩余 ${remain.length} 位（公开 ${c.pub} / 私密 ${c.priv}）。`, '#10b981');
        }
      } catch (e) {
        flash(`执行出错：${e.message}；未成功的记录已保留。`, '#ef4444');
      } finally {
        const controls = $('pfm-controls');
        if (controls) controls.style.display = 'none';
        pfmTaskLock = null;
        setBusy(false);
      }
    });

    // ── 4. 弹窗与导出 ───────────────────────────────────────────────────────────
    // ── 4. 列表弹窗 / 导出 / 导入 / 清空（区分公开与私密） ───────────────────────
    function downloadJSON(list, filename) {
      const b = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const u = URL.createObjectURL(b);
      Object.assign(document.createElement('a'), { href: u, download: filename }).click();
    }

    $('pfm-view').addEventListener('click', () => {
      const list = loadList();
      if (!list.length) return flash('列表为空。', '#ef4444');
      const cnt = countByRestrict(list);

      const backdrop = document.createElement('div');
      backdrop.id = 'pfm-backdrop';
      backdrop.innerHTML = `
        <div id="pfm-modal">
          <div id="pfm-mhead">
            <span>用户（${list.length}）<small style="font-weight:400;opacity:.7"> 公开 ${cnt.pub} / 私密 ${cnt.priv}</small></span>
            <button id="pfm-mx">✕</button>
          </div>
          <input id="pfm-msearch" placeholder="搜索昵称或 ID…" autofocus>
          <div id="pfm-mfilter" style="display:flex;gap:6px;padding:0 20px 8px;">
            <button class="pfm-fbtn" data-f="all">全部</button>
            <button class="pfm-fbtn" data-f="0">公开</button>
            <button class="pfm-fbtn" data-f="1">私密</button>
          </div>
          <div id="pfm-mlist"></div>
          <div id="pfm-mfoot">
            <span></span>
            <div style="display:flex;gap:6px;">
              <button id="pfm-mexp">导出</button>
              <button id="pfm-mclear">全部清空</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const listEl = backdrop.querySelector('#pfm-mlist');
      const searchEl = backdrop.querySelector('#pfm-msearch');
      let wList = list.slice();
      let filter = 'all';

      function applyFilter() {
        const q = (searchEl.value || '').toLowerCase();
        return wList.filter(u =>
          (filter === 'all' || u.restrict === filter) &&
          (!q || u.name.toLowerCase().includes(q) || u.id.includes(q))
        );
      }

      function render() {
        const items = applyFilter();
        listEl.innerHTML = items.length ? items.map(u => `
          <div class="pfm-urow" data-id="${u.id}">
            <button class="pfm-utag pfm-utag-${u.restrict}" data-id="${u.id}" title="切换公开 / 私密">${u.restrict === '1' ? '私密' : '公开'}</button>
            <div class="pfm-uinfo">
              <a class="pfm-uname" href="https://www.pixiv.net/users/${u.id}" target="_blank">${u.name}</a>
              <div class="pfm-uid">ID：${u.id}</div>
            </div>
            <button class="pfm-uremove">✕</button>
          </div>
        `).join('') : '<div style="padding:16px;text-align:center;color:#888;">没有匹配结果。</div>';

        listEl.querySelectorAll('.pfm-uremove').forEach(b => b.onclick = (e) => {
          const row = e.target.closest('.pfm-urow');
          wList = wList.filter(u => u.id !== row.dataset.id);
          saveList(wList); render();
          backdrop.querySelector('#pfm-mfoot span').textContent = `共 ${wList.length} 位`;
        });

        listEl.querySelectorAll('.pfm-utag').forEach(b => b.onclick = () => {
          const id = b.dataset.id;
          const it = wList.find(u => u.id === id);
          if (!it) return;
          it.restrict = it.restrict === '1' ? '0' : '1';
          saveList(wList); render();
        });

        const c = countByRestrict(wList);
        backdrop.querySelector('#pfm-mfoot span').textContent = `共 ${wList.length} 位（公开 ${c.pub} / 私密 ${c.priv}）`;
      }

      function setFilter(f, btn) {
        filter = f;
        backdrop.querySelectorAll('.pfm-fbtn').forEach(b => b.style.fontWeight = '400');
        btn.style.fontWeight = '700';
        render();
      }
      backdrop.querySelectorAll('.pfm-fbtn').forEach(b => { b.onclick = () => setFilter(b.dataset.f, b); b.style.fontWeight = '400'; });

      render();
      searchEl.oninput = () => render();
      backdrop.querySelector('#pfm-mx').onclick = () => backdrop.remove();
      backdrop.onmousedown = (e) => { if (e.target === backdrop) backdrop.remove(); };

      // 导出：默认全部；公开/私密各有内容时，再给一次「分开导出」的机会
      backdrop.querySelector('#pfm-mexp').onclick = () => {
        const cur = loadList();
        const c = countByRestrict(cur);
        if (c.pub > 0 && c.priv > 0) {
          if (confirm(`列表包含公开 ${c.pub} 位、私密 ${c.priv} 位。\n\n「确定」分别导出两个文件（推荐）\n「取消」合并导出一个文件`)) {
            downloadJSON(cur.filter(u => u.restrict === '0'), `pixiv-following-public-${Date.now()}.json`);
            setTimeout(() => downloadJSON(cur.filter(u => u.restrict === '1'), `pixiv-following-private-${Date.now()}.json`), 400);
          } else {
            downloadJSON(cur, `pixiv-following-all-${Date.now()}.json`);
          }
        } else {
          downloadJSON(cur, `pixiv-following-${Date.now()}.json`);
        }
      };

      backdrop.querySelector('#pfm-mclear').onclick = () => {
        if (!confirm(`确认清空全部 ${wList.length} 位？此操作不可撤销。\n仅清空本地列表，不会取消已关注的账号。`)) return;
        saveList([]); backdrop.remove(); flash('已清空', '#ef4444');
      };
    });

    $('pfm-export').onclick = () => {
      const list = loadList();
      if (!list.length) return flash('列表为空。', '#ef4444');
      const c = countByRestrict(list);
      if (c.pub > 0 && c.priv > 0) {
        if (confirm(`列表包含公开 ${c.pub} 位、私密 ${c.priv} 位。\n\n「确定」分别导出两个文件（推荐）\n「取消」合并导出一个文件`)) {
          downloadJSON(list.filter(u => u.restrict === '0'), `pixiv-following-public-${Date.now()}.json`);
          setTimeout(() => downloadJSON(list.filter(u => u.restrict === '1'), `pixiv-following-private-${Date.now()}.json`), 400);
        } else {
          downloadJSON(list, `pixiv-following-all-${Date.now()}.json`);
        }
      } else {
        downloadJSON(list, `pixiv-following-${Date.now()}.json`);
      }
    };

    $('pfm-import').onclick = () => fileInput.click();
    // ── 导入：把文件「增量并入」列表；可见性由面板上的「导入模式」决定 ──────────
    //   auto = 全部：按文件里每条自己的 restrict；没有标记的算公开
    //   pub  = 公开：整份并入「公开关注表」
    //   priv = 私密：整份并入「私密关注表」
    //   「增量覆盖」的语义：
    //     · 文件里有、列表里没有 → 追加（增量）
    //     · 文件里有、列表里也有 → 用文件的可见性覆盖（覆盖）
    //     · 列表里有、文件里没有 → 原样保留（不清空！）
    function currentImportMode() {
      const el = $('pfm-import-mode');
      const v = el && el.value;
      return (v === 'pub' || v === 'priv') ? v : 'auto';
    }
    const IMPORT_MODE_TEXT = { auto: '全部', pub: '公开', priv: '私密' };

    fileInput.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const mode = currentImportMode();
      const r = new FileReader();
      r.onload = ev => {
        try {
          const j = JSON.parse(ev.target.result);
          const arr = Array.isArray(j) ? j : (j.users || Object.values(j));

          const list = loadList();
          const index = new Map(list.map((u, k) => [u.id, k]));
          let added = 0, updated = 0, same = 0;

          for (const raw of (arr || [])) {
            if (!raw) continue;
            const base = normalizeItem(raw, '0');
            if (!base) continue;
            const target = mode === 'auto' ? base.restrict : (mode === 'priv' ? '1' : '0');

            const k = index.get(base.id);
            if (k === undefined) {
              list.push({ id: base.id, name: base.name, restrict: target });
              index.set(base.id, list.length - 1);
              added++;
            } else if (list[k].restrict !== target) {
              // 覆盖：同一个人，可见性以本次文件为准
              list[k] = { id: list[k].id, name: base.name || list[k].name, restrict: target };
              updated++;
            } else {
              // 可见性一致，顺手更新一下昵称
              list[k] = { id: list[k].id, name: base.name || list[k].name, restrict: target };
              same++;
            }
          }

          const saved = saveList(list);
          const c = countByRestrict(saved);
          const bits = [];
          if (added) bits.push(`新增 ${added}`);
          if (updated) bits.push(`可见性更新 ${updated}`);
          if (!added && !updated) bits.push('无变化');
          flash(`导入完成，已并入「${IMPORT_MODE_TEXT[mode]}」：${bits.join('，')}；` +
                `列表共 ${saved.length} 位（公开 ${c.pub} / 私密 ${c.priv}）`, '#10b981');
        } catch (err) {
          flash('导入失败：文件不是有效的 JSON。', '#ef4444');
        }
      };
      r.readAsText(file);
      e.target.value = '';
    };

    $('pfm-clear').onclick = () => {
      const n = loadList().length;
      if (!n) return flash('列表已为空。', '#ef4444');
      if (!confirm(`确认清空列表中的 ${n} 位？\n仅清空本地记录，不会取消已关注的账号。`)) return;
      saveList([]); flash('已清空', '#ef4444');
    };

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
  else initUI();
})();
