    // ── 1. 抓取当前页（DOM） ───────────────────────────────────────────────────
    // 局限说明：DOM 里读不到「公开/私密」，也读不到跨页的全局顺序。
    // 顺序靠「追加」保证：pixiv 关注页是 1→N 由新到旧，从第 1 页开始逐页抓，
    // 每页内部按 DOM 顺序 push，拼起来就是完整的「新→旧」顺序。
    $('pfm-scrape').addEventListener('click', () => {
      if (pfmTaskLock) return flash(`⏳ 正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      const existing = loadList();
      const existingIds = new Set(existing.map(u => String(u.id)));
      const myId = getCurrentUserId();
      const defaultRestrict = $('pfm-restrict').value === '1' ? '1' : '0';
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
        found.push({ id: id, name: n, restrict: defaultRestrict });
      });

      if (!found.length) return flash('❌ 未在页面中找到用户链接，请确认当前位于关注列表页面。', '#ef4444');

      let added = 0;
      for (const u of found) {
        if (existingIds.has(u.id)) continue;
        existing.push(u); existingIds.add(u.id); added++;
      }
      const saved = saveList(existing);
      const c = countByRestrict(saved);
      const where = pageNo !== null ? `第 ${pageNo} 页` : `第 ${seq} 次抓取`;

      flash(`✅ ${where}：本页新增 ${added} 位，列表共 ${saved.length} 位（公开 ${c.pub} / 私密 ${c.priv}）。` +
            `列表顺序按逐页追加拼接，请从第 1 页开始依次抓取；本页用户按「当前页可见性」标记。`, '#10b981');
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
      if (pfmTaskLock) return flash(`⏳ 正在进行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等待当前任务结束。`, '#f59e0b');
      // 抓的是「当前登录账号」的关注列表 —— 迁移就是从自己账号搬到另一个账号，这里就该用登录身份
      const pageUserId = getCurrentUserId();
      if (!pageUserId) return flash('❌ 请先登录 Pixiv 并打开任一用户主页。', '#ef4444');

      pfmTaskLock = 'fetch';
      setBusy(true);
      const cur = loadCursor(pageUserId);
      const resuming = cur.show > 0 || cur.hide > 0;

      try {
        flash(resuming ? `⏳ 续抓上次进度（公开第 ${cur.show + 1} 位、私密第 ${cur.hide + 1} 位）…` : '⏳ 正在抓取公开关注…', '#3b82f6');

        const pub = await apiFetchSegment(pageUserId, 'show', cur.show, (n, t, off) => {
          flash(`⏳ 抓取公开关注：已获取 ${n}${t ? '/' + t : ''} 位（offset ${off}）…`, '#3b82f6');
        });
        flash('⏳ 正在抓取私密关注…', '#3b82f6');
        let priv = { ids: [], total: 0, reason: null, pages: 0, nextOffset: 0, done: true };
        try {
          priv = await apiFetchSegment(pageUserId, 'hide', cur.hide, (n, t, off) => {
            flash(`⏳ 抓取私密关注：已获取 ${n}${t ? '/' + t : ''} 位（offset ${off}）…`, '#3b82f6');
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
          flash(`✅ 抓取完成：${detail}。新增公开 ${addedPub} 位、私密 ${addedPriv} 位，列表共 ${saved.length} 位。${gapNote}`, '#10b981');
        } else {
          const why = reason ? `原因：${reason}。` : '';
          // 注意：这里的「第 N 位」是游标 offset，不是行号；offset 可能因深翻页不满额而推进很慢，
          // 所以同时把「已入库数量」和 total 一起报出来，避免用户看到「从第 1 位继续」这种费解数字。
          const pubGot = pub.ids.length, privGot = priv.ids.length;
          const nextShow = (pub.nextOffset || 0), nextHide = (priv.nextOffset || 0);
          const nudge = `已保存进度：公开 ${pubGot}/${pub.total || '?'}、私密 ${privGot}/${priv.total || '?'}；` +
            `再次点击将从 offset=${nextShow}（私密 offset=${nextHide}）继续。` +
            `若持续在同一 offset 停止，通常是服务端限制了深翻页，多次重试可逐步推进。`;
          flash(`⚠️ 抓取未完成：${detail}。${why}${nudge}`, '#f59e0b');
        }
      } catch (e) {
        flash(`❌ 出错：${e.message}`, '#ef4444');
      } finally {
        pfmTaskLock = null;
        setBusy(false);
      }
    });
