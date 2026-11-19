// ==UserScript==
// @name Pixiv Follow Migrator
// @namespace http://tampermonkey.net/
// @version 3.0
// @description Copy your following list across Pixiv accounts — scrape page by page or fetch via API. Export, import, and paste to a new account.
// @author Misery
// @license MIT
// @match https://www.pixiv.net/*
// @grant GM_setValue
// @grant GM_getValue
// @grant unsafeWindow
// @run-at document-start
// @downloadURL https://update.greasyfork.org/scripts/576458/Pixiv%20Follow%20Migrator.user.js
// @updateURL https://update.greasyfork.org/scripts/576458/Pixiv%20Follow%20Migrator.meta.js
// ==/UserScript==
(function () {
  'use strict';
  // ── CSRF Interceptor (runs before Pixiv\'s own JS) ─────────────────────────
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

  // ── Theme Detection ───────────────────────────────────────────────────────
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

  // ── Styles ────────────────────────────────────────────────────────────────
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
      width: 320px; background: ${bg}; border: 1px solid ${border};
      border-radius: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px; color: ${text};
      box-shadow: 0 20px 25px -5px rgba(0,0,0,${d ? '.3' : '.05'}), 0 8px 10px -6px rgba(0,0,0,${d ? '.3' : '.05'});
      user-select: none; overflow: hidden;
    }
    #pfm * { box-sizing: border-box; }
    #pfm-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; background: ${bg}; border-bottom: 1px solid ${border};
      cursor: move;
    }
    .pfm-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }
    .pfm-title-version { font-size: 10px; color: ${sub}; font-weight: 500; padding: 2px 6px; background: ${panelBg}; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    #pfm-hbtns { display: flex; gap: 4px; }
    #pfm-hbtns button {
      background: none; border: none; color: ${sub}; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 4px; border-radius: 4px; transition: background .15s, color .15s;
    }
    #pfm-hbtns button:hover { color: ${text}; background: ${panelBg}; }

    #pfm-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; background: ${panelBg}; }

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
    }
    .pfm-footer-credit:hover { color: ${text}; }

    /* Progress */
    #pfm-prog { display: none; margin-top: 8px; }
    #pfm-track { background: ${border}; border-radius: 99px; height: 6px; overflow: hidden; }
    #pfm-bar { height: 100%; width: 0%; background: ${accent}; transition: width .3s ease; }
    #pfm-blabel { margin-top: 6px; font-size: 11px; color: ${sub}; text-align: center; font-variant-numeric: tabular-nums; }

    #pfm-controls { display: none; gap: 8px; justify-content: center; margin-top: 12px; }
    .pfm-btn-small { padding: 6px 12px; font-size: 11px; border-radius: 8px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .pfm-c-yellow { background: ${d ? '#3b2f15' : '#fef9c3'}; color: #d97706; border-color: #fde047; }
    .pfm-c-green { background: ${d ? '#12301f' : '#dcfce7'}; color: #15803d; border-color: #86efac; }
    .pfm-c-red { background: ${d ? '#3a1a1a' : '#fee2e2'}; color: #dc2626; border-color: #fca5a5; }

    /* Modal */
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

  // ── Helpers ───────────────────────────────────────────────────────────────
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
  function loadList() { try { return JSON.parse(GM_getValue('pfm_list', '[]')); } catch (_) { return []; } }
  function saveList(arr) { GM_setValue('pfm_list', JSON.stringify(arr)); }

  // ── Build Panel ───────────────────────────────────────────────────────────
  function initUI() {
    const theme = getPixivTheme();
    const styleEl = document.createElement('style');
    styleEl.textContent = buildStyles(theme);
    document.head.appendChild(styleEl);

    const panel = document.createElement('div');
    panel.id = 'pfm';
    panel.innerHTML = `
      <div id="pfm-header">
        <div class="pfm-title">🔁 Pixiv Migrator <span class="pfm-title-version">v3.0</span></div>
        <div id="pfm-hbtns">
          <button id="pfm-min" title="Minimize">—</button>
          <button id="pfm-x" title="Close">✕</button>
        </div>
      </div>

      <div id="pfm-body">
        <div id="pfm-status">Ready to migrate.</div>

        <div class="pfm-card">
          <div class="pfm-card-header">1. Grab Following List</div>
          <div class="pfm-card-body">
            <div class="pfm-methods-desc">Note: Only one method is needed.</div>
            <div class="pfm-methods">
              <button class="pfm-btn pfm-btn-outline" id="pfm-fetch">⚡ Auto-Fetch All (Fast)</button>
              <div class="pfm-or-divider">OR</div>
              <button class="pfm-btn pfm-btn-outline" id="pfm-scrape">📄 Scrape Page (Slow)</button>
            </div>
          </div>
        </div>

        <div class="pfm-card">
          <div class="pfm-card-header">2. Transfer to New Account</div>
          <div class="pfm-card-body">
            <div class="pfm-settings-grid">
              <div class="pfm-setting-item pfm-settings-row">
                <label>Follow Limit</label>
                <input id="pfm-limit" class="pfm-input" type="number" min="1" placeholder="All users">
              </div>
              <div class="pfm-setting-item">
                <label>Delay (ms)</label>
                <input id="pfm-delay" class="pfm-input" type="number" value="650" min="300" step="50">
              </div>
              <div class="pfm-setting-item">
                <label>Visibility</label>
                <select id="pfm-restrict" class="pfm-input">
                  <option value="0">Public</option>
                  <option value="1">Private</option>
                </select>
              </div>
            </div>
            <button class="pfm-btn pfm-btn-primary" id="pfm-paste">🚀 Start Auto Follow</button>

            <div id="pfm-prog">
              <div id="pfm-track"><div id="pfm-bar"></div></div>
              <div id="pfm-blabel">0/0</div>
            </div>

            <div id="pfm-controls">
              <button class="pfm-btn-small pfm-c-yellow" id="pfm-pause">⏸ Pause</button>
              <button class="pfm-btn-small pfm-c-green" id="pfm-resume" style="display:none;">▶ Resume</button>
              <button class="pfm-btn-small pfm-c-red" id="pfm-stop">⏹ Stop</button>
            </div>
          </div>
        </div>

        <div class="pfm-actions-tray">
          <button class="pfm-view-btn" id="pfm-view">👁 View List</button>

          <div class="pfm-manage-row">
            <button class="pfm-action-btn" id="pfm-export">💾 Export list</button>
            <button class="pfm-action-btn" id="pfm-import">📂 Import list</button>
          </div>
          <div style="width: 100%;">
            <button class="pfm-action-btn pfm-action-delete" style="width: 100%;" id="pfm-clear">🗑 Clear list</button>
          </div>
        </div>

        <div class="pfm-footer-credit">Made by Misery</div>
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

    // ── Drag ──────────────────────────────────────────────────────────────────
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
      panel.style.left = (e.clientX - ox) + 'px';
      panel.style.top = (e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => drag = false);

    // ── Minimize / Close ──────────────────────────────────────────────────────
    $('pfm-min').addEventListener('click', () => {
      const b = $('pfm-body');
      const minimized = b.style.display === 'none';
      b.style.display = minimized ? 'flex' : 'none';
      $('pfm-min').textContent = minimized ? '—' : '▢';
    });

    const summon = document.createElement('div');
    summon.id = 'pfm-summon';
    summon.title = 'Open Pixiv Migrator';
    summon.textContent = '🔁';
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

    $('pfm-x').addEventListener('click', () => {
      panel.style.display = 'none';
      summon.style.display = 'flex';
    });

    // ── 1. Scrape DOM ─────────────────────────────────────────────────────────
    $('pfm-scrape').addEventListener('click', () => {
      const existing = loadList();
      const existingIds = new Set(existing.map(u => String(u.id)));
      const myId = getCurrentUserId();
      const found = new Map();
      document.querySelectorAll('a[href*="/users/"]').forEach(link => {
        const m = link.href.match(/\/users\/(\d+)/);
        if (!m) return;
        const id = m[1];
        if (id === myId) return;
        let n = link.textContent.trim();
        if (!n) {
          const img = link.querySelector('img');
          n = img?.alt || img?.title || '';
        }
        if (n && (!found.has(id) || found.get(id).startsWith('User '))) found.set(id, n);
      });
      let added = 0;
      found.forEach((name, id) => {
        if (!existingIds.has(id)) { existing.push({ id, name }); existingIds.add(id); added++; }
      });
      saveList(existing);
      flash(`✅ ${added} users found & saved on this page`, '#10b981');
    });

    // ── 2. API Fetch ──────────────────────────────────────────────────────────
    async function apiFetchSegment(userId, rest) {
      const limit = 100; let offset = 0; const ids = []; let total = null;
      while (true) {
        const res = await fetch(`https://www.pixiv.net/ajax/user/${userId}/following?offset=${offset}&limit=${limit}&rest=${rest}&lang=en`,
          { credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }});
        const json = await res.json();
        if (json.error || !json.body?.users) break;
        if (total === null) total = json.body.total ?? null;
        const users = json.body.users;
        if (!users.length) break;
        ids.push(...users.map(u => ({ id: String(u.userId), name: u.userName || 'User ' + u.userId })));
        offset += limit;
        if (users.length < limit) break;
      }
      return { ids, total };
    }

    $('pfm-fetch').addEventListener('click', async () => {
      const pageUserId = getCurrentUserId();
      if (!pageUserId) return flash('❌ Go to a user profile first.', '#ef4444');
      setBusy(true); flash('⏳ Fetching...', '#3b82f6');
      try {
        const pub = await apiFetchSegment(pageUserId, 'show');
        const existing = loadList();
        const existingIds = new Set(existing.map(u => String(u.id)));
        let added = 0;
        pub.ids.forEach(u => {
          if (!existingIds.has(u.id)) { existing.push(u); added++; }
        });
        saveList(existing);
        flash(`✅ Fetched ${pub.ids.length} users (${added} new)`, '#10b981');
      } catch (e) { flash(`❌ Error: ${e.message}`, '#ef4444'); }
      finally { setBusy(false); }
    });

    // ── 3. Paste (Auto Follow) ────────────────────────────────────────────────
    let isPaused = false, shouldStop = false;

    $('pfm-paste').addEventListener('click', async () => {
      const list = loadList();
      if (!list.length) return flash('❌ No users in list.', '#ef4444');

      flash('⏳ Initializing...', '#3b82f6'); setBusy(true);
      let token = await getCsrfTokenWithFallback();
      if (!token) { setBusy(false); return flash('❌ Missing Session Token. Follow manually first.', '#ef4444'); }

      const limitVal = parseInt($('pfm-limit').value, 10);
      const toFollow = (limitVal > 0) ? list.slice(0, limitVal) : list;
      const restrictVal = $('pfm-restrict').value;
      const baseDelay = parseInt($('pfm-delay').value, 10) || 650;

      if (!confirm(`Auto-follow ${toFollow.length} users?\nDelay: ${baseDelay}ms`)) return setBusy(false);

      const controls = $('pfm-controls');
      controls.style.display = 'flex';
      $('pfm-pause').style.display = 'inline-block';
      $('pfm-resume').style.display = 'none';

      isPaused = false; shouldStop = false; window.runFlag = true;
      progEl.style.display = 'block'; setProgress(0, toFollow.length);

      let done = 0, failed = 0, skipped = 0;
      const succeededIds = new Set();

      $('pfm-pause').onclick = () => { isPaused = true; $('pfm-pause').style.display = 'none'; $('pfm-resume').style.display = 'inline-block'; flash('⏸ Paused', '#f59e0b'); };
      $('pfm-resume').onclick = () => { isPaused = false; $('pfm-pause').style.display = 'inline-block'; $('pfm-resume').style.display = 'none'; flash('▶ Resumed', '#10b981'); };
      $('pfm-stop').onclick = () => { shouldStop = true; window.runFlag = false; flash('⏹ Stopping...', '#ef4444'); };

      for (let i = 0; i < toFollow.length; i++) {
        const u = toFollow[i];
        if (!window.runFlag || shouldStop) break;
        while (isPaused && !shouldStop) await sleep(200);
        if (shouldStop) break;

        flash(`⏳ Following ${u.name}...`, '#3b82f6');
        try {
          const fd = new URLSearchParams();
          fd.append('mode', 'add_bookmark_user');
          fd.append('restrict', restrictVal);
          fd.append('user_id', u.id);

          const res = await fetch('https://www.pixiv.net/touch/ajax_api/ajax_api.php', {
            method: 'POST', credentials: 'include',
            headers: { 'Accept': 'application/json', 'x-csrf-token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: fd.toString()
          });

          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data?.isSucceed) { done++; succeededIds.add(u.id); }
            else if (data?.message?.toLowerCase().includes('already')) skipped++;
            else failed++;
          } else failed++;
        } catch (e) { failed++; }

        setProgress(done + failed + skipped, toFollow.length);
        await sleep(baseDelay + Math.random() * 150);
      }

      controls.style.display = 'none';
      if (succeededIds.size > 0) saveList(loadList().filter(u => !succeededIds.has(u.id)));
      flash(`✅ Done: ${done} OK, ${skipped} Skipped, ${failed} Failed`, '#10b981');
      setBusy(false);
    });

    // ── 4. Modals and Exports ─────────────────────────────────────────────────
    $('pfm-view').addEventListener('click', () => {
      const list = loadList();
      if (!list.length) return flash('❌ List is empty.', '#ef4444');
      const backdrop = document.createElement('div');
      backdrop.id = 'pfm-backdrop';
      backdrop.innerHTML = `
        <div id="pfm-modal">
          <div id="pfm-mhead"><span>👥 Users (${list.length})</span><button id="pfm-mx">✕</button></div>
          <input id="pfm-msearch" placeholder="Search name or ID..." autofocus>
          <div id="pfm-mlist"></div>
          <div id="pfm-mfoot"><span></span><button id="pfm-mclear">Clear All</button></div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const listEl = backdrop.querySelector('#pfm-mlist');
      const searchEl = backdrop.querySelector('#pfm-msearch');
      let wList = [...list];

      function render(items) {
        listEl.innerHTML = items.length ? items.map((u, i) => `
          <div class="pfm-urow" data-id="${u.id}">
            <div class="pfm-uinfo">
              <a class="pfm-uname" href="https://www.pixiv.net/users/${u.id}" target="_blank">${u.name}</a>
              <div class="pfm-uid">ID: ${u.id}</div>
            </div>
            <button class="pfm-uremove">✕</button>
          </div>
        `).join('') : '<div style="padding:16px;text-align:center;color:#888;">No results.</div>';

        listEl.querySelectorAll('.pfm-uremove').forEach(b => b.onclick = (e) => {
          const row = e.target.closest('.pfm-urow');
          wList = wList.filter(u => u.id !== row.dataset.id);
          saveList(wList); row.remove();
          backdrop.querySelector('#pfm-mfoot span').textContent = `${wList.length} total`;
        });
      }

      render(list);
      searchEl.oninput = () => {
        const q = searchEl.value.toLowerCase();
        render(wList.filter(u => u.name.toLowerCase().includes(q) || u.id.includes(q)));
      };
      backdrop.querySelector('#pfm-mx').onclick = () => backdrop.remove();
      backdrop.onmousedown = (e) => { if (e.target === backdrop) backdrop.remove(); };
      backdrop.querySelector('#pfm-mclear').onclick = () => { if(confirm('Clear all?')) { saveList([]); backdrop.remove(); flash('🗑 Cleared', '#ef4444'); } };
    });

    $('pfm-export').onclick = () => {
      const list = loadList(); if (!list.length) return;
      const b = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const u = URL.createObjectURL(b);
      Object.assign(document.createElement('a'), { href: u, download: `pixiv-following-${Date.now()}.json` }).click();
    };

    $('pfm-import').onclick = () => fileInput.click();
    fileInput.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = ev => {
        try {
          const j = JSON.parse(ev.target.result);
          const arr = Array.isArray(j) ? j : (j.users || Object.values(j));
          const existing = loadList(); const ids = new Set(existing.map(u=>u.id));
          let c = 0;
          arr.forEach(u => { const id = String(u.id||u.userId||''); if (id && !ids.has(id)) { existing.push({id, name:u.name||'User'}); ids.add(id); c++; } });
          saveList(existing); flash(`📂 Imported ${c} users`, '#10b981');
        } catch(err) { flash('❌ Import failed', '#ef4444'); }
      };
      r.readAsText(file);
      e.target.value = '';
    };

    $('pfm-clear').onclick = () => { if (confirm('Clear saved list?')) { saveList([]); flash('🗑 Cleared', '#ef4444'); } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
  else initUI();
})();
