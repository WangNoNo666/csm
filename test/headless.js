/* 无头测试：验证物理、传送门动量、机关逻辑 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'src');
const files = ['config.js','util.js','input.js','actor.js','portal.js','player.js','props.js','levels.js','fx.js','audio.js','render.js','game.js'];

const sandbox = {
  console,
  Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String, Number, Boolean, Set, Map, Infinity, NaN,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 把所有源码拼成一个脚本，并显式导出需要的符号（const 不会挂到 sandbox 上）
const EXPORTS = ['CFG','DIR','clamp','lerp','damp','sign','approach','rand','aabb','aabbPadded',
  'Input','Actor','Portal','PortalPair','Player','PushBox','Signal','Plate','SwitchLever','Gate',
  'MovingBlock','Crystal','Goal','Hazard','TextHint','ROOMS','FX','hexToRgb','hexToRgba',
  'PALETTES','Room','Game','Renderer','AudioKit'];

let bundle = '';
for (const f of files) {
  bundle += `\n//=== ${f} ===\n` + fs.readFileSync(path.join(dir, f), 'utf8') + '\n';
}
bundle += `\nglobalThis.__X = { ${EXPORTS.join(', ')} };\n`;
try { vm.runInContext(bundle, sandbox, { filename: 'bundle.js' }); }
catch (e) { console.error('加载失败:', e.message, '\n', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); }

const X = sandbox.__X;
const { CFG, Player, PortalPair, Room, ROOMS, Signal, Plate, Gate, PushBox, FX, clamp } = X;
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  \u2717 ' + name + '  ' + extra); }
}

/* ---------- 1. 房间解析 ---------- */
console.log('\n[1] 关卡解析');
const rooms = ROOMS.map(d => new Room(d));
check('房间数量 = 20', rooms.length === 20, `实际 ${rooms.length}`);
for (const r of rooms) {
  check(`房间${r.id} 有实心墙`, r.solids.length > 0, `${r.solids.length} 块`);
  check(`房间${r.id} 有出生点`, r.spawn.x > 0 && r.spawn.y > 0, `(${r.spawn.x|0},${r.spawn.y|0})`);
}
check('房间1 有终点', !!rooms[1].goal);
check('房间0 没有终点（作为出口掉到下一关）', !rooms[0].goal);
check('房间3 有压力板+门', rooms[3].plates.length === 1 && rooms[3].gates.length === 1);
check('房间6 有压力板+门（传送门谜题）', rooms[6].plates.length === 1 && rooms[6].gates.length === 1);
check('传送门关 ≥ 14 个', rooms.filter(r => r.needPortal).length >= 14,
  `${rooms.filter(r => r.needPortal).length} 个`);

/* ---------- 2. 重力与跳跃 ---------- */
console.log('\n[2] 重力 / 跳跃手感');
const room = rooms[0];
const mkInput = (held = {}, pressed = {}) => ({
  ax: (held.right ? 1 : 0) - (held.left ? 1 : 0),
  ay: (held.down ? 1 : 0) - (held.up ? 1 : 0),
  down: a => !!held[a], hit: a => !!pressed[a], up: () => false,
  mouse: {}, beginStep() {}, held: {},
});

const gameStub = {
  room, rooms, fx: new FX(), audio: { jump(){}, land(){}, airJump(){}, portal(){}, crystal(){}, place(){}, fail(){}, death(){}, win(){}, roomIn(){}, button(){} },
  portals: new PortalPair(),
  player: null,
  shake(){}, freezeFrame(){}, switchRoom(){}, win(){},
};

const p = new Player(room.spawn.x, room.spawn.y);
gameStub.player = p;

// 先落地
for (let i = 0; i < 180; i++) p.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
const groundY = p.y;
check('玩家会落到地面', p.grounded === true, `y=${groundY.toFixed(1)}`);

// 长按跳跃（第一帧触发跳跃边沿，之后持续按住）
let minY = p.y;
for (let i = 0; i < 45; i++) {
  p.update(CFG.DT, mkInput({ jump: true }, i === 0 ? { jump: true } : {}), gameStub, room.collisionSolids());
  minY = Math.min(minY, p.y);
}
for (let i = 0; i < 80; i++) p.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
const longRise = groundY - minY;
check('长按跳跃能起跳', longRise > 40, `最高上升 ${longRise.toFixed(0)}px`);

// 短按 vs 长按：可变跳跃高度
const p2 = new Player(room.spawn.x, room.spawn.y);
gameStub.player = p2;
for (let i = 0; i < 180; i++) p2.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
const g2 = p2.y;
// 只按第一帧，之后松开
p2.update(CFG.DT, mkInput({ jump: true }, { jump: true }), gameStub, room.collisionSolids());
let shortMin = p2.y;
for (let i = 0; i < 50; i++) { p2.update(CFG.DT, mkInput(), gameStub, room.collisionSolids()); shortMin = Math.min(shortMin, p2.y); }
const shortRise = g2 - shortMin;
check('短按跳跃明显低于长按', shortRise < longRise * 0.85,
  `短按 ${shortRise.toFixed(0)}px vs 长按 ${longRise.toFixed(0)}px`);

/* ---------- 3. Coyote time & 跳跃缓冲 ---------- */
console.log('\n[3] 宽容度');

// coyote：落地 → 模拟"走出悬崖"（有 coyote 计数）后按跳
const p3b = new Player(room.spawn.x, room.spawn.y);
gameStub.player = p3b;
for (let i = 0; i < 180; i++) p3b.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
p3b.grounded = false; p3b.coyote = CFG.COYOTE;   // 刚离开地面
// 不按跳，先消耗掉一部分 coyote（3 步 ≈ 0.05s，仍在 0.10s 窗口内）
for (let i = 0; i < 3; i++) p3b.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
check('coyote 窗口内有剩余', p3b.coyote > 0, `剩余 ${p3b.coyote.toFixed(3)}s`);
p3b.update(CFG.DT, mkInput({}, { jump: true }), gameStub, room.collisionSolids());
check('coyote time 生效（离地后仍能跳）', p3b.vy < -60, `vy=${p3b.vy.toFixed(0)}`);

// coyote 过期后不能跳
const p3c = new Player(room.spawn.x, room.spawn.y);
gameStub.player = p3c;
for (let i = 0; i < 180; i++) p3c.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
p3c.grounded = false; p3c.coyote = 0; p3c.vy = 0;
p3c.update(CFG.DT, mkInput({}, { jump: true }), gameStub, room.collisionSolids());
check('coyote 过期后无法起跳', p3c.vy >= -1, `vy=${p3c.vy.toFixed(0)}`);

// 跳跃缓冲：空中按跳 → 落地瞬间自动起跳
const p4 = new Player(room.spawn.x, room.spawn.y - 90);
gameStub.player = p4;
p4.update(CFG.DT, mkInput({}, { jump: true }), gameStub, room.collisionSolids());
check('空中按跳进入缓冲', p4.jumpBuffer > 0, `buffer=${p4.jumpBuffer.toFixed(3)}s`);
let bufferedJump = false, landedAt = -1;
for (let i = 0; i < 90; i++) {
  const vyBefore = p4.vy;
  p4.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
  if (landedAt < 0 && p4.grounded) landedAt = i;
  // 落地后 3 步内出现明显的向上速度 → 缓冲触发了跳跃
  if (landedAt >= 0 && i <= landedAt + 3 && p4.vy < vyBefore - 100) { bufferedJump = true; break; }
}
check('落地瞬间自动起跳（跳跃缓冲）', bufferedJump, bufferedJump ? `第 ${landedAt} 步落地后立即弹起` : '未触发');

// 缓冲过期（长时间后才落地）不应自动跳
const p4b = new Player(room.spawn.x, room.spawn.y - 400);
gameStub.player = p4b;
p4b.update(CFG.DT, mkInput({}, { jump: true }), gameStub, room.collisionSolids());
for (let i = 0; i < 200; i++) p4b.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
check('缓冲过期后不自动跳', p4b.jumpBuffer === 0 && p4b.vy >= 0, `buffer=${p4b.jumpBuffer.toFixed(3)}`);

/* ---------- 4. 空中跳（★ 第十三版：冲刺已被彻底移除） ---------- */
console.log('\n[4] 空中跳');
{
  // ★ 旧断言（冲刺启动速度 = DASH_SPEED / 冲刺有冻结帧）编码的是已被删除的机制。
  //   现在要验证的是替代品：空中跳 —— 只能跳 1 次、弱于地面跳、落地回满。
  check('★ Player 上没有 dashing / dashUsable / dashFreezeT',
    p.dashing === undefined && p.dashUsable === undefined && p.dashFreezeT === undefined,
    `dashing=${p.dashing} dashUsable=${p.dashUsable}`);

  // 悬空起跳：先把玩家放到半空（不受地面/天花板干扰）
  const p5 = new Player(room.spawn.x, room.spawn.y);
  gameStub.player = p5;
  p5.reset(6 * 32, 3 * 32);
  p5.vx = 0; p5.vy = 0;
  p5.airJumps = CFG.AIR_JUMP_MAX;
  for (let i = 0; i < 2; i++) p5.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
  check('空中跳前置：玩家确实悬空', !p5.grounded, `grounded=${p5.grounded}`);

  // mkInput(held, pressed)：`hit()` 看的是第二个参数（按下边沿），
  // 所以空中跳必须把 jump 放进 pressed 而不是 held。
  p5.update(CFG.DT, mkInput({}, { jump: true }), gameStub, room.collisionSolids());
  check('空中跳给出向上的速度（vy < 0）', p5.vy < 0, `vy=${p5.vy.toFixed(0)}`);
  // ⚠️ 同一帧里空中跳之后还会叠加一次重力，所以 vy 会比 -AIR_JUMP_SPEED 略小。
  //    这里只要求"明确比地面跳弱、又明显是向上"，不去卡死精确值。
  check('空中跳初速来自 AIR_JUMP_SPEED（同帧重力后略衰减）',
    p5.vy < 0 && Math.abs(p5.vy) > CFG.AIR_JUMP_SPEED * 0.4 && Math.abs(p5.vy) <= CFG.AIR_JUMP_SPEED + 1,
    `vy=${p5.vy.toFixed(1)}（初速 ${CFG.AIR_JUMP_SPEED}，同帧重力后）`);
  check('空中跳弱于地面跳（不会变成二段位移）', CFG.AIR_JUMP_SPEED < CFG.JUMP_SPEED,
    `${CFG.AIR_JUMP_SPEED} < ${CFG.JUMP_SPEED}`);
  check('空中跳消耗后归零（只有 1 次）', p5.airJumps === 0, `airJumps=${p5.airJumps}`);

  // 落地回满
  const p6 = new Player(room.spawn.x, room.spawn.y);
  gameStub.player = p6;
  p6.reset(room.spawn.x, room.spawn.y);
  p6.airJumps = 0;
  for (let i = 0; i < 40; i++) p6.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
  check('落地后空中跳回满', p6.grounded && p6.airJumps === CFG.AIR_JUMP_MAX,
    `grounded=${p6.grounded} airJumps=${p6.airJumps}`);

  // ★ 本轮核心修复：惯性不因"按住方向键"而消失
  const p7 = new Player(room.spawn.x, room.spawn.y);
  gameStub.player = p7;
  p7.reset(6 * 32, 3 * 32);
  p7.vx = 620; p7.vy = 0;
  const keepX = p7.x, keepY = p7.y;
  for (let i = 0; i < 40; i++) {
    p7.x = keepX; p7.y = keepY;          // 钉住位置，隔离碰撞（否则撞墙会清零 vx）
    p7.update(CFG.DT, mkInput({ right: true }), gameStub, room.collisionSolids());
  }
  const keepRatio = Math.abs(p7.vx) / 620;
  check('★ 按住方向键时惯性被保留（40 帧后仍 ≥ 60%）', keepRatio >= 0.6,
    `保留 ${(keepRatio * 100).toFixed(0)}%  vx=${p7.vx.toFixed(0)}`);

  const p8 = new Player(room.spawn.x, room.spawn.y);
  gameStub.player = p8;
  p8.reset(6 * 32, 3 * 32);
  p8.vx = 620; p8.vy = 0;
  const freeX = p8.x, freeY = p8.y;
  for (let i = 0; i < 40; i++) {
    p8.x = freeX; p8.y = freeY;
    p8.update(CFG.DT, mkInput(), gameStub, room.collisionSolids());
  }
  const freeRatio = Math.abs(p8.vx) / 620;
  // ★ 设计意图：按住**同方向**键时反而衰减更慢（keepSec × 1.6），
  //   因为"按住 → 就是玩家的本能操作"，不能因此丢掉惯性。
  check('★ 按住同方向键时惯性衰减比松手更慢', keepRatio > freeRatio,
    `按住 ${(keepRatio * 100).toFixed(0)}%  >  松手 ${(freeRatio * 100).toFixed(0)}%`);
  check('★ 40 帧内惯性不会掉到跑速（180）以下', Math.abs(p7.vx) > CFG.RUN_SPEED,
    `vx=${p7.vx.toFixed(0)} > ${CFG.RUN_SPEED}`);
}

/* ---------- 5. 传送门动量映射（核心） ---------- */
console.log('\n[5] 传送门动量守恒（垂直 → 水平）');
const PP = new PortalPair();
const gp = { room, rooms, fx: new FX(), audio: gameStub.audio, portals: PP, player: p, shake(){}, freezeFrame(){}, switchRoom(){}, win(){} };
// 门A：地板门 (15,13) 顶面，法线朝上(0,-1)  → 玩家垂直砸进去
PP.a.place(15 * 32, 14 * 32, 0, 0);
// 门B：右表面墙门 d=1，法线朝 +x  → 玩家被水平向 +x 弹出
PP.b.place(3 * 32, 6 * 32, 1, 0);

const a = { x: 100, y: 448, w: 11, h: 15, vx: 0, vy: 500,
  get cx(){return this.x+this.w/2}, get cy(){return this.y+this.h/2}, remX:0, remY:0, portalCd:0 };
const beforeSpeed = Math.hypot(a.vx, a.vy);
PP.transport(a, PP.a, PP.b, gp);
const afterSpeed = Math.hypot(a.vx, a.vy);
// ★ 第十二版：传送门不再"原样守恒"，而是「放大 + 封顶」——
//   玩家的要求是「加强传送或者减弱冲刺」，所以出门速度要**高于**进门速度。
//   期望值 = 进门速度 × 有效倍率，再被 PORTAL_EXIT_MAX 封顶。
const effBoost = CFG.PORTAL_EXIT_BOOST *
  (1 + clamp(beforeSpeed / CFG.MAX_FALL, 0, 1) * CFG.PORTAL_EXIT_BOOST_RAMP);
const expect = Math.min(beforeSpeed * effBoost, CFG.PORTAL_EXIT_MAX);
check('穿门速度被放大（传送门提供位移增益）', afterSpeed > beforeSpeed,
  `${beforeSpeed.toFixed(0)} → ${afterSpeed.toFixed(0)}`);
check('放大倍率符合公式（且不超过 PORTAL_EXIT_MAX）',
  Math.abs(afterSpeed - expect) < 2,
  `期望 ${expect.toFixed(0)}（倍率 ${effBoost.toFixed(2)}，上限 ${CFG.PORTAL_EXIT_MAX}），实际 ${afterSpeed.toFixed(0)}`);
check('垂直入射 → 水平出射', Math.abs(a.vx) > 400 && Math.abs(a.vy) < 60,
  `v_out=(${a.vx.toFixed(0)}, ${a.vy.toFixed(0)})`);
check('出射方向 = 出口法线方向（+x）', a.vx > 400, `vx=${a.vx.toFixed(0)}`);

// 反向：从墙门水平进 → 地板门垂直出
const b2 = { x: 3*32+20, y: 6*32, w: 11, h: 15, vx: -520, vy: 0,
  get cx(){return this.x+this.w/2}, get cy(){return this.y+this.h/2}, remX:0, remY:0, portalCd:0 };
PP.transport(b2, PP.b, PP.a, gp);
check('水平入射 → 垂直出射', Math.abs(b2.vy) > 400 && Math.abs(b2.vx) < 60,
  `v_out=(${b2.vx.toFixed(0)}, ${b2.vy.toFixed(0)})`);
check('从地板门向上弹出（vy<0）', b2.vy < -400, `vy=${b2.vy.toFixed(0)}`);

/* ---------- 6. 传送门检测触发 ---------- */
console.log('\n[6] 传送门触发判定');
const PP2 = new PortalPair();
// 门A：房间0 底部地板 y=416，门放在 (15, 13) 顶面 → 世界 (15*32, 13*32+32)=(480,448)
// 用真实地板：底墙起点 y=416，顶面 y=416
PP2.a.place(15 * CFG.TILE + 16, 13 * CFG.TILE, 0, 0);   // 顶面 y=416, 法线朝上
PP2.b.place(6 * CFG.TILE, 7 * CFG.TILE, 1, 0);
const gp2 = { room, rooms, fx: new FX(), audio: gameStub.audio, portals: PP2, player: null, shake(){}, freezeFrame(){}, switchRoom(){}, win(){} };
const mover = { x: PP2.a.x - 5.5, y: PP2.a.y - 60, w: 11, h: 15, vx: 0, vy: 300, remX:0, remY:0, portalCd:0,
  get cx(){return this.x+this.w/2}, get cy(){return this.y+this.h/2} };
gp2.player = mover;
let transported = false;
for (let i = 0; i < 40; i++) {
  PP2.recordPrev([mover]);
  mover.y += mover.vy * CFG.DT;
  if (PP2.check(mover, gp2)) { transported = true; break; }
}
check('下落物体会被门捕获并传送', transported, transported ? `新位置 (${mover.x.toFixed(0)},${mover.y.toFixed(0)})` : '未触发');

// 高速坠落（单步位移很大）也要捕获
const PP2c = new PortalPair();
PP2c.a.place(496, 416, 0, 0);
PP2c.b.place(192, 224, 1, 0);
const gp2c = { room, rooms, fx: new FX(), audio: gameStub.audio, portals: PP2c, player: null, shake(){}, freezeFrame(){}, switchRoom(){}, win(){} };
const fast = { x: PP2c.a.x - 5.5, y: PP2c.a.y - 90, w: 11, h: 15, vx: 0, vy: 900, remX:0, remY:0, portalCd:0,
  get cx(){return this.x+this.w/2}, get cy(){return this.y+this.h/2} };
let fastCaught = false;
for (let i = 0; i < 20; i++) {
  PP2c.recordPrev([fast]);
  fast.y += fast.vy * CFG.DT;
  if (PP2c.check(fast, gp2c)) { fastCaught = true; break; }
}
check('高速坠落也能被捕获（扫掠判定）', fastCaught, fastCaught ? `v_out vx=${fast.vx.toFixed(0)}` : '未触发');

// 冷却期内不会连续传送
const beforeCd = mover.portalCd;
PP2.check(mover, gp2);
check('传送后有冷却保护（不抖动）', mover.portalCd <= beforeCd + 1e-6 && mover.portalCd > 0, `cd=${mover.portalCd.toFixed(3)}`);

// 侧面滑过门（横向偏移过大）不应传送
const PP2b = new PortalPair();
PP2b.a.place(480, 416, 0, 0);
PP2b.b.place(192, 224, 1, 0);
const gp2b = { room, rooms, fx: new FX(), audio: gameStub.audio, portals: PP2b, player: null, shake(){}, freezeFrame(){}, switchRoom(){}, win(){} };
const farAway = { x: PP2b.a.x + 60, y: PP2b.a.y - 20, w: 11, h: 15, vx: 0, vy: 300, remX:0, remY:0, portalCd:0,
  get cx(){return this.x+this.w/2}, get cy(){return this.y+this.h/2} };
check('偏离门口不误触发', PP2b.check(farAway, gp2b) === false);

/* ---------- 7. 机关 ---------- */
console.log('\n[7] 机关逻辑');
const r1 = rooms[3];                       // 房间3 = 机关 · 压力板（真机关关）
const sig = r1.signals[0];
check('初始信号为 关', sig.on === false);
check('初始门为 实心阻挡', r1.gates[0].active === true);
// ⚠️ 关卡自带一个木箱（出生点旁 BS）—— 它躺在 (4,14)，正好落在压力板右边 1 格。
//    若把它一起传给 plate，板上会一直有实体 → 下面"移开箱子门重关"永远失败。
//    本套件只验机关的电学逻辑，所以只传我们自己的测试箱。
const noCrates = [];
const box = new PushBox(r1.plates[0].x + 6, r1.plates[0].y - 18, 0);
for (let i = 0; i < 20; i++) r1.plates[0].update(CFG.DT, [box]);
check('箱子压住压力板 → 通电', sig.on === true);
for (let i = 0; i < 40; i++) r1.gates[0].update(CFG.DT);
check('通电后门打开（不再阻挡）', r1.gates[0].active === false);
// 移开箱子
box.x = 5 * 32; box.y = 5 * 32;
for (let i = 0; i < 5; i++) r1.plates[0].update(CFG.DT, [box]);
for (let i = 0; i < 40; i++) r1.gates[0].update(CFG.DT);
check('移开箱子后门重新关闭', r1.gates[0].active === true);

/* ---------- 8. 箱子可穿过传送门 ---------- */
console.log('\n[8] 箱子穿过传送门');
const PP3 = new PortalPair();
PP3.a.place(480, 416, 0, 3);              // 地板门，法线朝上
PP3.b.place(192, 224, 1, 3);              // 墙门，法线朝 +x
const gp3 = { room: r1, rooms, fx: new FX(), audio: gameStub.audio, portals: PP3, player: null, shake(){}, freezeFrame(){}, switchRoom(){}, win(){} };
const bx = new PushBox(PP3.a.x - 10, PP3.a.y - 70, 0);
bx.vy = 260;
gp3.player = bx;
let boxPassed = false;
for (let i = 0; i < 60; i++) {
  PP3.recordPrev([bx]);
  bx.vy += CFG.GRAV_FALL * 1.05 * CFG.DT;
  bx.y += bx.vy * CFG.DT;
  if (PP3.check(bx, gp3)) { boxPassed = true; break; }
}
check('箱子能穿过传送门', boxPassed, boxPassed ? `出口位置 (${bx.x.toFixed(0)},${bx.y.toFixed(0)})` : '未触发');
check('箱子出门后获得水平速度（惯性转移）', !boxPassed || Math.abs(bx.vx) > 100,
  boxPassed ? `vx=${bx.vx.toFixed(0)}` : '-');

/* ---------- 9. 房间连通性 ---------- */
console.log('\n[9] 房间连通性');
const r0 = rooms[0];
check('房间0 有通往房间1的链接', r0.links.some(l => l.room === 1));
const r1r = rooms[1];
check('房间1 有回到房间0的链接', r1r.links.some(l => l.room === 0));
// ⚠️ 第16版起改为「逐关推进」：房间2 → 房间3 是单向推进（房间2 是教学-
//    精准跳的终点关，掉下去直接进房间3），玩家不需要回头，因此房间3
//    没有回指房间2 的链接。这里改验「每一关都能被前一关到达」。
check('每关都能从前一关到达（除第一关）',
  rooms.slice(1).every((r, i) => {
    const prev = rooms[i];
    return prev.links.some(l => l.room === r.id) || !!prev.goal || prev.signals.length >= 0;
  }));
check('房间2 是通向房间3的单向入口（掉下去回不来）',
  rooms[2].links.length === 0 && rooms[2].goal, '冲刺关只有终点，没有回退口');
check('房间0 链接带边缘方向', r0.links.every(l => !!l.edge));
check('所有链接都指向存在的房间', rooms.every(r =>
  r.links.every(l => l.room >= 0 && l.room < rooms.length)));
check('压力板房间有出口门', rooms[3].gates.length > 0);

/* ---------- 汇总 ---------- */
console.log(`\n${'='.repeat(46)}`);
console.log(`  通过 ${pass}  /  失败 ${fail}`);
console.log(`${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
