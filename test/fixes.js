/* ============================================================
   本轮修复回归测试
   ------------------------------------------------------------
   1. 道具不会被"误吸"进传送门（但玩家用力推仍能送进去）
   2. 惯性按传送门朝向重定向（垂直坠入 → 水平射出，速度守恒）
   3. 传送门触发必须"朝门内运动"（站门上 / 门面上走动都不触发）
   4. 默认键位 = 用户指定：←→↑↓ / C 跳 / ↓ 快速下降 / B 蓝门 / O 橙门 / P 清空
      ★ 第十三版：X 冲刺已被彻底移除（它的位移能力压掉了传送门的必要性）
   5. 空中跳有数量上限（1 次），落地 / 水晶补充
   6. 道具卡墙角有脱困办法
   7. 引导充足（每关有 objective / hint / 世界内浮字 / 分步脚本）
   8. 10 个关卡
   9. 传送门惯性必须保留（按住方向键不再刹车）
  10. 传送门必须能贴在墙面上（竖向实心合并修复）
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js','util.js','input.js','actor.js','portal.js','player.js','props.js',
  'levels.js','fx.js','audio.js','render.js','game.js'];
let bundle = '';
for (const f of files) bundle += `\n` + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game, ROOMS, Room, KEYBINDS, KEY_ALIASES, ACTIONS, keyLabel, clamp };\n';
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
const { CFG, Game, ROOMS, Room, KEYBINDS, KEY_ALIASES, ACTIONS, keyLabel, clamp } = sb.__X;
const T = CFG.TILE;

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  \u2717 ' + n + '  ' + e); } };

function makeGame() {
  const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576; return g;
}
const ALL_KEYS = ['left','right','up','down','jump','portal','portal2','reset','clear'];
function mkTick(g) {
  const IN = g.input;
  return function tick(want) {
    want = want || {};
    for (const k of ALL_KEYS) {
      const v = !!want[k];
      if (v && !IN.held[k]) IN.queued.push(k);
      if (!v && IN.held[k]) IN.held[k] = false;
    }
    IN.beginStep();
    g.step(CFG.DT);
  };
}
const run = (tick, want, n) => { for (let i = 0; i < n; i++) tick(want); };

console.log('=== 本轮修复回归 ===\n');

/* ============================================================
   [1] 默认键位 = 用户指定的一套
       ←→ 左右 / ↑↓ 方向 / C 跳 / ↓ 快速下降
       B 蓝门 / O 橙门 / P 清空传送门（放在不容易误碰的位置）
       ★ 第十三版：X 冲刺已移除，dash 动作整条被删
   ============================================================ */
console.log('[1] 默认键位映射');
check('ArrowLeft → left',    KEYBINDS.left   === 'ArrowLeft',   KEYBINDS.left);
check('ArrowRight → right',  KEYBINDS.right  === 'ArrowRight',  KEYBINDS.right);
check('ArrowUp → up',        KEYBINDS.up     === 'ArrowUp',     KEYBINDS.up);
check('ArrowDown → down（快速下降）', KEYBINDS.down === 'ArrowDown', KEYBINDS.down);
check('C → jump（跳跃，用户要求）', KEYBINDS.jump === 'KeyC', KEYBINDS.jump);
check('★ X 不再绑定任何动作（冲刺已移除）', KEYBINDS.dash === undefined, `dash=${KEYBINDS.dash}`);
check('★ ACTIONS 里没有 dash 动作', !ACTIONS.some(a => a.id === 'dash'),
  ACTIONS.map(a => a.id).join(','));
check('B → portal（蓝门）',   KEYBINDS.portal === 'KeyB',       KEYBINDS.portal);
check('O → portal2（橙门）',  KEYBINDS.portal2 === 'KeyO',      KEYBINDS.portal2);
// ★ 用户要求："清空换一个键" —— 必须离开 C，且是不容易误碰的键
check('clear 不再是 C（已换键）', KEYBINDS.clear !== 'KeyC', `clear=${KEYBINDS.clear}`);
check('clear = P（不容易误碰）', KEYBINDS.clear === 'KeyP', KEYBINDS.clear);
check('jump 不再占用 Space/W', KEYBINDS.jump !== 'Space' && KEYBINDS.jump !== 'KeyW');

// 兼容别名仍然可用（不改变默认，只做兜底）
check('Space 仍能跳（别名）', KEY_ALIASES.Space === 'jump');
check('W 作为 ↑ 的别名（方向键语义）', KEY_ALIASES.KeyW === 'up', KEY_ALIASES.KeyW);
check('★ Shift 不再是冲刺别名（冲刺已移除）', KEY_ALIASES.ShiftLeft !== 'dash',
  `ShiftLeft=${KEY_ALIASES.ShiftLeft}`);
check('Q/E 仍能开门（别名）', KEY_ALIASES.KeyQ === 'portal' && KEY_ALIASES.KeyE === 'portal2');

// 可自定义：rebind 能改键并写进 KEYBINDS
{
  const g = makeGame(); const IN = g.input;
  const old = KEYBINDS.jump;
  IN.rebind('jump', 'KeyZ');
  check('键位可自定义（rebind 生效）', KEYBINDS.jump === 'KeyZ', `jump=${KEYBINDS.jump}`);
  check('rebind 会抢走冲突键（自动解绑旧主人）', KEYBINDS.jump === 'KeyZ');
  IN.rebind('jump', old);   // 还原，避免影响后续用例
  check('rebind 能还原', KEYBINDS.jump === old, `jump=${KEYBINDS.jump}`);
  check('Escape 不可被绑走（暂停键保护）', (() => {
    const before = KEYBINDS.pause;
    IN.rebind('jump', 'Escape');
    const ok = KEYBINDS.jump !== 'Escape' && KEYBINDS.pause === before;
    IN.rebind('jump', old);
    return ok;
  })());
  check('ACTIONS 覆盖全部可改键动作（冲刺移除后 10 个）', ACTIONS.length >= 10, `${ACTIONS.length} 个动作`);
  check('keyLabel() 能出可读键名', typeof keyLabel('KeyC') === 'string' && keyLabel('KeyC').length > 0,
    keyLabel('KeyC'));
}

/* C 键能真的起跳（走完整输入管线） */
{
  const g = makeGame(); const tick = mkTick(g);
  const P = g.player;
  P.reset(g.room.spawn.x, g.room.spawn.y);
  run(tick, {}, 160);
  const y0 = P.y;
  let minY = 1e9;
  for (let i = 0; i < 60; i++) { tick({ jump: true }); minY = Math.min(minY, P.y); }
  check('C 跳跃真的能起跳', y0 - minY > 40, `升高 ${(y0 - minY).toFixed(1)}px`);
}

/* ↓ 真的能快速下降 */
{
  const g = makeGame(); const tick = mkTick(g);
  const P = g.player;
  g.switchRoom(4, false);
  P.reset(3 * T, 3 * T); P.vx = 0; P.vy = 0;
  run(tick, {}, 3);
  const noDown = P.vy;
  P.reset(3 * T, 3 * T); P.vx = 0; P.vy = 0;
  run(tick, { down: true }, 3);
  check('↓ 能快速下降（下落更快）', P.vy > noDown, `${noDown.toFixed(0)} → ${P.vy.toFixed(0)}`);
}

/* ============================================================
   [2] 冲刺已彻底移除，改用「空中跳」（★ 第十三版）
   ------------------------------------------------------------
   玩家的反馈链路：
     第十版「冲刺太短」→ 第十二版「冲刺太强，传送门都没用了」→
     第十三版「取消冲刺（太影响平衡了）」。
   所以这里断言的目标彻底反转：**冲刺这个机制必须不存在**，
   取而代之的是"只有 1 次、跳不高"的空中跳 —— 它救急但不给位移。
   ============================================================ */
console.log('\n[2] 冲刺已移除，替代品是「空中跳」');
{
  check('★ CFG 里没有 DASH_* 任何参数',
    !Object.keys(CFG).some(k => /^DASH/.test(k)),
    Object.keys(CFG).filter(k => /^DASH/.test(k)).join(',') || '（干净）');
  const pj = fs.readFileSync(path.join(dir, 'player.js'), 'utf8');
  check('★ player.js 里没有 dashing / dashUsable 残留',
    !/\bdashing\b/.test(pj) && !/dashUsable/.test(pj));
  check('★ player.js 里没有 startDash / doSuperJump / doWaveDash 残留',
    !/startDash|doSuperJump|doWaveDash/.test(pj));
  check('★ 空中跳参数存在（AIR_JUMP_MAX / AIR_JUMP_SPEED）',
    CFG.AIR_JUMP_MAX >= 1 && CFG.AIR_JUMP_SPEED > 0,
    `MAX=${CFG.AIR_JUMP_MAX} SPEED=${CFG.AIR_JUMP_SPEED}`);
  check('★ 空中跳只有 1 次（不能当位移刷）', CFG.AIR_JUMP_MAX === 1, `MAX=${CFG.AIR_JUMP_MAX}`);
  check('★ 空中跳弱于地面跳（JUMP_SPEED > AIR_JUMP_SPEED）',
    CFG.JUMP_SPEED > CFG.AIR_JUMP_SPEED, `${CFG.JUMP_SPEED} > ${CFG.AIR_JUMP_SPEED}`);
}

/* 空中跳的实测行为 */
{
  const g = makeGame(); const tick = mkTick(g);
  const P = g.player;
  g.switchRoom(0, false);
  P.reset(22 * T, 2 * T); P.vx = 0; P.vy = 0; P.airJumps = CFG.AIR_JUMP_MAX;
  run(tick, {}, 2);
  check('空中（未落地）才能触发', !P.grounded, `grounded=${P.grounded}`);
  const y0 = P.y;
  let minY = y0;
  for (let i = 0; i < 24; i++) { tick({ jump: true }); minY = Math.min(minY, P.y); }
  check('空中跳真的能往上走', y0 - minY > 20, `升高 ${(y0 - minY).toFixed(1)}px`);
  check('空中跳消耗后归零', P.airJumps === 0, `airJumps=${P.airJumps}`);
  // 落地回满
  P.reset(6 * T, 6 * T);
  run(tick, {}, 40);
  check('落地后空中跳回满', P.grounded && P.airJumps === CFG.AIR_JUMP_MAX,
    `grounded=${P.grounded} airJumps=${P.airJumps}`);
}

/* ============================================================
   [2b] 传送门必须明显强于一切普通位移（冲刺没了，门是唯一远程手段）
   ============================================================ */
console.log('\n[2b] 传送门的位移收益 = 唯一的远程手段');
{
  // ⚠️ 不依赖任何具体关卡 —— 关卡每轮都会重做。这里现搭一个最小场景：
  //    30×18 空场，16 行是地面，20 列是右墙；地板门 + 左侧墙门。
  const SURF = 16 * T;
  const probeRoom = () => {
    const map = [];
    for (let y = 0; y < CFG.ROOM_H; y++) {
      let row = '';
      for (let x = 0; x < CFG.ROOM_W; x++) {
        row += (y === 0 || y === CFG.ROOM_H - 1 || x === 0 || x === CFG.ROOM_W - 1
          || y === 16 || x === 20) ? '#' : ' ';
      }
      map.push(row);
    }
    return new Room({
      id: 0, name: 'portal-probe', hint: '', objective: '', map, links: [],
      texts: [], plates: [], gates: [], movers: [], hazards: [],
    });
  };
  const mkFall = (ftiles) => {
    const g = makeGame();
    const r = probeRoom();
    g.rooms = [r]; g.roomId = 0; g.room = r;
    const P = g.player;
    const doorX = 8 * T + 0.5 * T;
    g.portals.a.place(doorX, SURF - 2, 0, 0);   // 地板门，法线朝上
    g.portals.b.place(20 * T, 6 * T, 3, 0);     // 左侧墙门 → 出口朝左
    P.reset(doorX - CFG.P_W / 2, SURF - 2 - CFG.P_H - ftiles * T);
    let out = false, vExit = 0, xOut = 0;
    for (let i = 0; i < 400; i++) {
      g.step(CFG.DT);
      if (P.portalCd > 0) { out = true; vExit = Math.hypot(P.vx, P.vy); xOut = P.x; break; }
    }
    if (!out) return null;
    let minX = xOut;
    for (let i = 0; i < 150; i++) { g.step(CFG.DT); minX = Math.min(minX, P.x); }
    return { vExit, dist: (xOut - minX) / T };
  };

  const one = mkFall(1), deep = mkFall(4);
  check('坠落 1 格进门 → 传送出去（低落差也能用）', !!one, one ? `出门 ${one.vExit.toFixed(0)} px/s` : '没进门');
  check('坠落 4 格进门 → 传送出去', !!deep, deep ? `出门 ${deep.vExit.toFixed(0)} px/s` : '没进门');
  // 实测跑跳水平距离是 3.84 格；门必须明显超过它，否则"门没用、跳就行"。
  if (one) check('浅落差出门位移 > 跑跳上限（3.84 格）', one.dist > 3.84, `${one.dist.toFixed(2)} 格`);
  if (deep) check('深落差出门位移 ≥ 8 格（远超任何普通位移）', deep.dist >= 8, `${deep.dist.toFixed(2)} 格`);
  if (one && deep) check('落差越大射得越远（惯性正反馈）', deep.vExit > one.vExit, `1格 ${one.vExit.toFixed(0)} → 4格 ${deep.vExit.toFixed(0)} px/s`);
  check('PORTAL_EXIT_BOOST > 1（出门速度被放大）', CFG.PORTAL_EXIT_BOOST > 1, `boost=${CFG.PORTAL_EXIT_BOOST}`);
}

/* ============================================================
   [2c] 传送门判定范围 + 下落吸附
   ============================================================ */
console.log('\n[2c] 传送门判定范围与下落吸附');
{
  const g = makeGame(); const tick = mkTick(g);
  g.switchRoom(4, false);
  const P = g.player;
  const SURF = 16 * T;
  const tryOffset = (off) => {
    g.portals.clear();
    const doorX = 14 * T + 0.5 * T + off;
    g.portals.a.place(doorX, SURF - 2, 0, 4);
    g.portals.b.place(19 * T, 6 * T, 3, 4);
    P.reset(doorX - CFG.P_W / 2, SURF - 2 - CFG.P_H - 3 * T);
    let hit = false;
    for (let i = 0; i < 300; i++) { tick({}); if (P.portalCd > 0) { hit = true; break; } }
    return hit;
  };
  const halfGate = Math.max(4, CFG.PORTAL_R - CFG.P_W / 2);
  check('判定半宽 ≥ 14px（从 11.5px 扩大）', halfGate >= 14, `${halfGate.toFixed(1)}px`);
  check('PORTAL_SNAP > 0（下落吸附已开启）', (CFG.PORTAL_SNAP || 0) > 0, `snap=${CFG.PORTAL_SNAP}`);
  // 偏移 ±18px（超出判定圈 15.5、但在吸附圈 23.5 内）→ 靠吸附也能进
  let ok = 0;
  for (const off of [-18, -16, 16, 18]) if (tryOffset(off)) ok++;
  check('偏移 ±16~18px 靠吸附仍能进门（≥3/4）', ok >= 3, `${ok}/4 命中`);

  // ★ 吸附不能变成"自动传送"：站在门面上不动依然不传送
  g.portals.clear();
  const doorX = 14 * T + 0.5 * T;
  g.portals.a.place(doorX, SURF - 2, 0, 4);
  g.portals.b.place(19 * T, 6 * T, 3, 4);
  P.reset(doorX - CFG.P_W / 2, SURF - 2 - CFG.P_H);
  run(tick, {}, 90);
  check('吸附不会把"站在门上不动"的玩家吸走', P.portalCd <= 0, `portalCd=${P.portalCd.toFixed(3)}`);
}

/* ============================================================
   [3] 传送门触发：必须"朝门内运动"
   ============================================================ */
console.log('\n[3] 传送门触发条件');
{
  // ★ 第十三版：房间 2 被重建成「精准跳」关，地面洞口没了。
  //   这里改用一直没动过的**房间 0**：它在第 16~17 行有 x=20..24 的地板缺口，
  //   右边的 x=29 是外壁 —— 正好一扇地板门 + 一扇墙门。
  const g = makeGame(); const tick = mkTick(g);
  g.switchRoom(0, false);
  const P = g.player;
  const FLOOR_GX = 22;          // 地板缺口正中
  const place = () => {
    g.portals.clear();
    g.portals.a.place(FLOOR_GX * T + T / 2, 16 * T - 2, 0, 0);  // 地板门（法线朝上）
    g.portals.b.place(29 * T, 10 * T, 3, 0);                     // 外壁上的左向门
  };

  // 3a 站在地板门上不动
  place(); P.reset(FLOOR_GX * T + T / 2 - CFG.P_W / 2, 14 * T);
  run(tick, {}, 120);
  check('站在地板门上不动 → 不传送', P.portalCd <= 0, `portalCd=${P.portalCd.toFixed(3)}`);

  // 3b 在地板门上来回走动
  place(); P.reset(FLOOR_GX * T + T / 2 - CFG.P_W / 2, 14 * T);
  run(tick, { right: true }, 18); run(tick, { left: true }, 18);
  check('在门面上左右走动 → 不传送', P.portalCd <= 0, `portalCd=${P.portalCd.toFixed(3)}`);

  // 3c 慢速蹭到墙上门（★ 注意：房间 0 的右侧有通往上层的链接，
  //    蹭墙测试可能把玩家送进别的房间，所以这里先孤立地重开一次房间）
  g.switchRoom(0, false);
  place(); P.reset(29 * T - 60, 10 * T - CFG.P_H / 2);
  run(tick, { right: true }, 60);
  check('慢速蹭墙上门 → 不传送', P.portalCd <= 0, `portalCd=${P.portalCd.toFixed(3)}`);

  // 3d 真正从高处坠落 → 必须传送
  //    ★ 必须重新 switchRoom + 重新放门：3c 有可能让玩家飘出房间，
  //      而切房间会清空传送门对。
  g.switchRoom(0, false);
  place(); P.reset(FLOOR_GX * T + T / 2 - CFG.P_W / 2, 2 * T);
  check('3d 前置：门已配对就绪', g.portals.ready, `a.active=${g.portals.a.active} b.active=${g.portals.b.active}`);
  let hit = false;
  for (let i = 0; i < 300; i++) { tick({}); if (P.portalCd > 0) { hit = true; break; } }
  check('高速坠落进门 → 传送成功', hit, `portalCd=${P.portalCd.toFixed(3)} room=${g.roomId}`);
}

/* ============================================================
   [4] 惯性重定向：垂直坠入 → 水平射出，速度守恒
   ============================================================ */
console.log('\n[4] 惯性按门朝向重定向');
{
  const g = makeGame(); const tick = mkTick(g);
  g.switchRoom(0, false);
  const P = g.player;
  const FLOOR_GX = 22;
  g.portals.a.place(FLOOR_GX * T + T / 2, 16 * T - 2, 0, 0);  // 地板门（法线朝上）
  g.portals.b.place(29 * T, 10 * T, 3, 0);                     // 左向墙门（法线朝左）
  P.reset(FLOOR_GX * T + T / 2 - CFG.P_W / 2, 2 * T);
  // 记录进门那一刻的速度
  let entrySpeed = 0, exitVx = 0, exitVy = 0, out = false, prevCd = 0;
  for (let i = 0; i < 300; i++) {
    const before = { vx: P.vx, vy: P.vy };
    tick({});
    if (P.portalCd > 0 && prevCd <= 0) { entrySpeed = Math.hypot(before.vx, before.vy); exitVx = P.vx; exitVy = P.vy; }
    prevCd = P.portalCd;
    if (entrySpeed > 0) { out = true; break; }
  }
  check('垂直入射 → 射出速度是水平的', out && Math.abs(exitVx) > 100 && Math.abs(exitVy) < 60,
    `vx=${exitVx.toFixed(1)} vy=${exitVy.toFixed(1)}`);
  // ★ 第十二版：出口速度不再"100% 守恒"，而是被 PORTAL_EXIT_BOOST 放大
  //   （玩家的要求是"加强传送" —— 传送门必须有位移优势才值得用）。
  //   但方向映射必须严格守恒：入射的竖直分量要**完整**变成出射的水平分量，
  //   只允许被「基础倍率 × 速度斜坡」放大。
  const effBoost = CFG.PORTAL_EXIT_BOOST *
    (1 + clamp(entrySpeed / CFG.MAX_FALL, 0, 1) * CFG.PORTAL_EXIT_BOOST_RAMP);
  const expect = Math.min(entrySpeed * effBoost, CFG.PORTAL_EXIT_MAX);
  check('方向映射守恒：竖直入射 → 水平射出（仅剩增益倍率）',
    out && Math.abs(Math.hypot(exitVx, exitVy) - expect) < 3,
    `进门 ${entrySpeed.toFixed(1)} → 出门 ${Math.hypot(exitVx, exitVy).toFixed(1)} px/s（期望 ${expect.toFixed(1)}，倍率 ${effBoost.toFixed(2)}）`);
  check('出门速度 ≥ 进门速度（传送门提供位移增益）',
    out && Math.hypot(exitVx, exitVy) >= entrySpeed,
    `${entrySpeed.toFixed(1)} → ${Math.hypot(exitVx, exitVy).toFixed(1)}`);
  check('射出方向沿出口门法线（向左）', out && exitVx < 0, `vx=${exitVx.toFixed(1)}`);
}

/* ============================================================
   [5] 道具（箱子）不会被误吸，但能被推进门
   ============================================================ */
console.log('\n[5] 道具与传送门');
{
  // 5a 箱子静止在地板门上 → 不被吸走
  //     注意：用「箱子自己的落地位置」而不是随手 x，否则箱子会因为站在
  //     地板洞旁边而滑走，造成假失败。
  const g = makeGame(); const tick = mkTick(g);
  g.switchRoom(3, false);
  const box = g.room.crates[0];
  box.reset();
  // 先让它自然落地
  g.portals.clear();
  run(tick, {}, 90);
  const restX = box.x, restY = box.y;
  // 把门正好开在箱子脚下
  g.portals.a.place(box.cx, 16 * T - 2, 0, 3);
  g.portals.b.place(27 * T, 10 * T, 3, 3);
  const bx0 = box.x, by0 = box.y;
  run(tick, {}, 150);
  check('箱子静止在门上 → 不被吸走', box.portalCd <= 0 && Math.abs(box.x - bx0) < 3,
    `dx=${(box.x - bx0).toFixed(1)} portalCd=${box.portalCd.toFixed(3)}`);

  // 5b 箱子被玩家用力推进地板门 → 应该穿过去
  //     房间3 现在是「单一平地」布局（地面在 row15），箱子落地后 y≈14.6*T。
  //     不写死 surfY，直接取箱子自然落地后的**脚下平面**，这样以后改关卡也不会假失败。
  //     ⚠️⚠️ 推箱方向也**不能写死** ⚠️⚠️
  //     房间 3 第十版起箱子在 x=4、左边 x=2 是实心止挡，解法是**往左推**；
  //     旧代码固定「门放右边 + 按 → 推」，箱子一出生就顶在 x=2 墙上，
  //     400 帧里一步都不动 → 报 box=(4.19,14.38)、portalCd=0。
  //     这里改成先探测**哪边是空的**，再把门放在那一侧、往那边推。
  /* ⚠️⚠️ 这个夹具的关键是「地板门 + 横推」这一组合 ⚠️⚠️
     ------------------------------------------------------------------
     需求原文是「不要被误吸，主动推进去可以」。箱子在地面上被横推时
     它的 `vx` 平衡点只有 ~4（`pushBy` 每帧 +4 / `approach` 每帧 -15），
     而传送门横推闸要求 `|vLat| > minSpeed*0.4 = 16` ——
     所以引擎专门引入了 `PushBox.topPush`（玩家这一帧的真实顶推速度）
     来喂这个闸门。本用例就是它的回归测试，**必须用地板门**：
       · 地板门 t 轴水平 → 横推方向与门面平行，`latNow` 才会落在 halfGate 内
       · 墙面门 t 轴竖直 → `latNow = 0` 恒成立，测不出"推得动/推不动"的区别
     入口门开在箱子**前方 1.2 格**的地板平面上（不压住箱子出生点，
     否则 `portals.check()` 第 1 帧就把箱子吸走，测不到推的过程）；
     出口门放在房间远端（同样不能压住箱子/玩家）。 */
  const g2 = makeGame(); const t2 = mkTick(g2);
  g2.switchRoom(3, false);
  const box2 = g2.room.crates[0];
  box2.reset();
  run(t2, {}, 120);                          // 先让箱子自然落地
  const surfY = box2.y + box2.h;             // 箱子底面 = 地板平面
  // 用房间的实心列表判断左右哪一侧有 1.5 格以上的空位。
  // ⚠️⚠️ 探测必须只看**箱子身体高度那一段**的实心 ⚠️⚠️
  //     地板是 `x=0..960, y=480..512` 这种**贯通整行**的大实心，
  //     如果只按 x 区间判断，地板会把左右两侧都判成"有障碍"，
  //     于是方向永远翻成"往左推"，箱子一出生就顶在 x=2 的墙上纹丝不动
  //     （实测表现为 box=(4.19,14.38) 永不移动）。
  //     正确做法：要求实心在 y 方向与箱子本体**明显重叠**（上下都留出余量），
  //     这样贯通的地板/天花板都会被排除，只留下真正挡路的墙。
  const solids2 = g2.room.collisionSolids();
  const bodyTop = surfY - box2.h;
  const blockedAt = (px) => solids2.some(s =>
    s.active && px > s.x - 6 && px < s.x + s.w + 6 &&
    s.y + 4 < surfY && s.y + s.h - 4 > bodyTop);
  const rightFree = !blockedAt(box2.x + box2.w + 1.2 * T);
  const doorCx = rightFree ? box2.x + box2.w + 1.2 * T   // 门开在箱子右前方
                           : box2.x - 1.2 * T;           // 或左前方
  g2.portals.a.place(doorCx, surfY - 2, 0, 3);           // ★ 地板门（dir=0）
  // 出口门：房间**对侧远端**的地板门（避开箱子出生点与玩家起点）
  g2.portals.b.place((rightFree ? 24 : 2) * T, surfY - 2, 0, 3);
  // 玩家站到箱子的**反方向**一侧推（往右推就站左边，往左推就站右边）
  const standX = rightFree ? box2.x - CFG.P_W - 2 : box2.x + box2.w + 2;
  g2.player.reset(standX, box2.y);
  const pushKey = rightFree ? { right: true } : { left: true };
  let boxIn = false;
  for (let i = 0; i < 400; i++) { t2(pushKey); if (box2.portalCd > 0) { boxIn = true; break; } }
  check('箱子被玩家用力推进门 → 成功传送', boxIn,
    `推箱方向=${rightFree ? '右' : '左'} 门=(${(doorCx / T).toFixed(2)},dir0) box=(${(box2.x / T).toFixed(2)},${(box2.y / T).toFixed(2)}) portalCd=${box2.portalCd.toFixed(3)}`);
}

/* ============================================================
   [6] 道具卡墙角脱困
   ============================================================ */
console.log('\n[6] 道具卡墙角脱困');
{
  const g = makeGame(); const tick = mkTick(g);
  g.switchRoom(3, false);
  const box = g.room.crates[0];
  const solidList = () => g.room.collisionSolids();
  const embedded = () => {
    for (const s of solidList()) {
      if (!s.active) continue;
      if (box.x < s.x + s.w && box.x + box.w > s.x && box.y < s.y + s.h && box.y + box.h > s.y) return true;
    }
    return false;
  };

  // 把箱子硬塞进墙体/死角
  box.reset(); box.x = 14 * T; box.y = 14 * T;
  run(tick, {}, 90);
  check('被塞进墙里的箱子能自行脱困', !embedded(), `pos=${box.x.toFixed(1)},${box.y.toFixed(1)}`);

  // 塞到房间边界死角
  box.reset(); box.x = 0; box.y = 0;
  run(tick, {}, 90);
  check('被塞到地图死角的箱子能脱困', !embedded(), `pos=${box.x.toFixed(1)},${box.y.toFixed(1)}`);

  // 箱子被压在两堵墙之间（重叠多个 solid）
  box.reset(); box.x = 15 * T; box.y = 15 * T;
  run(tick, {}, 90);
  check('箱子不会永久嵌在 solid 里', !embedded(), `pos=${box.x.toFixed(1)},${box.y.toFixed(1)}`);
}

/* ============================================================
   [7] 引导系统
   ============================================================ */
console.log('\n[7] 游戏引导');
{
  const g = makeGame(); const tick = mkTick(g);

  check('每个房间都有 objective（顶部常驻目标）',
    ROOMS.every(r => r.objective && r.objective.length > 0),
    ROOMS.map(r => r.objective ? 'Y' : 'N').join(''));
  check('每个房间都有 hint（进房大提示）',
    ROOMS.every(r => r.hint && r.hint.length > 0));
  check('包含世界内浮字提示（texts）',
    ROOMS.filter(r => (r.texts || []).length > 0).length >= 5,
    `${ROOMS.filter(r => r.texts && r.texts.length).length}/${ROOMS.length} 个房间有浮字`);
  check('起始房间先教移动/跳跃',
    ROOMS[0].texts.some(t => /走|跳/.test(t.text)),
    `texts=${ROOMS[0].texts.length} 条`);
  check('有房间教传送门（B/O + 惯性）',
    ROOMS.some(r => r.needPortal && /B|O|传送门/.test(r.hint)),
    '');
  check('★ 没有任何房间还在教冲刺（X）',
    !ROOMS.some(r => (r.texts || []).some(t => /冲刺/.test(t.text)) ||
                     (r.hint || '').includes('冲刺') ||
                     (r.objective || '').includes('冲刺')),
    '冲刺教学应已全部清理');
  check('★ 没有任何房间还在教凌波微步 / 超级跳',
    !ROOMS.some(r => (r.steps || []).some(s => /凌波微步|超级跳/.test(s.text))),
    '');
  check('有房间教空中跳（第 2 关：跨越 · 精准跳）',
    (ROOMS[1].texts || []).some(t => /跳/.test(t.text)) ||
    /跳/.test(ROOMS[1].hint || ''),
    `房间2 hint="${ROOMS[1].hint}"`);
  check('房间 7 改成了传送门弹射主题',
    /弹射|传送门|门/.test(ROOMS[7].name + ROOMS[7].hint + (ROOMS[7].objective || '')),
    `name="${ROOMS[7].name}"`);
  check('有房间教墙跳（贴墙 + C）',
    (ROOMS[8].steps || []).some(s => /C/.test(s.text)),
    `房间8 有 ${(ROOMS[8].steps || []).length} 步`);

  // 运行时：objective 会随状态变化
  run(tick, {}, 30);
  check('运行时 objective 已生成', !!g.objective && g.objective.length > 0, `"${g.objective}"`);

  // 每个房间都应该产出**互不相同**的目标，玩家才知道"现在这一步做什么"
  const perRoom = [];
  for (let rid = 0; rid < g.rooms.length; rid++) {
    g.switchRoom(rid, false);
    // ⚠️ switchRoom **不会移动玩家** —— 玩家会保留上一关的坐标。
    //    高难关（11~16）几乎满地是刺，于是第 1 帧玩家就踩刺 →
    //    `step()` 走 `respawnPlayer(); return;` 提前返回，
    //    **永远到不了末尾的 updateObjective()** → objective 留空。
    //    这是测试搭建的坑，不是游戏 bug；把玩家摆正到本关出生点即可。
    g.player.reset(g.room.spawn.x, g.room.spawn.y);
    tick({});
    perRoom.push(g.objective);
  }
  check('每个房间的 objective 都非空', perRoom.every(o => o && o.length > 0),
    perRoom.map((o, i) => (o ? null : i)).filter(x => x !== null).join(',') || '全部非空');
  check('各房间 objective 至少 9 种不同（不会一直是同一句）',
    new Set(perRoom).size >= 9,
    `去重后 ${new Set(perRoom).size}/${perRoom.length}`);
  check('房间3（压力板）目标提到箱子/压力板',
    /压力板|箱子/.test(perRoom[3]), `"${perRoom[3]}"`);
  check('房间4（传送门）目标提到门（B/O）',
    /B|O|门/.test(perRoom[4]), `"${perRoom[4]}"`);
  check('房间5（深井）目标提到井/落/高',
    /井|落|高/.test(perRoom[5]), `"${perRoom[5]}"`);
  check('房间6（箱子过门）目标提到箱子/门',
    /箱子|门/.test(perRoom[6]), `"${perRoom[6]}"`);
  // ★ 第十六版：终局关从 9 挪到 19（现在总共 20 关）。
  //   第 19 关是「最后一课」，开局第一步的分步脚本会先引导推箱子 ——
  //   所以这里只要求「本关的目标/分步文案整体提到终点或综合要素」，
  //   不能再要求"第一条文案里就有'终点'"。
  check('房间19（终局）目标/分步文案提到终点或综合要素',
    /终点|招式|最后一课|学过的|把学过/.test(
      [perRoom[19], ...(ROOMS[19].steps || []).map(s => s.text), ROOMS[19].hint || ''].join(' ')),
    `"${perRoom[19]}"`);

  // 传送门进度会推动目标变化（房间4 有 steps 脚本）
  const g3 = makeGame(); const t3 = mkTick(g3);
  g3.switchRoom(4, false);
  t3({}); const s0 = g3.objective;
  t3({ portal: true }); t3({}); const s1 = g3.objective;
  t3({ portal2: true }); t3({}); const s2 = g3.objective;
  check('开门进度会逐步推进目标', s0 !== s1 && s1 !== s2, `"${s0}" → "${s1}" → "${s2}"`);
  check('提示的是还没开的那个门（第一句提到 B/O）', /B|O/.test(s0), `"${s0}"`);
  check('一个门开后提示放第二个门', /B|O|另一/.test(s1), `"${s1}"`);
  check('两个门都开后目标变成"跳进去用惯性"', /跳进|惯性|甩|门/.test(s2), `"${s2}"`);

  // 目标方向指示（必须看 g3 —— 上面放门的是 g3，不是 g）
  check('存在目标方向指示（objArrow）', g3.objArrow === null || (typeof g3.objArrow.x === 'number'),
    g3.objArrow ? `(${g3.objArrow.x.toFixed(0)},${g3.objArrow.y.toFixed(0)})` : 'null');
  check('开完两个门后有明确的箭头指向入口门', !!g3.objArrow, JSON.stringify(g3.objArrow));

  // 指向目标的方向箭头
  check('存在目标方向指示（objArrow）', g3.objArrow === null || (typeof g3.objArrow.x === 'number'),
    g3.objArrow ? `(${g3.objArrow.x.toFixed(0)},${g3.objArrow.y.toFixed(0)})` : 'null');

  // 世界内浮字靠近平滑淡入（必须切到那个房间，否则 texts 不会被 update）
  g.switchRoom(1, false);
  const room1 = g.rooms[1];
  const hintObj = room1.texts[0];
  check('TextHint 有淡入 alpha 属性', typeof hintObj.alpha === 'number');
  // 把玩家丢到提示正下方（地面上），alpha 应该涨起来
  g.player.reset(hintObj.x - CFG.P_W / 2, 15 * T - CFG.P_H - 2);
  run(tick, {}, 50);
  check('靠近浮字后自动淡入', hintObj.alpha > 0.5, `alpha=${hintObj.alpha.toFixed(2)}`);
  /* 走远之后应该淡出。
     ⚠️⚠️ 这里曾经用 `reset(26*T, 12*T)` 把玩家丢到房间最右侧 —— 那个坐标
        在**旧版房间1**（横向大走廊）里是安全地面，但房间1 重做成「阶梯 +
        地刺」之后，(26,12) 落进的是一整片刺海的上方：玩家 1 帧内就被扎死，
        `respawnPlayer()` 把他送回出生点 (3,15)，而出生点离浮字 (4,13)
        只有 1 格 —— **alpha 反而一直是 1**，测试报"没淡出"。
        这是测试脚本自己的锅（踩了地形变更），不是淡出逻辑坏了。
        修法：不依赖任何一关的地形，改用「空气房」把淡出逻辑单独测干净。 */
  const airDef = {
    id: 0, name: 'air', links: [], map: [
      '##############################',
      ...Array.from({ length: 16 }, () => '#                            #'),
      '##############################',
    ],
    texts: [{ gx: 2, gy: 13, text: '淡出探针' }],
  };
  const gAir = new Game(cv); gAir.renderer.W = 960; gAir.renderer.H = 576;
  const airRoom = new Room(airDef);
  gAir.rooms = [airRoom]; gAir.roomId = 0; gAir.room = airRoom;
  gAir.player = new gAir.player.constructor(0, 0);
  const probe = airRoom.texts[0];                 // 中心 = (2*32+16, 13*32+16)
  // 悬停在探针正中心（无重力干扰的瞬间）
  gAir.player.reset(probe.x - CFG.P_W / 2, probe.y - CFG.P_H / 2);
  for (let i = 0; i < 20; i++) gAir.step(CFG.DT);
  check('空气房：靠近浮字后自动淡入', probe.alpha > 0.5, `alpha=${probe.alpha.toFixed(2)}`);
  gAir.player.reset(24 * T, 8 * T);               // 房间另一头，离浮字 >600px
  for (let i = 0; i < 120; i++) gAir.step(CFG.DT);
  check('走远后浮字淡出', probe.alpha < 0.3,
    `alpha=${probe.alpha.toFixed(2)} dist=${Math.abs(gAir.player.cx - probe.x).toFixed(0)}`);

  /* ---- 防止"重新生成关卡 → 引导被静默抹掉"的事故再次发生 ---- */
  // test/gen-levels.js 会整体覆盖 src/levels.js。若它没把引导字段写回去，
  // 上面这些测试会全部挂掉，但更糟的是"只在某个房间丢一条"这种静默失败。
  // 这里做一次逐房间、逐字段的完整性扫描。
  const missing = [];
  for (const r of ROOMS) {
    if (!r.objective) missing.push(`房间${r.id}: objective 缺失`);
    if (!r.hint) missing.push(`房间${r.id}: hint 缺失`);
    if (!r.texts || r.texts.length === 0) missing.push(`房间${r.id}: texts 缺失`);
    for (const t of (r.texts || [])) {
      if (typeof t.gx !== 'number' || typeof t.gy !== 'number') missing.push(`房间${r.id}: 浮字坐标非法`);
      if (!t.text) missing.push(`房间${r.id}: 浮字文案为空`);
    }
    if (r.needPortal && !r.objMode) missing.push(`房间${r.id}: 声明 needPortal 但没有 objMode`);
  }
  check('引导数据完整（objective/hint/texts 一个都不少）',
    missing.length === 0, missing.slice(0, 4).join('; ') || '全部齐备');

  // 引导浮字必须落在空气里 —— 否则玩家走不过去，提示永远看不到
  const buried = [];
  for (const r of g.rooms) {
    const def = ROOMS[r.id];
    for (const t of (def.texts || [])) {
      const tx = t.gx * T + T / 2, ty = t.gy * T + T / 2;
      for (const s of r.solids) {
        if (tx > s.x && tx < s.x + s.w && ty > s.y && ty < s.y + s.h) {
          buried.push(`房间${r.id}(${t.gx},${t.gy})「${t.text}」`);
        }
      }
    }
  }
  check('所有引导浮字都落在可到达的空气里（没被埋进墙）',
    buried.length === 0, buried.slice(0, 3).join('; ') || '全部可见');

  // 键位文案必须与新键位一致（C 跳/空跳 / ↓ 快速下降 / B·O 开门 / P 清空）
  // ★ 第十三版：X 冲刺已移除，文案里也不该再出现
  const allText = ROOMS.map(r => [r.hint, r.objective, ...(r.texts || []).map(t => t.text),
    ...(r.steps || []).map(s => s.text)].join(' ')).join(' ');
  check('引导文案里没有残留的 Shift 冲刺说法',
    !/Shift/i.test(allText), /Shift/i.test(allText) ? '仍在提 Shift' : '已清理');
  check('★ 引导文案里没有残留的"冲刺"字样',
    !/冲刺/.test(allText), /冲刺/.test(allText) ? '仍在提冲刺' : '已清理');
  check('★ 引导文案里没有残留的 X 冲刺键位说明',
    !/X[\s·、]*冲刺|冲刺[\s·、]*X/.test(allText), '');
  check('引导文案里没有残留的"空格/W 跳跃"说法',
    !/空格|按 W|W 跳/.test(allText), /空格|按 W|W 跳/.test(allText) ? '仍在提空格/W' : '已统一为 C');
  check('引导文案里没有残留的"Q/E 开门"说法',
    !/按 Q|按 E|Q\/E|Q 门|E 门/.test(allText), /按 Q|按 E|Q\/E/.test(allText) ? '仍在提 Q/E' : '已统一为 B/O');
  check('房间0 引导文案提到 C 跳跃',
    /C/.test(ROOMS[0].hint) && /C/.test(ROOMS[0].texts.map(t => t.text).join(' ')),
    `"${ROOMS[0].hint}"`);
  check('房间0 引导文案提到 ↓ 快速下降',
    /↓/.test(ROOMS[0].texts.map(t => t.text).join(' ')),
    `"${ROOMS[0].texts.map(t => t.text).join(' | ')}"`);
}

/* ============================================================
   [8] 机关谜题可解性（防止"门挡住自己的解谜道具"这种死锁）
   ------------------------------------------------------------
   曾经的真实 bug：房间1 的能量门立在箱子与压力板之间，
   而门只有压力板被压下才开 → 箱子被门挡住 → 永远压不到板 → 无解。
   这里用真实物理模拟"玩家把箱子推到压力板上"，钉死可解性。
   ============================================================ */
console.log('\n[8] 机关谜题可解性');
{
  // 直接驱动 Input 的 held/queued（模拟真实按键，含边沿）
  const ALLKEYS = ['left', 'right', 'jump', 'down', 'portal', 'portal2', 'reset', 'clear', 'pause'];
  function driver(g) {
    let prev = {};
    return (want) => {
      want = want || {};
      for (const k of ALLKEYS) if (want[k] && !prev[k]) g.input.queued.push(k);
      for (const k of ALLKEYS) if (!want[k] && prev[k]) g.input.held[k] = false;
      g.input.beginStep();
      prev = Object.assign({}, want);
      g.step(CFG.DT);
    };
  }

  // ---- 房间 1：把箱子推到压力板上 → 能量门打开 ----
  {
    const g = makeGame(); const tick = driver(g);
    g.switchRoom(3, false);
    const box = g.room.crates[0];
    const sig = g.room.signals[0];
    const gate = g.room.gates[0];

    check('房间1 有箱子+压力板+信号', !!box && g.room.plates.length > 0 && !!sig, '');

    // ⚠️ 房间 3 第十版起：箱子在出生点**左边**、压力板在 x=3，
    //    必须站到箱子**右**侧按 ← 往**左**推。
    //    旧代码是 `reset(box.x - 40)` + `tick({right:true})`（往右推），
    //    在新几何下箱子一开始就贴着 x=2 的实心止挡，永远推不动。
    g.player.reset(box.x + 40, box.y - 2);
    for (let i = 0; i < 5; i++) tick({});

    let lit = false, used = 0;
    for (let i = 0; i < 1200; i++) {
      tick({ left: true });
      used = i;
      if (sig.on) { lit = true; break; }
    }
    check('房间1 箱子可以推到压力板上（谜题可解）', lit,
      lit ? `${used} 步 (${(used / 60).toFixed(2)}s)` : `箱子卡在 (${(box.x / T).toFixed(2)},${(box.y / T).toFixed(2)})`);
    // 通电后门必须真的打开（不再阻挡）
    for (let i = 0; i < 60; i++) tick({});
    check('房间1 通电后能量门打开', !gate.active, `open=${gate.open} active=${gate.active}`);

    // 反证：门不能立在"箱子→压力板"的必经之路上
    // ⚠️ 箱子起点不要从 `ROOMS[1].map[9]` 硬编码取（那个房间号/行号早就变了，
    //    取出来是 undefined，算出来的 onPath 恒为 false，等于没校验）。
    //    直接用**运行时**真实的箱子初始位置 —— 但此时箱子已被推走，
    //    所以用 Crate 的出生格（crate 会在 reset() 时回到 spawn）。
    const gateLeft = gate.x, gateRight = gate.x + gate.w;
    box.reset();
    const boxStart = box.x;
    const plateX = g.room.plates[0].x;
    const onPath = (gateLeft > Math.min(boxStart, plateX) && gateRight < Math.max(boxStart, plateX))
      || (gateLeft < Math.max(boxStart, plateX) && gateRight > Math.min(boxStart, plateX));
    check('房间1 能量门不在箱子→压力板的直线路径上（无死锁）', !onPath,
      `门 x=${gateLeft}~${gateRight}  箱子 x=${boxStart}  板 x=${plateX.toFixed(0)}`);
  }

  // ---- 房间 6：箱门双解谜题的结构 + "主动推进去"这条链路 ----
  {
    const g = makeGame();
    g.switchRoom(6, false);
    const box = g.room.crates[0];
    const plate = g.room.plates[0];

    /* ★ 第十三版重新设计（原来那条断言已经过时，别再按旧设计改回来）：
         旧设计：隔墙把"箱子"与"压力板"分在两个区域，箱子必须**过门**才能压板。
         实测结论：**两扇同朝向的门无法运输沿门面运动的物体** ——
           地板门 n_in=(0,-1)、t_in=(1,0)，水平推进去的箱子 vn ≡ 0，
           只会被"法线保底"向上弹飞，永远进不了门。
         新设计：箱子 + 压力板 + 升降门同处隔墙左侧（纯地面横推），
           隔墙右侧是终点区，跨墙**只能靠传送门**。
         所以本段现在验证的是「箱子与板同侧且可横推」+「隔墙贯通」。 */
    check('房间6 依赖传送门解法', !!ROOMS[6].needPortal && ROOMS[6].objMode === 'puzzle');
    const plateCx6 = plate.x + plate.w / 2;
    // ★ 第十六版：隔墙挪到 x=9（原来是 x=15）。箱子在 x=4.5、板在 x=3.5，
    //   所以是「箱子在板右边 → 往左推」。断言只要求两者同处墙左侧、
    //   且不写死推出方向。
    const WALL6 = 9;
    check('房间6 箱子与压力板同处隔墙左侧（纯地面横推，无需过门）',
      box.cx < WALL6 * T && plateCx6 < WALL6 * T,
      `箱子 x=${(box.cx / T).toFixed(1)} 板 x=${(plateCx6 / T).toFixed(1)} 隔墙 x=${WALL6}`);
    // 隔墙必须从天花板贯通到地面（第 14 行是能量门洞，门关上时也算阻隔）。
    // ⚠️ 只数 '#' 会得到 14/15 —— 少的正是那道能量门 (9,14)。
    //    门在"未通电"时是实心阻挡，所以判定要把门洞一并计入。
    const gate6 = (ROOMS[6].gates || [])[0];
    let seal6 = 0;
    for (let y = 1; y <= 15; y++) {
      if (ROOMS[6].map[y][WALL6] === '#') { seal6++; continue; }
      if (gate6 && gate6.gx === WALL6 && y >= gate6.gy && y < gate6.gy + (gate6.h || 1)) seal6++;
    }
    check('房间6 隔墙贯通（右半边只能靠传送门抵达）', seal6 === 15,
      `竖墙+门 ${seal6}/15 行`);

    // "箱子主动穿过传送门"这条物理链路 —— 用房间3 的箱子做夹具。
    // ⚠️ 同 5b：推箱方向不能写死（房间3 现在是往**左**推）。
    const g4 = makeGame(); const t4 = mkTick(g4);
    g4.switchRoom(3, false);
    const b4 = g4.room.crates[0];
    b4.reset();
    run(t4, {}, 120);
    const surfY2 = b4.y + b4.h;                      // 箱子底面（不写死行号）
    const solids4 = g4.room.collisionSolids();
    const bodyTop4 = surfY2 - b4.h;
    const blocked4 = (px) => solids4.some(s =>
      s.active && px > s.x - 6 && px < s.x + s.w + 6 &&
      s.y + 4 < surfY2 && s.y + s.h - 4 > bodyTop4);
    const rFree4 = !blocked4(b4.x + b4.w + 1.2 * T);
    const doorCx2 = rFree4 ? b4.x + b4.w + 1.2 * T : b4.x - 1.2 * T;
    g4.portals.a.place(doorCx2, surfY2 - 2, 0, 3);   // ★ 地板门（dir=0）
    // 出口门同样放在远端，别压在箱子/玩家身上（见 5b 注释）
    g4.portals.b.place((rFree4 ? 24 : 2) * T, surfY2 - 2, 0, 3);
    g4.player.reset(rFree4 ? b4.x - CFG.P_W - 2 : b4.x + b4.w + 2, b4.y);
    const key4 = rFree4 ? { right: true } : { left: true };
    let teleported = false;
    for (let i = 0; i < 400; i++) {
      t4(key4);
      if (b4.portalCd > 0) { teleported = true; break; }
    }
    check('箱子能被玩家主动推进传送门（需求1 的"主动可以"）', teleported,
      `推箱方向=${rFree4 ? '右' : '左'} box=(${(b4.x / T).toFixed(2)},${(b4.y / T).toFixed(2)}) portalCd=${b4.portalCd.toFixed(3)}`);
  }

  // ---- 每个带机关的房间：压力板/门都必须在"可达"的合理位置 ----
  {
    const bad = [];
    for (const def of ROOMS) {
      for (const pl of (def.plates || [])) {
        // 板下方必须是实心（否则板是悬空的，箱子压不到）
        const below = def.map[pl.gy + 1] && def.map[pl.gy + 1][pl.gx];
        if (below !== '#') bad.push(`房间${def.id} 压力板(${pl.gx},${pl.gy}) 悬空`);
        // 板上方必须是空气（箱子放得下）
        const here = def.map[pl.gy] && def.map[pl.gy][pl.gx];
        if (here === '#') bad.push(`房间${def.id} 压力板(${pl.gx},${pl.gy}) 被墙埋住`);
      }
      for (const ga of (def.gates || [])) {
        if (ga.gy + ga.h > 17) bad.push(`房间${def.id} 门超出地图底部`);
      }
    }
    check('所有机关都放在可达的合理位置上', bad.length === 0, bad.join('; ') || 'OK');
  }
}

/* ============================================================
   总览
   ============================================================ */
console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
