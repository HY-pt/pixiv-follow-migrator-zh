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