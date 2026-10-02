/* ============================================================
   test/realsolve.js —— 真实物理「可解性」审计器
   ------------------------------------------------------------
   为什么必须存在（血泪教训）：
     静态 BFS（gen-levels.js 里的 R17 analyzePureMove）**太弱**。
     实测：它对已发布的房间 9 打印 "✅ 不可达"，
     而真实引擎跑出来有 **141 条不用门就能通关的路线**。
     ⇒ 关卡能不能过、会不会被偷鸡，**只能用真引擎验**。

   本文件只做两件事：
     ① usable(玩法可用性)：从出生点出发，纯移动 + 传送门，
        能碰到的东西（站立面/可站立格）有多少 —— 用来发现
        "出生区被全高墙封死" 这类致命 bug。
     ② reachGoal：真按键序列能不能通关（含传送门路线）。

   用法：
     node test/realsolve.js            审计全部 20 关，打印表格
     node test/realsolve.js 5 7 8      只审计指定关卡
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = require('./_harness.js');

const SRC = path.join(__dirname, '..', 'src');
const { G, cv, T } = H.boot();
const { CFG, Game, Room, Player, PushBox } = G;

// 关卡数据直接从 src/levels.js 取（不要在生成器里重复维护）
const LEVELS_SRC = fs.readFileSync(path.join(SRC, 'levels.js'), 'utf8');
const ROOMS = vm.runInNewContext(LEVELS_SRC + '\n;ROOMS', {});

/** 从 ROOMS[i] 造一个只含这一间的 Game */
function roomGame(i) {
  const def = ROOMS[i];
  const g = new Game(cv);
  g.renderer.W = 960; g.renderer.H = 576;
  const room = new Room(def);
  g.rooms = [room];
  g.roomId = 0;
  g.room = room;
  g.player = new Player(room.spawn.x, room.spawn.y);
  return g;
}

/** 玩家静止站立时，脚下那一格（实心）的行号 */
function standRow(g) {
  return Math.round((g.player.y + CFG.P_H) / T);
}

/**
 * ① 纯移动「可达域」探测（不用传送门）
 *   用真实物理 + 一套穷举/随机的按键序列探索，记录所有"站住过"的格子。
 *   这不是完备证明，但**能可靠地抓出"出生区被封死"**这类 bug ——
 *   因为那种情况下无论怎么按，x 范围都不会扩大。
 *
 * @returns { cells:Set<string>, minX, maxX, minY, maxY, landed:[{x,y}] }
 */
function pureMoveExplore(g, G2, budget = 12) {
  const P = g.player;
  const cells = new Set();
  const landed = [];
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;

  const note = () => {
    const tx = Math.floor(P.cx / T), ty = Math.floor(P.cy / T);
    cells.add(tx + ',' + ty);
    if (P.cx / T < minX) minX = P.cx / T;
    if (P.cx / T > maxX) maxX = P.cx / T;
    if (P.cy / T < minY) minY = P.cy / T;
    if (P.cy / T > maxY) maxY = P.cy / T;
    if (P.grounded) {
      const k = Math.round(P.cx / T) + ':' + Math.round((P.y + CFG.P_H) / T);
      if (!landed.some(q => q.k === k)) landed.push({ k, x: P.cx / T, y: (P.y + CFG.P_H) / T });
    }
  };

  // 键盘"人格"：不同节奏 + 不同方向，组合搜索
  const plans = [];
  const dirs = [['right'], ['left']];
  for (const [d] of dirs) {
    for (const jumpLen of [0, 6, 14, 26]) {
      for (const runLen of [4, 10, 20, 44]) {
        for (const mode of ['flat', 'dash', 'hop', 'wall']) {
          plans.push({ d, jumpLen, runLen, mode });
        }
      }
    }
  }
  // 再加一批"反方向 + 空中跳"的名堂
  for (const mode of ['air', 'down', 'up']) {
    plans.push({ d: 'right', jumpLen: 20, runLen: 16, mode });
    plans.push({ d: 'left', jumpLen: 20, runLen: 16, mode });
  }

  for (const p of plans) {
    g.player.reset(g.room.spawn.x, g.room.spawn.y);
    for (let i = 0; i < 20; i++) H.tick(g, G2, {});
    let t = 0;
    for (let seg = 0; seg < budget; seg++) {
      const phase = seg % 4;
      let want = {};
      if (p.mode === 'flat') {
        want = { [p.d]: true, jump: phase === 1 };
      } else if (p.mode === 'dash') {
        want = { [p.d]: true, jump: true };
      } else if (p.mode === 'hop') {
        want = { [p.d]: true, jump: phase % 2 === 0 };
      } else if (p.mode === 'wall') {
        // 贴墙墙跳：按住方向 + 上，周期性跳
        want = { [p.d]: true, up: true, jump: (t % 22 === 0) };
      } else if (p.mode === 'air') {
        want = { [p.d]: true, jump: (t % 30 === 0 || t % 30 === 12) };
      } else if (p.mode === 'down') {
        want = { down: true, jump: (t % 18 === 0) };
      } else {
        want = { up: true, [p.d]: true };
      }
      const n = phase === 1 ? p.jumpLen : p.runLen;
      for (let i = 0; i < n; i++, t++) {
        H.tick(g, G2, want);
        note();
        if (!P.alive) break;
      }
      if (!P.alive) break;
    }
  }
  return { cells, minX, maxX, minY, maxY, landed };
}

/**
 * ② 真按键「通关搜索」（含传送门）
 *   思路：把"放门 + 跑跳"拼成一串分段序列做随机搜索。
 *   传送门是**场景固定的**（放在几何上有意义的面），搜索空间只在按键上。
 */
function portalSolve(g, G2, tries = 4000, seed = 12345) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = a => a[(rnd() * a.length) | 0];

  const dirs = ['left', 'right'];
  const aims = ['none', 'left', 'right', 'up', 'down'];
  let best = { maxX: -1e9, minY: 1e9, res: 'NONE' };

  for (let it = 0; it < tries; it++) {
    g.player.reset(g.room.spawn.x, g.room.spawn.y);
    g.portals.clear();
    for (let i = 0; i < 16; i++) H.tick(g, G2, {});
    const seq = [];
    const nSeg = 4 + ((rnd() * 5) | 0);
    for (let k = 0; k < nSeg; k++) {
      const r = rnd();
      if (r < 0.25) {
        // 放门：按住某个方向 → portal / portal2
        const aim = pick(aims);
        const w = aim === 'none' ? {} : { [aim]: true };
        seq.push([w, 1 + ((rnd() * 3) | 0)]);
        seq.push([{ ...w, portal: true }, 2]);
        seq.push([{}, 4]);
      } else if (r < 0.45) {
        const aim = pick(aims);
        const w = aim === 'none' ? {} : { [aim]: true };
        seq.push([w, 1 + ((rnd() * 3) | 0)]);
        seq.push([{ ...w, portal2: true }, 2]);
        seq.push([{}, 4]);
      } else {
        // 跑跳
        const d = pick(dirs);
        const jumpy = rnd() < 0.6;
        seq.push([{ [d]: true, jump: jumpy }, 3 + ((rnd() * 30) | 0)]);
        if (rnd() < 0.5) seq.push([{ [d]: true, jump: true }, 3 + ((rnd() * 20) | 0)]);
        if (rnd() < 0.4) seq.push([{ [d]: true }, 4 + ((rnd() * 40) | 0)]);
        if (rnd() < 0.3) seq.push([{}, 10 + ((rnd() * 80) | 0)]);
      }
    }
    const r = H.runSeq(g, G2, seq, 900);
    if (r.res === 'WIN') return { win: true, seq, f: r.f, maxX: r.maxX, minY: r.minY };
    if (r.maxX > best.maxX) best = { maxX: r.maxX, minY: r.minY, res: r.res };
  }
  return { win: false, ...best };
}

/* ------------------------------ 主流程 ------------------------------ */
const ids = process.argv.slice(2).map(Number).filter(n => Number.isInteger(n));
const list = ids.length ? ids : ROOMS.map((_, i) => i);

console.log('房间  名称                      出生域   纯移动x范围        真按键通关   最高点y');
console.log('─'.repeat(96));
const report = [];
for (const i of list) {
  const g = roomGame(i);
  const ex = pureMoveExplore(g, G, 10);
  const ps = portalSolve(g, G, 1200, 999 + i * 7);
  report.push({ i, name: ROOMS[i].name, cells: ex.cells.size, minX: ex.minX, maxX: ex.maxX, win: ps.win });
  console.log(
    String(i).padStart(3) + '   ' +
    (ROOMS[i].name + '                        ').slice(0, 22) + '  ' +
    String(ex.cells.size).padStart(5) + '   ' +
    `[${ex.minX.toFixed(1)}, ${ex.maxX.toFixed(1)}]`.padEnd(18) + '  ' +
    (ps.win ? '✅ 可通关  ' : '❌ 未搜到  ') + '   ' +
    (ps.minY === undefined ? '-' : ps.minY.toFixed(1))
  );
}
console.log('─'.repeat(96));
const bad = report.filter(r => r.cells < 25);
if (bad.length) {
  console.log('\n⚠️ 出生域过小（<25 格，极可能被墙封死）：');
  for (const b of bad) console.log(`   房间${b.i} ${b.name}  出生域 ${b.cells} 格，纯移动 x∈[${b.minX.toFixed(1)}, ${b.maxX.toFixed(1)}]`);
}
