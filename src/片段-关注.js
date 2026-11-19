    // ── 3. 自动关注（执行锁 + 开始前校验 + 按条走公开/私密 + 撞墙不丢列表） ─────
    // 拉「当前登录账号」现有的关注，用来判断列表里哪些其实已经关注过了
    async function fetchExistingFollowIds() {
      const myId = getCurrentUserId();
      if (!myId) return null;
      const ids = new Set();
      for (const rest of ['show', 'hide']) {
        let offset = 0, total = null;
        while (true) {
          let json = null;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const res = await fetch(`https://www.pixiv.net/ajax/user/${myId}/following?offset=${offset}&limit=100&rest=${rest}&lang=en`,
                { credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }});
              if (!res.ok) { await sleep(900 * attempt); continue; }
              const j = await res.json();
              if (j && j.error) { await sleep(900 * attempt); continue; }
              json = j; break;
            } catch (_) { await sleep(900 * attempt); }
          }
          if (!json) break;
          if (total === null) total = Number(json.body && json.body.total) || null;
          const users = (json.body && json.body.users) || [];
          if (!users.length) break;
          for (const u of users) ids.add(String(u.userId));
          offset += 100;
          if (total !== null && offset >= total) break;
          if (users.length < 100) break;
          await sleep(350 + Math.random() * 250);
        }
      }
      return ids;
    }

    // ── 校验（只读）：比对目标账号已有收藏，产出报告，【绝不修改列表】 ──────────
    // 旧版在这里直接 saveList(remain)，一校验就永久删人，且没有中间态、无法撤销。
    // 现在拆成两步：本函数只算差异；真正删除由「执行清理」按钮单独确认。
    async function buildVerifyReport() {
      const before = loadList();
      if (!before.length) return { ok: false, why: '列表为空' };
      flash('⏳ 正在比对目标账号已有的关注…', '#3b82f6');
      const have = await fetchExistingFollowIds();
      // have === null 表示连自己的 UID 都取不到；空 Set 表示页面都失败 —— 都不足以下结论
      if (!have) return { ok: false, why: '取不到当前账号信息（请确认已登录 pixiv）' };
      if (have.size === 0) {
        return { ok: false, why: '目标账号的关注列表读回 0 条，可能未登录或被限流，已中止比对以免误删' };
      }
      const already = [], remain = [];
      for (const u of before) (have.has(u.id) ? already : remain).push(u);
      const report = {
        ok: true,
        at: Date.now(),
        total: before.length,
        alreadyCount: already.length,
        remainCount: remain.length,
        alreadyIds: already.map(u => u.id),
        remainIds: remain.map(u => u.id),
      };
      saveVerifyReport(report);
      return report;
    }

    // 「校验并生成报告」：只算差异，列表一个字都不动
    $('pfm-verify').addEventListener('click', async () => {
      if (pfmTaskLock) return flash(`⏳ 正在执行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等它结束。`, '#f59e0b');
      pfmTaskLock = 'verify';
      setBusy(true);
      try {
        const r = await buildVerifyReport();
        if (!r.ok) return flash(`⚠️ 校验中止：${r.why}。列表未做任何修改。`, '#f59e0b');
        if (r.alreadyCount === 0) {
          flash(`✅ 校验完成：列表里的 ${r.total} 位都还没关注，无需清理。（列表未改动）`, '#10b981');
        } else {
          flash(`📋 校验完成：${r.total} 位中 ${r.alreadyCount} 位已在关注、${r.remainCount} 位待关注。` +
                `列表未改动 —— 要移除这 ${r.alreadyCount} 位请再点「执行清理」。`, '#3b82f6');
        }
      } catch (e) {
        flash(`❌ 校验失败：${e.message}。列表未改动。`, '#ef4444');
      } finally {
        pfmTaskLock = null;
        setBusy(false);
      }
    });

    // 「执行清理」：真正删除，删除前备份，可一键撤销
    $('pfm-prune').addEventListener('click', async () => {
      if (pfmTaskLock) return flash(`⏳ 正在执行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等它结束。`, '#f59e0b');
      const rep = loadVerifyReport();
      if (!rep || !rep.ok) return flash('⚠️ 还没有可用的校验结果。先点「校验并生成报告」。', '#f59e0b');
      if (!rep.alreadyCount) return flash('✅ 没有需要移除的（上次校验显示都未关注）。', '#10b981');

      const cur = loadList();
      const curIds = new Set(cur.map(u => u.id));
      const toRemove = rep.alreadyIds.filter(id => curIds.has(id)).length;
      if (!toRemove) return flash('ℹ️ 上次校验标记的已关注用户已不在列表里，无需清理。', '#3b82f6');

      if (!confirm(`将从列表移除 ${toRemove} 位「已在关注中」的用户。\n列表当前 ${cur.length} 位 → ${cur.length - toRemove} 位。\n\n删除前会自动备份，可用「撤销清理」恢复。继续？`)) return;

      pfmTaskLock = 'verify';
      setBusy(true);
      try {
        backupList();
        const drop = new Set(rep.alreadyIds);
        const next = cur.filter(u => !drop.has(u.id));
        const saved = saveList(next);
        clearVerifyReport();
        flash(`🗑 已移除 ${toRemove} 位，列表剩 ${saved.length} 位。若误删，点「撤销清理」可恢复。`, '#10b981');
      } catch (e) {
        flash(`❌ 清理失败：${e.message}`, '#ef4444');
      } finally {
        pfmTaskLock = null;
        setBusy(false);
      }
    });

    // 「撤销清理」：把上一次清理前的列表恢复回来
    $('pfm-undo').addEventListener('click', () => {
      if (pfmTaskLock) return flash(`⏳ 正在执行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等它结束。`, '#f59e0b');
      if (!hasBackup()) return flash('ℹ️ 没有可撤销的清理备份。', '#3b82f6');
      const n = restoreList();
      if (n > 0) flash(`↩️ 已恢复到清理前的列表（${n} 位）。`, '#10b981');
      else flash('❌ 撤销失败：备份数据不可用。', '#ef4444');
    });

    $('pfm-paste').addEventListener('click', async () => {
      if (pfmTaskLock) return flash(`⏳ 正在执行「${PFM_LOCK_LABEL[pfmTaskLock] || pfmTaskLock}」，请等它结束。`, '#f59e0b');
      const list = loadList();
      if (!list.length) return flash('❌ 列表里还没有用户。', '#ef4444');

      pfmTaskLock = 'follow';
      setBusy(true);
      let token = null;
      try {
        flash('⏳ 正在初始化…', '#3b82f6');
        token = await getCsrfTokenWithFallback();
        if (!token) { flash('❌ 没拿到 CSRF 令牌。请先在页面里手动关注一个用户，再回来重试。', '#ef4444'); return; }

        const limitVal = parseInt($('pfm-limit').value, 10);
        const defaultRestrict = $('pfm-restrict').value === '1' ? '1' : '0';
        const baseDelay = Math.max(200, parseInt($('pfm-delay').value, 10) || 1200);
        const jitterMax = Math.max(1, Math.min(10, parseFloat($('pfm-jitter').value) || 3));
        // 长休眠：每处理 batchN 个就休息 restSec 秒，模拟人类节奏（PBD 的「慢速模式」思路）
        const batchN = Math.max(0, parseInt($('pfm-batch') && $('pfm-batch').value, 10) || 0);
        const restSec = Math.max(5, Math.min(600, parseInt($('pfm-rest') && $('pfm-rest').value, 10) || 30));
        // 撞墙策略：pause=暂停等待续跑 / stop=立即停 / refollow=取消再关注（会通知对方）
        const wallMode = ($('pfm-wall') && $('pfm-wall').value) || 'pause';

        // ── 开始前先比对：已关注的人【只跳过、不删除】──────────────────────────
        // 旧版这里直接移除，用户在毫无察觉的情况下丢数据 —— 这是「列表自毁」的第二处来源。
        let skipSet = new Set();
        let preSkipped = 0;
        try {
          const have = await fetchExistingFollowIds();
          if (have && have.size > 0) {
            const cur = loadList();
            skipSet = new Set(cur.filter(u => have.has(u.id)).map(u => u.id));
            preSkipped = skipSet.size;
            if (preSkipped > 0) {
              flash(`ℹ️ 有 ${preSkipped} 位已在关注中，本次会跳过（不会改动你的列表）。`, '#3b82f6');
            }
          }
        } catch (_) {}

        const current = loadList();
        if (!current.length) { flash('✅ 列表为空，无需执行。', '#10b981'); return; }
        const pending = current.filter(u => !skipSet.has(u.id));
        if (!pending.length) {
          flash(`✅ 列表里的 ${current.length} 位都已在关注中，无需再执行。（列表未改动，可点「执行清理」手动移除）`, '#10b981');
          return;
        }
        // ── 顺序处理 ──────────────────────────────────────────────────────────
        // pixiv 的关注列表是「最新关注的排最前」。抓取时按接口顺序（最新→最早）入库，
        // 若就按这个顺序依次关注，每关注一个人就插到目标账号列表最前，最终显示顺序整个翻转。
        // 所以默认 reverse：从最早关注的开始关注，最后关注的那位才会排最前，还原源账号顺序。
        const orderMode = ($('pfm-order') && $('pfm-order').value) || 'reverse';
        const ordered = orderMode === 'reverse' ? pending.slice().reverse() : pending;
        const toFollow = (limitVal > 0) ? ordered.slice(0, limitVal) : ordered;
        const jobs = toFollow.map(u => ({ id: u.id, name: u.name, restrict: u.restrict === '1' ? '1' : defaultRestrict }));
        const pubN = jobs.filter(j => j.restrict === '0').length;
        const privN = jobs.length - pubN;

        const restNote = batchN > 0 ? `每 ${batchN} 个长休眠 ${restSec} 秒。` : '不启用长休眠。';
        const wallNote = wallMode === 'refollow'
          ? '撞墙时【取消关注再关注回来】—— 对方会收到重复关注通知，请谨慎。'
          : (wallMode === 'pause' ? '撞墙时暂停等待后自动续跑。' : '撞墙时立即停止并保留进度。');
        if (!confirm(`将关注 ${jobs.length} 位用户（公开 ${pubN} / 私密 ${privN}）。\n` +
                     `基准间隔 ${baseDelay} 毫秒，实际在 1～${jitterMax} 倍之间随机。\n${restNote}\n${wallNote}`)) return;

        const controls = $('pfm-controls');
        controls.style.display = 'flex';
        $('pfm-pause').style.display = 'inline-block';
        $('pfm-resume').style.display = 'none';

        isPaused = false; shouldStop = false; window.runFlag = true;
        progEl.style.display = 'block'; setProgress(0, jobs.length);

        let done = 0, failed = 0, skipped = 0, streakFail = 0, rateLimited = false;
        const confirmed = new Set();   // 只有「确认成功」或「确认已关注」的才允许移出列表

        function nextDelay(streak) {
          const mult = 1 + Math.random() * (jitterMax - 1);
          let d = baseDelay * mult;
          if (streak > 0) d = Math.min(60000, baseDelay * Math.pow(2, Math.min(streak, 6)) * (0.8 + Math.random() * 0.4));
          return Math.round(d);
        }

        $('pfm-pause').onclick = () => { isPaused = true; $('pfm-pause').style.display = 'none'; $('pfm-resume').style.display = 'inline-block'; flash('⏸ 已暂停', '#f59e0b'); };
        $('pfm-resume').onclick = () => { isPaused = false; $('pfm-pause').style.display = 'inline-block'; $('pfm-resume').style.display = 'none'; flash('▶ 已继续', '#10b981'); };
        $('pfm-stop').onclick = () => { shouldStop = true; window.runFlag = false; flash('⏹ 正在停止…', '#ef4444'); };

        for (let i = 0; i < jobs.length; i++) {
          const u = jobs[i];
          if (!window.runFlag || shouldStop) break;
          while (isPaused && !shouldStop) await sleep(200);
          if (shouldStop) break;

          flash(`⏳ ${u.restrict === '1' ? '私密' : '公开'}关注 ${u.name}…（${i + 1}/${jobs.length}）`, '#3b82f6');
          let verdict = 'fail';
          try {
            const fd = new URLSearchParams();
            fd.append('mode', 'add_bookmark_user');
            fd.append('restrict', u.restrict);
            fd.append('user_id', u.id);

            const res = await fetch('https://www.pixiv.net/touch/ajax_api/ajax_api.php', {
              method: 'POST', credentials: 'include',
              headers: { 'Accept': 'application/json', 'x-csrf-token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: fd.toString()
            });

            if (res.status === 429 || res.status === 403) { rateLimited = true; verdict = 'fail'; }
            else if (res.ok) {
              const data = await res.json().catch(() => ({}));
              const msg = String(data && data.message || '').toLowerCase();
              if (data && data.isSucceed) verdict = 'ok';
              else if (msg.includes('already') || msg.includes('すでに') || msg.includes('フォロー済み')) verdict = 'skip';
            }
          } catch (_) {}

          if (verdict === 'ok') { done++; confirmed.add(u.id); streakFail = 0; }
          else if (verdict === 'skip') { skipped++; confirmed.add(u.id); streakFail = 0; }
          else { failed++; streakFail++; }

          setProgress(done + failed + skipped, jobs.length);

          // ── 撞墙处理 ──────────────────────────────────────────────────────
          if (rateLimited || streakFail >= 8) {
            const why = rateLimited ? '被 Pixiv 限流（429/403）' : '连续 8 次失败';
            if (wallMode === 'pause') {
              // 方案 A：暂停等待，然后原地重试（成功率最高、最不冒犯）
              const coolMin = 3 + Math.round(Math.random() * 2);   // 3~5 分钟，贴合 PixiC 实测
              for (let left = coolMin * 60; left > 0 && !shouldStop; left -= 5) {
                flash(`⏸ ${why}，冷却中… 剩余 ${Math.ceil(left / 60)} 分钟（可随时点「停止」）`, '#f59e0b');
                await sleep(5000);
              }
              if (shouldStop) break;
              rateLimited = false; streakFail = 0;
              i--;   // 重试当前这位
              flash('▶ 冷却结束，继续。', '#3b82f6');
              continue;
            }
            if (wallMode === 'refollow') {
              // 方案 B：取消关注 → 等一会儿 → 重新关注
              // 代价：对方会收到「又被关注了」的通知；且会改变他在对方列表里的位置。
              flash(`🔁 ${why}，尝试「取消关注 → 重新关注」${u.name}…`, '#f59e0b');
              try {
                const del = new URLSearchParams();
                del.append('mode', 'remove_bookmark_user');
                del.append('user_id', u.id);
                await fetch('https://www.pixiv.net/touch/ajax_api/ajax_api.php', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Accept': 'application/json', 'x-csrf-token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: del.toString()
                });
                await sleep(3000 + Math.random() * 2000);
                const add = new URLSearchParams();
                add.append('mode', 'add_bookmark_user');
                add.append('restrict', u.restrict);
                add.append('user_id', u.id);
                const rr = await fetch('https://www.pixiv.net/touch/ajax_api/ajax_api.php', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Accept': 'application/json', 'x-csrf-token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: add.toString()
                });
                if (rr.ok) {
                  const dd = await rr.json().catch(() => ({}));
                  if (dd && dd.isSucceed) {
                    done++; confirmed.add(u.id); failed = Math.max(0, failed - 1);
                    rateLimited = false; streakFail = 0;
                    setProgress(done + failed + skipped, jobs.length);
                    flash(`✅ 取消再关注成功：${u.name}`, '#10b981');
                    continue;
                  }
                }
              } catch (_) {}
              shouldStop = true;
              flash(`⛔ ${why}，「取消再关注」也没成功，已停止。请等 10～30 分钟再试。`, '#ef4444');
              break;
            }
            // 方案 C：直接停
            shouldStop = true;
            flash(`⛔ ${why}。已停止，请等 10～30 分钟再点「开始自动关注」继续。`, '#ef4444');
            break;
          }

          // ── 长休眠：每 batchN 个休息一次 ────────────────────────────────────
          const handled = done + failed + skipped;
          if (batchN > 0 && handled > 0 && handled % batchN === 0 && handled < jobs.length) {
            flash(`😴 已完成 ${handled} 个，长休眠 ${restSec} 秒…（可点「停止」中断）`, '#3b82f6');
            for (let left = restSec; left > 0 && !shouldStop; left -= 1) await sleep(1000);
            if (shouldStop) break;
          }

          const d = nextDelay(streakFail);
          flash(`⏳ 已处理 ${handled}/${jobs.length}，${(d / 1000).toFixed(1)}s 后继续…`, '#3b82f6');
          await sleep(d);
        }

        // ── 收尾：只移除「确认已完成」的；失败的、没轮到的全部保留 ──────────────
        const remain = loadList().filter(u => !confirmed.has(u.id));
        saveList(remain);
        const c = countByRestrict(remain);

        if (rateLimited) {
          flash(`⛔ 被限流：成功 ${done}，跳过 ${skipped}，失败 ${failed}。等 10～30 分钟再继续；未完成 ${remain.length} 位仍在列表里（公开 ${c.pub} / 私密 ${c.priv}）。`, '#ef4444');
        } else if (shouldStop) {
          flash(`⏹ 已停止：成功 ${done}，跳过 ${skipped}，失败 ${failed}；未完成 ${remain.length} 位仍在列表里（公开 ${c.pub} / 私密 ${c.priv}）。`, '#f59e0b');
        } else {
          flash(`✅ 完成：成功 ${done}，跳过 ${skipped}，失败 ${failed}；列表剩余 ${remain.length} 位（公开 ${c.pub} / 私密 ${c.priv}）。`, '#10b981');
        }
      } catch (e) {
        flash(`❌ 执行出错：${e.message}（已保留未成功的记录）`, '#ef4444');
      } finally {
        const controls = $('pfm-controls');
        if (controls) controls.style.display = 'none';
        pfmTaskLock = null;
        setBusy(false);
      }
    });