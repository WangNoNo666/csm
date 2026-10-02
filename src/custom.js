/* ============================================================
   自定义模式：选关面板 + 记录 + 关卡编辑器
   ------------------------------------------------------------
   用户原话：「增加到20个关卡加入自定义模式」
   并按 AskUserQuestion 确认：「上面全部 + 自定义关卡编辑器」
   —— 即：
     ① 20 格选关面板（已通关显示最佳时间 / 死亡数）
     ② 任意跳关、自由重开
     ③ 键位设置整合进同一个面板
     ④ 关卡编辑器：网格改地图、放机关、存 localStorage、能直接试玩

   ⚠️ 本文件必须在 game.js / main.js **之后**加载：
      它要在 window.__game 建好之后才包装 step() / 提供 UI。
   ============================================================ */

const CUSTOM = (() => {
  const LS_LEVELS = 'portalrunner.custom.levels.v1';
  const LS_RECORDS = 'portalrunner.records.v1';
  const LS_KEYBINDS = 'portalrunner.keybinds.v1';

  /* ------------------------------------------------------------
     一、记录（最佳时间 / 死亡数 / 是否通关）
     ------------------------------------------------------------ */
  let records = {};
  try { records = JSON.parse(localStorage.getItem(LS_RECORDS) || '{}') || {}; } catch (e) { records = {}; }

  function saveRecords() {
    try { localStorage.setItem(LS_RECORDS, JSON.stringify(records)); } catch (e) {}
  }
  function recordOf(rid) {
    return records[rid] || (records[rid] = { cleared: false, best: null, deaths: 0, plays: 0 });
  }
  /** 通关时调用：写入最佳时间与死亡数 */
  function submitClear(rid, timeSec, deaths) {
    const r = recordOf(rid);
    r.cleared = true;
    r.plays = (r.plays || 0) + 1;
    if (r.best == null || timeSec < r.best) r.best = timeSec;
    r.deaths = Math.max(r.deaths || 0, deaths || 0);
    saveRecords();
    refreshSelectBadges();
  }

  /* ------------------------------------------------------------
     二、自定义关卡存储
     ------------------------------------------------------------ */
  function loadCustomLevels() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_LEVELS) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }
  function saveCustomLevels(list) {
    try { localStorage.setItem(LS_LEVELS, JSON.stringify(list)); } catch (e) {}
  }

  /* ------------------------------------------------------------
     二点五、分享码（自定义地图的"导出 / 导入"）
     ------------------------------------------------------------
     目标：不依赖任何服务器，把一整张关卡变成一串能复制粘贴的文本。

     ▸ 编码
       1) 地图 → 每格 4 bit（0 空 / 1 墙 / 2 刺 / 3 水晶 / 4 箱 / 5 出生 / 6 终点）
          30×18 = 540 格 → 270 字节 → Base64 后 360 字符，太长了。
       2) 所以用 **游程编码（RLE）**：地图大部分是连续的同一种格子，
          “墙墙墙墙”压缩成 <次数><格子>。实测常规关卡能压到 ~40~120 字符。
       3) 再套一层 base64url，得到一串纯 A-Za-z0-9-_ 的安全文本。

     ▸ 容器格式
          PR1.<版本>.<名字 b64url>.<地图 b64url>
       前缀 "PR1" 是防呆：粘错内容能立刻报错，而不是生成一张乱图。
       名字为空时那一段写 '-'。
     ------------------------------------------------------------ */
  const CELL_BITS = { ' ': 0, '#': 1, '^': 2, 'o': 3, 'B': 4, 'S': 5, 'G': 6 };
  const BITS_CELL = [' ', '#', '^', 'o', 'B', 'S', 'G'];

  function b64urlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** 地图字符串数组 → 游程压缩后的字节流 */
  function encodeMapBytes(mapRows) {
    const bits = [];
    for (let y = 0; y < CFG.ROOM_H; y++) {
      const row = mapRows[y] || '';
      for (let x = 0; x < CFG.ROOM_W; x++) {
        const b = CELL_BITS[row[x]];
        bits.push(b === undefined ? 0 : b);
      }
    }
    /* 游程：(count-1) 存成 2 字节小端（1..65536），再接 1 字节格子值。
       ⚠️⚠️ 这里踩过一个真实的坑：最初 count 只存 1 字节（上限 256）。
          但地图里"一片连通的墙"动辄好几百格 —— 例如房间 0 的行 0/17 全是墙，
          再加上底下整块地板，一条游程轻易超过 256。写进 1 字节就**溢出**，
          高位的格子被静默丢掉 → 解码出来的地图缺了出生点/终点。
          症状是"分享码生成成功，但导入时报地图不完整"，极难排查。
          现在固定 2 字节，上限 65536 > 540（总格数），永远不可能溢出。 */
    const out = [];
    let i = 0;
    while (i < bits.length) {
      const v = bits[i];
      let n = 1;
      while (i + n < bits.length && bits[i + n] === v && n < 65536) n++;
      out.push((n - 1) & 0xff, ((n - 1) >> 8) & 0xff, v);
      i += n;
    }
    return out;
  }

  function decodeMapBytes(bytes) {
    const bits = [];
    /* ⚠️ 步长 3，边界必须是 `k + 3 <= bytes.length`。
       写 `k + 2 < bytes.length` 会把**最后一条游程的尾部**也当成一条新游程
       解析（多读 1 字节），于是整张图后移 —— 实测症状是
       "解码出来有出生点但没终点"，报「地图不完整」。
       这种 off-by-one 只在字节数刚好卡在边界时暴露，非常隐蔽。 */
    for (let k = 0; k + 3 <= bytes.length; k += 3) {
      const n = bytes[k] + bytes[k + 1] * 256 + 1;
      const v = bytes[k + 2];
      const cell = BITS_CELL[v] === undefined ? ' ' : BITS_CELL[v];
      for (let j = 0; j < n; j++) bits.push(cell);
    }
    const rows = [];
    for (let y = 0; y < CFG.ROOM_H; y++) {
      rows.push(bits.slice(y * CFG.ROOM_W, (y + 1) * CFG.ROOM_W).join('').padEnd(CFG.ROOM_W, ' '));
    }
    return rows;
  }

  /** 生成分享码 */
  function makeShareCode(name, mapRows) {
    const namePart = name ? b64urlEncode(new TextEncoder().encode(name)) : '-';
    const mapPart = b64urlEncode(new Uint8Array(encodeMapBytes(mapRows)));
    return `PR1.${namePart}.${mapPart}`;
  }

  /** 解析分享码 → { name, map } / 抛错 */
  function parseShareCode(code) {
    const raw = String(code || '').trim();
    if (!raw) throw new Error('分享码是空的');
    const parts = raw.split('.');
    if (parts[0] !== 'PR1' || parts.length < 3) {
      throw new Error('这不是本游戏的分享码（应以 PR1. 开头）');
    }
    const name = parts[1] === '-' ? '' : new TextDecoder().decode(b64urlDecode(parts[1]));
    const map = decodeMapBytes(b64urlDecode(parts.slice(2).join('.')));
    /* 基本合法性：必须能找到"出口"。
       ⚠️ 出口**不一定**是 'G'：官方第 1 关（房间 0）就是靠地板缺口通往下一间，
          地图里根本没有 'G'。所以判据是「有 G **或者**地板上有缺口」——
          后者正是 game.js 里房间链接的触发方式（掉出世界底边 → 进下一间）。
          这样官方第 1 关也能正常分享，同时仍然挡得住"随便一串字符"的坏码。 */
    let hasS = false, hasG = false, lastRow = null;
    for (const r of map) {
      if (r.includes('S')) hasS = true;
      if (r.includes('G')) hasG = true;
      lastRow = r;
    }
    if (!hasS) throw new Error('分享码里的地图没有出生点（S）');
    const hasHole = !!lastRow && lastRow.slice(1, -1).includes(' ');
    if (!hasG && !hasHole) throw new Error('分享码里的地图没有出口（既没有终点 G，底部也没有缺口）');
    return { name, map };
  }

  /* 把一份自定义地图（字符串数组）变成合法的 Room 定义 */
  const BLANK_ROW = '#'.repeat(CFG.ROOM_W);
  function blankMap() {
    const rows = [];
    for (let y = 0; y < CFG.ROOM_H; y++) {
      if (y === 0 || y === CFG.ROOM_H - 1) rows.push(BLANK_ROW);
      else rows.push('#' + ' '.repeat(CFG.ROOM_W - 2) + '#');
    }
    // 默认给一块地板、一个出生点、一个终点
    rows[CFG.ROOM_H - 2] = '#' + '#'.repeat(CFG.ROOM_W - 2) + '#';
    return rows;
  }
  /** 从「字符串数组」造 Room 定义（editor 与自定义关共用） */
  function defFromMap(id, name, mapRows, extra = {}) {
    return Object.assign({
      id, name,
      hint: extra.hint || '自定义关卡 —— 自己做的，自己玩得开心',
      objective: extra.objective || '抵达金色终点',
      map: mapRows,
      links: [],
    }, extra.def || {});
  }

  /* ------------------------------------------------------------
     三、注入自定义关到运行中的 Game
     ------------------------------------------------------------ */
  /**
   * 用给定的地图字符串数组直接开一局（试玩 / 玩自定义关）。
   * 做法：临时替换 game.rooms，并把 game.roomId 指到第 0 个。
   * 退出时调用 restoreOriginal() 还原 20 关。
   */
  let savedRooms = null, savedRoomId = 0, savedTimes = null;
  let playingCustom = false;

  function playMap(mapRows, opts = {}) {
    const g = window.__game;
    if (!savedRooms) {
      savedRooms = g.rooms;
      savedRoomId = g.roomId;
      savedTimes = g.levelTimes.slice();
    }
    const def = defFromMap(0, opts.name || '自定义关卡', mapRows, opts);
    const room = new Room(def);
    g.rooms = [room];
    g.roomId = 0;
    g.room = room;
    g.levelTimes = [];
    g.levelStartTime = g.time;
    g.deathAtLevelStart = g.deaths;
    g.portals.clear();
    g.player.reset(room.spawn.x, room.spawn.y);
    g.cam.x = g.roomCenterCam().x;
    g.cam.y = g.roomCenterCam().y;
    g.fx.clear();
    g.won = false; g.winT = 0;
    g.levelClear = false; g.levelClearT = 0;
    g.paused = false;
    g.objective = '';
    g.currentHint = room.hint;
    g.hintTimer = 4.2;
    playingCustom = true;
    setModeTag(opts.name || '自定义关卡');
  }

  function restoreOriginal() {
    const g = window.__game;
    if (!savedRooms) return;
    g.rooms = savedRooms;
    g.roomId = Math.min(savedRoomId, savedRooms.length - 1);
    g.room = g.rooms[g.roomId];
    g.levelTimes = savedTimes ? savedTimes.slice() : [];
    g.portals.clear();
    g.player.reset(g.room.spawn.x, g.room.spawn.y);
    g.cam.x = g.roomCenterCam().x;
    g.cam.y = g.roomCenterCam().y;
    g.fx.clear();
    g.won = false; g.winT = 0;
    g.levelClear = false; g.levelClearT = 0;
    savedRooms = null; savedTimes = null;
    playingCustom = false;
    setModeTag(null);
  }

  /** 跳到指定关（选关面板点格子） */
  function gotoLevel(rid) {
    const g = window.__game;
    if (playingCustom) restoreOriginal();
    if (rid < 0 || rid >= g.rooms.length) return;
    for (const r of g.rooms) {
      for (const c of r.crates) c.reset();
      for (const s of r.signals) s.on = false;
      for (const gt of r.gates) { gt.open = false; gt.openAmt = 0; }
      for (const cr of r.crystals) cr.timer = 0;
    }
    g.portals.clear();
    g.roomId = rid;
    g.room = g.rooms[rid];
    g.roomId = rid;
    g.player.reset(g.room.spawn.x, g.room.spawn.y);
    g.cam.x = g.roomCenterCam().x;
    g.cam.y = g.roomCenterCam().y;
    g.fx.clear();
    g.time = 0;
    g.deaths = 0;
    g.levelStartTime = 0;
    g.deathAtLevelStart = 0;
    g.levelTimes = [];
    g.won = false; g.winT = 0;
    g.levelClear = false; g.levelClearT = 0;
    g.paused = false;
    g.objective = '';
    g.currentHint = g.room.hint;
    g.hintTimer = 4.2;
    g.transition = 1;
    closeSelect();
  }

  /* ------------------------------------------------------------
     四点五、键位设置面板
     ------------------------------------------------------------
     ⚠️ 这段逻辑原先写在 index.html 的内联 <script> 里，和 custom.js 的
        openPanel 各绑了一遍按钮 —— 两个监听器都跑，行为互相打架。
        现在**唯一定义在这里**，index.html 不再重复绑定。
     ------------------------------------------------------------ */
  function renderBindPanel() {
    const rows = document.getElementById('bindRows');
    if (!rows) return;
    rows.innerHTML = '';
    for (const a of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'row';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = a.label;

      const btn = document.createElement('div');
      btn.className = 'key' + (KEYBINDS[a.id] ? '' : ' none');
      btn.textContent = KEYBINDS[a.id] ? keyLabel(KEYBINDS[a.id]) : '未绑定';
      btn.addEventListener('click', () => {
        const inp = window.__game.input;
        // 已经在录别的键 → 先取消，避免两个框同时 listening
        if (inp.captureAction) inp.captureAction = null;
        for (const el of rows.querySelectorAll('.key.listening')) el.classList.remove('listening');
        btn.classList.add('listening');
        btn.textContent = '按下按键…';
        inp.captureAction = a.id;
      });

      row.appendChild(name);
      row.appendChild(btn);
      rows.appendChild(row);
    }
  }

  function closeBindPanel() {
    const el = document.getElementById('binds');
    if (el) el.classList.remove('show');
    window.__game.input.captureAction = null;
    for (const e of document.querySelectorAll('.key.listening')) e.classList.remove('listening');
    window.__game.paused = false;
  }

  /* ------------------------------------------------------------
     四、选关面板 UI
     ------------------------------------------------------------ */
  let panelEl = null, gridEl = null, modeTagEl = null;

  function setModeTag(label) {
    if (!modeTagEl) return;
    if (label) {
      modeTagEl.textContent = label;
      modeTagEl.style.display = '';
    } else {
      modeTagEl.style.display = 'none';
    }
  }

  function buildPanel() {
    panelEl = document.getElementById('selectPanel');
    gridEl = document.getElementById('selectGrid');
    modeTagEl = document.getElementById('modeTag');
    if (!panelEl) return;

    gridEl.innerHTML = '';
    for (let i = 0; i < 20; i++) {
      const cell = document.createElement('button');
      cell.className = 'lvl';
      cell.dataset.rid = String(i);
      cell.innerHTML = `<div class="n">${i + 1}</div>`
        + `<div class="name"></div>`
        + `<div class="rec">—</div>`;
      cell.addEventListener('click', () => gotoLevel(i));
      gridEl.appendChild(cell);
    }
    refreshSelectBadges();
  }

  function refreshSelectBadges() {
    if (!gridEl) return;
    const g = window.__game;
    const total = g ? g.rooms.length : 20;
    for (const cell of gridEl.querySelectorAll('.lvl')) {
      const i = +cell.dataset.rid;
      const room = g && g.rooms[i];
      cell.querySelector('.name').textContent = room ? room.name : '—';
      if (i >= total) { cell.classList.add('locked'); continue; }
      cell.classList.remove('locked');
      const r = records[i];
      const rec = cell.querySelector('.rec');
      if (r && r.cleared) {
        cell.classList.add('done');
        rec.textContent = `最佳 ${(r.best || 0).toFixed(1)}s · 死 ${r.deaths || 0}`;
      } else {
        cell.classList.remove('done');
        rec.textContent = '未通关';
      }
    }
    // 全清进度
    const done = Object.values(records).filter(r => r && r.cleared).length;
    const el = document.getElementById('selectProgress');
    if (el) el.textContent = `已通关 ${Math.min(done, total)} / ${total}`;
  }

  function openSelect() { openPanel('select'); }
  function closeSelect() { if (panelEl) panelEl.classList.remove('show'); window.__game.paused = false; }

  function openPanel(which) {
    const g = window.__game;
    g.audio.init();
    g.paused = true;
    // ⚠️⚠️ 这里必须先清掉「正在录制键位」的状态。
    //   曾经的致命 bug：玩家点「键位设置」→ 点某个键框（captureAction 置位）
    //   → 直接点「关卡编辑器」。面板虽然切走了，但 input.captureAction 还留着，
    //   于是**下一次按键被吞进录制器**里，游戏里按什么都没反应；
    //   而键位面板这轮又不是被自己的关闭按钮关掉的，没人去清它 ——
    //   表现就是用户说的「点击后进入编辑地图页面，无法修改按键」。
    //   任何面板切换都必须先无条件取消录制。
    g.input.captureAction = null;
    for (const el of document.querySelectorAll('.key.listening')) el.classList.remove('listening');

    for (const el of document.querySelectorAll('.modal')) el.classList.remove('show');
    let id = 'selectPanel';
    if (which === 'editor') id = 'editorPanel';
    else if (which === 'binds') id = 'binds';
    else if (which === 'hall') id = 'hallPanel';
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
    if (which === 'select') refreshSelectBadges();
    if (which === 'editor') editor.refresh();
    if (which === 'binds') renderBindPanel();
    if (which === 'hall') hall.refresh();
  }
  function closePanels() {
    for (const el of document.querySelectorAll('.modal')) el.classList.remove('show');
    window.__game.input.captureAction = null;
    window.__game.paused = false;
  }

  /* ------------------------------------------------------------
     四点六、自定义地图大厅（浏览 / 分享 / 导入 / 试玩）
     ------------------------------------------------------------
     用户原话：「增添分享自定义地图或者自定义地图大厅」。
     大厅 = 下面这些能力的汇总：
       · 浏览所有自定义关卡（自己做的 + 分享码导入的），每张卡带缩略图
       · 搜索 / 排序 / 试玩 / 编辑 / 删除
       · 每张卡「分享」→ 生成分享码，一键复制（发微信 / 贴论坛都行）
       · 「导入分享码」→ 粘贴别人的码，直接进大厅，可选立刻试玩
     ------------------------------------------------------------ */
  const hall = (() => {
    let sortMode = 'new', keyword = '';

    /** 修正老数据：确保每条都有 id / 时间 / 作者字段 */
    function normalize(list) {
      let dirty = false;
      const now = Date.now();
      list.forEach((lv, i) => {
        if (!lv.id) { lv.id = 'c' + now + '_' + i + '_' + ((Math.random() * 1e6) | 0); dirty = true; }
        if (!lv.savedAt) { lv.savedAt = now - (list.length - i) * 1000; dirty = true; }
        if (lv.author === undefined) { lv.author = ''; dirty = true; }
        if (lv.plays === undefined) { lv.plays = 0; dirty = true; }
      });
      if (dirty) saveCustomLevels(list);
      return list;
    }

    function all() { return normalize(loadCustomLevels()); }

    /** 计算这张图的"难度标签"（纯统计，给玩家一眼看出关卡风格） */
    function tags(lv) {
      const t = [];
      let spikes = 0, crates = 0, walls = 0;
      for (const r of lv.map) for (const c of r) {
        if (c === '^') spikes++;
        else if (c === 'B') crates++;
        else if (c === '#') walls++;
      }
      if (spikes) t.push('刺 ' + spikes);
      if (crates) t.push('机关');
      t.push(walls > 300 ? '地形复杂' : '简洁');
      return t;
    }

    function filtered() {
      let list = all();
      if (keyword) {
        const k = keyword.toLowerCase();
        list = list.filter(lv =>
          (lv.name || '').toLowerCase().includes(k) ||
          (lv.author || '').toLowerCase().includes(k));
      }
      if (sortMode === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
      else if (sortMode === 'plays') list.sort((a, b) => (b.plays || 0) - (a.plays || 0));
      else list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      return list;
    }

    /** 画一张卡片的缩略图（复用编辑器的配色，玩家不用打开就看得懂） */
    function drawThumb(canvas, mapRows) {
      const cw = canvas.width, chh = canvas.height;
      const T = cw / CFG.ROOM_W;
      const c = canvas.getContext('2d');
      c.fillStyle = '#0b1020';
      c.fillRect(0, 0, cw, chh);
      for (let y = 0; y < CFG.ROOM_H; y++) {
        const row = mapRows[y] || '';
        for (let x = 0; x < CFG.ROOM_W; x++) {
          const ch2 = row[x], px = x * T, py = y * T;
          if (ch2 === '#') { c.fillStyle = '#3b5476'; c.fillRect(px, py, T + 0.6, T + 0.6); }
          else if (ch2 === '^') { c.fillStyle = '#ff6b6b'; c.fillRect(px + T * .15, py + T * .35, T * .7, T * .5); }
          else if (ch2 === 'o') { c.fillStyle = '#8fe3ff'; c.fillRect(px + T * .28, py + T * .28, T * .44, T * .44); }
          else if (ch2 === 'B') { c.fillStyle = '#c8a06a'; c.fillRect(px + T * .15, py + T * .15, T * .7, T * .7); }
          else if (ch2 === 'S') { c.fillStyle = '#9dffb0'; c.fillRect(px + T * .2, py + T * .2, T * .6, T * .6); }
          else if (ch2 === 'G') { c.fillStyle = '#ffd76e'; c.fillRect(px + T * .12, py + T * .12, T * .76, T * .76); }
        }
      }
    }

    function refresh() {
      const grid = document.getElementById('hallGrid');
      if (!grid) return;
      const list = filtered();
      grid.innerHTML = '';
      const countEl = document.getElementById('hallCount');
      if (countEl) countEl.textContent = `共 ${list.length} 张地图`;

      if (!list.length) {
        grid.innerHTML = `<div class="empty">${keyword ? '没有匹配的地图' : '还没有自定义地图 —— 去编辑器画一张，或者用分享码导入别人的'}</div>`;
        return;
      }

      for (const lv of list) {
        const card = document.createElement('div');
        card.className = 'card';

        const thumb = document.createElement('canvas');
        thumb.width = 300; thumb.height = 180;
        drawThumb(thumb, lv.map);
        card.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 'body';

        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = lv.name || '未命名';
        nm.title = lv.name || '';
        body.appendChild(nm);

        const meta = document.createElement('div');
        meta.className = 'meta';
        const d = lv.savedAt ? new Date(lv.savedAt) : null;
        meta.textContent = (lv.author ? 'by ' + lv.author + ' · ' : '')
          + (d ? `${d.getMonth() + 1}/${d.getDate()} ` : '')
          + `试玩 ${lv.plays || 0}`;
        body.appendChild(meta);

        const tagsEl = document.createElement('div');
        tagsEl.className = 'tags';
        for (const t of tags(lv)) {
          const s = document.createElement('span');
          s.textContent = t;
          tagsEl.appendChild(s);
        }
        body.appendChild(tagsEl);

        const acts = document.createElement('div');
        acts.className = 'acts';
        const bPlay = document.createElement('button');
        bPlay.textContent = '试玩';
        bPlay.addEventListener('click', () => {
          lv.plays = (lv.plays || 0) + 1;
          saveCustomLevels(all());
          closePanels();
          playMap(lv.map, { name: lv.name, objective: '抵达金色终点' });
        });

        const bEdit = document.createElement('button');
        bEdit.textContent = '编辑';
        bEdit.addEventListener('click', () => {
          const idx = all().findIndex(q => q.id === lv.id);
          openPanel('editor');
          if (idx >= 0) editor.loadLevel(idx);
        });

        const bShare = document.createElement('button');
        bShare.textContent = '分享';
        bShare.addEventListener('click', () => copyShare(lv));

        const bDel = document.createElement('button');
        bDel.className = 'danger';
        bDel.textContent = '删';
        bDel.addEventListener('click', () => {
          if (!confirm('删除「' + (lv.name || '未命名') + '」？')) return;
          const l = all().filter(q => q.id !== lv.id);
          saveCustomLevels(l);
          refresh();
          editor.refresh();
          toast('已删除');
        });

        acts.appendChild(bPlay); acts.appendChild(bEdit);
        acts.appendChild(bShare); acts.appendChild(bDel);
        body.appendChild(acts);
        card.appendChild(body);
        grid.appendChild(card);
      }
    }

    /** 把一张卡片的分享码塞进输入框并尝试复制到剪贴板 */
    function copyShare(lv) {
      let code;
      try { code = makeShareCode(lv.name, lv.map); }
      catch (e) { toast('生成分享码失败：' + e.message); return; }
      const box = document.getElementById('shareCode');
      if (box) { box.value = code; box.select(); }
      const done = () => toast(`分享码已复制（${code.length} 字）—— 发给别人即可`);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, () => { toast('已生成分享码，请手动复制'); });
      } else {
        try { document.execCommand('copy'); done(); }
        catch (e) { toast('已生成分享码，请手动复制'); }
      }
    }

    /** 导入一段分享码；opts.play = 导入后立刻试玩 */
    function importCode(code, opts = {}) {
      let parsed;
      try { parsed = parseShareCode(code); }
      catch (e) { toast('导入失败：' + e.message); return null; }
      const list = all();
      const name = parsed.name || ('分享关卡 ' + (list.length + 1));
      // 去重：地图完全一样就不重复入库
      const dup = list.find(lv => lv.map.join('\n') === parsed.map.join('\n'));
      if (dup) {
        toast('这张地图已经在你的大厅里了「' + dup.name + '」');
        if (opts.play) { closePanels(); playMap(dup.map, { name: dup.name, objective: '抵达金色终点' }); }
        return dup;
      }
      const rec = {
        name, author: opts.author || '', map: parsed.map,
        id: 'c' + Date.now() + '_' + ((Math.random() * 1e6) | 0),
        savedAt: Date.now(), plays: 0,
      };
      list.push(rec);
      saveCustomLevels(list);
      refresh();
      editor.refresh();
      toast('已导入「' + name + '」到大厅');
      if (opts.play) { closePanels(); playMap(rec.map, { name: rec.name, objective: '抵达金色终点' }); }
      return rec;
    }

    function init() {
      const s = document.getElementById('hallSearch');
      if (s) s.addEventListener('input', () => { keyword = s.value.trim(); refresh(); });
      const so = document.getElementById('hallSort');
      if (so) so.addEventListener('change', () => { sortMode = so.value; refresh(); });

      const imp = document.getElementById('hallImport');
      if (imp) imp.addEventListener('click', () => {
        const box = document.getElementById('shareCode');
        const v = prompt('把分享码粘到这里：', (box && box.value) || '');
        if (v) importCode(v.trim(), {});
      });
      const nb = document.getElementById('hallNew');
      if (nb) nb.addEventListener('click', () => { openPanel('editor'); editor.newLevel(); });

      const cp = document.getElementById('shareCopy');
      if (cp) cp.addEventListener('click', () => {
        const box = document.getElementById('shareCode');
        if (!box.value) { toast('还没有分享码 —— 点某张卡的「分享」'); return; }
        box.select();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(box.value).then(() => toast('已复制'), () => toast('请手动复制'));
        } else { try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('请手动复制'); } }
      });
      const op = document.getElementById('shareOpen');
      if (op) op.addEventListener('click', () => {
        const box = document.getElementById('shareCode');
        if (!box.value.trim()) { toast('先把分享码粘进来'); return; }
        importCode(box.value.trim(), { play: true });
      });
    }

    return { init, refresh, all, importCode, copyShare, makeShareCode, parseShareCode };
  })();

  /* ------------------------------------------------------------
     五、关卡编辑器
     ------------------------------------------------------------ */
  const PALETTE = [
    { ch: '#', label: '墙',      color: '#5c7ba8' },
    { ch: ' ', label: '空气',    color: '#1a2233' },
    { ch: '^', label: '尖刺',    color: '#ff7a7a' },
    { ch: 'o', label: '水晶',    color: '#8fe3ff' },
    { ch: 'B', label: '木箱',    color: '#c8a06a' },
    { ch: 'S', label: '出生点',  color: '#9dffb0' },
    { ch: 'G', label: '终点',    color: '#ffd76e' },
  ];

  const editor = (() => {
    let grid = [];          // 二维字符数组
    let brush = '#';
    let cv = null, cx = null;
    let hover = null;
    let name = '我的关卡';
    let editingIndex = -1;  // -1 = 新建
    let rafOn = false;

    function newLevel() {
      grid = blankMap().map(r => r.split(''));
      grid[CFG.ROOM_H - 2][3] = 'S';
      grid[CFG.ROOM_H - 3][10] = 'G';
      editRect(grid, 6, CFG.ROOM_H - 5, 10, CFG.ROOM_H - 3, '#');
      name = '我的关卡';
      editingIndex = -1;
      const inp = document.getElementById('edName');
      if (inp) inp.value = name;
      draw();
    }

    function editRect(gr, x0, y0, x1, y1, ch) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          if (gr[y] && gr[y][x] !== undefined) gr[y][x] = ch;
    }

    function loadLevel(idx) {
      const list = loadCustomLevels();
      if (idx < 0 || idx >= list.length) return;
      const lv = list[idx];
      grid = lv.map.map(r => r.split(''));
      name = lv.name || ('自定义 ' + (idx + 1));
      editingIndex = idx;
      const inp = document.getElementById('edName');
      if (inp) inp.value = name;
      draw();
      refresh();
    }

    function ensureBorders() {
      for (let x = 0; x < CFG.ROOM_W; x++) {
        grid[0][x] = '#';
        grid[CFG.ROOM_H - 1][x] = '#';
      }
      for (let y = 0; y < CFG.ROOM_H; y++) {
        grid[y][0] = '#';
        grid[y][CFG.ROOM_W - 1] = '#';
      }
    }

    /** 把编辑器网格转成 map 字符串数组 */
    function toMapRows() { return grid.map(r => r.join('')); }

    function paint(gx, gy) {
      if (gx < 1 || gx >= CFG.ROOM_W - 1 || gy < 0 || gy >= CFG.ROOM_H) return;
      // 只允许有一个 S / 一个 G
      if (brush === 'S' || brush === 'G') {
        for (let y = 0; y < CFG.ROOM_H; y++)
          for (let x = 0; x < CFG.ROOM_W; x++)
            if (grid[y][x] === brush) grid[y][x] = ' ';
      }
      grid[gy][gx] = brush;
      ensureBorders();
      draw();
    }

    function validate() {
      const msgs = [];
      let hasS = false, hasG = false;
      for (let y = 0; y < CFG.ROOM_H; y++) for (let x = 0; x < CFG.ROOM_W; x++) {
        if (grid[y][x] === 'S') hasS = true;
        if (grid[y][x] === 'G') hasG = true;
      }
      if (!hasS) msgs.push('缺少出生点（S）');
      if (!hasG) msgs.push('缺少终点（G）');
      return msgs;
    }

    /* ---------------- 绘制 ---------------- */
    function cellPx() {
      if (!cv) return 20;
      return cv.width / CFG.ROOM_W;
    }

    function draw() {
      if (!cv || !cx) return;
      const T = cellPx();
      cx.clearRect(0, 0, cv.width, cv.height);
      // 背景
      cx.fillStyle = '#0b1020';
      cx.fillRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < CFG.ROOM_H; y++) {
        for (let x = 0; x < CFG.ROOM_W; x++) {
          const ch = grid[y][x];
          const px = x * T, py = y * T;
          if (ch === '#') { cx.fillStyle = '#3b5476'; cx.fillRect(px, py, T + 0.5, T + 0.5); }
          else if (ch === '^') {
            cx.fillStyle = '#ff6b6b';
            cx.beginPath();
            cx.moveTo(px + T / 2, py + T * 0.15);
            cx.lineTo(px + T * 0.85, py + T * 0.85);
            cx.lineTo(px + T * 0.15, py + T * 0.85);
            cx.closePath(); cx.fill();
          }
          else if (ch === 'o') {
            cx.fillStyle = '#8fe3ff';
            cx.beginPath(); cx.arc(px + T / 2, py + T / 2, T * 0.3, 0, 7); cx.fill();
          }
          else if (ch === 'B') {
            cx.fillStyle = '#c8a06a'; cx.fillRect(px + T * 0.15, py + T * 0.15, T * 0.7, T * 0.7);
          }
          else if (ch === 'S') {
            cx.fillStyle = '#9dffb0';
            cx.beginPath(); cx.arc(px + T / 2, py + T / 2, T * 0.3, 0, 7); cx.fill();
          }
          else if (ch === 'G') {
            cx.fillStyle = '#ffd76e';
            cx.fillRect(px + T * 0.2, py + T * 0.2, T * 0.6, T * 0.6);
          }
        }
      }
      // 网格线
      cx.strokeStyle = 'rgba(140,180,255,.10)';
      cx.lineWidth = 1;
      for (let x = 0; x <= CFG.ROOM_W; x++) {
        cx.beginPath(); cx.moveTo(x * T, 0); cx.lineTo(x * T, cv.height); cx.stroke();
      }
      for (let y = 0; y <= CFG.ROOM_H; y++) {
        cx.beginPath(); cx.moveTo(0, y * T); cx.lineTo(cv.width, y * T); cx.stroke();
      }
      // 悬停高亮
      if (hover) {
        cx.strokeStyle = 'rgba(120,220,255,.9)';
        cx.lineWidth = 2;
        cx.strokeRect(hover.x * T, hover.y * T, T, T);
      }
    }

    /* ---------------- 事件 ---------------- */
    function bindCanvas() {
      cv = document.getElementById('edCanvas');
      if (!cv) return;
      cv.width = CFG.ROOM_W * 22;
      cv.height = CFG.ROOM_H * 22;
      cv.style.aspectRatio = `${CFG.ROOM_W} / ${CFG.ROOM_H}`;
      cx = cv.getContext('2d');

      const toCell = (e) => {
        const rect = cv.getBoundingClientRect();
        const T = rect.width / CFG.ROOM_W;
        const gx = Math.floor((e.clientX - rect.left) / T);
        const gy = Math.floor((e.clientY - rect.top) / T);
        return { x: gx, y: gy };
      };
      let down = false, rightDown = false;

      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        const c = toCell(e);
        if (e.button === 2) { rightDown = true; const keep = brush; brush = ' '; paint(c.x, c.y); brush = keep; }
        else { down = true; paint(c.x, c.y); }
      });
      cv.addEventListener('pointermove', (e) => {
        const c = toCell(e);
        hover = c;
        if (down) paint(c.x, c.y);
        else if (rightDown) { const keep = brush; brush = ' '; paint(c.x, c.y); brush = keep; }
        else draw();
      });
      const up = () => { down = false; rightDown = false; };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointerleave', () => { hover = null; up(); draw(); });
      cv.addEventListener('dblclick', () => {
        // 双击快速试玩
        editor.playtest();
      });
    }

    function playtest() {
      const msgs = validate();
      if (msgs.length) { alert('还不能试玩：\n· ' + msgs.join('\n· ')); return; }
      const g = window.__game;
      closePanels();
      playMap(toMapRows(), { name: name || '自定义关卡', objective: '抵达金色终点' });
    }

    function save() {
      const msgs = validate();
      if (msgs.length) { alert('还不能保存：\n· ' + msgs.join('\n· ')); return; }
      const list = hall.all();
      const nm = document.getElementById('edName');
      const finalName = (nm && nm.value.trim()) || name || '我的关卡';
      if (editingIndex >= 0 && editingIndex < list.length) {
        const old = list[editingIndex];
        list[editingIndex] = Object.assign({}, old, {
          name: finalName, map: toMapRows(), savedAt: Date.now(),
        });
      } else {
        list.push({
          name: finalName, map: toMapRows(),
          author: '', plays: 0,
          id: 'c' + Date.now() + '_' + ((Math.random() * 1e6) | 0),
          savedAt: Date.now(),
        });
        editingIndex = list.length - 1;
      }
      name = finalName;
      saveCustomLevels(list);
      refresh();
      hall.refresh();
      toast('已保存到本机 · 共 ' + list.length + ' 个自定义关卡');
    }

    /** 「分享」按钮：生成当前地图的分享码，可直接发给别人 */
    function shareCurrent() {
      const msgs = validate();
      if (msgs.length) { alert('还不能分享：\n· ' + msgs.join('\n· ')); return; }
      const nm = document.getElementById('edName');
      const finalName = (nm && nm.value.trim()) || name || '我的关卡';
      let code;
      try { code = makeShareCode(finalName, toMapRows()); }
      catch (e) { toast('生成分享码失败：' + e.message); return; }
      const box = document.getElementById('shareCode');
      if (box) { box.value = code; box.select(); }
      const copied = () => toast(`分享码已复制（${code.length} 字）`);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(copied, () => toast('已生成分享码，请手动复制'));
      } else {
        try { document.execCommand('copy'); copied(); }
        catch (e) { toast('已生成分享码，请手动复制'); }
      }
      // 顺手切到大厅，让玩家看到输入框里已经躺着分享码
      openPanel('hall');
    }

    function del() {
      const list = loadCustomLevels();
      if (editingIndex < 0 || editingIndex >= list.length) { toast('还没保存过这个关卡'); return; }
      if (!confirm('删除「' + list[editingIndex].name + '」？')) return;
      list.splice(editingIndex, 1);
      saveCustomLevels(list);
      editingIndex = -1;
      newLevel();
      refresh();
      toast('已删除');
    }

    function refresh() {
      const listEl = document.getElementById('edList');
      if (!listEl) return;
      const list = hall.all();
      listEl.innerHTML = '';
      if (!list.length) {
        listEl.innerHTML = '<div class="empty">还没有自定义关卡 —— 画一个再按「保存」</div>';
      }
      list.forEach((lv, i) => {
        const item = document.createElement('div');
        item.className = 'lv' + (i === editingIndex ? ' active' : '');
        item.innerHTML = `<span class="nm">${escapeHtml(lv.name)}</span>`;
        const pb = document.createElement('button');
        pb.className = 'mini';
        pb.textContent = '试玩';
        pb.addEventListener('click', (e) => {
          e.stopPropagation();
          lv.plays = (lv.plays || 0) + 1;
          saveCustomLevels(list);
          closePanels();
          playMap(lv.map, { name: lv.name, objective: '抵达金色终点' });
        });
        const eb = document.createElement('button');
        eb.className = 'mini';
        eb.textContent = '编辑';
        eb.addEventListener('click', (e) => { e.stopPropagation(); loadLevel(i); });
        item.appendChild(pb); item.appendChild(eb);
        item.addEventListener('click', () => loadLevel(i));
        listEl.appendChild(item);
      });
    }

    function buildPalette() {
      const el = document.getElementById('edPalette');
      if (!el) return;
      el.innerHTML = '';
      for (const p of PALETTE) {
        const b = document.createElement('button');
        b.className = 'sw' + (p.ch === brush ? ' on' : '');
        b.innerHTML = `<i style="background:${p.color}"></i>${p.label}`;
        b.addEventListener('click', () => {
          brush = p.ch;
          for (const s of el.querySelectorAll('.sw')) s.classList.remove('on');
          b.classList.add('on');
        });
        el.appendChild(b);
      }
    }

    function init() {
      bindCanvas();
      buildPalette();
      newLevel();
      refresh();

      const nm = document.getElementById('edName');
      if (nm) nm.addEventListener('input', () => { name = nm.value; });

      const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      wire('edNew', () => { editingIndex = -1; newLevel(); refresh(); });
      wire('edSave', save);
      wire('edPlay', playtest);
      wire('edPlayFoot', playtest);
      wire('edDelete', del);
      wire('edFill', () => {
        // 快捷：沿当前行填一条地板（在最底行）
        editRect(grid, 1, CFG.ROOM_H - 2, CFG.ROOM_W - 2, CFG.ROOM_H - 2, '#');
        draw();
      });
      wire('edClear', () => { newLevel(); toast('已清空'); });
      wire('edShare', shareCurrent);
      wire('edImport', importFromGame);
    }

    /** 把当前正在玩的官方关卡拷进编辑器（方便改） */
    function importFromGame() {
      const g = window.__game;
      const room = g.room;
      // 从 Room 反推一张干净的字符图（墙 + 实体）
      const rows = [];
      for (let y = 0; y < CFG.ROOM_H; y++) rows.push(new Array(CFG.ROOM_W).fill(' '));
      for (const s of room.solids) {
        if (!s.isStatic) continue;
        const x0 = Math.round(s.x / CFG.TILE), y0 = Math.round(s.y / CFG.TILE);
        const w = Math.round(s.w / CFG.TILE), h = Math.round(s.h / CFG.TILE);
        for (let y = y0; y < y0 + h; y++)
          for (let x = x0; x < x0 + w; x++)
            if (rows[y] && rows[y][x] !== undefined) rows[y][x] = '#';
      }
      for (const hz of room.hazards) {
        const x0 = Math.round(hz.x / CFG.TILE), y0 = Math.round(hz.y / CFG.TILE);
        const w = Math.round(hz.w / CFG.TILE), h = Math.round(hz.h / CFG.TILE);
        for (let y = y0; y < y0 + h; y++)
          for (let x = x0; x < x0 + w; x++)
            if (rows[y] && rows[y][x] !== undefined) rows[y][x] = '^';
      }
      for (const c of room.crystals) if (rows[c.gy]) rows[c.gy][c.gx] = 'o';
      for (const b of room.crates) {
        const gx = Math.round(b.x / CFG.TILE), gy = Math.round(b.y / CFG.TILE);
        if (rows[gy] && rows[gy][gx] !== undefined) rows[gy][gx] = 'B';
      }
      const sp = { x: Math.round(room.spawn.x / CFG.TILE), y: Math.round(room.spawn.y / CFG.TILE) };
      if (rows[sp.y] && rows[sp.y][sp.x] !== undefined) rows[sp.y][sp.x] = 'S';
      if (room.goal) {
        const gx = Math.round(room.goal.x / CFG.TILE), gy = Math.round(room.goal.y / CFG.TILE);
        if (rows[gy] && rows[gy][gx] !== undefined) rows[gy][gx] = 'G';
      }
      grid = rows;
      name = room.name + '（副本）';
      editingIndex = -1;
      const inp = document.getElementById('edName');
      if (inp) inp.value = name;
      ensureBorders();
      draw();
      toast('已导入「' + room.name + '」，可以随便改');
    }

    return { init, refresh, playtest, newLevel, loadLevel, draw, refreshBadges: refresh, importFromGame, save, shareCurrent };
  })();

  /* ------------------------------------------------------------
     六、小工具
     ------------------------------------------------------------ */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ------------------------------------------------------------
     七、包装 Game.step：捕获"本关通过"以记录成绩
     ------------------------------------------------------------ */
  function wrapGame() {
    const g = window.__game;
    if (!g || g.__customWrapped) return;
    g.__customWrapped = true;

    const origAdvance = g.advanceLevel.bind(g);
    g.advanceLevel = function () {
      // 记录本关成绩（在切关之前）
      if (!playingCustom) {
        const t = this.levelTimes[this.roomId] != null
          ? this.levelTimes[this.roomId]
          : Math.max(0, this.time - this.levelStartTime);
        const d = this.deaths - (this.deathAtLevelStart || 0);
        submitClear(this.roomId, t, d);
      } else {
        // 自定义关卡通关：只弹提示，不写记录
        toast('自定义关卡通关！用时 ' + (this.time - this.levelStartTime).toFixed(1) + 's');
      }
      return origAdvance();
    };

    const origHardReset = g.hardReset.bind(g);
    g.hardReset = function () {
      if (playingCustom) { restoreOriginal(); toast('已回到官方关卡'); }
      return origHardReset();
    };
  }

  /* ------------------------------------------------------------
     八、启动
     ------------------------------------------------------------ */
  function init() {
    buildPanel();
    editor.init();
    hall.init();
    wrapGame();

    const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    wire('btnSelect', openSelect);
    wire('btnEditor', () => openPanel('editor'));
    wire('btnBinds', () => openPanel('binds'));
    if (document.getElementById('btnHall')) wire('btnHall', () => openPanel('hall'));

    // 键位面板自己的按钮（唯一定义点，index.html 不再重复绑定）
    wire('btnBindsClose', closeBindPanel);
    wire('btnBindsReset', () => { resetBinds(); renderBindPanel(); toast('键位已恢复默认'); });
    const bp = document.getElementById('binds');
    if (bp) bp.addEventListener('click', (e) => { if (e.target === bp) closeBindPanel(); });

    // 录制结束（Input._bind 的 keydown 已经处理完 e.preventDefault）后自动刷新列表。
    // ⚠️ 用捕获阶段监听：Input 的监听器在同一事件里把 captureAction 置空，
    //    我们在它之后读到的就是"已结束"状态。
    addEventListener('keydown', () => {
      const inp = window.__game.input;
      if (inp._capturing) {
        inp._capturing = false;
        renderBindPanel();
      }
    }, true);

    for (const el of document.querySelectorAll('[data-close]')) {
      el.addEventListener('click', (e) => {
        if (e.target === el || e.target.dataset.close !== undefined) closePanels();
      });
    }
    addEventListener('keydown', (e) => {
      /* ⚠️⚠️ 录制键位时必须**完全让路**。
         否则玩家想绑 Tab / Esc 这类键，会被下面的"Tab 开选关 / Esc 关面板"
         抢走 —— 表现为"按键改不了"。 */
      if (window.__game.input.captureAction) return;
      if (e.key === 'Escape') {
        const anyOpen = document.querySelector('.modal.show');
        if (anyOpen) { closePanels(); e.preventDefault(); }
      }
      // Tab = 选关面板
      if (e.key === 'Tab') { e.preventDefault(); openSelect(); }
    });
    window.__custom = {
      gotoLevel, openSelect, openEditor: () => openPanel('editor'),
      playMap, restoreOriginal, records, submitClear, loadCustomLevels,
      openPanel, closePanels, renderBindPanel,
      hall, makeShareCode, parseShareCode, importShareCode: (c, o) => hall.importCode(c, o),
    };
  }

  return {
    init, gotoLevel, openSelect, playMap, restoreOriginal, records, submitClear,
    refreshSelectBadges, openPanel, closePanels, toast,
    renderBindPanel, closeBindPanel, hall, makeShareCode, parseShareCode,
  };
})();

// 显式挂到 window，保证 `CUSTOM` 在任何环境下都可访问（游戏内 / 测试沙箱）
window.CUSTOM = CUSTOM;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => CUSTOM.init(), 0));
} else {
  setTimeout(() => CUSTOM.init(), 0);
}
