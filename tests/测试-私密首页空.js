// 复现并验证：私密关注「第一页就返回空」不能被当成正常损耗
// 之前的 bug：TAIL_EMPTY 判断只看 total > offset，offset=0 时也命中，
// 于是私密被抓成 0/23 并静默清掉游标。
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2] || 'pixiv-follow-migrator-zh.user.js';

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

const PUB = Array.from({ length: 30 }, (_, i) => ({ userId: 100000 + i, userName: '公开' + i }));
const st = { fetchLog: [] };

// 关键：hide 请求永远返回空 users，但 total=23（模拟「有私密关注但接口不返回」）
function jr(obj, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => obj }; }
async function fakeFetch(url) {
  const u = String(url);
  st.fetchLog.push(u);
  if (u.includes('/following?offset=')) {
    const rest = (u.match(/rest=(\w+)/) || [])[1];
    const m = u.match(/offset=(\d+)&limit=(\d+)/);
    const offset = Number(m[1]), limit = Number(m[2]);
    if (rest === 'hide') return jr({ error: false, body: { users: [], total: 23 } });
    return jr({ error: false, body: { users: PUB.slice(offset, offset + limit), total: PUB.length } });
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
  unsafeWindow: {}, confirm: () => true, alert: () => {},
  Promise, JSON, Math, Date, Object, Array, String, Number, Error, RegExp, Map, Set,
  innerWidth: 1200, innerHeight: 900,
};
sandbox.addEventListener = () => {};
sandbox.dispatchEvent = () => {};
sandbox.window = sandbox; sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE });

const click = id => (registry.get(id)._events.click || []).forEach(fn => fn({ target: registry.get(id) }));
const status = () => registry.get('pfm-status').textContent || '';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  click('pfm-fetch');
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const t = status();
    if (/^[✅⚠️❌⛔]/.test(t)) break;
    await wait(120);
  }
  const end = status();
  const cursor = JSON.parse(storage.get('pfm_cursor') || '{}');
  console.log('终态:', end);
  console.log('游标:', JSON.stringify(cursor));
  console.log();

  const ok1 = !/抓取完成/.test(end);            // 不能报「完成」
  const ok2 = /私密|第一页|空/.test(end);        // 要提到私密/空页原因
  const ok3 = cursor.hide !== 0 || cursor.show !== undefined; // 游标不能被清空成「都完成」

  console.log(ok1 ? 'PASS 私密首页空 → 不报「抓取完成」' : 'FAIL 仍被当成完成');
  console.log(ok2 ? 'PASS 状态栏说明了原因' : 'FAIL 没说明原因');
  console.log(ok3 ? 'PASS 游标保留了未完成状态' : 'FAIL 游标被清空');
  process.exit(ok1 && ok2 && ok3 ? 0 : 1);
})();
