/* ============================================================
   关卡可通关性验证 —— 对 10 个房间逐关模拟"目标是否可达"
   ------------------------------------------------------------
   不做完整 AI 通关（太难写），而是做**结构化验证**：
     1. 每个房间的终点/出口在几何上可达（跳跃/冲刺/传送门能到）
     2. 分步脚本（steps）能随状态推进，且最终步指向出口/终点
     3. 推箱子关卡真的能推（真实物理）
     4. 传送门关卡的 entry/exit 组合能到达终点
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js', 'util.js', 'input.js', 'actor.js', 'portal.js', 'player.js', 'props.js',
  'levels.js', 'fx.js', 'audio.js', 'render.js', 'game.js'];
let bundle = '';
for (const f of files) bundle += '\n' + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game, ROOMS, KEYBINDS, ACTIONS };\n';
const ctx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'measureText') return () => ({ width: 100 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'canvas') return { width: 960, height: 576 };
    return () => {};
  },
});
const cv = {
  width: 960, height: 576, style: {}, getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 576 }), addEventListener() {},
};
const sb = {
  console, Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String, Number,
  Boolean, Set, Map, Infinity, NaN,
  document: { getElementById: () => cv, addEventListener() {} },
  addEventListener() {}, requestAnimationFrame() {}, performance: { now: () => 0 }, devicePixelRatio: 1,
};
sb.window = sb; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(bundle, sb);
const { CFG, Game, ROOMS } = sb.__X;
const T = CFG.TILE;

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  \u2717 ' + n + '  ' + e); }
};

function makeGame() {
  const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576; return g;
}
const ALL = ['left', 'right', 'up', 'down', 'jump', 'dash', 'portal', 'portal2', 'reset', 'clear', 'pause'];
function driver(g) {
  let prev = {};
  return (want) => {
    want = want || {};
    for (const k of ALL) if (want[k] && !prev[k]) g.input.queued.push(k);
    for (const k of ALL) if (!want[k] && prev[k]) g.input.held[k] = false;
    g.input.beginStep();
    prev = Object.assign({}, want);
    g.step(CFG.DT);
  };
}
function run(tick, want, n) { for (let i = 0; i < n; i++) tick(want); }

/* ---- 几何工具：找"可站立格"，判断终点是否落在某个可站立格附近 ----
   注意：用真实玩家碰撞盒（CFG.P_W × CFG.P_H），不要用写死的 10×14，
   否则窄平台上的合法终点会被误判为"孤立"。 */
function standableCells(room) {
  const T2 = CFG.TILE;
  const set = new Set();
  const PW = CFG.P_W, PH = CFG.P_H;
  const hitBox = (b) => {
    for (const s of room.solids) {
      if (s.active && b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) return true;
    }
    return false;
  };
  for (let y = 0; y < CFG.ROOM_H - 1; y++) {
    for (let x = 0; x < CFG.ROOM_W; x++) {
      const cx = x * T2 + T2 / 2, cy = y * T2 + T2 / 2;
      // 玩家中心落在该格里时，盒子不能与任何实心重叠
      if (hitBox({ x: cx - PW / 2, y: cy - PH / 2, w: PW, h: PH })) continue;
      // 脚下 2px 内有实心 → 站得住
      if (hitBox({ x: cx - PW / 2, y: cy + PH / 2, w: PW, h: 2 })) set.add(x + ',' + y);
    }
  }
  return set;
}

/* 终点所在列，向下最多 3 格之内是否有实心地面（宽松判定，用于窄平台） */
function groundBelow(room, gx, gy) {
  const T2 = CFG.TILE;
  const cx = gx * T2 + T2 / 2;
  for (let y = gy; y <= gy + 3; y++) {
    const cy = y * T2 + T2 / 2;
    for (const s of room.solids) {
      if (!s.active) continue;
      if (cx + 4 > s.x && cx - 4 < s.x + s.w && cy + T2 / 2 + 2 > s.y && cy - T2 / 2 < s.y + s.h) return true;
    }
  }
  return false;
}

console.log('=== 关卡可通关性验证 ===\n');

/* 放置辅助：把"地板门"放在某格地板的**顶面之上**（门框贴在表面，玩家能从上往下落进去）。
   朝向约定与 game.js findPortalSpot 的 faces 一致：
     d=0 法线(0,-1)朝上 → 地板门（装在 solid 顶面）
     d=2 法线(0,1) 朝下 → 天花板门（装在 solid 底面）
     d=1 法线(1,0) 朝右 → 左墙的右表面
     d=3 法线(-1,0)朝左 → 右墙的左表面
   PortalPair.check 要求 "沿法线速度 vAlong < -minSpeed"，
   所以从上方落入地板门时 vAlong = vy * (-1) = -vy < 0 ✓ */
function floorPortal(P, tileX, surfaceTileY, roomId) {
  P.place(tileX * T + T / 2, surfaceTileY * T - 2, 0, roomId);
}
/* 把"墙面门"放在某格墙的侧面（法线指向房间内侧） */
function wallPortal(P, x, tileY, d, roomId) { P.place(x, tileY * T + T / 2, d, roomId); }

/* ---- 1. 每关都有出口（终点 或 房间链接 或 靠传送门抵达） ---- */
console.log('[1] 每关都有明确出口');
for (const def of ROOMS) {
  const hasGoal = def.map.some(r => r.includes('G'));
  const hasLink = (def.links || []).length > 0;
  const portalExit = !!def.needPortal;       // 传送门关：出口靠穿门抵达，地图上不必有 G
  check(`房间${def.id} ${def.name} 有终点或房间链接`, hasGoal || hasLink || portalExit,
    hasGoal ? '终点 G' : (hasLink ? '链接 →' : (portalExit ? '传送门出口（needPortal）' : '都没有！')));
}

/* ---- 2. 终点落在可站立的地面之上 ---- */
console.log('\n[2] 终点落在可站立的平台上');
{
  const g = makeGame();
  for (const def of ROOMS) {
    const room = g.rooms[def.id];
    if (!room.goal) continue;
    const cells = standableCells(room);
    const gx = Math.floor(room.goal.x / T), gy = Math.floor(room.goal.y / T);
    let ok = false;
    for (let dx = -1; dx <= 1 && !ok; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (cells.has((gx + dx) + ',' + (gy + dy))) { ok = true; break; }
    }
    if (!ok) ok = groundBelow(room, gx, gy);   // 宽松兜底：该列下方 3 格内有地面
    check(`房间${def.id} 终点 (${gx},${gy}) 可达`, ok, ok ? 'OK' : '孤立！');
  }
}

/* ---- 3. 出生点自身可站立 ---- */
console.log('\n[3] 出生点站得住');
{
  const g = makeGame();
  for (const def of ROOMS) {
    const room = g.rooms[def.id];
    g.switchRoom(def.id, false);
    /* ⚠️ switchRoom **不会搬玩家** —— 玩家会保留上一关的坐标。
       高难关（11~19）满地是刺，第 1 帧就踩刺 → step() 走
       `respawnPlayer(); return;` 提前返回，量到的 y 是上一关的残留值
       （历史报错 y=10.59 / y=15.69 就是这么来的）。
       必须显式把玩家摆到本关出生点。 */
    g.player.reset(room.spawn.x, room.spawn.y);
    const tick = driver(g);
    run(tick, {}, 30);
    check(`房间${def.id} 出生后站得住（不下坠）`, g.player.grounded,
      `y=${(g.player.cy / T).toFixed(2)} grounded=${g.player.grounded}`);
  }
}

/* ---- 4. 分步脚本会随状态推进 ---- */
console.log('\n[4] 分步脚本（steps）能推进');
{
  const g = makeGame();
  for (const def of ROOMS) {
    if (!def.steps || !def.steps.length) continue;
    const room = g.rooms[def.id];
    g.switchRoom(def.id, false);
    g.player.reset(room.spawn.x, room.spawn.y);
    const tick = driver(g);
    run(tick, {}, 20);
    const first = g.objective;
    check(`房间${def.id} steps 产出了目标文案`, !!first && first.length > 0, `"${first}"`);
  }
}

/* ---- 5. 推箱子关卡真的可推（房间 3） ---- */
console.log('\n[5] 推箱子机关（房间 3）真的可解');
{
  /* ⚠️⚠️ 房间 3 第十版起，箱子在出生点**左边**、压力板也在左边（x=3），
     解法是「按 ← 往左推」。旧测试写的是 `right:true`（往右推），
     在新几何下箱子一出生就贴着 x=2 的实心止挡，怎么推都不动 →
     报"箱子卡在 (4.19,14.38)"。这里必须改成**站到箱子右边往左推**。
     另外 x=2 是实心墙（不是刺），所以推到底只是贴墙，不会死。 */
  const g = makeGame(); const tick = driver(g);
  g.switchRoom(3, false);
  const box = g.room.crates[0];
  const sig = g.room.signals[0];
  g.player.reset(box.x + 40, box.y - 2);   // ★ 站到箱子**右边**
  run(tick, {}, 5);
  let lit = false, used = 0;
  for (let i = 0; i < 1200; i++) {
    tick({ left: true }); used = i;        // ★ 往**左**推
    if (sig.on) { lit = true; break; }
  }
  check('房间3 箱子能推到压力板', lit, lit ? `${used} 步` : `箱子卡在 (${(box.x / T).toFixed(2)},${(box.y / T).toFixed(2)})`);
  const gate = g.room.gates[0];
  run(tick, {}, 60);
  check('房间3 通电后门打开', !gate.active, `open=${gate.open}`);
}

/* ---- 6. 传送门关卡：门能放 + 惯性射出 ----
   朝向 d 的含义（DIR[d] 是法线，指向"房间内侧/空气一侧"）：
     d=0 法线(0,-1)朝上 → 放在天花板底面  → 从上方落入
     d=1 法线(1,0) 朝右 → 放在左侧墙的右表面 → 从右方落入
     d=2 法线(0,1) 朝下 → 放在地板顶面    → 从下方落入
     d=3 法线(-1,0)朝左 → 放在右侧墙的左表面 → 从左方落入
   check() 要求"沿法线速度 < -minSpeed"，也就是实体必须逆着法线撞进门面。 */
console.log('\n[6] 传送门关卡可解（房间 4 / 5 / 6）');
{
  /* ⚠️ 本段所有坐标都从 **房间实际几何** 推导，不写死 —— 关卡会随难度调整而改。
     通用工具：
       ① 找"地板行"：从下往上找**第一叠实心**，这一叠最上面那一行才是可站面。
       ② 找一条「从某个高度直落到底、中途无平台、落点不在刺上」的竖列。 */
  const floorRowAt = (def, x) => {
    // 从最底行往上找第一块 '#'，再继续往上跳过整叠实心 → 得到可站面所在行
    let fy = -1;
    for (let y = CFG.ROOM_H - 2; y >= 2; y--) if (def.map[y][x] === '#') { fy = y; break; }
    if (fy < 0) return -1;
    while (fy > 2 && def.map[fy - 1][x] === '#') fy--;
    return fy;
  };
  const clearColumn = (g, x, yTop, yFloor) => {
    for (let y = yTop; y < yFloor; y++) if (g.room.def.map[y][x] !== ' ') return false;
    return g.room.def.map[yFloor][x] === '#' &&
      !g.room.hazards.some(h => Math.abs(h.x - (x * T + T / 2)) < T * 0.6 &&
        Math.abs(h.y - ((yFloor - 1) * T + T / 2)) < T * 0.6);
  };
  /* 在 [x0,x1] 里找一条"从 yTop 直落到底"的空列；返回 {x, floor} */
  const findShaft = (g, x0, x1, yTop) => {
    for (let x = x0; x <= x1; x++) {
      const fy = floorRowAt(g.room.def, x);
      if (fy > 0 && clearColumn(g, x, yTop, fy)) return { x, floor: fy };
    }
    return null;
  };

  /* ---- 房间4：高处坠落 → 地板门 → 墙门水平射出 ---- */
  const g = makeGame(); const tick = driver(g);
  g.switchRoom(4, false);
  g.player.reset(g.room.spawn.x, g.room.spawn.y);
  const s4 = findShaft(g, 2, CFG.ROOM_W - 3, 10);
  check('房间4 存在直落通道', !!s4, s4 ? `x=${s4.x} 落面=${s4.floor}` : '没找到');
  if (s4) {
    floorPortal(g.portals.a, s4.x, s4.floor, 4);      // 地板门（朝上），从上方落入
    // 出口门开在右侧墙的**左表面**（法线朝左），这样射出方向是水平向左
    g.portals.b.place(27 * T - 2, 10 * T + T / 2, 3, 4);
    check('房间4 两个门都放好了', g.portals.ready, `ready=${g.portals.ready}`);
    g.player.reset(s4.x * T + (T - CFG.P_W) / 2, 10.5 * T);
    g.player.vx = 0; g.player.vy = 0;
    let outSpeed = 0, teleported = false, outVx = 0, outVy = 0;
    for (let i = 0; i < 400; i++) {
      tick({});
      if (!teleported && g.player.portalCd > 0) {
        teleported = true;
        outSpeed = Math.hypot(g.player.vx, g.player.vy);
        outVx = g.player.vx; outVy = g.player.vy;
      }
    }
    check('房间4 玩家能从地门穿到墙门', teleported,
      teleported ? `出速 ${outSpeed.toFixed(0)}px/s` : '没穿过去');
    check('房间4 穿门后速度守恒（惯性保留）', outSpeed > 300, `速度 ${outSpeed.toFixed(0)}`);
    check('房间4 竖落进门 → 横着射出（方向被重映射）', Math.abs(outVx) > Math.abs(outVy),
      `vx=${outVx.toFixed(0)} vy=${outVy.toFixed(0)}`);
  }

  /* ---- 房间5：井顶直落 → 井底地板门 → 井壁墙门水平射出 ----
     ⚠️ 井筒不再是 x=15 —— 现在是很宽的落差槽（约 x=10..25）。
        井筒中线与井底落面全部从地图推导。 */
  const g5 = makeGame(); const t5 = driver(g5);
  g5.switchRoom(5, false);
  const d5 = ROOMS[5];
  g5.player.reset(g5.room.spawn.x, g5.room.spawn.y);
  const s5 = findShaft(g5, 10, 25, 4);
  check('房间5 井筒中线贯通（落得进去）', !!s5, s5 ? `x=${s5.x} 落面=${s5.floor}` : '被堵住了！');
  if (s5) {
    floorPortal(g5.portals.a, s5.x, s5.floor, 5);              // 井底地板门（朝上）
    // 出口门开在井**右壁的左表面**（法线朝左）—— 先找井右壁：s5.x 往右第一道实心竖墙
    let wallX = s5.x + 1;
    while (wallX < CFG.ROOM_W - 1 && d5.map[s5.floor - 1][wallX] === ' ') wallX++;
    g5.portals.b.place(wallX * T - 2, (s5.floor - 5) * T + T / 2, 3, 5);
    g5.player.reset(s5.x * T + (T - CFG.P_W) / 2, 4.5 * T);
    g5.player.vx = 0; g5.player.vy = 0;
    let fell = false, spd = 0, fellVx = 0;
    for (let i = 0; i < 400; i++) {
      t5({});
      if (g5.player.portalCd > 0) {
        fell = true; spd = Math.hypot(g5.player.vx, g5.player.vy); fellVx = g5.player.vx;
        break;
      }
    }
    check('房间5 从井顶落下能进门', fell, fell ? `速度 ${spd.toFixed(0)}` : '没进去');
    check('房间5 井底加速度够大（> 400）', !fell || spd > 400, `${spd.toFixed(0)} px/s`);
    check('房间5 竖落进门 → 横着射出', !fell || Math.abs(fellVx) > 400,
      `vx=${fellVx.toFixed(0)}`);
  }

  /* ---- 房间6：中央贯通竖墙把左右隔断（通行必须靠传送门） ----
     结构：箱子 + 压力板 + 能量门都在**隔墙左侧**（纯地面横推解谜），
          隔墙右侧是起点区，**只能靠传送门飞过去**。
     ⚠️ 隔墙位置每轮会变（曾经是 x=14/15，第 16 版挪到 x=9），
        所以隔墙列 & 推箱方向都要从地图/实体位置推导，不能写死。 */
  const g6 = makeGame(); const t6 = driver(g6);
  g6.switchRoom(6, false);
  const d6 = ROOMS[6];
  check('房间6 需要传送门（结构检查）', !!d6.needPortal && d6.objMode === 'puzzle');
  // 找那根"从天花板砌到地面"的贯通竖墙（行 1..15 全 '#'，或该行被能量门补齐）
  const gate6 = (d6.gates || [])[0];
  let wallCol = -1, wallRows = 0;
  for (let x = 2; x < CFG.ROOM_W - 2; x++) {
    let n = 0;
    for (let y = 1; y <= 15; y++) {
      if (d6.map[y][x] === '#') { n++; continue; }
      if (gate6 && gate6.gx === x && y >= gate6.gy && y < gate6.gy + (gate6.h || 1)) n++;
    }
    if (n > wallRows) { wallRows = n; wallCol = x; }
  }
  check('房间6 中央竖墙把左右隔断（需要传送门）', wallRows === 15,
    `竖墙 x=${wallCol} ${wallRows}/15 行`);

  /* ---- 房间6b：箱子 + 压力板 + 能量门 结构完整 ---- */
  check('房间6 有压力板', g6.room.plates.length === 1, `plate=${g6.room.plates.length}`);
  check('房间6 有能量门', g6.room.gates.length === 1, `gate=${g6.room.gates.length}`);
  // 压板前门必须是关着的（active），否则机关没作用
  t6({});
  check('房间6 压板前能量门是关的', g6.room.gates[0].active, `active=${g6.room.gates[0].active}`);
  const b6 = g6.room.crates[0];
  const pl6 = g6.room.plates[0];
  const pl6cx = pl6.x + pl6.w / 2;
  // 箱子与压力板必须都在隔墙左侧（同一可推达区域，纯地面横推）
  check('房间6 箱子在隔墙左侧（可横推压板）', !!b6 && b6.cx < wallCol * T,
    `box=(${(b6.cx / T).toFixed(1)},${(b6.cy / T).toFixed(1)}) 墙 x=${wallCol}`);
  check('房间6 压力板在隔墙左侧', pl6cx < wallCol * T,
    `plate x=${(pl6cx / T).toFixed(1)} 墙 x=${wallCol}`);
  check('房间6 箱子能推到压力板（同层、同一平地上）',
    !!b6 && Math.abs(b6.cy - (pl6.y + pl6.h / 2)) < 2 * T,
    b6 ? `box y=${(b6.cy / T).toFixed(1)} plate y=${((pl6.y + pl6.h / 2) / T).toFixed(1)}（方向 ${
      b6.cx > pl6cx ? '往左推' : '往右推'}）` : '没有箱子');

  /* ---- 房间6c：真的推一遍（方向由几何决定） ---- */
  if (b6) {
    const g6b = makeGame(); const t6b = driver(g6b);
    g6b.switchRoom(6, false);
    g6b.player.reset(g6b.room.spawn.x, g6b.room.spawn.y);
    const bx = g6b.room.crates[0], sg = g6b.room.signals[0];
    const pushLeft = bx.cx > pl6cx;                   // 板在左 → 往左推
    const standDir = pushLeft ? 1 : -1;               // 站到箱子的另一侧
    g6b.player.reset(bx.x + (standDir > 0 ? 40 : -40), bx.y);
    run(t6b, {}, 5);
    let lit = false, used = 0;
    for (let i = 0; i < 1500; i++) {
      t6b(pushLeft ? { left: true } : { right: true }); used = i;
      if (sg && sg.on) { lit = true; break; }
    }
    check('房间6 箱子真能推到压力板（通电）', lit,
      lit ? `${used} 步（${pushLeft ? '往左' : '往右'}推）`
        : `箱子卡在 (${(bx.x / T).toFixed(2)},${(bx.y / T).toFixed(2)})，${pushLeft ? '往左' : '往右'}推`);
  }
}

/* ---- 7. 进阶动作真的能用 ---- */
// ★ 第十三版：冲刺/凌波微步/超级跳已**整体移除**（用户要求「取消冲刺」）。
//   本节改成验证三件仍然存在的事：
//     ① 空中跳能用（落地回满、只给一次、初速合格）
//     ② 传送门惯性保留（按住方向键不再刹车） —— 这是本轮的核心修复
//     ③ 墙跳仍然能用
console.log('\n[7] 进阶动作可用性');

/* ---- 7a. 空中跳 ---- */
{
  const g = makeGame(); const tick = driver(g);
  g.switchRoom(0, false);
  g.player.reset(6 * T, 15 * T);
  run(tick, {}, 14);                                   // 落到地面
  const maxAir = CFG.AIR_JUMP_MAX;
  check('出生/落地后空中跳是满的', g.player.airJumps === maxAir,
    `airJumps=${g.player.airJumps}/${maxAir}`);

  // 起跳 → 升到半空 → 再按跳（空跳）
  run(tick, { jump: true }, 6);
  const yBefore = g.player.cy, vyBefore = g.player.vy;
  tick({});                                            // 清 held
  tick({ jump: true });                                // ★ 空中跳上升沿
  check('空中跳能触发（半空中再次向上加速）',
    g.player.vy < vyBefore - 100 && g.player.airJumps === maxAir - 1,
    `vy ${vyBefore.toFixed(0)} → ${g.player.vy.toFixed(0)}, airJumps=${g.player.airJumps}`);
  check('空中跳初速 = CFG.AIR_JUMP_SPEED',
    Math.abs(Math.abs(g.player.vy) - CFG.AIR_JUMP_SPEED) < 12,
    `vy=${g.player.vy.toFixed(0)} 期望 -${CFG.AIR_JUMP_SPEED}`);

  // 落地后必须回满
  run(tick, {}, 120);
  check('落地后空中跳回满', g.player.airJumps === maxAir,
    `airJumps=${g.player.airJumps}`);
  check('空中跳次数有限（不是无限位移）', maxAir >= 1 && maxAir <= 2,
    `AIR_JUMP_MAX=${maxAir}`);
}

/* ---- 7b. 传送门惯性保留（本轮核心修复）---- */
{
  /* 旧 bug：`movementX` 的正常分支是
       `if (ax !== 0) this.vx = approach(this.vx, ax * RUN_SPEED, accel*dt)`
     —— 按住方向键会把 620 的传送门惯性**硬拉回 180**，实测 20 帧掉 71%。
     修复：超过 RUN_SPEED 时方向键只做"微调"，不做"刹车"。

     ⚠️ 测试必须是"纯物理"场景：把玩家放在半空、**把移动位移按住不动**
       （每帧把 x 复位），这样不会撞墙、不会被 `resolveX` 把 vx 清零，
       量到的衰减就纯粹来自 `movementX`。 */
  // 用 driver 但每帧前置复位位置（排除碰撞对 vx 的干扰）
  const measure = (keys, frames) => {
    const g = makeGame(); const tick = driver(g);
    g.switchRoom(0, false);
    g.player.reset(6 * T, 6 * T);              // 半空（空中，不受地面摩擦）
    g.player.vx = 620; g.player.airJumps = CFG.AIR_JUMP_MAX;
    const x0 = g.player.x, y0 = g.player.y;
    for (let i = 0; i < frames; i++) {
      g.player.x = x0; g.player.y = y0;
      tick(keys);
    }
    return Math.abs(g.player.vx) / 620;
  };

  const keptHold = measure({ right: true }, 40);
  check('按住方向键不再刹车：传送门惯性保留 ≥ 60%', keptHold >= 0.60,
    `620 → ${(keptHold * 620).toFixed(0)} px/s（保留 ${(keptHold * 100).toFixed(0)}%，40 帧）`);
  check('惯性保留时长 ≈ PORTAL_INERTIA_KEEP（1.2s 量级）',
    (CFG.PORTAL_INERTIA_KEEP || 0) >= 1.0,
    `PORTAL_INERTIA_KEEP=${CFG.PORTAL_INERTIA_KEEP}`);

  const keptFree = measure({}, 40);
  check('松手也保留惯性（不再"必须按着才留得住"）', keptFree >= 0.55,
    `620 → ${(keptFree * 620).toFixed(0)} px/s（保留 ${(keptFree * 100).toFixed(0)}%）`);

  const keptAgainst = measure({ left: true }, 40);
  check('逆着方向键飞时会被温和刹车（防止完全失控）', keptAgainst < keptHold,
    `逆按保留 ${(keptAgainst * 100).toFixed(0)}% < 顺按 ${(keptHold * 100).toFixed(0)}%`);
}

/* ---- 7c. 墙跳 ---- */
{
  const g2 = makeGame(); const t2 = driver(g2);
  g2.switchRoom(8, false);
  g2.player.reset(13 * T + 2, 10 * T);
  run(t2, {}, 20);
  let wallJumped = false;
  for (let i = 0; i < 120; i++) {
    t2({ left: true });
    if (g2.player.wallSlide || g2.player.wallDir) break;
  }
  const beforeVy = g2.player.vy;
  t2({ jump: true });
  if (g2.player.vy < -200) wallJumped = true;
  check('墙跳能触发（按跳后向上弹）', wallJumped,
    `vy ${beforeVy.toFixed(0)} → ${g2.player.vy.toFixed(0)}`);
}

/* ---- 8. 水晶 = 空中跳补给（原"水晶补冲刺"）---- */
// ★ 第十三版：水晶不再补冲刺，改成补**空中跳**。
console.log('\n[8] 水晶补给空中跳');
{
  /* 用**全新的 Game** 做水晶断言，避免前面几节残留的状态
     （死亡重生会把 crystal.timer 清零、把 airJumps 补满，导致结果不可复现）。 */
  const gc = makeGame(); const tc = driver(gc);
  gc.switchRoom(0, false);
  check('空中跳初始 = AIR_JUMP_MAX', gc.player.airJumps === CFG.AIR_JUMP_MAX,
    `${gc.player.airJumps} / ${CFG.AIR_JUMP_MAX}`);

  const c = gc.room.crystals[0];
  check('房间0 有水晶（用于补给测试）', !!c,
    c ? `水晶 格=(${c.gx},${c.gy})` : '无');

  if (c) {
    c.timer = 0;
    gc.player.x = c.x - CFG.P_W / 2;
    gc.player.y = c.y - CFG.P_H / 2;   // 水晶正好在平台上方，玩家盒能贴合
    gc.player.vx = 0; gc.player.vy = 0;
    gc.player.airJumps = 0;            // 先清空，再验证"吃到即补满"
    run(tc, {}, 3);
    check('吃到水晶补满空中跳', gc.player.airJumps === CFG.AIR_JUMP_MAX,
      `airJumps=${gc.player.airJumps} / ${CFG.AIR_JUMP_MAX}（距水晶 ${Math.hypot(gc.player.cx - c.x, gc.player.cy - c.y).toFixed(1)}px）`);
  }

  // 在另一个 Game 里验证"用掉 → 落地回满"
  const g2 = makeGame(); const t2 = driver(g2);
  g2.switchRoom(0, false);
  g2.player.reset(3 * T, 6 * T);
  run(t2, {}, 3);
  t2({ jump: true }); run(t2, {}, 4);
  t2({}); t2({ jump: true });          // 空中跳上升沿
  check('空中跳用掉后 airJumps = 0', g2.player.airJumps === 0,
    `airJumps=${g2.player.airJumps}`);
  run(t2, {}, 200);                    // 落回地面
  check('落地后空中跳回满', g2.player.airJumps === CFG.AIR_JUMP_MAX,
    `airJumps=${g2.player.airJumps} / ${CFG.AIR_JUMP_MAX}`);
}

/* ---- 9. 每关都能渲染 ---- */
console.log('\n[9] 每关渲染无异常');
{
  const g = makeGame();
  for (const def of ROOMS) {
    g.switchRoom(def.id, false);
    let err = null;
    try { for (let i = 0; i < 90; i++) g.step(CFG.DT); } catch (e) { err = e.message; }
    check(`房间${def.id} 90 步无异常`, !err, err || 'OK');
  }
}

console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
