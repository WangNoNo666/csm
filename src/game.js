/* ============================================================
   Game —— 世界状态、房间管理、机关、主循环
   ============================================================ */

const PALETTES = [
  { bg1: '#0f1524', bg2: '#1a2337', far: '#121a2b', wall: '#232f47', wallTop: '#375074', wallLine: 'rgba(120,150,200,.13)', wallEdge: 'rgba(150,185,235,.30)', accent: '#4ee2ff' },
  { bg1: '#141126', bg2: '#221a3a', far: '#1a1430', wall: '#2b2544', wallTop: '#463a6d', wallLine: 'rgba(160,140,220,.13)', wallEdge: 'rgba(190,170,255,.30)', accent: '#b79bff' },
  { bg1: '#0e1d1e', bg2: '#14302f', far: '#102524', wall: '#1f3a3a', wallTop: '#2f5c5a', wallLine: 'rgba(120,220,200,.12)', wallEdge: 'rgba(140,240,220,.28)', accent: '#4ee2b0' },
  { bg1: '#1e1410', bg2: '#33211a', far: '#241812', wall: '#3b2a22', wallTop: '#5e4436', wallLine: 'rgba(230,170,120,.12)', wallEdge: 'rgba(255,190,140,.28)', accent: '#ffa94e' },
  { bg1: '#101a2a', bg2: '#1b2b45', far: '#132135', wall: '#243550', wallTop: '#3a5478', wallLine: 'rgba(130,175,230,.13)', wallEdge: 'rgba(160,205,255,.30)', accent: '#6fb2ff' },
  { bg1: '#1a1226', bg2: '#2b1c40', far: '#201530', wall: '#312350', wallTop: '#4c3778', wallLine: 'rgba(180,150,240,.13)', wallEdge: 'rgba(210,180,255,.30)', accent: '#c89bff' },
];

/* ============================================================
   分步引导脚本编译器
   ------------------------------------------------------------
   levels.js 里写：
     steps: [
       { when: 'sig(0)',        text: '门开了，往右走' },
       { when: '!sig(0)',       text: '把箱子推上压力板', at: 'plate0' },
     ]
   用到的表达式只允许访问**白名单里的变量/函数**（见 Game.stepObjective 的 env），
   不允许 window/document/eval 等，避免关卡数据变成任意代码入口。
   ============================================================ */
const STEP_ALLOWED = new Set([
  'p', 'r', 'P', 'sig', 'gatesOpen', 'anyGateOpen', 'gatesShut', 'platesDown', 'anyPlateDown',
  'boxOnPlate', 'boxMoved', 'near', 'at', 'onGround', 'inAir', 'onWall',
  'leftOf', 'rightOf', 'py', 'px', 'portalReady', 'portalCount', 'blockedGate', 'sigOn',
  'won', 't', 'T', 'Math', 'abs', 'min', 'max', 'clamp',
]);
const STEP_ARROW_POINTS = {
  plate0: 'plate0', plate1: 'plate1',
  box0: 'box0', box1: 'box1',
  goal: 'goal', crystal0: 'crystal0', crystal1: 'crystal1',
  portalA: 'portalA', portalB: 'portalB',
  exit: 'exit',
};

function compileSteps(defSteps) {
  if (!defSteps || !defSteps.length) return [];
  const out = [];
  for (const s of defSteps) {
    const fn = compileStepExpr(s.when);
    const arrowFn = compileStepArrow(s.at);
    // 保留 when 原文：出错时能直接报出「哪条条件写错了」，不然只能看到 undefined
    out.push({ text: s.text, when: s.when, fn, at: s.at, arrowFn });
  }
  return out;
}

/** 编译 when 表达式 → 函数(env) → boolean */
function compileStepExpr(src) {
  const code = String(src || 'false');
  return function (env) {
    // 只暴露白名单键；未列出的键一律 undefined
    const names = [], vals = [];
    for (const k of Object.keys(env)) {
      if (!STEP_ALLOWED.has(k)) continue;
      // 合法的标识符才能作为形参
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)) continue;
      names.push(k); vals.push(env[k]);
    }
    names.push('abs'); vals.push(Math.abs);
    names.push('min'); vals.push(Math.min);
    names.push('max'); vals.push(Math.max);
    names.push('clamp'); vals.push(clamp);
    let f;
    try {
      // eslint-disable-next-line no-new-func
      f = new Function(...names, `"use strict"; return (${code});`);
    } catch (e) {
      // 只有**编译**失败（表达式语法/白名单写错）才吞掉，
      // 并且留下线索，免得策划对着"永远第 1 步"发呆。
      if (typeof console !== 'undefined') {
        console.warn(`[引导脚本] 表达式无法编译: ${code} → ${e.message}`);
      }
      return false;
    }
    // 运行期错误**不**吞：吞掉会让写错的表达式（例如 p.py()）静默变成 false，
    // 表现为引导永远停在第一步，排查成本极高。
    return f(...vals);
  };
}

/** 编译 at 表达式 → 函数(env, T) → {x,y} | null */
function compileStepArrow(src) {
  if (src == null || typeof src === 'object') return null;
  const key = String(src);
  return function (env, T) {
    const r = env.r, P = env.P;
    const pick = (obj) => obj ? { x: obj.x ?? (obj.cx), y: obj.y ?? (obj.cy) } : null;
    if (key === 'goal') return r.goal ? { x: r.goal.x, y: r.goal.y } : null;
    if (key === 'exit') {
      const l = (r.links || [])[0];
      if (!l) return null;
      if (l.edge === 'bottom') return { x: ((l.x0 + l.x1) / 2 + 0.5) * T, y: r.H - T };
      if (l.edge === 'top') return { x: ((l.x0 + l.x1) / 2 + 0.5) * T, y: T };
      if (l.edge === 'left') return { x: T, y: ((l.y0 + l.y1) / 2 + 0.5) * T };
      return { x: r.W - T, y: ((l.y0 + l.y1) / 2 + 0.5) * T };
    }
    if (/^plate(\d+)$/.test(key)) {
      const pl = r.plates[+RegExp.$1];
      return pl ? { x: pl.x + pl.w / 2, y: pl.y } : null;
    }
    if (/^box(\d+)$/.test(key)) {
      const b = r.crates[+RegExp.$1];
      return b ? { x: b.cx, y: b.cy } : null;
    }
    if (/^crystal(\d+)$/.test(key)) {
      const c = r.crystals[+RegExp.$1];
      return c ? { x: c.x, y: c.y } : null;
    }
    if (key === 'portalA') return P.a.active ? { x: P.a.x, y: P.a.y } : null;
    if (key === 'portalB') return P.b.active ? { x: P.b.x, y: P.b.y } : null;
    if (key === 'portalOpen') {
      const e = P.a.active ? P.a : P.b;
      return e ? { x: e.x, y: e.y } : null;
    }
    // 兜底：当作 "gx,gy" 或单个数字
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(key)) {
      const [a, b] = key.split(',').map(Number);
      return { x: a * T + T / 2, y: b * T + T / 2 };
    }
    return null;
  };
}

class Room {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.hint = def.hint || '';
    this.objective = def.objective || '';
    this.needPortal = !!def.needPortal;
    this.objMode = def.objMode || 'inertia';
    this.keys = def.keys || null;      // 本关要提示的键位（{portal, portal2}）
    this.steps = compileSteps(def.steps);   // 分步引导脚本（见 compileSteps）
    this.palette = PALETTES[def.id % PALETTES.length];
    this.W = CFG.ROOM_W * CFG.TILE;
    this.H = CFG.ROOM_H * CFG.TILE;
    this.bounds = { x: 0, y: 0, w: this.W, h: this.H };
    // 房间边界放宽一圈，让玩家能穿过洞口进入相邻房间（再由 checkRoomLinks 接手）
    this.boundsLoose = { x: -CFG.TILE, y: -CFG.TILE, w: this.W + CFG.TILE * 2, h: this.H + CFG.TILE * 2 };
    this.solids = [];        // 静态墙块（合并后）
    this.spawn = { x: 64, y: 64 };
    this.goal = null;
    this.entities = [];      // 动态实体
    this.signals = [];
    this.gates = [];
    this.movers = [];
    this.plates = [];
    this.levers = [];
    this.crystals = [];
    this.crates = [];
    this.hazards = [];
    this.texts = [];
    this.links = def.links || [];
    this.build();
  }

  build() {
    const map = this.def.map;
    const T = CFG.TILE;
    // 1) 解析地图 → 原始格
    const grid = [];
    for (let y = 0; y < CFG.ROOM_H; y++) {
      const row = (map[y] || '').padEnd(CFG.ROOM_W, ' ');
      grid.push(row.slice(0, CFG.ROOM_W).split(''));
    }
    // 2) 实体
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        const ch = grid[y][x];
        if (ch === 'S') { this.spawn = { x: x * T + (T - CFG.P_W) / 2, y: y * T + (T - CFG.P_H) / 2 }; grid[y][x] = ' '; }
        else if (ch === 'G') { this.goal = new Goal(x, y); grid[y][x] = ' '; }
        else if (ch === 'B') { this.crates.push(new PushBox(x * T + 6, y * T + 4, this.crates.length)); grid[y][x] = ' '; }
        else if (ch === 'o') { this.crystals.push(new Crystal(x, y)); grid[y][x] = ' '; }
        else if (ch === '^') { this.hazards.push(new Hazard(x, y, 1, 1, 'spike')); grid[y][x] = ' '; }
      }
    }
    // 3) 实心格 → 合并矩形（贪心 **先横后纵**）
    /* ★★★ 为什么要纵向合并（这是一个让"传送门放不到墙上"的真凶）★★★
       原来的实现只做**行内横向合并**，于是每个 solid 都是"高 1 格"的条带。
       后果：
         · 地板/天花板（一行 30 格贯通）→ 变成 960px 宽的条带，
           它的顶面/底面很宽，门放得下 ✅
         · **竖直隔墙**（x=15 的一列 '#'）→ 变成 15 个 1×1 的小方块，
           每块的**侧面只有 32px 高**。
       而 `findPortalSpot` 里有一道"面太窄放不下"的闸：
           if (f.to - f.from < R * 1.6) continue;      // R=21 → 33.6px
       32 < 33.6 ⇒ **所有竖直墙的表面全被过滤掉**。
       玩家按 → 想开墙面门时，候选里只剩地板条带的底面，
       于是被强制放到 `(14.83, 18.00) d=2`（地板下面，房间外）——
       这就是用户说的"传送门无法在墙上放置"。
       ✅ 修法：横向合并完之后，再做一次**纵向合并**（把同 x 区间、
          上下相邻的条带粘起来）。这样一堵 15 格高的隔墙就是**一整块**
          solid，侧面 480px 宽，墙面门自然就能选中了。 */
    const used = new Set();
    const key = (x, y) => x + ',' + y;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] !== '#' || used.has(key(x, y))) continue;
        let w = 1;
        while (x + w < CFG.ROOM_W && grid[y][x + w] === '#' && !used.has(key(x + w, y))) w++;
        for (let i = 0; i < w; i++) used.add(key(x + i, y));
        this.solids.push({ x: x * T, y: y * T, w: w * T, h: T, active: true, isStatic: true });
      }
    }
    // 3b) 纵向合并：把"同样的 x 区间、上下紧邻"的条带粘成一整块
    {
      const merged = [];
      const byX = new Map();                       // "x,w" → 该列上已合并的块
      // 按 y 升序处理（solid 天然就是按 y 生成的）
      for (const s of this.solids) {
        const k = `${s.x},${s.w}`;
        const prevS = byX.get(k);
        if (prevS && Math.abs((prevS.y + prevS.h) - s.y) < 0.01) {
          prevS.h += s.h;                          // 上下紧邻 → 长高
        } else {
          const ns = { x: s.x, y: s.y, w: s.w, h: s.h, active: s.active, isStatic: s.isStatic };
          merged.push(ns);
          byX.set(k, ns);
        }
      }
      this.solids = merged;
    }

    // 4) 机关
    // ⚠️ signals 支持三种写法：
    //    数字 N        → 建 N 条信号（旧版 `signals: 1`）
    //    'signal0'     → 单个命名信号；但引擎内部一律用 **数字下标** 索引
    //                    （`s.signals[i]` / cat 的 `sig: i => signals[i]`），
    //                    所以字符串署名 → 统一映射成下标 0。
    //    undefined     → 完全由 plates/gates/... 的 sig 字段兜底建（默认 0 号）。
    //    历史 bug：把字符串直接丢进 for 循环 —— 'signal0' < 0 为 false，
    //    于是 signals 数组一个元素都没有，signals[0] === undefined，
    //    所有机关房间的 plate/gate 共享 undefined，整关机关全废。
    const rsigs = this.def.signals;
    if (typeof rsigs === 'number') {
      for (let i = 0; i < rsigs; i++) this.signals.push(new Signal(false));
    } else if (typeof rsigs === 'string') {
      this.signals.push(new Signal(false));
    }
    // ⚠️ 各机关 def 里的 `sig` 是可省略的（地图写法只给 gx/gy）。
    //    必须显式取 `p.sig ?? 0`：直接写 `this.signals[p.sig]` 会变成
    //    `signals[undefined]` —— 既创建了一个游离属性，又让 plate 抓到
    //    一个和 signals[0] 完全不同的 Signal 对象（门永远开不了）。
    const sigAt = (i) => {
      const k = (i === undefined || i === null) ? 0 : (i | 0);
      if (!this.signals[k]) this.signals[k] = new Signal(false);
      return this.signals[k];
    };
    for (const p of (this.def.plates || [])) {
      this.plates.push(new Plate(p.gx, p.gy, sigAt(p.sig), p.w || 1));
    }
    for (const l of (this.def.levers || [])) {
      this.levers.push(new SwitchLever(l.gx, l.gy, sigAt(l.sig)));
    }
    for (const gt of (this.def.gates || [])) {
      this.gates.push(new Gate(gt.gx, gt.gy, gt.w, gt.h, sigAt(gt.sig), !!gt.invert));
    }
    for (const m of (this.def.movers || [])) {
      this.movers.push(new MovingBlock(m.gx, m.gy, m.w, m.h, m.dx, m.dy, sigAt(m.sig), m.speed || 1.6));
    }
    for (const h of (this.def.hazards || [])) this.hazards.push(new Hazard(h.gx, h.gy, h.w, h.h, h.type));
    for (const t of (this.def.texts || [])) this.texts.push(new TextHint(t.gx, t.gy, t.text));
  }

  /** 每步需要参与碰撞的实心集合 */
  collisionSolids() {
    const arr = this.solids.slice();
    for (const gt of this.gates) if (gt.active) arr.push(gt.solidRect);
    for (const m of this.movers) arr.push(m.solidRect);
    return arr;
  }

  /** 世界绘制用（含装饰） */
  get solidsAll() { return this.solids; }
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.input = new Input();
    this.fx = new FX();
    this.audio = new AudioKit();

    this.rooms = ROOMS.map(d => new Room(d));
    this.roomId = 0;
    this.room = this.rooms[0];

    this.portals = new PortalPair();
    this.player = new Player(this.room.spawn.x, this.room.spawn.y);

    this.cam = { x: 0, y: 0 };
    this.shakeAmt = 0; this.shakeT = 0; this.shakeDur = 0;
    this.freezeT = 0;

    this.time = 0;
    this.deaths = 0;
    this.paused = false;
    this.won = false;
    this.winT = 0;
    this.started = false;
    this.transition = 0;
    this.transTarget = null;

    // ---- 关卡进度 ----
    // 抵达终点**不是**游戏结束，而是进入下一关；只有第 10 关才真正通关。
    // levelClearT > 0 表示"本关已通过，正在播放过场"，倒计时结束才切关。
    this.levelClear = false;
    this.levelClearT = 0;
    this.levelTimes = [];     // 每关用时（秒）
    this.levelStartTime = 0;  // 本关开始时刻（用 game.time 计）
    this.deathAtLevelStart = 0;

    this.lastPlace = null;   // 记住上一次放的门（用于 Q/E 轮换）
    this.hintTimer = 4.5;
    this.currentHint = this.room.hint;
    this.portalHintShown = false;
    // 「按住方向键可以指定门开在哪一面」这条教学只弹一次（首次放门时）。
    // 没有它玩家不知道能把门送到隔墙另一侧，房间6 会卡死。
    this.portalAimHintShown = false;

    // ---- 引导系统 ----
    // 顶部常驻「当前目标」：永远是"下一步该干什么"的一句话
    this.objective = '';
    this.objectiveKey = '';   // 目标 key，变化时闪光提示
    this.objFlash = 0;
    this.objArrow = null;     // 指向目标的世界坐标 {x,y}
    this._objArrow = null;    // 由 portalObjective 回填的临时箭头
    this.showKeyHelp = true;  // 起始房间常驻键位卡

    this.acc = 0;
  }

  /* ---------------- 初始化 / 重置 ---------------- */
  start() {
    this.audio.init();
    this.resetAll(true);
  }

  resetAll(initial = false) {
    for (const r of this.rooms) {
      for (const c of r.crates) c.reset();
      for (const s of r.signals) s.on = false;
      for (const l of r.levers) l.flipped = false;
      for (const gt of r.gates) { gt.open = false; gt.openAmt = 0; }
      for (const m of r.movers) m.p = 0;
      for (const cr of r.crystals) cr.timer = 0;
    }
    if (initial) { this.roomId = 0; this.room = this.rooms[0]; }
    this.portals.clear();
    this.player.reset(this.room.spawn.x, this.room.spawn.y);
    this.cam.x = this.roomCenterCam().x;
    this.cam.y = this.roomCenterCam().y;
    this.fx.clear();
    this.won = false; this.winT = 0;
    // 关卡进度复位
    this.levelClear = false;
    this.levelClearT = 0;
    this.levelTimes = [];
    this.levelStartTime = this.time;
    this.deathAtLevelStart = this.deaths;
    this.hintTimer = 4.5;
    this.currentHint = this.room.hint;
    // 教学提示跟着进度一起复位（重开一局时应该再教一次）
    this.portalHintShown = false;
    this.portalAimHintShown = false;
  }

  /** 玩家死亡/重置：回到房间出生点，机关复位，箱子复位 */
  respawnPlayer() {
    this.deaths++;
    this.audio.death();
    this.fx.deathBurst(this.player.cx, this.player.cy);
    this.shake(9, 0.35);
    this.freezeFrame(0.09);
    const r = this.room;
    for (const c of r.crates) c.reset();
    for (const s of r.signals) s.on = false;
    for (const l of r.levers) l.flipped = false;
    this.portals.clearRoom(r.id);
    this.player.reset(r.spawn.x, r.spawn.y);
    // ⚠️ step() 里碰到尖刺是「先 respawnPlayer() 再 return」，
    //    那一步不会走到末尾的 updateObjective()。如果这里不重算，
    //    切关首帧就吃到刺的房间会永远显示空白目标（房间9 踩过）。
    this.updateObjective();
  }

  hardReset() {
    // 真正从第 1 关重开（结算画面的「按 R 重新开始」走这里）
    this.resetAll(true);
    this.deaths = 0;
    this.time = 0;
    this.levelStartTime = 0;
    this.deathAtLevelStart = 0;
    this.audio.place();
  }

  roomCenterCam() {
    const r = this.room;
    return {
      x: clamp(this.player.cx - this.renderer.W / 2, 0, Math.max(0, r.W - this.renderer.W)),
      y: clamp(this.player.cy - this.renderer.H / 2, 0, Math.max(0, r.H - this.renderer.H)),
    };
  }

  /* ---------------- 房间切换 ---------------- */
  switchRoom(rid, viaPortal = false) {
    if (rid === this.roomId || rid == null || !this.rooms[rid]) return;
    this.roomId = rid;
    this.room = this.rooms[rid];
    this.transition = 1;
    this.currentHint = this.room.hint;
    this.hintTimer = 4.2;
    this.objective = '';      // 强制下一帧重算目标
    this.objArrow = null;
    if (!viaPortal) {
      this.cam.x = this.roomCenterCam().x;
      this.cam.y = this.roomCenterCam().y;
      this.audio.roomIn();
    }
    this.player._lastEntry = null;
  }

  /**
   * 房间链接检测。
   * 玩家从某个方向的"开口"越过房间边界时，进入相邻房间并镜像落点。
   * 链接定义： { room, edge: 'top'|'bottom'|'left'|'right', x0,x1 | y0,y1, toY|toX }
   */
  checkRoomLinks() {
    const p = this.player;
    const r = this.room;
    const T = CFG.TILE;
    const bd = r.boundsLoose || { x: -T, y: -T, w: r.W + 2 * T, h: r.H + 2 * T };

    // 判断玩家是否越过了某条边。
    // 注意：Actor 用 boundsLoose(±1 格) 兜底，所以玩家最多只能贴到边界上，
    // 这里以「贴住边界」作为触发条件（用底边/右边算，别用左上角坐标）。
    const outT = 1;
    let edge = null, cross = 0;
    if (p.y <= bd.y + outT) { edge = 'top'; cross = p.cx; }
    else if (p.y + p.h >= bd.y + bd.h - outT) { edge = 'bottom'; cross = p.cx; }
    else if (p.x <= bd.x + outT) { edge = 'left'; cross = p.cy; }
    else if (p.x + p.w >= bd.x + bd.w - outT) { edge = 'right'; cross = p.cy; }
    if (!edge) return;

    for (const l of (r.links || [])) {
      if (l.edge !== edge) continue;
      // 检查横向位置是否落在开口范围内
      const axis = (edge === 'top' || edge === 'bottom') ? 'x' : 'y';
      const crossTile = cross / T;
      const inRange = axis === 'x'
        ? (crossTile >= l.x0 - 1.0 && crossTile <= l.x1 + 2.0)
        : (crossTile >= l.y0 - 1.0 && crossTile <= l.y1 + 2.0);
      if (!inRange) continue;

      const target = this.rooms[l.room];
      if (!target) break;
      // 镜像落点：从对面进入
      const nx = clamp(crossTile, 2, CFG.ROOM_W - 3);
      const ny = clamp(cross / T, 2, CFG.ROOM_H - 3);
      if (edge === 'bottom') {
        this.player.x = nx * T + (T - p.w) / 2;
        this.player.y = (l.toY ?? 2) * T;
      } else if (edge === 'top') {
        this.player.x = nx * T + (T - p.w) / 2;
        this.player.y = (l.toY ?? CFG.ROOM_H - 4) * T;
      } else if (edge === 'left') {
        this.player.y = ny * T + (T - p.h) / 2;
        this.player.x = (CFG.ROOM_W - 3) * T;
      } else {
        this.player.y = ny * T + (T - p.h) / 2;
        this.player.x = 2 * T;
      }
      this.player.vx = 0;
      this.player.vy = Math.min(Math.max(this.player.vy, 0), 180);
      this.player.remX = 0; this.player.remY = 0;
      this.player._prevCx = this.player.cx;
      this.player._prevCy = this.player.cy;
      this.switchRoom(l.room, false);
      return;
    }

    // 越界但没有链接 → 掉出世界，重生
    this.respawnPlayer();
  }

  /* ---------------- 传送门操作 ---------------- */
  /**
   * 在玩家附近的墙面上寻找可放置点。
   *
   * ⚠️⚠️ 关键设计：**按住方向键可以指定门放在哪个面** ⚠️⚠️
   * ------------------------------------------------------------------
   * 旧实现只按「离玩家最近」打分，导致的致命问题（用户实测反馈）：
   *   房间6 有一道贯通隔墙 x=14 把房间劈成左右两半，
   *   玩家**只能站在左侧**（右侧要靠传送门才能过去，是设计要求）。
   *   但"离玩家最近的面"永远是**脚下的地板顶面**（dist 最小），
   *   于是玩家无论朝哪站，按 B 都只会把门放在自己脚边 ——
   *   **永远无法把门放到隔墙的右表面**（那是通往右侧的唯一出口）。
   *   实测扫描房间6 全部 126 个站位：能放下两个门的站位有 126 个，
   *   但"第一个门 x > 14（隔墙右侧）"的站位是 **0 个**。
   *   玩家的体感就是"传送门放不到右边去，这关过不了"。
   *
   * ✅ 新规则（三层优先级）：
   *   ① 玩家**按住 ↑/↓/←/→** 时，只用该方向那一组面
   *      （↑→地面/天花板底面，↓→顶面，←→左表面(d3)，→→右表面(d1)）
   *      —— 这样"想往右放"就按住 → 再按 B，语义直觉且完全可控。
   *   ② 没按方向键时：优先**玩家正贴着的那面墙**（脚下 / 背后），保持原有手感。
   *   ③ 都没有才退回"离玩家最近"。
   *   另外：**同方向的多个面里优先离玩家最近的**（保持"就近放置"的手感），
   *   但**不再因为"脚边有地板"就永远抢走选择权**。
   *
   * @param {'a'|'b'} which 放哪一扇门
   * @param {object} [aim] 可选：显式指定方向偏好 { dx, dy }（-1/0/1）
   */
  findPortalSpot(which, aim = null) {
    const p = this.player;
    const T = CFG.TILE;
    const solids = this.room.collisionSolids();
    const R = CFG.PORTAL_R;
    const input = this.input;

    /* ---- 决定"方向偏好" ----
       显式传入的 aim 优先（供测试/脚本用）；
       否则读玩家当前按住的移动键。 */
    let wantX = 0, wantY = 0;
    if (aim) { wantX = aim.dx | 0; wantY = aim.dy | 0; }
    else if (input) {
      if (input.down('up')) wantY = -1;
      else if (input.down('down')) wantY = 1;
      if (input.down('right')) wantX = 1;
      else if (input.down('left')) wantX = -1;
      // 同时按了水平+垂直：以水平为准（墙面门更常用，也更符合"往那边放"的直觉）
      if (wantX !== 0) wantY = 0;
    }
    // 竖直方向：↑ 通常是"把门放头上/脚下地板"，↓ 是"放脚下"。
    // 这里把 ↑ 映射到「顶面(d0)」和「底面(d2)」两个候选都保留，
    // 具体由下面的 faceDir 过滤决定。
    const hasAim = wantX !== 0 || wantY !== 0;

    // 候选点：玩家周围的实心格表面
    const cands = [];
    for (const s of solids) {
      if (!s.active) continue;
      // 只看近处的块
      if (s.x > p.cx + 3 * T || s.x + s.w < p.cx - 3 * T) continue;
      if (s.y > p.cy + 3 * T || s.y + s.h < p.cy - 3 * T) continue;

      // 四个面
      const faces = [
        { d: 0, x: s.x + s.w / 2, y: s.y, from: s.x, to: s.x + s.w },              // 顶面（法线朝上）
        { d: 2, x: s.x + s.w / 2, y: s.y + s.h, from: s.x, to: s.x + s.w },        // 底面（法线朝下）
        { d: 3, x: s.x, y: s.y + s.h / 2, from: s.y, to: s.y + s.h },              // 左表面
        { d: 1, x: s.x + s.w, y: s.y + s.h / 2, from: s.y, to: s.y + s.h },        // 右表面
      ];
      for (const f of faces) {
        /* ★★★ 按"面本身"到玩家的最近距离过滤，而不是按"块的外接矩形" ★★★
           血泪史（房间9 整关报废，第五次；这条是所有"门开到奇怪地方"的总根源）：
             原来是 `if (s.y > p.cy + 3T || s.y+s.h < p.cy - 3T) continue;` ——
             只看**块的包围盒**有没有和玩家 ±3 格重叠。
             于是像"井右壁"这种**贯通 13 格高的细长块**，它的**顶面**
             （在离玩家 8 格高的地方）也会通过筛选，然后靠 `dist` 排序
             在某些地形下一路胜出 —— 玩家明明站在井底，门却开到了 8 格高的墙顶。
             正确判据：**这张面离玩家最近的点的距离**必须 ≤ 3 格。
             对 d=0/d=2（水平面）取 |py - p.cy| 与面在 x 上的区间距离；
             对 d=1/d=3（竖直面）取 |px - p.cx| 与面在 y 上的区间距离。
           ⇒ 统一用"点到线段的距离"，一次解决所有朝向。 */
        const horizontal = f.d === 0 || f.d === 2;   // 水平面：from/to 是 x 区间
        const segLo = Math.min(f.from, f.to), segHi = Math.max(f.from, f.to);
        let fdx, fdy;
        if (horizontal) {
          const nearX = clamp(p.cx, segLo, segHi);
          fdx = p.cx - nearX;                         // 横向缺口
          fdy = f.y - p.cy;                           // 纵向到面的距离
        } else {
          const nearY = clamp(p.cy, segLo, segHi);
          fdx = f.x - p.cx;                           // 横向到面的距离
          fdy = p.cy - nearY;                         // 纵向缺口
        }
        if (Math.hypot(fdx, fdy) > 3 * T) continue;

        /* ⚠️ 面宽闸：门直径是 R（=21px 半径 → 需要约 2 格 = 64px 才好放），
           但**绝不能**把 1 格（32px）的面直接毙掉 ——
           很多平台/台阶就是 1 格厚，毙掉之后玩家在这些地方
           完全放不出门（表现为"按了开门键没反应"）。
           ✅ 改成：只要不小于 1 格就不硬性剔除，而是**记一个惩罚分**，
              让"更宽的面"优先胜出。这样既保证放得出来，又保证放得好看。 */
        if (f.to - f.from < T * 0.9) continue;   // 连 1 格都不到 → 真的放不下
        f.owner = s;                             // ★ 记住"这张面属于哪块实心"
        cands.push(f);
      }
    }
    if (!cands.length) return null;

    /* ---- 评估每个候选 ---- */
    const scored = [];
    for (const f of cands) {
      const span = f.to - f.from;
      /* 投影玩家中心到面上。
         ⚠️ 面比门直径还窄时（span < 2R），`clamp(v, from+R, to-R)` 的
            下界会大于上界，clamp 会返回下界 → 门被推到面外面去。
            所以这里要按"能夹就夹，不能夹就居中"处理。 */
      const lo = f.from + Math.min(R, span / 2);
      const hi = f.to - Math.min(R, span / 2);
      let px, py;
      if (f.d === 0 || f.d === 2) { px = hi >= lo ? clamp(p.cx, lo, hi) : (f.from + f.to) / 2; py = f.y; }
      else { px = f.x; py = hi >= lo ? clamp(p.cy, lo, hi) : (f.from + f.to) / 2; }

      /* 门必须"露在空气里" —— 但不能因为**旁边的墙**就把门判死。
         ★★★ 探针从"门面正前方一小片"改成"门框自身 + 薄薄一层空腔" ★★★
         血泪史（房间9 整关报废，第二次；这次是最终真凶）：
           原来的探针是"门面法线方向外侧的一个小方盒"，目的是确认门外是空的。
           但对**地板门（d=0）**来说，只要玩家站在一个"地板与竖墙相接的角落"
           （竖井里贴着高柱就是这种地形），门面法线朝上、门面外侧确实是空气，
           可那个小方盒的**侧面**会插进旁边的竖墙里 → blocked → 地板门被毙。
           于是玩家按 ↑ 只能把门开到柱顶 (8.5, 6.0)，整关无解。
         正确的判据是：**门框自身所占的空间必须是空的**（门不能被埋在实心块里），
         至于门外侧——门本来就是贴在面上的，只要"门框所在的那条线"
         没有被实心块穿过就够了。
         ⇒ 改成：直接检查**门框矩形**（沿门面方向 span 宽、法线方向 6px 厚）
            是否与任何实心块重叠。贴在墙边的地板门不再是"被挡"，而是"合法"。 */
      /* ★★★ 判据：**门心那一点**必须落在空气里（或恰在面上）★★★
         ── 第五版，也是最终版。此前的四次尝试分别死在这些地方：
           ① "门面法线外侧一个小方盒" —— 玩家站在地板与竖墙的夹角时，
              方盒侧面插进竖墙 → 地板门被毙（房间9 第一、二次报废）
           ② "门框矩形 + 外移 3px"      —— 探针内边缘仍与面严丝合缝，
              aabb 用严格不等号 → 依然算重叠（房间9 第三次报废）
           ③ "外移整个探针厚度"          —— 探针**横向**仍然有 42px 宽，
              玩家贴着墙站（井底必然贴墙）时横向插进墙里（房间9 第四次报废）
         本质问题：**门贴在面上、可以合法地"骑"在平台边沿上**，
             所以任何"有宽度"的探针，只要玩家靠墙就必然与墙重叠。
         真正需要保证的只有一件事：**门心别埋在实心块里面**。
             门框两侧超出部分本来就会盖住相邻的墙 —— 那是正常且好用的
             （玩家可以贴着墙角进门），不该判死。
         ⇒ 用一个**7px 见方的小方块**（≈门心）做检测；它比任何墙的
            判定都更严格地表达"门没被埋进墙里"这一唯一语义。 */
      const probeSize = 7;
      const n = DIR[f.d];
      const probe = {
        x: px - probeSize / 2 + n.x * (probeSize / 2 + 0.5),
        y: py - probeSize / 2 + n.y * (probeSize / 2 + 0.5),
        w: probeSize, h: probeSize,
      };
      let blocked = false;
      /* ★★★ 忽略"这张面所属的那块实心"本身 ★★★
         血泪史（房间9 整关报废，第四次；终于收口）：
           井底的地板门，其"面"属于**底部边框**那块贯通全宽的实心块。
           探针（门框 + 一点厚度）无论怎么平移，只要玩家站在井底、
           而井的左壁（一块 9 格高的实心）一直砌到同一条水平线 y=512，
           探针的**横向边缘**就必然扎进左壁 —— 于是井底地板门永远 blocked。
           但"面所属的那块实心"本来就在门的另一侧，它和门**不该**算遮挡；
           真正要判的是"门前这条缝里有没有别的块"。
         ⇒ 探针检测时跳过 owner 自身。 */
      for (const s of solids) {
        if (!s.active || s === f.owner) continue;
        if (aabb(probe, s)) { blocked = true; break; }
      }
      if (blocked) continue;

      // 玩家要能靠近：门心到玩家的距离
      const dist = Math.hypot(px - p.cx, py - p.cy);

      // 面朝向是否匹配玩家的方向偏好
      //   d=1 右表面（法线朝右）↔ 按 →
      //   d=3 左表面（法线朝左）↔ 按 ←
      //   d=0 顶面（法线朝上）  ↔ 按 ↑（"把门放在我上方/脚下这块地的顶面"）
      //   d=2 底面（法线朝下）  ↔ 按 ↓
      let aimOk = true;
      if (hasAim) {
        if (wantX === 1) aimOk = (f.d === 1);
        else if (wantX === -1) aimOk = (f.d === 3);
        else if (wantY === -1) aimOk = (f.d === 0);
        else if (wantY === 1) aimOk = (f.d === 2);
      }

      // 不要和另一个门重叠
      const other = which === 'a' ? this.portals.b : this.portals.a;
      let overlapPenalty = 0;
      if (other.active && other.roomId === this.room.id) {
        const d2 = Math.hypot(other.x - px, other.y - py);
        if (d2 < R * 2.4) overlapPenalty = 900;
      }

      // 没按方向键时的"就近 + 朝向"偏好（保持原来的手感）
      const facingBonus = !hasAim && ((f.d === 1 && p.facing === 1) || (f.d === 3 && p.facing === -1)) ? -26 : 0;

      /* 面宽偏好：够放一整扇门（≥2R）最好；只有 1 格厚则记惩罚。
         这一步是为了"能放得出来"和"放得好看"兼顾。 */
      const narrowPenalty = span >= R * 2 ? 0 : (R * 2 - span) * 0.35;

      /* ★★★ "脚下地板"偏好（"按 ↑ 结果门开在柱顶"的真凶）★★★
         血泪史（房间9）：
           玩家贴着高柱站在竖井底，按 ↑ 想开脚底的地板门。
           候选里同时有「竖井地板顶面（就在脚底下）」和「柱子顶面（在头顶 5.8 格）」，
           两者 d 都是 0、都能过 aimOk。原来纯按 dist 比，
           地板 7.5px 明明更近 —— 但地板的探针被判 blocked（见上面的探针注释），
           于是只剩柱顶，门就开到了头顶。
         现在探针修好了，地板不会再被误判；这里再加一层**语义偏好**，
         保证"玩家脚下（或脚边）的那块地面"永远赢过"远处的某个台阶顶面"：
           · 玩家实际踩着的地面（|py - 脚底| < 2px）       → -70（最强）
           · 门面在玩家腰部以下（py >= p.cy）              → -40
           · 门面在玩家头顶（py < p.cy - T）               → +50（惩罚）
         只在 d=0（顶面）上生效，不影响墙面门。 */
      let onSurface = 0;
      if (f.d === 0) {
        const feet = p.y + p.h;
        if (Math.abs(py - feet) < 2) onSurface = -70;
        else if (py >= p.cy) onSurface = -40;
        else if (py < p.cy - T) onSurface = 50;
      }

      scored.push({ f, px, py, dist, aimOk, facingBonus, overlapPenalty, narrowPenalty, onSurface });
    }
    if (!scored.length) return null;

    /* ---- 三层优先级 ----
       ① 有方向偏好 → 只在 aimOk 的里挑最近
       ② 没有方向偏好 → 全部里挑 距离+朝向加成 最小
       ③ ① 找不到任何 aimOk 的 → 退回 ②（避免"按了方向键反而放不出来"） */
    const pick = (list) => {
      let best = null, bestScore = Infinity;
      for (const c of list) {
        const score = c.dist + c.facingBonus + c.overlapPenalty + c.narrowPenalty + (c.onSurface || 0);
        if (score < bestScore) { bestScore = score; best = c; }
      }
      return best;
    };

    let chosen = null;
    if (hasAim) {
      chosen = pick(scored.filter(c => c.aimOk));
      if (chosen) return { x: chosen.px, y: chosen.py, d: chosen.f.d };
    }
    chosen = pick(scored);
    return chosen ? { x: chosen.px, y: chosen.py, d: chosen.f.d } : null;
  }

  placePortal(which) {
    const spot = this.findPortalSpot(which);
    if (!spot) { this.audio.fail(); this.flashHint('这里没有可以开门的平面 —— 找一面墙或地板试试'); return; }
    const p = which === 'a' ? this.portals.a : this.portals.b;
    p.place(spot.x, spot.y, spot.d, this.room.id);
    this.audio.place();
    this.fx.portalBurst(spot.x, spot.y, p.color, spot.d, 60);
    this.shake(2, 0.1);

    /* ★ 教学：第一次放门时，告诉玩家"按住方向键可以指定门开在哪面墙"。
       这条提示很重要 —— 没有它玩家不知道能把门送到隔墙的另一侧，
       房间6 会直接卡死（用户实测就是这个体感："传送门放不到右边去"）。 */
    if (!this.portalAimHintShown) {
      this.portalAimHintShown = true;
      this.flashHint('想开在指定墙面？按住 ← ↑ → ↓ 再按开门键 —— 门会贴到那一侧');
    } else if (this.portals.ready && !this.portalHintShown) {
      // 教学：两个门都开了 → 提示惯性玩法
      this.portalHintShown = true;
      this.flashHint('两个门都开了！从高处坠进去 —— 出口会带着你的速度把你甩出去');
    } else if (!this.portals.ready) {
      const other = which === 'a'
        ? `${keyLabel(KEYBINDS.portal2)} 橙门`
        : `${keyLabel(KEYBINDS.portal)} 蓝门`;
      this.flashHint(`再按 ${other} 放下第二个门`);
    }
  }

  /* ---------------- 引导：当前目标 ---------------- */
  /**
   * 每步重新评估"下一步该干什么"，产出：
   *   - objective : 顶部常驻的一句话目标
   *   - objArrow  : 目标方向指示（世界坐标）
   *
   * 判定优先级（从"最具体的挡路问题"到"最泛的目标"）：
   *   0. 房间脚本（room.steps）→ 逐条推进的分步指引（最明确）
   *   1. 已通关            → 不显示
   *   2. 有挡路的机关门     → 先解决机关（压力板/拉杆）
   *   3. 传送门是本关解法   → 按传送门进度分步（开门→对准角度→跳进去吃惯性）
   *   4. 门刚打开          → 立刻告诉玩家"门开了，往下走"
   *   5. 有终点            → 直奔终点
   *   6. 有房间连接         → 去缺口
   *   7. 兜底
   */
  updateObjective() {
    const r = this.room;
    const p = this.player;
    const P = this.portals;
    let text = '';
    let arrow = null;

    const blockedGate = r.gates.some(g => g.active && !g.open);
    const sigOn = r.signals.some(s => s.on);

    // ---- 0. 房间分步脚本（有就优先用，最具体）----
    const scripted = this.stepObjective(r, p, P, blockedGate, sigOn);

    if (this.won) {
      text = '';
    } else if (scripted) {
      text = scripted.text;
      arrow = scripted.arrow;
    } else if (blockedGate && !sigOn) {
      const lever = r.levers.find(l => !l.flipped);
      const plate = r.plates.find(pl => !pl.pressed);
      if (plate && r.crates.length) {
        text = '把箱子推到发光的压力板上 · 能量门就会打开';
        arrow = { x: plate.x + plate.w / 2, y: plate.y };
      } else if (lever) {
        text = '走到拉杆旁边碰一下 · 能量门就会打开';
        arrow = { x: lever.x, y: lever.y };
      } else {
        text = '想办法给机关通电，能量门才会打开';
      }
    } else if (r.needPortal) {
      // ---- 3. 传送门解法（按进度分步）----
      text = this.portalObjective(r, P, p);
      arrow = this._objArrow;
    } else if (r.goal) {
      // ---- 5. 直奔终点（优先用关卡作者写的本关目标，避免各关都是同一句）----
      text = r.objective || '抵达金色终点';
      arrow = { x: r.goal.x, y: r.goal.y };
    } else if (r.links && r.links.length) {
      // ---- 6. 房间连接 ----
      const l = r.links[0];
      const T = CFG.TILE;
      if (l.edge === 'bottom') {
        arrow = { x: ((l.x0 + l.x1) / 2 + 0.5) * T, y: r.H - T };
        text = '往右下方的地板缺口走 → 掉进下一个房间';
      } else if (l.edge === 'top') {
        arrow = { x: ((l.x0 + l.x1) / 2 + 0.5) * T, y: T };
        text = '往上方的缺口走 → 进入上一个房间';
      } else if (l.edge === 'left') {
        arrow = { x: T, y: ((l.y0 + l.y1) / 2 + 0.5) * T };
        text = '往左边走 → 进入旁边的房间';
      } else {
        arrow = { x: r.W - T, y: ((l.y0 + l.y1) / 2 + 0.5) * T };
        text = '往右边走 → 进入旁边的房间';
      }
    }

    // ---- 6. 兜底 ----
    if (!text) text = '探索这个房间，找到出口';

    if (text !== this.objective) {
      this.objective = text;
      this.objFlash = 0.55;
    }
    this.objArrow = arrow || this._objArrow;
    this.objFlash = Math.max(0, this.objFlash - CFG.DT);
  }

  /**
   * 房间分步脚本。
   *
   * 这是解决"到了压力板关卡就不知道干什么"的核心机制：
   * 房间可以在 levels.js 里声明 `steps: [{ when, text, at }]`，
   * 引擎每帧从头到尾找**第一个条件成立**的步骤作为当前目标。
   * `when` 是一个字符串表达式（在受限沙箱里求值），能读到：
   *   p (player) / r (room) / P (portals) / sig(i) / gatesOpen / platesDown /
   *   boxOn(plateIndex) / dist(x,y) / onGround
   *
   * 这样策划就可以写出非常具体的"第一步做什么、第二步做什么"，
   * 而不必把逻辑硬编码进引擎。
   */
  stepObjective(r, p, P, blockedGate, sigOn) {
    const steps = r.steps;
    if (!steps || !steps.length) return null;

    const T = CFG.TILE;
    const env = this.buildStepEnv(r, p, P, blockedGate, sigOn);

    for (const s of steps) {
      // 运行期错误让它抛出去（见过 console 就知道哪条脚本写错了）。
      // 早先这里 catch 成 false，导致 `p.py()` 这类错误静默失效。
      const ok = !!s.fn(env);
      if (!ok) continue;
      // 解析箭头：字符串表达式或 {gx,gy} / {x,y}
      let arrow = null;
      if (s.at) {
        if (typeof s.at === 'string') {
          try {
            const v = s.arrowFn(env, T);
            if (v) arrow = v;
          } catch (e) { arrow = null; }
        } else if (typeof s.at.gx === 'number') {
          arrow = { x: s.at.gx * T + T / 2, y: s.at.gy * T + T / 2 };
        } else {
          arrow = { x: s.at.x, y: s.at.y };
        }
      }
      this._objArrow = arrow;
      return { text: s.text, arrow };
    }
    return null;
  }

  /**
   * 构造分步脚本的求值环境。
   * 抽成独立方法是为了让测试可以**直接跑一遍**每个 when 表达式 ——
   * compileStepExpr 内部 try/catch 会把异常吞成 false，写错的表达式
   * 不会报错、只会让引导永远停在第 1 步，必须显式校验才能发现。
   */
  buildStepEnv(r, p, P, blockedGate, sigOn) {
    const T = CFG.TILE;
    const env = {
      p, r, P,
      // 信号
      sig: (i) => !!(r.signals[i] && r.signals[i].on),
      // 门
      gatesOpen: () => r.gates.every(g => !g.active || g.open),
      anyGateOpen: () => r.gates.some(g => g.open),
      gatesShut: () => r.gates.some(g => g.active && !g.open),
      // 压力板
      platesDown: () => r.plates.every(pl => pl.pressed),
      anyPlateDown: () => r.plates.some(pl => pl.pressed),
      // 箱子是否在某块板附近（水平距离 < 22px）
      boxOnPlate: (i = 0) => {
        const pl = r.plates[i], bx = r.crates[0];
        if (!pl || !bx) return false;
        return Math.abs((bx.cx) - (pl.x + pl.w / 2)) < 24 && bx.cy > pl.y - 30;
      },
      boxMoved: (i = 0) => {
        const bx = r.crates[i];
        return !!bx && (Math.abs(bx.cx - (bx.spawn.x + bx.w / 2)) > 20);
      },
      // 距离（世界坐标，单位像素）
      near: (wx, wy, rad = 44) => Math.hypot(p.cx - wx, p.cy - wy) < rad,
      // 位置（格 → 像素中心）
      at: (gx, gy, rad = 44) => Math.hypot(p.cx - (gx * T + T / 2), p.cy - (gy * T + T / 2)) < rad,
      onGround: () => p.grounded,
      inAir: () => !p.grounded,
      // 是否贴墙
      onWall: () => !!p.wallDir,
      // 玩家在某个 x 格范围的哪一边
      leftOf: (gx) => p.cx < gx * T,
      rightOf: (gx) => p.cx > gx * T,
      // 玩家所处高度（格）
      py: () => p.cy / T,
      px: () => p.cx / T,
      portalReady: () => P.ready,
      portalCount: () => (P.a.active ? 1 : 0) + (P.b.active ? 1 : 0),
      blockedGate, sigOn,
      won: this.won,
      t: this.time,
    };
    // `p` 同时充当「玩家实例」和「查询助手命名空间」：
    // 关卡脚本里既可以写 p.grounded / p.waveFx（真实字段），
    // 也可以写 p.py() / p.px()（env 里的助手函数）。
    // 用一个 Proxy 做属性透传，避免两套 API 打架 —— 之前 `p.py()` 会
    // 在真实 Player 上取到 undefined 然后抛异常，被 try/catch 吞掉，
    // 表现为「分步引导永远停在第一步」。
    env.p = new Proxy(p, {
      get(t2, k) {
        const v = t2[k];
        if (v !== undefined) return v;
        return env[k];
      },
      has() { return true; },
    });
    return env;
  }

  /**
   * 传送门房间的分步目标：开门 → 对准角度 → 吃惯性射出去。
   * ★ 第十三版：冲刺已移除，原来"补冲刺"那一步换成了"对准角度"。
   * 把结果同时写进 this._objArrow（方向指示），返回值是文案。
   * 房间可以用 objMode 声明自己的玩法侧重：
   *   'puzzle'  → 道具过门（先推箱子）
   *   'well'    → 落差加速（从高处跳进井底门）
   *   'inertia' → 基础惯性（默认）
   */
  portalObjective(r, P, p) {
    this._objArrow = null;
    const mode = r.objMode || 'inertia';
    const k = r.keys || { portal: 'B', portal2: 'O' };

    if (!P.ready) {
      const need = !P.a.active ? `${k.portal}（蓝门）` : `${k.portal2}（橙门）`;
      // 门还没开齐时，把"这扇门是拿来干什么的"一起说出来，
      // 否则不同关卡会给出同一句提示，玩家依然不知道这一步的意义。
      const why = mode === 'puzzle'
        ? '，好让箱子能过去'
        : mode === 'well'
          ? '，一个开井底一个开高墙'
          : r.goal ? '，然后借惯性冲终点' : '';
      return `按 ${need} 开传送门${why}`;
    }
    // 有箱子+压力板的组合谜题 → 先教"把箱子推进传送门"
    const needBoxOnPlate = r.crates.length && r.plates.length && !r.signals.some(s => s.on);
    if (needBoxOnPlate || mode === 'puzzle') {
      const box = r.crates[0];
      if (box) {
        this._objArrow = { x: box.cx, y: box.cy };
        return '把箱子推进传送门，让它替你压住压力板';
      }
    }
    const entry = P.a.active ? P.a : P.b;
    if (entry) this._objArrow = { x: entry.x, y: entry.y };

    if (mode === 'well') return '爬到高处，跳进井底的传送门 —— 下落越久射得越远';
    if (r.goal) return '跳进传送门 —— 借惯性冲向金色终点';
    return '跳进传送门 —— 利用惯性从另一个门射出去';
  }

  /* ---------------- 特效接口 ---------------- */
  shake(amt, dur) {
    if (amt > this.shakeAmt || this.shakeT <= 0) { this.shakeAmt = amt; this.shakeDur = dur; this.shakeT = dur; }
  }
  freezeFrame(t) { this.freezeT = Math.max(this.freezeT, t); }
  flashHint(text) {
    this.currentHint = text;
    this.hintTimer = 2.4;
  }
  /**
   * 抵达本关终点。
   *
   * 注意：**不是**游戏结束，而是"这一关过了"。真正的流程是
   *   过场动画（约 0.9s）→ 自动进入下一关
   * 只有最后一关（rooms.length - 1）才切到通关画面。
   *
   * 这里只负责"标记 + 播特效"，真正的切关放在 step() 里倒计时结束时做，
   * 这样过场动画有时间播完，玩家也能看到自己刚才的成果。
   */
  win() {
    if (this.won || this.levelClear) return;
    // 记录本关用时
    this.levelTimes[this.roomId] = Math.max(0, this.time - this.levelStartTime);
    this.levelClear = true;
    this.levelClearT = CFG.LEVEL_CLEAR_DELAY;
    this.audio.win();
    if (this.room.goal) {
      this.shake(6, 0.5);
      for (let i = 0; i < 5; i++) this.fx.crystalBurst(this.room.goal.x, this.room.goal.y);
    }
  }

  /** 过场结束 → 真正切关（或通关） */
  advanceLevel() {
    this.levelClear = false;
    this.levelClearT = 0;
    const next = this.roomId + 1;
    if (next >= this.rooms.length) {
      // 最后一关 → 通关画面
      this.won = true;
      this.winT = 0;
      return;
    }
    this.switchRoom(next, false);
    // switchRoom 不会移动玩家，必须自己放到新关出生点
    this.portals.clear();
    this.player.reset(this.room.spawn.x, this.room.spawn.y);
    this.cam.x = this.roomCenterCam().x;
    this.cam.y = this.roomCenterCam().y;
    this.transition = 1;
    this.currentHint = this.room.hint;
    this.hintTimer = 4.2;
    this.objective = '';
    this.objArrow = null;
    this.objFlash = 0;
    // 本关计时重新开始
    this.levelStartTime = this.time;
    this.deathAtLevelStart = this.deaths;
  }

  /* ---------------- 固定步更新 ---------------- */
  step(dt) {
    const input = this.input;
    this.time += dt;

    if (this.freezeT > 0) {
      this.freezeT -= dt;
      // 冻结帧期间仍然消耗输入边沿，避免"丢跳跃"
      return;
    }

    // 全局按键
    if (input.hit('reset')) { this.respawnPlayer(); return; }
    if (input.hit('clear')) { this.portals.clear(); this.audio.place(); this.fx.portalBurst(this.player.cx, this.player.cy, '#ffffff', 0, 40); }

    // 本关通过过场：世界停住，只播特效，倒计时结束自动切下一关。
    // 允许按跳跃加速跳过，避免手速快的玩家干等。（冲刺已在第十三版移除）
    if (this.levelClear) {
      this.levelClearT -= dt;
      this.fx.update(dt);
      for (const p of [this.portals.a, this.portals.b]) {
        p.wobble = Math.max(0, p.wobble - dt * 2.4);
      }
      if (this.levelClearT <= 0 || input.hit('jump')) {
        this.advanceLevel();
      }
      return;
    }

    // 全部关卡通关：停留在结算画面（按 R 重开）
    if (this.won) {
      this.winT += dt;
      this.fx.update(dt);
      return;
    }

    const room = this.room;

    // 传送门放置
    if (input.hit('portal')) this.placePortal('a');
    if (input.hit('portal2')) this.placePortal('b');
    // 鼠标右键 = 放另一个门（备用）
    if (input.mouse.rpressed) this.placePortal(this.portals.a.active ? 'b' : 'a');

    // 机关先更新（信号 → 门/移动块）
    const solids = room.collisionSolids();
    for (const pl of room.plates) pl.update(dt, [this.player, ...room.crates]);
    for (const lv of room.levers) lv.update(dt, [this.player, ...room.crates]);
    for (const gt of room.gates) gt.update(dt);
    for (const mv of room.movers) mv.update(dt);

    // 移动块推挤：把玩家和箱子一起推走
    const solids2 = room.collisionSolids();
    this.applyMoverPush(room, dt);

    // 记录本步起始位置（传送门扫掠判定用）
    this.portals.recordPrev([this.player, ...room.crates]);

    // 玩家
    this.player.update(dt, input, this, solids2);

    // 箱子
    for (const c of room.crates) c.update(dt, this, solids2);
    // 玩家推箱子
    this.pushCrates(room, solids2);

    // 水晶
    for (const cr of room.crystals) cr.update(dt, this);
    for (const h of room.hazards) { h.update(dt); if (aabbPadded(this.player.box, h, -2)) { this.respawnPlayer(); return; } }
    for (const t of room.texts) t.update(dt, this);
    if (room.goal) room.goal.update(dt, this);

    // 房间链接 / 掉出世界
    this.checkRoomLinks();

    // 引导：重算当前目标
    this.updateObjective();

    // 传送门动画衰减
    for (const p of [this.portals.a, this.portals.b]) {
      p.wobble = Math.max(0, p.wobble - dt * 2.4);
    }

    // 摄像机
    this.updateCamera(dt);
    this.updateShake(dt);
    this.fx.update(dt);

    if (this.hintTimer > 0) this.hintTimer -= dt;
    if (this.transition > 0) this.transition = Math.max(0, this.transition - dt * 1.8);
  }

  applyMoverPush(room, dt) {
    const movers = room.movers;
    if (!movers.length) return;
    const ents = [this.player, ...room.crates];
    for (const mv of movers) {
      if (Math.abs(mv.dxPrev) < 0.001 && Math.abs(mv.dyPrev) < 0.001) continue;
      for (const e of ents) {
        if (!aabbPadded(e.box, mv, 2)) continue;
        // 沿移动方向推
        e.x += mv.dxPrev;
        e.y += mv.dyPrev;
        if (Math.abs(mv.dxPrev) > Math.abs(mv.dyPrev)) e.vx = clamp(mv.dxPrev / dt * 0.35, -260, 260);
        e.separateFromSolids(room.collisionSolids(), room);
      }
    }
  }

  pushCrates(room, solids) {
    const p = this.player;
    for (const c of room.crates) {
      if (!aabbPadded(p.box, c, 1)) continue;
      // 判断推的方向
      const overlapX = (p.cx < c.cx)
        ? (p.x + p.w) - c.x
        : (c.x + c.w) - p.x;
      const overlapY = (p.cy < c.cy)
        ? (p.y + p.h) - c.y
        : (c.y + c.h) - p.y;
      if (overlapX < overlapY) {
        // 水平推。
        // ⚠️ 位移用 `overlapX`（把"玩家已经压进箱子多少"补回去），
        //    速度只给一点点（pushBy 的 gain=4，见 props.js 的血泪注释）。
        //    旧代码这里是 `c.x += dir * Math.min(overlapX, 40)` +
        //    `c.pushBy(dir * (0.5 + pushSpeed / 200))` —— pushSpeed 最大 180，
        //    于是 pushBy 每帧灌进 1.4*46≈64 的速度，远超阻尼的 15/帧，
        //    箱子被"泵"到 RUN_SPEED 后**永不停下**，滑过压力板撞墙瞬移回家，
        //    把推箱关彻底玩废。现在速度增益与玩家速度脱钩，只保留手感。
        const dir = p.cx < c.cx ? 1 : -1;
        c.x += dir * Math.min(overlapX, 40);
        c.pushBy(dir);
        // ⚠️ 额外记录「顶推速度」给传送门速度闸用（见 PushBox.pushSpeed 的注释）。
        //    不能直接用 c.vx —— 它的增益只有 4，平衡点就是 4，
        //    而传送门要求 |vLat| > 16，于是"把箱子顶到门上"永远不触发。
        c.pushSpeed(dir, p.vx);
        // 玩家不穿进箱子
        p.x -= dir * Math.max(0, overlapX - 1.2);
        p.separateFromSolids([c], room);
      } else {
        // 踩在箱子上（当作地面）—— 玩家在上方
        if (p.cy < c.cy && p.vy > 0) {
          p.y = c.y - p.h;
          p.grounded = true;
          p.vy = 0;
        }
      }
    }
  }

  updateCamera(dt) {
    const r = this.room;
    const look = this.player.facing * CFG.CAM_LOOK;
    let tx = this.player.cx + look - this.renderer.W / 2;
    let ty = this.player.cy - this.renderer.H / 2 - 6;

    tx = clamp(tx, 0, Math.max(0, r.W - this.renderer.W));
    ty = clamp(ty, 0, Math.max(0, r.H - this.renderer.H));

    // 平滑跟随（与帧率无关）
    const nx = damp(this.cam.x, tx, 11, dt);
    const ny = damp(this.cam.y, ty, 9, dt);
    // 限制镜头速度，避免瞬移
    this.cam.x = clamp(nx, this.cam.x - CFG.CAM_MAX_SPEED * dt, this.cam.x + CFG.CAM_MAX_SPEED * dt);
    this.cam.y = clamp(ny, this.cam.y - CFG.CAM_MAX_SPEED * dt, this.cam.y + CFG.CAM_MAX_SPEED * dt);
  }

  updateShake(dt) {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeAmt = 0;
    }
  }

  get shakeOffset() {
    if (this.shakeAmt <= 0 || this.shakeT <= 0) return { x: 0, y: 0 };
    const k = this.shakeAmt * (this.shakeT / Math.max(0.001, this.shakeDur));
    return { x: rand(-k, k), y: rand(-k, k) };
  }
}
