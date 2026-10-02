/* ============================================================
   test/_harness.js —— 无头引擎测试台（供关卡设计脚本复用）

   血泪教训（务必遵守）：
     ① `standAt(g, tx, ty)` 里的 ty 是**脚下的那一格**（实心格），
        玩家脚底必须落在 `ty * T`，即 `y = ty*T - P_H`。
        写成 `(ty+1)*T - P_H` 会把玩家**嵌进实心块里**，
        表现为 moveX 全被 BLOCKED、vx 永远 0 —— 极难排查。
     ② Game 构造永远加载 0 号房，要手动 `g.roomId/g.room` 切换。
     ③ `Room.build()` 会吃掉 'S'/'G'/'^'，要留一份原始 map 做几何分析。
     ④ 按键必须走 `queued.push` + `beginStep()`，
        并且**松开的键要显式 `held[k]=false`**。
     ⑤ 游戏里的输入是"按住即持续"，长按 jump 才是最高跳。
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const FILES = ['config.js', 'util.js', 'input.js', 'actor.js', 'portal.js', 'player.js',
  'props.js', 'levels.js', 'fx.js', 'audio.js', 'render.js', 'game.js'];

function boot() {
  let b = '';
  for (const f of FILES) b += '\n' + fs.readFileSync(path.join(SRC, f), 'utf8');
  b += '\nglobalThis.__G={CFG,Game,Room,Player,PortalPair,Hazard,ACTIONS,KEYBINDS};\n';
  const ctx = new Proxy({}, {
    get: (t, k) => k === 'measureText' ? () => ({ width: 100 })
      : (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() { } })
        : (k === 'canvas') ? { width: 960, height: 576 } : () => { }
  });
  const cv = {
    width: 960, height: 576, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 576 }),
    addEventListener() { }
  };
  const sb = {
    console, Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String,
    Number, Boolean, Set, Map, Infinity, NaN,
    document: { getElementById: () => cv, addEventListener() { } },
    addEventListener() { }, requestAnimationFrame() { },
    performance: { now: () => 0 }, devicePixelRatio: 1
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb); vm.runInContext(b, sb);
  return { sb, cv, G: sb.__G, T: sb.__G.CFG.TILE };
}

const AK = ['left', 'right', 'up', 'down', 'jump', 'dash', 'portal', 'portal2', 'reset', 'clear', 'pause'];

/** 由字符画造房间（自动补足行宽/行数） */
function makeRoomDef(rows, links = [], id = 0, name = 'probe') {
  const W = Math.max(...rows.map(r => r.length));
  const map = rows.map(r => r.padEnd(W, ' '));
  return { id, name, map, links };
}

/** 造一个只含这个房间的 Game */
function mkGame(cv, G, roomDef) {
  const { Game, Room, Player } = G;
  const g = new Game(cv);
  g.renderer.W = 960; g.renderer.H = 576;
  const room = new Room(roomDef);
  g.rooms = [room];
  g.roomId = 0;
  g.room = room;
  g.player = new Player(room.spawn.x, room.spawn.y);
  return g;
}

/** 把玩家放到 (tx, ty) 格、脚踩在 ty 格顶面上，并跑若干帧稳定 */
function standAt(g, G, tx, ty, settle = 25) {
  const CFG = G.CFG, T = CFG.TILE;
  g.player.x = tx * T + (T - CFG.P_W) / 2;
  g.player.y = ty * T - CFG.P_H;          // ★ 脚底 = ty*T
  g.player.vx = 0; g.player.vy = 0;
  g.player.remX = 0; g.player.remY = 0;
  for (let i = 0; i < settle; i++) tick(g, G, {});
  return g.player.grounded;
}

/** 单步：want = {left:true, jump:true, ...} */
function tick(g, G, want) {
  const IN = g.input;
  for (const k of AK) {
    const v = !!want[k];
    if (v && !IN.held[k]) IN.queued.push(k);
    if (!v && IN.held[k]) IN.held[k] = false;
  }
  IN.beginStep();
  g.step(G.CFG.DT);
}

/**
 * 跑一段按键序列。
 * seq = [[{right:true}, 60], [{right:true,jump:true}, 30], [{}, 120], ...]
 * 返回 { res:'WIN'|'DEAD'|'TIMEOUT', f, log, maxX, minY }
 */
function runSeq(g, G, seq, maxF = 1800) {
  const T = G.CFG.TILE;
  let f = 0;
  const log = [];
  let maxX = -Infinity, minY = Infinity;
  for (const [want, n] of seq) {
    for (let i = 0; i < n; i++, f++) {
      tick(g, G, want);
      const x = g.player.cx / T, y = g.player.cy / T;
      log.push({ f, x, y, vx: g.player.vx, vy: g.player.vy });
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (g.won) return { res: 'WIN', f, log, maxX, minY };
      if (!g.player.alive) return { res: 'DEAD', f, log, maxX, minY };
      if (f >= maxF) return { res: 'TIMEOUT', f, log, maxX, minY };
    }
  }
  return { res: 'END', f, log, maxX, minY };
}

/** 打印一行轨迹采样 */
function trajLine(log, samples = 24) {
  const step = Math.max(1, Math.floor(log.length / samples));
  return log.filter((_, i) => i % step === 0)
    .map(q => `(${q.x.toFixed(1)},${q.y.toFixed(1)})`).join(' ');
}

/** 打印地图（只显示 y>=yFrom 的行） */
function printMap(rows, yFrom = 0) {
  rows.forEach((r, y) => { if (y >= yFrom) console.log(String(y).padStart(2), '|' + r + '|'); });
}

module.exports = { boot, makeRoomDef, mkGame, standAt, tick, runSeq, trajLine, printMap, AK };
