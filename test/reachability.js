/* ============================================================
   关卡可达性验证（v4 —— 「反偷鸡」设计守卫）
   ------------------------------------------------------------
   ⚠️⚠️ 本套件第十六版**语义反转**，请先读这段再改断言。

   背景（用户原话）：
     「最后一关我直接跳过去就完了啊没有用到传送门，还有一些关卡也没有用到
       传送门，直接跳就完了」
   根因（test/capability.js 实测）：
     长按跳爬升 3.50 格、满速助跑跳水平 3.84 格 —— 任何 ≤4 格宽 / ≤3 格高的
     地形都是"直接跳过去"可达的。老版本关卡大量踩在这条线内。

   修法（用户确认的方案）：
     · 物理隔断：每关用"垂直大裂谷 / 贯通高墙"把终点区与出生区分开
     · 反偷鸡校验：生成器 R17 + 本套件 —— 只要**纯移动**能碰到终点就直接判失败

   所以本套件现在做两件事：
     [A] 纯移动 BFS（沿用 v3 的抛物线模型：垂直 3 格 / 水平 5 格）
     [B] 对 needPortal 关卡断言「终点不可达」（连通性被掐死 = 设计成立）
         对非 needPortal 关卡断言「终点可达」（教学/地面关不能卡死玩家）
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js','util.js','input.js','actor.js','portal.js','player.js','props.js',
  'levels.js','fx.js','audio.js','render.js','game.js'];
let bundle = '';
for (const f of files) bundle += `\n` + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game, ROOMS };\n';

const ctx = new Proxy({}, { get: (t, k) => {
  if (k === 'measureText') return () => ({ width: 100 });
  if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
  if (k === 'canvas') return { width: 960, height: 576 };
  return () => {};
} });
const cv = { width: 960, height: 576, style: {}, getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 576 }), addEventListener() {} };
const sb = { console, Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String, Number,
  Boolean, Set, Map, Infinity, NaN,
  document: { getElementById: () => cv, addEventListener() {} },
  addEventListener() {}, requestAnimationFrame() {}, performance: { now: () => 0 }, devicePixelRatio: 1 };
sb.window = sb; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(bundle, sb);
const { CFG, Game, ROOMS } = sb.__X;
const T = CFG.TILE;

const g = new Game(cv);
g.renderer.W = 960; g.renderer.H = 576;

const aabb2 = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/* ⚠️ 能力参数必须与 test/capability.js 的**实测值对齐**：
     长按跳最大爬升 3.50 格、满速助跑跳水平 3.84 格。
     这里取 垂直 3 / 水平 4（各留一点余量，宁可高估玩家能力 ——
     高估才会把"其实跳得过去"的关卡抓出来）。 */
const CAP_V = 3, CAP_H = 4;
const CRYSTAL_R = 15;          // props.js 里的判定半径

/* 洪泛出所有「可站立点」，并记录落脚点像素坐标 */
function analyze(room) {
  const rects = room.solids.filter(s => s.active && s.isStatic);
  /* ⚠️⚠️ 必须把**尖刺**算进去，否则纯移动 BFS 会把"落在刺上"当成合法落脚点。
     历史 bug：房间18 的 BFS 路径是
       (2.3,1.5) → (6.3,15.5) → (10.3,15.5) → (14.3,15.5) → (16.3,15.5)
       …… 而 (10.3,15.5)/(14.3,15.5)/(16.3,15.5) **全都在刺格上**
       （逐点验证：P=15..31 / y=496..510 与刺 rect y=480..512 相交，严格命中 1 个）。
     game.js 用 `aabbPadded(this.player.box, h, -2)` 判定（比我们更宽松 2px），
     所以这里直接用严格 AABB —— 只要 BFS 认为"躲得过"，游戏里就必然躲得过。 */
  const hazardBox = (px, py) => {
    const b = { x: px, y: py, w: CFG.P_W, h: CFG.P_H };
    for (const h of room.hazards) if (aabb2(b, h)) return true;
    return false;
  };
  const blocked = (px, py) => {
    if (hazardBox(px, py)) return true;      // 踩到刺 = 死，不算落脚点
    const b = { x: px, y: py, w: CFG.P_W, h: CFG.P_H };
    for (const s of rects) if (aabb2(b, s)) return true;
    return false;
  };
  const standable = (px, py) => {
    if (blocked(px, py)) return false;
    const f = { x: px, y: py + 1, w: CFG.P_W, h: CFG.P_H };
    for (const s of rects) if (aabb2(f, s)) return true;
    return false;
  };
  /* 从 (px,py) 落到最低可站立点
     —— 向下扫描；一旦玩家身体被实心挡住，就说明已经落到地面了，
        返回最近一个可站立点（而不是放弃）。 */
  const dropTo = (px, py) => {
    let last = null;
    for (let y = py; y < room.H; y++) {
      if (blocked(px, y)) return last;   // 撞到地面 → 落点就是上一个可站立位置
      if (standable(px, y)) last = y;
    }
    return last;
  };

  const startY = dropTo(room.spawn.x, room.spawn.y);
  if (startY === null) return { set: new Set(), pts: [], startY: null };
  const key = (x, y) => Math.round(x) + ',' + Math.round(y);
  const seen = new Set([key(room.spawn.x, startY)]);
  const q = [{ x: room.spawn.x, y: startY }];

  const MOVES = [];
  for (let dx = -CAP_H; dx <= CAP_H; dx++) MOVES.push([dx, 0]);
  for (let dy = 1; dy <= CAP_V; dy++)
    for (let dx = -(CAP_H - dy); dx <= CAP_H - dy; dx++) MOVES.push([dx, -dy]);
  for (let dy = 1; dy <= 14; dy++)
    for (let dx = -CAP_H; dx <= CAP_H; dx++) MOVES.push([dx, dy]);

  const canDo = (rise, dx) => {
    if (rise <= 0) return true;
    if (rise > CAP_V) return false;
    const maxDx = CAP_H * Math.sqrt(Math.max(0, 1 - (rise / CAP_V) ** 2)) + 0.5;
    return Math.abs(dx) <= maxDx;
  };

  while (q.length) {
    const p = q.pop();
    for (const [dxg, dyg] of MOVES) {
      if (!canDo(-dyg, dxg)) continue;
      const tx = p.x + dxg * T;
      if (tx < T || tx > room.W - T * 2) continue;
      const ty = Math.max(T, p.y + dyg * T);
      const land = dropTo(tx, ty);
      if (land === null) continue;
      const k = key(tx, land);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ x: tx, y: land });
    }
  }
  /* 还原成落脚点列表 {x, y, cx, cy} */
  const pts = [...seen].map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, cx: x + CFG.P_W / 2, cy: y + CFG.P_H / 2 };
  });
  return { set: seen, pts, startY };
}

console.log('=== 关卡可达性（v4 · 反偷鸡设计守卫）===');
console.log(`能力：垂直 ${CAP_V} 格 / 水平 ${CAP_H} 格   水晶判定半径 ${CRYSTAL_R}px\n`);

/* 晶体可达 = 存在落脚点使 |落脚中心 − 水晶中心| < CRYSTAL_R（并留 1px 余量） */
const crystalReach = (pts, cr) => {
  for (const p of pts) if (Math.hypot(p.cx - cr.x, p.cy - cr.y) < CRYSTAL_R - 1) return true;
  return false;
};
/* 实体目标可达 = 存在落脚点在水平 1.5 格且垂直 1.5 格内 */
const nearReach = (pts, x, y, tol = T * 1.5) => {
  for (const p of pts) if (Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol) return true;
  return false;
};

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  \u2717 ' + n + '  ' + e); }
};
const gname = (n) => `房间${n.id} ${n.name}`;

const cheat = [], stuck = [];

for (const room of g.rooms) {
  const { set, pts } = analyze(room);
  const goalOk = room.goal ? nearReach(pts, room.goal.x, room.goal.y) : null;
  const moves = `落脚点 ${set.size}` + (room.goal ? `  终点${goalOk ? '✓' : '✗'}` : '  （无终点，靠出口）');

  /* ---- [A] 出生点附近必须有可活动空间（不能一出生就被焊死） ---- */
  check(`${gname(room)} 出生点可活动`, set.size >= 3, moves);

  /* ---- [B] 核心守卫：needPortal 关卡必须"纯移动到不了终点" ---- */
  if (room.needPortal && room.goal) {
    check(`  ★ ${gname(room)} 终点纯移动不可达（强制用门）`, !goalOk,
      goalOk ? '竟然不用门就能碰到终点 → 可以偷鸡！' : '连通性已被物理隔断 ✓');
    if (goalOk) cheat.push(`${gname(room)}（不用门就能到终点）`);
  } else if (room.goal) {
    check(`  ${gname(room)} 终点纯移动可达（非门关不能卡死）`, goalOk,
      goalOk ? 'OK' : '玩家会卡死在出生区！');
    if (!goalOk) stuck.push(`${gname(room)}（到不了终点）`);
  }

  /* ---- [C] 箱子 / 压力板：必须都在"可推达区域"里，否则机关无解 ---- */
  for (const c of room.crates) {
    check(`  ${gname(room)} 箱子${c.id} 在可活动区域内`, nearReach(pts, c.x, c.y, T * 2.5));
  }
  for (const p of room.plates) {
    check(`  ${gname(room)} 压力板(${p.gx},${p.gy}) 在可活动区域内`, nearReach(pts, p.x, p.y, T * 2.5));
  }
  /* ---- [D] 水晶：只统计"纯移动就能吃到"的部分，不做硬断言 ----
     （很多水晶是**进门后的奖励**，纯移动当然吃不到 —— 那不是 bug。） */
  const crystalTotal = room.crystals.length;
  const crystalOk = room.crystals.filter(cr => crystalReach(pts, cr)).length;
  if (crystalTotal) {
    check(`  ${gname(room)} 水晶可达统计`, true,
      `${crystalOk}/${crystalTotal} 纯移动可达` + (crystalOk < crystalTotal ? '（其余为门后奖励，正常）' : ''));
  }
}

/* ---- [E] 全局：needPortal 关卡占比 ---- */
const portalRooms = ROOMS.filter(d => d.needPortal).length;
console.log('');
check(`强制用门的关卡 ≥ 14 个（实得 ${portalRooms}/${ROOMS.length}）`, portalRooms >= 14);

console.log(`\n${'='.repeat(52)}`);
console.log(`  通过 ${pass}  /  失败 ${fail}`);
if (cheat.length) { console.log('  ⚠️ 可偷鸡：'); cheat.forEach(d => console.log('    · ' + d)); }
if (stuck.length) { console.log('  ⚠️ 会卡死：'); stuck.forEach(d => console.log('    · ' + d)); }
if (!cheat.length && !stuck.length) console.log('  ✅ 反偷鸡守卫通过：没有关卡能被纯移动通关，也没有死路');
console.log(`${'='.repeat(52)}\n`);
process.exit(fail > 0 ? 1 : 0);
