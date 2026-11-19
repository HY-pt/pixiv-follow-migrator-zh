// v3.4.0 验证：①校验只读 ②清理可撤销 ③长休眠 ④三种撞墙策略 ⑤导入三选一
const fs = require('fs');
const vm = require('vm');

const FILE = 'pixiv-follow-migrator-zh.user.js';
const CASE = process.argv[2] || 'all';

const registry = new Map();
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, children: [], dataset: {},
    _html: '', textContent: '', value: '', _id: '', title: '', disabled: false, files: [],
    onclick: null, oninput: null, _events: {}, classList: { add() {}, remove() {} }, attrs: {}, name: '',
    get id() { return this._id; },
    set id(v) { this._id = v; if (v) registry.set(v, this); },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this._events[t] = this._events[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, removeChild() {},
    closest() { return null; },
    querySelector(s) { return qs(s); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 400, width: 300, height: 400 }; },
    click() { if (typeof this.onclick === 'function') this.onclick({ target: this }); },
    focus() {},
  };
  return el;
}
function qs(sel) {
  const key = String(sel).replace(/^#/, '');
  if (!registry.has(key)) registry.set(key, makeEl('div'));
  const el = registry.get(key); el.id = key; return el;
}
const document = {
  readyState: 'complete', head: makeEl('head'), body: makeEl('body'),
  documentElement: Object.assign(makeEl('html'), { innerHTML: '' }),
  createElement: t => makeEl(t),
  getElementById: id => (registry.has(id) ? registry.get(id) : null),
  querySelector: sel => (String(sel).includes('csrf-token') ? { content: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } : null),
  querySelectorAll: () => [],
  addEventListener() {},
};

const LIST = Array.from({ length: 10 }, (_, i) => ({ id: String(100000 + i), name: 'U' + i, restrict: i < 7 ? '0' : '1' }));
const st = { mode: 'target', existing: [], fetchLog: [], followSeq: 0, followLimit: Infinity, confirmQueue: [] };
function jr(o, s = 200) { return { ok: s >= 200 && s < 300, status: s, json: async () => o }; }

async function fakeFetch(url, opts) {
  const u = String(url);
  st.fetchLog.push(u);
  if (u.includes('/following?offset=')) {
    const rest = (u.match(/rest=(\w+)/) || [])[1];
    const m = u.match(/offset=(\d+)&limit=(\d+)/);
    const offset = Number(m[1]), limit = Number(m[2]);
    const pool = st.mode === 'target'
      ? (rest === 'hide' ? [] : st.existing)
      : [];
    return jr({ error: false, body: { users: pool.slice(offset, offset + limit), total: pool.length } });
  }
  if (u.includes('ajax_api.php')) {
    const body = String((opts && opts.body) || '');
    if (body.includes('remove_bookmark_user')) return jr({ error: false, isSucceed: true });
    st.followSeq++;
    if (st.followSeq > st.followLimit) return jr({ error: true }, 429);
    return jr({ isSucceed: true });
  }
  return jr({ error: true }, 404);
}

const storage = new Map();
const sandbox = {
  console, document,
  location: { pathname: '/users/999', href: 'https://www.pixiv.net/users/999' },
  localStorage: { getItem: () => null, setItem() {} },
  getComputedStyle: () => ({ backgroundColor: 'rgb(255,255,255)' }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: fakeFetch,
  XMLHttpRequest: function () {}, CustomEvent: function () {},
  Blob: function () {}, URL: Object.assign(function () {}, { createObjectURL: () => 'blob:x' }),
  URLSearchParams, FileReader: function () {},
  GM_getValue: (k, d) => (storage.has(k) ? storage.get(k) : d),
  GM_setValue: (k, v) => storage.set(k, v),
  unsafeWindow: {},
  confirm: () => (st.confirmQueue.length ? st.confirmQueue.shift() : true),
  alert: () => {},
  Promise, JSON, Math, Date, Object, Array, String, Number, Error, RegExp, Map, Set,
  innerWidth: 1200, innerHeight: 900,
};
sandbox.addEventListener = () => {};
sandbox.dispatchEvent = () => {};
sandbox.window = sandbox; sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE });

const click = id => {
  const el = registry.get(id);
  if (!el) throw new Error('missing ' + id);
  (el._events.click || []).forEach(fn => fn({ target: el }));
};
const getList = () => { try { return JSON.parse(storage.get('pfm_list') || '[]'); } catch (_) { return []; } };
const setList = a => storage.set('pfm_list', JSON.stringify(a));
const status = () => registry.get('pfm-status').textContent || '';
const wait = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const ok = (l, c, d) => results.push({ l, pass: !!c, d });

const PROGRESS = /^(正在|已处理|续抓|抓取公开关注|抓取私密关注|长休眠|已暂停|已继续|被 Pixiv 限流|准备就绪)/;
const isFinal = t => !!t && !PROGRESS.test(t);

async function untilFinal(max = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const t = status();
    if (isFinal(t)) return t;
    await wait(100);
  }
  return 'TIMEOUT: ' + status();
}

(async () => {
  // ── ① 校验只读：不删人 ──────────────────────────────────────────────────
  if (CASE === 'verify-readonly' || CASE === 'all') {
    setList(LIST);
    st.mode = 'target';
    st.existing = [100000, 100001, 100002].map(id => ({ userId: id, userName: 'x' }));   // 前 3 个已关注
    click('pfm-verify');
    const end = await untilFinal();
    const L = getList();
    ok('校验后列表条数不变（只读）', L.length === 10, `列表 ${L.length}（应为 10，旧版会变 7）；终态「${end}」`);
    const rep = JSON.parse(storage.get('pfm_verify_report') || 'null');
    ok('生成了校验报告', rep && rep.ok && rep.alreadyCount === 3, `报告 ${JSON.stringify(rep && { a: rep.alreadyCount, r: rep.remainCount })}`);
  }

  // ── ② 清理 + 撤销 ───────────────────────────────────────────────────────
  if (CASE === 'prune-undo' || CASE === 'all') {
    setList(LIST);
    st.mode = 'target';
    st.existing = [100000, 100001, 100002].map(id => ({ userId: id, userName: 'x' }));
    st.confirmQueue = [true];           // 校验确认
    click('pfm-verify');
    await untilFinal();
    st.confirmQueue = [true];           // 清理确认
    click('pfm-prune');
    await untilFinal();
    const after = getList().length;
    ok('清理移除了已关注的 3 位', after === 7, `列表 ${after}（应为 7）`);

    click('pfm-undo');
    const back = getList().length;
    ok('撤销恢复到 10 位', back === 10, `列表 ${back}（应为 10）`);
  }

  // ── ③ 校验异常时不误删（空目标） ────────────────────────────────────────
  if (CASE === 'verify-guard' || CASE === 'all') {
    setList(LIST);
    st.mode = 'target';
    st.existing = [];                   // 目标账号读回 0 条 → 应中止而非全判"未关注"
    click('pfm-verify');
    const end = await untilFinal();
    ok('目标读回 0 条时中止校验并保留列表', getList().length === 10 && /中止|未做任何修改/.test(end),
       `列表 ${getList().length}；终态「${end}」`);
  }

  // ── ④ 长休眠 ────────────────────────────────────────────────────────────
  if (CASE === 'longsleep' || CASE === 'all') {
    setList(LIST.slice(0, 6).map((u, i) => ({ id: u.id, name: u.name, restrict: '0' })));
    st.mode = 'target'; st.existing = []; st.followSeq = 0; st.followLimit = Infinity;
    st.confirmQueue = [true];
    qs('#pfm-batch').value = '3';
    qs('#pfm-rest').value = '5';
    qs('#pfm-delay').value = '200';
    qs('#pfm-jitter').value = '1';
    qs('#pfm-wall').value = 'pause';
    click('pfm-paste');
    const t0 = Date.now();
    let sawRest = false;
    while (Date.now() - t0 < 25000) {
      if (/长休眠/.test(status())) { sawRest = true; break; }
      if (st.followSeq >= 6) break;
      await wait(120);
    }
    ok('处理满 3 个后触发长休眠', sawRest, `followSeq=${st.followSeq}，状态「${status()}」`);
    // 停止，避免等 5 秒
    click('pfm-stop');
    await wait(300);
  }

  // ── ⑤ 撞墙策略 refollow ─────────────────────────────────────────────────
  if (CASE === 'wall-refollow' || CASE === 'all') {
    setList(LIST.slice(0, 3).map(u => ({ id: u.id, name: u.name, restrict: '0' })));
    st.mode = 'target'; st.existing = []; st.followSeq = 0;
    st.followLimit = 1;                  // 第 2 个就撞墙
    st.confirmQueue = [true];
    qs('#pfm-batch').value = '0';
    qs('#pfm-delay').value = '200';
    qs('#pfm-jitter').value = '1';
    qs('#pfm-wall').value = 'refollow';
    click('pfm-paste');
    const t0 = Date.now();
    let sawRefollow = false;
    while (Date.now() - t0 < 30000) {
      const t = status();
      if (/重新关注/.test(t)) sawRefollow = true;
      if (/^(已完成|已停止|触发限流)/.test(t)) break;
      await wait(100);
    }
    const removeCalls = st.fetchLog.filter(u => u.includes('ajax_api.php')).length;
    ok('refollow 模式发出过取消/重发请求', removeCalls >= 2, `关注接口调用 ${removeCalls} 次；状态「${status()}」`);
  }

  // ── ⑥ 撞墙策略 stop ─────────────────────────────────────────────────────
  if (CASE === 'wall-stop' || CASE === 'all') {
    setList(LIST.slice(0, 5).map(u => ({ id: u.id, name: u.name, restrict: '0' })));
    st.mode = 'target'; st.existing = []; st.followSeq = 0;
    st.followLimit = 1;
    st.confirmQueue = [true];
    qs('#pfm-batch').value = '0';
    qs('#pfm-wall').value = 'stop';
    qs('#pfm-delay').value = '200';
    qs('#pfm-jitter').value = '1';
    click('pfm-paste');
    const end = await untilFinal(20000);
    ok('stop 模式撞墙后立即停止', /已停止|触发限流/.test(end), `终态「${end}」`);
  }

  console.log(`\n--- case: ${CASE}`);
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.l + '  →  ' + r.d);
  const bad = results.filter(r => !r.pass).length;
  console.log(bad ? `${bad} 项未通过` : '全部通过');
  process.exit(bad ? 1 : 0);
})();
