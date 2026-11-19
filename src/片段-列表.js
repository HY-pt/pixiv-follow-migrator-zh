    // ── 4. 列表弹窗 / 导出 / 导入 / 清空（区分公开与私密） ───────────────────────
    function downloadJSON(list, filename) {
      const b = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const u = URL.createObjectURL(b);
      Object.assign(document.createElement('a'), { href: u, download: filename }).click();
    }

    $('pfm-view').addEventListener('click', () => {
      const list = loadList();
      if (!list.length) return flash('❌ 列表为空。', '#ef4444');
      const cnt = countByRestrict(list);

      const backdrop = document.createElement('div');
      backdrop.id = 'pfm-backdrop';
      backdrop.innerHTML = `
        <div id="pfm-modal">
          <div id="pfm-mhead">
            <span>👥 用户（${list.length}）<small style="font-weight:400;opacity:.7"> 公开 ${cnt.pub} / 私密 ${cnt.priv}</small></span>
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
        saveList([]); backdrop.remove(); flash('🗑 已清空', '#ef4444');
      };
    });

    $('pfm-export').onclick = () => {
      const list = loadList();
      if (!list.length) return flash('❌ 列表为空。', '#ef4444');
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
          flash(`📂 导入完成，已并入「${IMPORT_MODE_TEXT[mode]}」：${bits.join('，')}；` +
                `列表共 ${saved.length} 位（公开 ${c.pub} / 私密 ${c.priv}）`, '#10b981');
        } catch (err) {
          flash('❌ 导入失败：文件不是有效的 JSON。', '#ef4444');
        }
      };
      r.readAsText(file);
      e.target.value = '';
    };

    $('pfm-clear').onclick = () => {
      const n = loadList().length;
      if (!n) return flash('❌ 列表已为空。', '#ef4444');
      if (!confirm(`确认清空列表中的 ${n} 位？\n仅清空本地记录，不会取消已关注的账号。`)) return;
      saveList([]); flash('🗑 已清空', '#ef4444');
    };
