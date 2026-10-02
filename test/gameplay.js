/* 端到端玩法验证：真实物理跑通「房间切换」与「传送门解谜」 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js','util.js','input.js','actor.js','portal.js','player.js','props.js',
  'levels.js','fx.js','audio.js','render.js','game.js'];
let bundle = '';
for (const f of files) bundle += `\n` + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game };\n';
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
const { CFG, Game } = sb.__X;
const T = CFG.TILE;

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  \u2717 ' + n + '  ' + e); } };

function makeGame() {
  const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576;
  return g;
}
function mkTick(g) {
  const IN = g.input;
  return function tick(want) {
    want = want || {};
    for (const k in want) {
      if (want[k] && !IN.held[k]) IN.queued.push(k);
      if (!want[k] && IN.held[k]) IN.held[k] = false;
    }
    IN.beginStep();
    g.step(CFG.DT);
  };
}

console.log('=== 端到端玩法验证 ===\n');

/* ---------- 1. 房间 0 → 1：从底部开口掉下去 ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  check('起始房间是 0', g.roomId === 0, `roomId=${g.roomId}`);
  // 房间 0 的底部开口在 x=20..24（洞口列），从这里下坠
  g.player.reset(22 * T, 6 * T);
  let dropped = false;
  for (let i = 0; i < 400; i++) {
    tick({});
    if (g.roomId === 1) { dropped = true; break; }
  }
  check('从房间 0 底部开口下坠能进入房间 1', dropped, `roomId=${g.roomId}`);
  if (dropped) {
    const p = g.player;
    let inside = false;
    for (const s of g.room.solids) if (s.active && p.x < s.x + s.w && p.x + p.w > s.x && p.y < s.y + s.h && p.y + p.h > s.y) inside = true;
    check('进入房间 1 后没有卡在墙里', !inside, `x=${p.x.toFixed(1)} y=${p.y.toFixed(1)}`);
    for (let i = 0; i < 300; i++) tick({});
    check('进入房间 1 后能站稳', g.player.grounded, `y=${g.player.y.toFixed(1)} grounded=${g.player.grounded}`);
  }
  // 不在开口列下坠则不应跨房间，而应掉出世界后重生
  const g2 = makeGame();
  const t2 = mkTick(g2);
  g2.player.reset(3 * T, 6 * T);      // x=3：地面是实心，会落在地面上
  for (let i = 0; i < 300; i++) t2({});
  check('非开口处不会误触发跨房间', g2.roomId === 0, `roomId=${g2.roomId}`);
  check('非开口处能正常落地', g2.player.grounded, `y=${g2.player.y.toFixed(1)}`);
}

/* ---------- 2. 房间 3 压力板机制：箱子压板 → 信号 → 开门 ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  g.switchRoom(3, false);
  const room = g.room;
  check('房间 3 有压力板', room.plates.length > 0);
  check('房间 3 有能量门', room.gates.length > 0);
  check('房间 3 有信号', room.signals.length > 0);
  const gate = room.gates[0];
  check('初始状态能量门关闭', !gate.open, `open=${gate.open}`);
  check('初始状态门完全落下（挡路）', gate.openAmt < 0.5, `openAmt=${gate.openAmt.toFixed(2)}`);

  // 真实玩法：把箱子放到压力板上，让物理去压
  const plate = room.plates[0];
  const box = room.crates[0];
  if (box) {
    box.x = plate.x; box.y = plate.y - 24; box.vy = 0; box.vx = 0;
    for (let i = 0; i < 90; i++) tick({});
    check('箱子落到压力板上触发信号', room.signals[0].on, `on=${room.signals[0].on} plate.pressed=${plate.pressed}`);
    check('压力板触发后能量门打开', gate.open, `open=${gate.open} openAmt=${gate.openAmt.toFixed(2)}`);
    // 把箱子移开 → 门重新关上
    // ⚠️ 不能写死 `3 * T`：房间 3 第十版起**压力板就在 x=3**
    //    （解法改成"把箱子往左推到 x=3 的板上"），
    //    所以旧代码把箱子"移开"到 x=3 其实是**又放回了板上**，
    //    门当然一直开着 → 断言失败（实测 open=true openAmt=1.00）。
    //    改为按压力板所在列做偏移：搬到离板至少 2 格远的安全地面上。
    {
      const plateGx = Math.round(plate.x / T);
      const awayGx = plate.x / T < 15 ? plateGx + 4 : plateGx - 4;
      box.x = awayGx * T; box.y = 12 * T;
    }
    for (let i = 0; i < 90; i++) tick({});
    check('箱子移开后能量门重新关闭', !gate.open, `open=${gate.open} openAmt=${gate.openAmt.toFixed(2)}`);
  }
}

/* ---------- 3. 房间 4 传送门：高处坠入地板门 → 从上方门被弹起 ----------
   ⚠️ 位置从 room 实际几何推导，不写死坐标 —— 关卡几何会随难度调整而变。
   本测试只关心「传送门物理」，所以挑一条「从顶到底没有平台、落点不在刺上」的竖列。 */
{
  const g = makeGame();
  const tick = mkTick(g);
  g.switchRoom(4, false);
  const room = g.room;
  const goal = room.goal;
  check('房间 4 有终点', !!goal);

  // 找一条**任意高度**的竖直通道：从某行起到底部全空、底部那行是实心、
  // 且落脚行没有刺。不再写死 4..15 行 —— 关卡几何每轮都会重做。
  const spikeAt = (x, y) => room.hazards.some(h => Math.abs(h.x - x * T) < 1 && Math.abs(h.y - y * T) < 1);
  let gx = -1, floorY = -1, topY = -1;
  for (let x = 2; x < 28 && gx < 0; x++) {
    // ⚠️ 从最底行往上找**第一块**实心，然后继续往上跳过整叠实心 ——
    //    真正可站的"地面顶面"是这一叠实心最上面那一行，不是最底下那块。
    //    （写错会让 floorY 落在被埋住的格子上，门开在墙里 → 永远不触发。）
    let fy = -1;
    for (let y = CFG.ROOM_H - 2; y >= 2; y--) {
      if (room.def.map[y][x] === '#') { fy = y; break; }
    }
    if (fy < 0) continue;
    while (fy > 2 && room.def.map[fy - 1][x] === '#') fy--;
    // 落点上方的行进空间必须没有刺（否则一进去就死）
    if (spikeAt(x, fy - 1)) continue;
    // 从地板往上，找连续空列的顶端（至少留 6 格下落高度才有意义）
    let ty = fy - 1;
    while (ty > 1 && room.def.map[ty - 1][x] === ' ') ty--;
    // 整条竖列上都不能有刺
    let risky = false;
    for (let y = ty; y < fy; y++) if (spikeAt(x, y)) { risky = true; break; }
    if (!risky && fy - ty >= 6) { gx = x; floorY = fy; topY = ty; }
  }
  check('房间 4 能找到一条直落通道', gx > 0,
    `x=${gx} 落面=${floorY} 起跳=${topY}`);

  // 门 A 开在地面顶面（d=0 法线朝上，门面贴地面）
  g.portals.a.place((gx + 0.5) * T, floorY * T - 2, 0, g.roomId);
  // 门 B 开在右侧高空（同为 d=0），玩家从 B 向上弹出后落到高台
  g.portals.b.place(21.5 * T, (floorY - 7) * T, 0, g.roomId);
  check('两个门都已放置', g.portals.a.active && g.portals.b.active);
  check('门已配对可用', g.portals.ready);
  check('门 A 在地面之上（未埋进地板）', g.portals.a.y < floorY * T,
    `y=${g.portals.a.y} 地面顶面=${floorY * T}`);

  // 玩家从高处自由落体砸进门 A
  const P = g.player;
  P.reset((gx + 0.5) * T - CFG.P_W / 2, topY * T);
  let teleportHappened = false;
  let maxSpeedAtExit = 0;
  for (let i = 0; i < 400; i++) {
    tick({});
    if (!teleportHappened && P.vy < 0) { teleportHappened = true; maxSpeedAtExit = Math.abs(P.vy); }
  }
  check('坠入地板门后被从出口门弹出（vy 反向）', teleportHappened, `vy=${P.vy.toFixed(1)}`);
  check('出口弹射速度可观（惯性被保留）', maxSpeedAtExit > 200, `弹射 vy=${maxSpeedAtExit.toFixed(1)} px/s`);
  check('最终仍在房间 4', g.roomId === 4, `roomId=${g.roomId}`);
}

/* ---------- 4. 传送门跨房间 ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  g.switchRoom(4, false);
  // 门 A 在房间 4 地面（x=12 是一条直落通道），门 B 在房间 5 地面
  g.portals.a.place(12.5 * T, 16 * T - 2, 0, 4);
  g.portals.b.place(12.5 * T, 16 * T - 2, 0, 5);
  check('跨房间门都激活', g.portals.a.active && g.portals.b.active);
  check('门分属不同房间', g.portals.a.roomId === 4 && g.portals.b.roomId === 5,
    `a.room=${g.portals.a.roomId} b.room=${g.portals.b.roomId}`);
  g.player.reset(12.5 * T - CFG.P_W / 2, 4 * T);
  let switched = false;
  for (let i = 0; i < 400; i++) {
    tick({});
    if (g.roomId === 5) { switched = true; break; }
  }
  check('穿过传送门会切换到出口门所在房间', switched, `roomId=${g.roomId}`);
}

/* ---------- 4b. 传送门惯性：垂直下坠 → 水平射出 ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  g.switchRoom(4, false);
  // 门 A 在地板上（d=0 法线朝上，吸收垂直下落）
  // x=12 是一条从顶到底都空、且地面无刺的通道（见 gen-levels 房间 4）
  g.portals.a.place(12.5 * T, 16 * T - 2, 0, g.roomId);
  // 门 B 开在右墙上（d=3 法线朝左 = 指向房间内侧），出口沿法线向左射出
  g.portals.b.place(27 * T, 10 * T, 3, g.roomId);
  const P = g.player;
  P.reset(12.5 * T - CFG.P_W / 2, 2 * T);
  let exitVx = 0, exitVy = 0, captured = false;
  for (let i = 0; i < 300; i++) {
    tick({});
    // 捕获「刚出门那一瞬间」：vx 突然变成大负值（向左射出）
    if (!captured && P.vx < -200) { captured = true; exitVx = P.vx; exitVy = P.vy; }
  }
  // 出口法线是 (-1,0)，所以射出方向应该是负 vx（向左冲进房间），vy≈0
  check('垂直下坠的动量被转成水平速度（满速保留）',
    captured && exitVx < -150 && Math.abs(exitVy) < 60,
    `exitVx=${exitVx.toFixed(1)} exitVy=${exitVy.toFixed(1)}`);
}

/* ---------- 5. 死亡与重生（从没有链接的边界掉出去） ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  g.switchRoom(7, false);      // 房间 7 没有 links
  const spawn = { ...g.room.spawn };
  const deaths0 = g.deaths;
  // 房间 7 地面是实心的；从左上角（无开口）往外推，应触发边界 → 重生
  g.player.reset(2 * T, 6 * T);
  g.player.x = -50;            // 强制放到左侧边界外
  g.player.y = 300;
  for (let i = 0; i < 60; i++) tick({});
  check('越界会触发重生', g.deaths > deaths0, `deaths ${deaths0} → ${g.deaths}`);
  // 重生后落到出生点附近（允许重力下落几像素）
  check('重生回到房间出生点附近', Math.abs(g.player.x - spawn.x) < 3 && Math.abs(g.player.y - spawn.y) < 40,
    `x=${g.player.x.toFixed(1)} y=${g.player.y.toFixed(1)} 期望 (${spawn.x},${spawn.y})`);
  // R 键手动重生
  for (let i = 0; i < 40; i++) tick({});
  const d1 = g.deaths;
  for (let i = 0; i < 4; i++) tick({ reset: i === 0 });
  check('按 R 手动重生', g.deaths > d1, `deaths ${d1} → ${g.deaths}`);
}

/* ---------- 6. 收集水晶补充空中跳（★ 第十三版：冲刺已移除，水晶改为补空中跳） ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  g.switchRoom(0, false);
  const room = g.room;
  const cr = room.crystals[0];
  check('房间 0 有水晶', !!cr);
  g.player.airJumps = 0;                 // 先把空中跳耗光
  g.player.reset(cr.x - CFG.P_W / 2, cr.y - CFG.P_H / 2);
  for (let i = 0; i < 10; i++) tick({});
  check('碰到水晶补充空中跳', g.player.airJumps === CFG.AIR_JUMP_MAX,
    `airJumps=${g.player.airJumps} 期望=${CFG.AIR_JUMP_MAX}`);
  // 空中跳次数已满时，水晶不应再被消耗（timer 保持 0）
  check('空中跳已满时水晶不被触发', cr.timer <= 0, `timer=${cr.timer.toFixed(2)}`);
}

/* ---------- 6b. 空中跳：唯一一次、落地回满（★ 第十三版新增） ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  g.switchRoom(0, false);
  // 房间 0 的 x=22 列，第 1~6 行是空的，保证玩家确实悬在空中
  g.player.reset(22 * T, 2 * T);
  g.player.vx = 0; g.player.vy = 0;
  g.player.airJumps = CFG.AIR_JUMP_MAX;
  check('初始悬空（未落地）', !g.player.grounded, `grounded=${g.player.grounded}`);
  check('初始空中跳次数 = AIR_JUMP_MAX', g.player.airJumps === CFG.AIR_JUMP_MAX,
    `airJumps=${g.player.airJumps}`);
  // 空中按跳 → 消耗一次，vy 变为负（向上）
  tick({ jump: true }); tick({ jump: true });
  const vyAfter = g.player.vy;
  check('空中跳产生向上速度', vyAfter < 0, `vy=${vyAfter.toFixed(1)}`);
  check('空中跳次数被消耗', g.player.airJumps === 0, `airJumps=${g.player.airJumps}`);
  // 没有剩余次数时再按跳不会再有向上的抬升
  const vyBefore = g.player.vy;
  for (let i = 0; i < 3; i++) tick({ jump: true });
  check('次数用尽后不能再次空中跳', g.player.airJumps === 0 && g.player.vy > vyBefore - 1e-6,
    `airJumps=${g.player.airJumps} vy ${vyBefore.toFixed(1)} → ${g.player.vy.toFixed(1)}`);
  // 落地回满
  g.player.reset(6 * T, 6 * T);
  for (let i = 0; i < 40; i++) tick({});
  check('落地后空中跳回满', g.player.grounded && g.player.airJumps === CFG.AIR_JUMP_MAX,
    `grounded=${g.player.grounded} airJumps=${g.player.airJumps}`);
}

/* ---------- 7. 通关流程 ---------- */
{
  const g = makeGame();
  const tick = mkTick(g);
  // ★ 第十六版：终局关从 9 变成 19（共 20 关），只有最后一关才判 won。
  const LAST = g.rooms.length - 1;
  g.switchRoom(LAST, false);
  // ⚠️ 前面的用例可能已经让这台 Game 走到过 won=true（比如反复切关 + 踩终点）。
  //    这里显式清掉通关/过场状态，否则后面的断言一开始就不成立。
  g.won = false; g.winT = 0; g.levelClear = false; g.levelClearT = 0;
  // ⚠️ 也不要先 tick 一帧再去找终点：第 19 关的出生点离终点很近，
  //    那一帧就可能直接触发 levelClear → 过场 → won。直接摆位、只跑一次判定。
  g.player.reset(g.room.spawn.x, g.room.spawn.y);
  const goal = g.room.goal;
  check(`房间 ${LAST}（最后一关）有终点`, !!goal);
  // 把玩家**整个碰撞盒**对准终点中心（Goal 判定用的是玩家碰撞盒 vs 终点格）。
  g.player.reset(goal.x - CFG.P_W / 2, goal.y - CFG.P_H / 2);
  g.player.vx = 0; g.player.vy = 0;
  // ⚠️ 只跑 10 帧（< CFG.LEVEL_CLEAR_DELAY 的 54 帧）——
  //    跑满 60 帧会把过场也走完，直接变成 won，就验不到"先过场"这一步了。
  for (let i = 0; i < 10; i++) tick({});
  check('碰到终点先进入本关过场（不是直接通关）', g.levelClear === true && g.won === false,
    `levelClear=${g.levelClear} won=${g.won}`);
  // 过场结束 → 因为是最后一关 → 判定通关
  let guard = 0;
  while (g.levelClear && guard++ < 400) tick({});
  check('最后一关过场结束后触发通关', g.won === true, `won=${g.won}`);
}

console.log(`\n${'='.repeat(46)}`);
console.log(`  通过 ${pass}  /  失败 ${fail}`);
console.log(`${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
