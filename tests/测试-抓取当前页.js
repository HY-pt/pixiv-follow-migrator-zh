// 验证「抓取当前页」：DOM 顺序是否被保留、是否按默认可见性打标、是否去重
const fs = require('fs');
const vm = require('vm');

const FILE = 'pixiv-follow-migrator-zh.user.js';

const registry = new Map();
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, children: [], dataset: {},
    _html: '', textContent: '', value: '', _id: '', title: '', disabled: false, files: [],
    onclick: null, oninput: null, _events: {}, classList: { add() {}, remove() {} }, attrs: {},
    href: '', alt: '',
    get id() { return this._id; },
    set id(v) { this._id = v; if (v) registry.set(v, this); },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this._events[t] = this._events[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() {}, removeChild(c) { this.children = this.children.filter(x => x !== c); },
    closest() { return null; },
    querySelector(s) {
      if (String(s).includes('img')) return { alt: el.alt, title: '' };
      return qs(s);
    },
    querySelectorAll() { return []; },
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

// DOM 上模拟「关注列表」：顺序 = 新→旧（pixiv 的显示顺序）
const DOM_LINKS = [
  { href: 'https://www.pixiv.net/users/200005', textContent: '最新E' },
  { href: 'https://www.pixiv.net/users/100004', textContent: 'D' },
  { href: 'https://www.pixiv.net/users/100003', textContent: 'C' },
  { href: 'https://www.pixiv.net/users/100002', textContent: '' , alt: 'B(alt)' },
  { href: 'https://www.pixiv.net/users/100001', textContent: '最早A' },
  { href: 'https://www.pixiv.net/users/200005', textContent: '最新E重复' },  // 重复应去重
  { href: 'https://www.pixiv.net/users/999999', textContent: '我自己' },      // 自己应排除
];

const document = {
  readyState: 'complete', head: makeEl('head'), body: makeEl('body'),
  documentElement: Object.assign(makeEl('html'), { innerHTML: '' }),
  createElement: t => makeEl(t),
  getElementById: id => (registry.has(id) ? registry.get(id) : null),
  querySelector: sel => (String(sel).includes('csrf-token') ? { content: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } : null),
  querySelectorAll: sel => {
    if (String(sel).includes('/users/')) {
      return DOM_LINKS.map(l => {
        const el = makeEl('a');
        el.href = l.href; el.textContent = l.textContent; el.alt = l.alt || '';
        return el;
      });
    }
    return [];
  },
  addEventListener() {},
};

const storage = new Map();
const sandbox = {
  console, document,
  location: { pathname: '/users/999999', href: 'https://www.pixiv.net/users/999999' },
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

const click = id => (registry.get(id)._events.click || []).forEach(fn => fn({ target: registry.get(id) }));
const getList = () => JSON.parse(storage.get('pfm_list') || '[]');
const status = () => registry.get('pfm-status').textContent;

// 默认可见性设为私密，验证打标
qs('#pfm-restrict').value = '1';
click('pfm-scrape');

const L = getList();
console.log('抓到的顺序:', L.map(u => u.name).join(' → '));
console.log('条数:', L.length, '（DOM 有 7 个链接，其中 1 个重复 1 个是自己 → 应 5 条）');
console.log('可见性标记:', JSON.stringify(L.map(u => u.restrict)));
console.log('状态栏:', status());

const nameOrder = L.map(u => u.name);
const expect = ['最新E', 'D', 'C', 'B(alt)', '最早A'];
const okOrder = JSON.stringify(nameOrder) === JSON.stringify(expect);
const okCount = L.length === 5;
const okTag = L.every(u => u.restrict === '1');
console.log();
console.log(okOrder ? 'PASS 顺序与 DOM 一致（新→旧）' : 'FAIL 顺序不符，期望 ' + JSON.stringify(expect));
console.log(okCount ? 'PASS 去重+排除自己正确' : 'FAIL 条数应为 5');
console.log(okTag ? 'PASS 按默认可见性打标' : 'FAIL 可见性标记错误');
process.exit(okOrder && okCount && okTag ? 0 : 1);
