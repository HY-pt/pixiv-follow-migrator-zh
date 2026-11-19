// 验证「增量覆盖」语义：
//   · 文件有、列表无 → 追加
//   · 文件有、列表也有 → 覆盖可见性（不重复、不跳过）
//   · 列表有、文件无  → 原样保留（绝不清空）
const fs = require('fs');
const vm = require('vm');
const FILE = 'pixiv-follow-migrator-zh.user.js';

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

let fileChange = null;
const document = {
  readyState: 'complete', head: makeEl('head'), body: makeEl('body'),
  documentElement: Object.assign(makeEl('html'), { innerHTML: '' }),
  createElement: t => {
    const el = makeEl(t);
    if (t === 'input') Object.defineProperty(el, 'onchange', {
      set(fn) { fileChange = fn; }, get() { return fileChange; }, configurable: true,
    });
    return el;
  },
  getElementById: id => (registry.has(id) ? registry.get(id) : null),
  querySelector: sel => (String(sel).includes('csrf-token') ? { content: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } : null),
  querySelectorAll: () => [],
  addEventListener() {},
};

const storage = new Map();
const sandbox = {
  console, document,
  location: { pathname: '/users/999', href: 'https://www.pixiv.net/users/999' },
  localStorage: { getItem: () => null, setItem() {} },
  getComputedStyle: () => ({ backgroundColor: 'rgb(255,255,255)' }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ error: false, body: { users: [], total: 0 } }) }),
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

const getList = () => { try { return JSON.parse(storage.get('pfm_list') || '[]'); } catch (_) { return []; } };
const setList = a => storage.set('pfm_list', JSON.stringify(a));
const status = () => registry.get('pfm-status').textContent || '';

function importJSON(text) {
  sandbox.FileReader = function () {
    return { readAsText() { this.onload({ target: { result: text } }); } };
  };
  fileChange({ target: { files: [{ name: 'x.json' }], value: '' } });
}
const byId = a => Object.fromEntries(a.map(u => [u.id, u.restrict]));

const results = [];
const ok = (l, c, d) => results.push({ l, pass: !!c, d });

// 列表初始：1公开 2私密 3公开（3 不在任何导入文件里，必须保留）
const seed = () => setList([
  { id: '1', name: 'A旧', restrict: '0' },
  { id: '2', name: 'B旧', restrict: '1' },
  { id: '3', name: 'C旧', restrict: '0' },
]);

// ── ① 公开模式：文件里 1(公开→本就公开)、4(新)、2(私密→改公开)
seed();
qs('#pfm-import-mode').value = 'pub';
importJSON(JSON.stringify([
  { id: '1', name: 'A新' },
  { id: '2', name: 'B新' },
  { id: '4', name: 'D新' },
]));
let L = getList(), m = byId(L);
ok('公开模式：新增 4', m['4'] === '0', `列表 ${JSON.stringify(m)}`);
ok('公开模式：2 的可见性被覆盖为公开', m['2'] === '0', `2→${m['2']}`);
ok('公开模式：列表里原有但文件没有的 3 被保留', m['3'] === '0' && L.length === 4, `共 ${L.length} 条`);
ok('公开模式：没有重复添加 1', L.filter(u => u.id === '1').length === 1, `1 出现 ${L.filter(u => u.id === '1').length} 次`);

// ── ② 私密模式：整份并入私密表
seed();
qs('#pfm-import-mode').value = 'priv';
importJSON(JSON.stringify([{ id: '1', name: 'A' }, { id: '5', name: 'E' }]));
L = getList(); m = byId(L);
ok('私密模式：1 被覆盖为私密', m['1'] === '1', `1→${m['1']}`);
ok('私密模式：5 新增且为私密', m['5'] === '1', `5→${m['5']}`);
ok('私密模式：原有的 2/3 未被清空', m['2'] === '1' && m['3'] === '0', `共 ${L.length} 条`);

// ── ③ 全部模式：按文件内标记
seed();
qs('#pfm-import-mode').value = 'auto';
importJSON(JSON.stringify([
  { id: '1', name: 'A', restrict: '1' },
  { id: '6', name: 'F' },                      // 无标记 → 公开
  { id: '7', name: 'G', restrict: '1' },
]));
L = getList(); m = byId(L);
ok('全部模式：1 按文件改为私密', m['1'] === '1', `1→${m['1']}`);
ok('全部模式：无标记的 6 算公开', m['6'] === '0', `6→${m['6']}`);
ok('全部模式：7 为私密', m['7'] === '1', `7→${m['7']}`);

// ── ④ 重复导入不产生重复条目
seed();
qs('#pfm-import-mode').value = 'auto';
const same = JSON.stringify([{ id: '1', name: 'A', restrict: '1' }]);
importJSON(same);
importJSON(same);
L = getList();
ok('重复导入同一条不新增重复项', L.filter(u => u.id === '1').length === 1, `1 出现 ${L.filter(u => u.id === '1').length} 次，共 ${L.length} 条`);

// ── ⑤ 状态栏文案包含「并入公开」与计数
seed();
qs('#pfm-import-mode').value = 'pub';
importJSON(JSON.stringify([{ id: '9', name: 'Z' }]));
ok('状态栏说明并入的是哪张表', /并入「公开」/.test(status()) && /新增 1/.test(status()), `「${status()}」`);

console.log();
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.l + '  →  ' + r.d);
const bad = results.filter(r => !r.pass).length;
console.log(bad ? `\n${bad} 项未通过` : '\n全部通过');
process.exit(bad ? 1 : 0);