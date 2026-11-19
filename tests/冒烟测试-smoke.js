// 极简 DOM/浏览器桩，只为跑通 initUI() 与几个事件处理器，验证汉化后没有运行时错误。
const fs = require('fs');
const vm = require('vm');

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    style: { cssText: '', display: '', width: '', color: '', borderColor: '', transform: '', left: '', top: '', right: '', bottom: '' },
    children: [],
    dataset: {},
    _html: '',
    textContent: '',
    value: '',
    _id: '',
    _events: {},
    get id() { return this._id; },
    set id(v) { this._id = v; if (v) registry.set(v, this); },
    title: '',
    disabled: false,
    files: [],
    onclick: null,
    oninput: null,
    classList: { add() {}, remove() {} },
    attrs: {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this._events[t] = this._events[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() {},
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    closest() { return null; },
    querySelector(sel) { return qs(sel); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 400 }; },
    click() { if (typeof this.onclick === 'function') this.onclick({ target: this }); },
    focus() {},
  };
  return el;
}

const registry = new Map();
function qs(sel) {
  const key = String(sel).replace(/^#/, '');
  if (!registry.has(key)) registry.set(key, makeEl('div'));
  const el = registry.get(key);
  el.id = key;
  return el;
}

const document = {
  readyState: 'complete',
  head: makeEl('head'),
  body: makeEl('body'),
  documentElement: Object.assign(makeEl('html'), { innerHTML: '' }),
  createElement: (t) => makeEl(t),
  getElementById: (id) => (registry.has(id) ? registry.get(id) : null),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};

const storage = new Map();
const sandbox = {
  console,
  document,
  location: { pathname: '/users/12345', href: 'https://www.pixiv.net/users/12345' },
  window: null,
  localStorage: { getItem: () => null, setItem() {} },
  getComputedStyle: () => ({ backgroundColor: 'rgb(255,255,255)' }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: async () => ({ ok: true, json: async () => ({ body: { users: [], total: 0 } }) }),
  XMLHttpRequest: function () {},
  CustomEvent: function (n, o) { this.type = n; this.detail = o && o.detail; },
  Blob: function () {},
  URL: Object.assign(function () {}, { createObjectURL: () => 'blob:x' }),
  URLSearchParams: function () { this.append = () => {}; this.toString = () => ''; },
  FileReader: function () {},
  GM_getValue: (k, d) => (storage.has(k) ? storage.get(k) : d),
  GM_setValue: (k, v) => storage.set(k, v),
  unsafeWindow: {},
  confirm: (msg) => { captured.confirms.push(String(msg)); return false; },
  alert: () => {},
  Promise, JSON, Math, Date, Object, Array, String, Number, Error, RegExp, Map, Set,
};
const captured = { confirms: [], statuses: [] };
sandbox.addEventListener = () => {};
sandbox.dispatchEvent = () => {};
sandbox.window = sandbox;
sandbox.self = sandbox;

const code = fs.readFileSync('pixiv-follow-migrator-zh.user.js', 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'zh.user.js' });

// 面板已构建：抓取标题与关键按钮文本
const panel = registry.get('pfm');
function allText(el, acc = []) {
  if (!el) return acc;
  if (el.textContent) acc.push(el.textContent);
  if (el._html) acc.push(el._html);
  (el.children || []).forEach(c => allText(c, acc));
  return acc;
}
const html = panel && panel._html ? panel._html : '';
const titleMatch = html.match(/<div class="pfm-title">([\s\S]*?)<\/div>/);
console.log('面板标题:', titleMatch ? titleMatch[1].trim() : '(未找到)');
console.log('面板 HTML 长度:', html.length);

// 触发几个按钮的处理器
const hits = [];
for (const [id, el] of registry) {
  if (typeof el.onclick === 'function') hits.push(id);
  for (const t of Object.keys(el._events || {})) hits.push(id + ':' + t);
  if (typeof el.oninput === 'function') hits.push(id + '(oninput)');
}
console.log('已绑定 onclick/oninput 的元素:', hits.join(', '));

// 触发 View List（空列表 → flash 提示）与 Clear list（confirm 文案）
const statusEl = registry.get('pfm-status');
try {
  (registry.get('pfm-view')._events.click || []).forEach(fn => fn({target: registry.get('pfm-view')}));
  console.log('查看列表 →', statusEl.textContent);
  registry.get('pfm-clear').onclick();
  console.log('清空列表 →', statusEl.textContent, '| confirm 文案:', captured.confirms.join(' / '));
} catch (e) {
  console.error('!! 运行时错误:', e && e.stack || e);
  process.exitCode = 1;
}

// 检查未汉化的英文界面文案残留
const leftovers = [/Ready to migrate/, /Grab Following List/, /Transfer to New Account/,
  /Start Auto Follow/, /Export list/, /Import list/, /Clear list/, /View List/,
  /Made by Misery/, /Search name or ID/, /No results/, /Clear all\?/, /Users \(/];
const bad = leftovers.filter(r => r.test(html) || r.test(statusEl.textContent || ''));
console.log(bad.length ? '!! 仍有英文残留: ' + bad.join(', ') : '无英文界面残留（面板 HTML + 状态栏）');
if (bad.length) process.exitCode = 1;
