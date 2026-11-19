// 行为验证：用假 fetch 模拟 pixiv，跑真实脚本逻辑
// 用法：node 行为测试-behavior.js <case>   逐用例独立进程，避免异步残留互相污染
const fs = require('fs');
const vm = require('vm');

const FILE = 'pixiv-follow-migrator-zh.user.js';
const CASE = process.argv[2] || 'all';

// ── DOM 桩 ─────────────────────────────────────────────────────────────────
const registry = new Map();
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, children: [], dataset: {},
    _html: '', textContent: '', value: '', _id: '', title: '', disabled: false, files: [],
    onclick: null, oninput: null, _events: {}, classList: { add() {}, remove() {} }, attrs: {},
    get id() { return this._id; },
    set id(v) { this._id = v; if (v) registry.set(v, this); },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this._events[t] = this._events[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() {}, removeChild(c) { this.children = this.children.filter(x => x !== c); },
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

// ── 假 pixiv：本地数据 = 200 公开 + 50 私密 ────────────────────────────────
const PUB = Array.from({ length: 200 }, (_, i) => ({ userId: 100000 + i, userName: '公开画师' + (100000 + i) }));
const PRIV = Array.from({ length: 50 }, (_, i) => ({ userId: 200000 + i, userName: '私密画师' + (200000 + i) }));
const ALL = PUB.concat(PRIV);

const cfg = { mode: 'source', failOffsetsOnce: new Set(), followLimit: Infinity, targetExisting: [] };
const st = { followed: [], seq: 0, fetchLog: [], delays: [], restrictUsed: [] };
const storage = new Map();

function jr(obj, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => obj }; }

async function fakeFetch(url, opts) {
  const u = String(url);
  st.fetchLog.push(u);

  if (u.includes('/following?offset=')) {
    const m = u.match(/offset=(\d+)&limit=(\d+)/);
    const offset = Number(m[1]), limit = Number(m[2]);
    const rest = (u.match(/rest=(\w+)/) || [])[1];
    if (cfg.failOffsetsOnce.has(offset + ':' + rest)) { cfg.failOffsetsOnce.delete(offset + ':' + rest); return jr({ error: true, message: 'hiccup' }, 500); }
    const pool = cfg.mode === 'target'
      ? (rest === 'hide' ? [] : cfg.targetExisting)
      : (rest === 'hide' ? PRIV : PUB);
    // shortPageFrom: 从该 offset 起每页只返回 12 条（模拟深翻页不满页）
    // ignoreOffset=true 时模拟「offset 不生效」：不管 offset 是几，都只回第一页
    const from = cfg.ignoreOffset ? 0 : offset;
    const effLimit = (cfg.shortPageFrom != null && offset >= cfg.shortPageFrom) ? 12 : limit;
    return jr({ error: false, body: { users: pool.slice(from, from + effLimit), total: pool.length } });
  }

  if (u.includes('ajax_api.php')) {
    st.seq++;
    const body = String((opts && opts.body) || '');
    const id = (body.match(/user_id=(\d+)/) || [])[1];
    const restrict = (body.match(/restrict=(\d+)/) || [])[1];
    st.restrictUsed.push({ id, restrict });
    if (st.seq > cfg.followLimit) return jr({ error: true, message: 'rate limited' }, 429);
    st.followed.push(id);
    return jr({ isSucceed: true });
  }
  return jr({ error: true }, 404);
}

const realSetTimeout = setTimeout;
const sandbox = {
  console, document,
  location: { pathname: '/users/999999', href: 'https://www.pixiv.net/users/999999' },
  localStorage: { getItem: () => null, setItem() {} },
  getComputedStyle: () => ({ backgroundColor: 'rgb(255,255,255)' }),
  setTimeout: (fn, ms, ...a) => { if (ms >= 100) st.delays.push(ms); return realSetTimeout(fn, ms, ...a); },
  clearTimeout, setInterval, clearInterval,
  fetch: fakeFetch,
  XMLHttpRequest: function () {}, CustomEvent: function (n, o) { this.type = n; this.detail = o && o.detail; },
  Blob: function () {}, URL: Object.assign(function () {}, { createObjectURL: () => 'blob:x' }),
  URLSearchParams, FileReader: function () {},
  GM_getValue: (k, d) => (storage.has(k) ? storage.get(k) : d),
  GM_setValue: (k, v) => storage.set(k, v),
  unsafeWindow: {}, confirm: () => true, alert: () => {},
  Promise, JSON, Math, Date, Object, Array, String, Number, Error, RegExp, Map, Set,
  innerWidth: 1200, innerHeight: 900,
};
sandbox.addEventListener = () => {};
sandbox.dispatchEvent = () => {};
sandbox.window = sandbox; sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE });

const wait = ms => new Promise(r => realSetTimeout(r, ms));
const click = id => {
  const el = registry.get(id);
  if (!el) throw new Error('missing ' + id);
  (el._events.click || []).forEach(fn => fn({ target: el }));
};
const getList = () => { try { return JSON.parse(storage.get('pfm_list') || '[]'); } catch (_) { return []; } };
const setList = a => storage.set('pfm_list', JSON.stringify(a));
const status = () => (registry.get('pfm-status') || {}).textContent || '';
const mk = (n, from = 0) => ALL.slice(from, from + n).map(u => ({ id: String(u.userId), name: u.userName, restrict: String(u.userId) >= '200000' ? '1' : '0' }));

const PROGRESS = /^(正在|已处理|续抓|抓取公开关注|抓取私密关注|长休眠|已暂停|已继续|被 Pixiv 限流|准备就绪)/;
const isFinal = t => !!t && !PROGRESS.test(t);

async function untilFinal(maxMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const t = status();
    if (isFinal(t)) return t;
    await wait(120);
  }
  return 'TIMEOUT: ' + status();
}

const results = [];
const ok = (label, cond, detail) => results.push({ label, pass: !!cond, detail });

(async () => {
  // ── 抓取：分页到底 + 公开/私密分开入库 ───────────────────────────────────
  if (CASE === 'fetch-all' || CASE === 'all') {
    cfg.mode = 'source';
    click('pfm-fetch');
    const end = await untilFinal();
    const L = getList();
    const pub = L.filter(u => u.restrict === '0').length;
    const priv = L.filter(u => u.restrict === '1').length;
    ok('抓取 250 位全部入库（旧版停在 100）', L.length === 250, `入库 ${L.length}，fetch ${st.fetchLog.length} 次；终态「${end}」`);
    ok('公开/私密自动分开标记', pub === 200 && priv === 50, `公开 ${pub} / 私密 ${priv}`);
  }

  // ── 抓取：单页 500 后重试仍拿全 ──────────────────────────────────────────
  if (CASE === 'fetch-retry' || CASE === 'all') {
    cfg.mode = 'source';
    cfg.failOffsetsOnce = new Set(['72:show']);
    click('pfm-fetch');
    const end = await untilFinal();
    const tries = st.fetchLog.filter(u => u.includes('offset=72') && u.includes('rest=show')).length;
    ok('单页 500 后重试仍拿全', getList().length === 250 && tries >= 2, `入库 ${getList().length}；重试 ${tries} 次；终态「${end}」`);
  }

  // ── 抖动 ──────────────────────────────────────────────────────────────────
  if (CASE === 'jitter' || CASE === 'all') {
    cfg.mode = 'target'; cfg.targetExisting = []; cfg.followLimit = Infinity;
    setList(mk(30, 0));
    qs('#pfm-jitter').value = '3';
    qs('#pfm-delay').value = '650';
    click('pfm-paste');
    const t0 = Date.now();
    while (Date.now() - t0 < 40000 && st.followed.length < 30) await wait(50);
    await wait(400);
    const d = st.delays.filter(ms => ms >= 600 && ms <= 2000);
    const uniq = new Set(d.map(x => Math.round(x / 10))).size;
    ok('间隔落在 1～3 倍区间（650ms 下限）', d.length >= 10 && Math.min(...d) >= 649 && Math.max(...d) <= 1955,
       `样本 ${d.length}，范围 ${Math.round(Math.min(...d))}~${Math.round(Math.max(...d))}ms`);
    ok('间隔随机而非恒定', uniq >= 8, `不同取值 ${uniq} 种`);
  }

  // ── 限流：停下 + 列表绝不全丢 ────────────────────────────────────────────
  if (CASE === 'ratelimit' || CASE === 'all') {
    cfg.mode = 'target'; cfg.targetExisting = []; cfg.followLimit = 12;
    setList(mk(30, 0));
    qs('#pfm-jitter').value = '3';
    qs('#pfm-wall').value = 'stop';      // v3.4.0 默认是 pause（冷却续跑），这里显式测 stop
    click('pfm-paste');
    const end = await untilFinal(60000);
    const left = getList();
    ok('stop 策略下 429 后立即停止', st.seq <= 14, `发出 ${st.seq} 次关注请求（阈值 12、列表 30）`);
    ok('未成功的全部保留在列表（撞墙不全丢）', left.length === 18,
       `剩余 ${left.length}（应为 30−12=18）`);
    ok('状态栏说明被限流并告知剩余数', /限流/.test(end) && /18/.test(end), `终态「${end}」`);
  }

  // ── 默认策略 pause：撞墙后进入冷却而不是直接放弃 ─────────────────────────
  if (CASE === 'wall-pause' || CASE === 'all') {
    cfg.mode = 'target'; cfg.targetExisting = []; cfg.followLimit = 2;
    setList(mk(5, 0));
    qs('#pfm-jitter').value = '1';
    qs('#pfm-delay').value = '200';
    qs('#pfm-wall').value = 'pause';     // 默认值
    click('pfm-paste');
    const t0 = Date.now();
    let sawCooling = false;
    while (Date.now() - t0 < 8000) {
      if (/冷却中/.test(status())) { sawCooling = true; break; }
      await wait(100);
    }
    ok('pause 策略撞墙后进入冷却等待', sawCooling, `状态「${status()}」`);
    click('pfm-stop');
    await wait(300);
  }

  // ── 校验：已在关注中的从列表剔除 ─────────────────────────────────────────
  if (CASE === 'verify' || CASE === 'all') {
    cfg.mode = 'target';
    const ten = mk(10, 0);
    cfg.targetExisting = ten.map(u => ({ userId: Number(u.id), userName: u.name }));
    setList(mk(30, 0));
    click('pfm-verify');
    const end = await untilFinal();
    const left = getList();
    // v3.4.0 起校验是只读的：只出报告、不动列表；删除要另外点「执行清理」
    ok('校验是只读的，列表不变', left.length === 30, `列表 ${left.length}（应为 30）；终态「${end}」`);
    ok('校验报告正确识别出 10 位已关注', /10 位已在关注/.test(end), `终态「${end}」`);
  }

  // ── 执行锁：执行中重复点击被拒 ───────────────────────────────────────────
  if (CASE === 'lock' || CASE === 'all') {
    cfg.mode = 'target'; cfg.targetExisting = []; cfg.followLimit = Infinity;
    st.seq = 0; st.followed = [];
    setList(mk(10, 0));
    click('pfm-paste');                       // 第一次：正常执行
    click('pfm-paste');                       // 立刻第二次：应被锁拒绝
    click('pfm-verify');                      // 立刻点校验：也应被锁拒绝
    const lockedMsg = status();                 // 立即采样，此时还没进入关注循环
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && /^(正在|已处理)/.test(status())) await wait(150);
    await wait(300);
    ok('执行中重复点「开始自动关注」不会重复跑', st.seq === 10, '总共发出 ' + st.seq + ' 次关注请求（列表 10 人，重复执行会是 20）');
    ok('执行中「校验」也被锁拒绝', /正在进行/.test(lockedMsg), '第二次点击时状态栏「' + lockedMsg + '」');
  }

  // ── 关注时按每条自己的可见性发送 ─────────────────────────────────────────
  if (CASE === 'restrict' || CASE === 'all') {
    cfg.mode = 'target'; cfg.targetExisting = []; cfg.followLimit = Infinity;
    const mixed = [
      { id: '100001', name: '公开A', restrict: '0' },
      { id: '200001', name: '私密B', restrict: '1' },
      { id: '100002', name: '公开C', restrict: '0' },
      { id: '200002', name: '私密D', restrict: '1' },
    ];
    setList(mixed);
    click('pfm-paste');
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && st.followed.length < 4) await wait(60);
    await wait(400);
    const map = new Map(mixed.map(u => [u.id, u.restrict]));
    const wrong = st.restrictUsed.filter(r => map.has(r.id) && map.get(r.id) !== r.restrict);
    ok('每条按自己的公开/私密发送', st.restrictUsed.length === 4 && wrong.length === 0,
       `发送 ${JSON.stringify(st.restrictUsed)}`);
  }

  // ── 顺序还原：反序关注后目标账号显示顺序应与源一致 ─────────────────────
  if (CASE === 'order' || CASE === 'all') {
    cfg.mode = 'target'; cfg.targetExisting = []; cfg.followLimit = Infinity;
    st.followed = []; st.seq = 0;
    // 源账号接口顺序：最新关注在前
    const src = [
      { id: '100005', name: '最新E', restrict: '0' },
      { id: '100004', name: 'D', restrict: '0' },
      { id: '100003', name: 'C', restrict: '0' },
      { id: '100002', name: 'B', restrict: '0' },
      { id: '100001', name: '最早A', restrict: '0' },
    ];
    setList(src);
    qs('#pfm-order').value = 'reverse';
    qs('#pfm-jitter').value = '1';
    click('pfm-paste');
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && st.followed.length < 5) await wait(60);
    await wait(300);
    // 模拟 pixiv：最新关注的插到最前
    const display = [];
    for (const id of st.followed) display.unshift(id);
    const srcOrder = src.map(u => u.id);
    ok('反序关注后目标显示顺序 = 源账号顺序', JSON.stringify(display) === JSON.stringify(srcOrder),
       '关注次序 ' + st.followed.join(',') + ' → 显示 ' + display.join(','));
  }

  // ── 分页用 24：确保 offset 生效时能拿全 ─────────────────────────────────
  if (CASE === 'paging24' || CASE === 'all') {
    cfg.mode = 'source'; cfg.ignoreOffset = false; st.fetchLog = [];
    click('pfm-fetch');
    const end = await untilFinal();
    const L = getList();
    const lim = st.fetchLog.filter(u => u.includes('following?offset=')).map(u => Number((u.match(/limit=(\d+)/)||[])[1]));
    ok('请求用 limit=24（不是 100）', lim.length > 0 && lim.every(v => v === 24), '实际 limit 取值 ' + JSON.stringify([...new Set(lim)]));
    ok('250 位全部入库', L.length === 250, '入库 ' + L.length + '；终态「' + end + '」');
    ok('页数符合 200/24≈9 页 + 50/24≈3 页', st.fetchLog.filter(u => u.includes('rest=show')).length === 9, 'show 请求 ' + st.fetchLog.filter(u => u.includes('rest=show')).length + ' 次');
  }

  // ── offset 被忽略时：必须识别并明确报错，不能假装成功 ─────────────────────
  if (CASE === 'paging-ignored' || CASE === 'all') {
    cfg.mode = 'source'; cfg.ignoreOffset = true; st.fetchLog = [];
    storage.clear();
    click('pfm-fetch');
    const end = await untilFinal(30000);
    ok('识别出翻页失效并中断', /翻页未生效|offset 被忽略|offset 未生效|反复返回同一页/.test(end), '终态「' + end + '」');
    ok('没有把重复数据当成完整列表', getList().length <= 48, '入库 ' + getList().length + '（应只拿到第一页左右，不会堆成几百）');
  }

  // ── 深翻页返回不满页：不能提前 break（复现 95/128 那个 bug） ──────────────
  if (CASE === 'short-page' || CASE === 'all') {
    cfg.mode = 'source'; cfg.ignoreOffset = false;
    cfg.shortPageFrom = 96;          // 从第 5 页（offset 96）起每页只给 12 条
    st.fetchLog = []; storage.clear();
    click('pfm-fetch');
    const end = await untilFinal(60000);
    const L = getList();
    const showReqs = st.fetchLog.filter(u => u.includes('rest=show')).length;
    ok('不满页时仍然抓全 250 位', L.length === 250, '入库 ' + L.length + '；终态「' + end + '」');
    ok('没有在第 4 页停下', showReqs > 4, 'show 请求 ' + showReqs + ' 次');
  }

  // ── 断点续抓：中断后再点一次，从上次位置继续而不是从头 ─────────────────
  if (CASE === 'resume' || CASE === 'all') {
    cfg.mode = 'source'; cfg.ignoreOffset = false; cfg.shortPageFrom = null;
    st.fetchLog = []; storage.clear();
    const orig = sandbox.fetch;
    let calls = 0;
    sandbox.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/following?offset=')) {
        calls++;
        if (calls > 3) return jr({ error: true, message: 'rate limited' }, 429);
      }
      return orig(url, opts);
    };
    click('pfm-fetch');
    const first = await untilFinal(90000);
    const afterFirst = getList().length;
    const cursor = JSON.parse(storage.get('pfm_cursor') || '{}');

    sandbox.fetch = orig;
    const before2 = st.fetchLog.length;
    click('pfm-fetch');
    const second = await untilFinal(90000);
    const L = getList();
    const resumedReqs = st.fetchLog.slice(before2).filter(u => u.includes('rest=show'));
    const startedAtZero = resumedReqs.some(u => /offset=0&/.test(u));

    ok('第一次中断后记下了进度游标', cursor.show > 0 || cursor.hide > 0,
       '游标 ' + JSON.stringify(cursor) + '；首次入库 ' + afterFirst + '；终态「' + first + '」');
    ok('第二次从断点继续并抓全 250 位', L.length === 250, '入库 ' + L.length + '；终态「' + second + '」');
    ok('续抓没有从 offset=0 重来', !startedAtZero, '续抓首个 show 请求: ' + (resumedReqs[0] || 'none'));
  }

  // ── 差额归因：total 大于可取数量时，应说明是注销/冻结账号 ─────────────────
  if (CASE === 'gap' || CASE === 'all') {
    cfg.mode = 'source'; cfg.ignoreOffset = false; cfg.shortPageFrom = null;
    // 模拟：total 说有 250，但其中 5 个公开 + 2 个私密是「取不到的死号」
    const ghostPub = PUB.filter((_, i) => i >= 195);      // 最后 5 个公开
    const ghostPriv = PRIV.filter((_, i) => i >= 45);     // 最后 2 个私密
    const origFetch = sandbox.fetch;
    sandbox.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/following?offset=')) {
        const rest = (u.match(/rest=(\w+)/) || [])[1];
        const m = u.match(/offset=(\d+)&limit=(\d+)/);
        const offset = Number(m[1]), limit = Number(m[2]);
        const pool = rest === 'hide'
          ? PRIV.filter(x => !ghostPriv.includes(x))
          : PUB.filter(x => !ghostPub.includes(x));
        const total = rest === 'hide' ? PRIV.length : PUB.length;   // total 仍含死号
        return jr({ error: false, body: { users: pool.slice(offset, offset + limit), total: total } });
      }
      return origFetch(url, opts);
    };
    st.fetchLog = []; storage.clear();
    click('pfm-fetch');
    const end = await untilFinal(60000);
    const L = getList();
    sandbox.fetch = origFetch;
    ok('取不到的账号不影响其余用户入库', L.length === 240, '入库 ' + L.length + '（250 − 公开死号 5 − 私密死号 5 = 240）');
    ok('状态栏说明差额是注销/冻结账号', /注销|冻结/.test(end), '终态「' + end + '」');
  }

  console.log(`\n--- case: ${CASE}`);
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + '  →  ' + r.detail);
  const bad = results.filter(r => !r.pass).length;
  console.log(bad ? `${bad} 项未通过` : '全部通过');
  process.exit(bad ? 1 : 0);
})();