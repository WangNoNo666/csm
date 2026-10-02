/* 关卡流程验证：抵达终点 → 过场 → 自动进入下一关 → … → 第 10 关后结算 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js', 'util.js', 'input.js', 'actor.js', 'portal.js', 'player.js',
  'props.js', 'levels.js', 'fx.js', 'audio.js', 'render.js', 'game.js'];
let bundle = '';
for (const f of files) bundle += '\n' + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game, ROOMS };\n';
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
const { CFG, Game } = sb.__X;
const T = CFG.TILE;

let pass = 0, fail = 0;
const chk = (n, c, e = '') => {
  if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  \u2717 ' + n + '  ' + e); }
};

function makeGame() {
  const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576;
  g.start();
  return g;
}
/** 推进 n 帧，可选按住某些键 */
function tickN(g, n, held) {
  const IN = g.input;
  for (let i = 0; i < n; i++) {
    IN.held = Object.create(null);
    if (held) for (const k of Object.keys(held)) IN.held[k] = !!held[k];
    IN.queued = [];
    IN.beginStep();
    g.step(CFG.DT);
  }
}
/** 把玩家瞬移到终点位置（模拟"走到了终点"） */
function touchGoal(g) {
  const goal = g.room.goal;
  if (!goal) return false;
  g.player.reset(goal.x - g.player.w / 2, goal.y - g.player.h / 2);
  tickN(g, 1);
  return true;
}
/**
 * 房间 0 是教学关（靠掉落口进房间 1，本身没有终点水晶），
 * 所以测试「通关流程」时先走到第一个有终点的房间。
 */
function toFirstGoalRoom(g) {
  const T2 = CFG.TILE;
  // 房间 0 没有终点：把玩家放到掉落口正上方，然后自由落体进房间 1。
  // 注意只瞬移**一次**，否则每帧重置位置会永远掉不下去。
  if (g.roomId === 0) {
    g.player.reset(22 * T2, 6 * T2);
    let guard = 0;
    while (g.roomId === 0 && guard++ < 400) tickN(g, 1);
  }
  return g.roomId;
}

/**
 * 把玩家推到房间的出口（用于**没有终点**的房间）。
 *
 * ⚠️ 为什么需要：房间 11「高难 · 低矮通道」没有 'G'，靠玩家一路贴地
 *    跑到右边缘的通道口进入下一关。老测试直接 `if (!g.room.goal) break;`
 *    → 流程验证走到房间 11 就断了。
 *
 * 做法：优先按 links 声明的那条边推；没有 links 就贴着右边缘推。
 * 推过去之后由引擎的 checkRoomLinks() 接手切关。
 */
function walkToExit(g) {
  const T2 = CFG.TILE;
  const r = g.room;
  const link = (r.links || [])[0];
  const edge = link ? link.edge : 'right';
  if (edge === 'bottom') {
    const cx = ((link.x0 + link.x1) / 2 + 0.5) * T2;
    g.player.reset(cx, (CFG.ROOM_H - 4) * T2);
  } else if (edge === 'top') {
    const cx = ((link.x0 + link.x1) / 2 + 0.5) * T2;
    g.player.reset(cx, 3 * T2);
  } else if (edge === 'left') {
    const cy = link ? ((link.y0 + link.y1) / 2 + 0.5) * T2 : 8 * T2;
    g.player.reset(3 * T2, cy);
  } else {
    // 右边缘：贴着右边推，靠 checkRoomLinks 的边界宽容度触发
    g.player.reset((CFG.ROOM_W - 2) * T2, r.spawn.y);
  }
  let guard = 0;
  const start = g.roomId;
  while (g.roomId === start && guard++ < 400) tickN(g, 1);
  return g.roomId !== start;
}

console.log('=== 关卡流程验证 ===\n');

/* ---------- 0. 前置：房间0 没有终点，靠掉落进房间1 ---------- */
console.log('[0] 房间 0 靠掉落口进入房间 1（这是"第一部分"的出口）');
{
  const g = makeGame();
  chk('房间 0 没有终点水晶', !g.room.goal, g.room.goal ? '竟有 goal' : 'ok');
  chk('房间 0 有通往房间 1 的底部链接',
    (g.room.links || []).some(l => l.room === 1 && l.edge === 'bottom'));
  // 从开口掉下去
  g.player.reset(22 * T, 6 * T);
  let guard = 0;
  while (g.roomId === 0 && guard++ < 400) tickN(g, 1);
  chk('从开口掉落进入房间 1', g.roomId === 1, `roomId=${g.roomId}`);
}

/* ---------- 1. 抵达终点不应直接"通关"，而是标记本关通过 ---------- */
console.log('\n[1] 抵达终点 → 本关通过（不是直接通关）');
{
  const g = makeGame();
  // 房间 0 没终点，先进到房间 1（"第一部分"）
  g.player.reset(22 * T, 6 * T);
  let guard = 0;
  while (g.roomId === 0 && guard++ < 400) tickN(g, 1);
  chk('起点：已到达第 2 关（有终点的第一关）', g.roomId === 1, `roomId=${g.roomId}`);
  chk('起始未通关', !g.won && !g.levelClear);
  chk('该关有终点', !!g.room.goal);
  touchGoal(g);
  chk('抵达终点后标记本关通过', g.levelClear === true, `levelClear=${g.levelClear}`);
  chk('抵达终点后**没有**直接通关（旧 bug：卡在结算画面）', g.won === false, `won=${g.won}`);
  chk('过场倒计时已启动', g.levelClearT > 0, `levelClearT=${g.levelClearT.toFixed(2)}`);
  chk('记录了本关用时', typeof g.levelTimes[1] === 'number', `${(g.levelTimes[1] || 0).toFixed(2)}s`);
}

/* ---------- 2. 过场结束后自动进入下一关 ---------- */
console.log('\n[2] 过场结束 → 自动进入下一关');
{
  const g = makeGame();
  toFirstGoalRoom(g);                    // → 房间 1
  const from = g.roomId;
  touchGoal(g);
  // 过场期间世界应该停住（时钟由 levelClearT 独立走）
  tickN(g, 10);
  chk('过场期间仍停在原关（旧 bug：在这里卡死）', g.roomId === from, `roomId=${g.roomId}`);
  // 等过场走完
  let guard = 0;
  while (g.levelClear && guard++ < 400) tickN(g, 1);
  chk('过场结束后进入下一关', g.roomId === from + 1, `${from} → ${g.roomId}`);
  chk('进入下一关后 levelClear 复位', !g.levelClear);
  chk('进入下一关没有误判通关', !g.won);
  // 玩家应该在新关的出生点，而不是卡在旧位置
  const r = g.rooms[g.roomId];
  const d = Math.hypot(g.player.cx - (r.spawn.x + g.player.w / 2),
    g.player.cy - (r.spawn.y + g.player.h / 2));
  chk('玩家被放到新关出生点', d < 40, `距离=${d.toFixed(1)}px`);
  // 新关应该能正常跑物理
  tickN(g, 30);
  chk('新关物理正常运行', Number.isFinite(g.player.x) && Number.isFinite(g.player.y),
    `x=${g.player.x.toFixed(1)} y=${g.player.y.toFixed(1)}`);
}

/* ---------- 3. 按跳跃可跳过过场（★ 第十三版：冲刺已移除，跳是唯一的跳过键） ---------- */
console.log('\n[3] 过场可按跳跃跳过');
{
  const g = makeGame();
  toFirstGoalRoom(g);
  const from = g.roomId;
  touchGoal(g);
  tickN(g, 2);
  chk('跳之前还在过场中', g.levelClear && g.roomId === from, `roomId=${g.roomId}`);
  // 造一个 jump 的按下边沿
  g.input.queued = ['jump'];
  g.input.beginStep();
  g.step(CFG.DT);
  chk('按跳跃立即进入下一关', g.roomId === from + 1, `${from} → ${g.roomId}`);

  const g2 = makeGame();
  toFirstGoalRoom(g2);
  const from2 = g2.roomId;
  touchGoal(g2);
  tickN(g2, 2);
  chk('跳之前 g2 仍在过场中', g2.levelClear && g2.roomId === from2, `roomId=${g2.roomId}`);
  // 不按键时应该继续停在过场里（世界静止）
  tickN(g2, 4);
  chk('不按键时停留在过场（不会自动秒切）', g2.roomId === from2, `roomId=${g2.roomId}`);
  g2.input.queued = ['jump'];
  g2.input.beginStep();
  g2.step(CFG.DT);
  chk('再次按跳跃同样能跳过过场', g2.roomId === from2 + 1, `${from2} → ${g2.roomId}`);
}

/* ---------- 4. 连续打到最后一关 → 才是通关 ---------- */
console.log('\n[4] 连过所有带终点的关 → 最后一关结束才结算');
{
  const g = makeGame();
  toFirstGoalRoom(g);
  const visited = [g.roomId];
  let guard = 0;
  while (!g.won && guard++ < 400) {
    // ⚠️ 有些房间**故意没有终点**（房间 0 靠掉落口、房间 11 靠右边缘通道）。
    //    老版本在这里直接 break，于是测试走到房间 11 就停了，
    //    永远验不到后半段。现在改成：没终点就"走向边缘"推进，
    //    仍然过不去才放弃。
    if (!g.room.goal) {
      const before = g.roomId;
      if (!walkToExit(g)) break;
      if (g.roomId === before) break;      // 推不动了，避免死循环
      if (visited[visited.length - 1] !== g.roomId) visited.push(g.roomId);
      continue;
    }
    touchGoal(g);
    // 等过场走完（或按跳过）
    let inner = 0;
    while (g.levelClear && inner++ < 400) tickN(g, 1);
    if (g.won) break;
    if (visited[visited.length - 1] !== g.roomId) visited.push(g.roomId);
  }
  // ★ 第十六版：20 关。房间 0（掉落口）与 11（右边缘通道）没有 'G'，其余 18 关都有。
  const LAST = g.rooms.length - 1;
  const expect = Array.from({ length: LAST }, (_, i) => i + 1).filter(i => !!g.rooms[i].goal).join(',');
  chk('依次走完了所有带终点的关', visited.join(',') === expect, visited.join(' → '));
  chk('最后一关结束后才判定通关', g.won === true, `won=${g.won} roomId=${g.roomId}`);
  chk('通关时停留在最后一关', g.roomId === LAST, `roomId=${g.roomId} last=${LAST}`);
  const timed = g.levelTimes.filter(v => typeof v === 'number').length;
  chk('记录了各关用时', timed === g.rooms.length - 1,
    `${timed} 关 / 共 ${g.rooms.length}（房间 0 没有终点，不计时）`);
}

/* ---------- 5. 通关后按 R 从第 1 关重开 ---------- */
console.log('\n[5] 通关后按 R 重开');
{
  const g = makeGame();
  toFirstGoalRoom(g);
  let guard = 0;
  while (!g.won && guard++ < 400) {
    if (!g.room.goal) break;
    touchGoal(g);
    let inner = 0;
    while (g.levelClear && inner++ < 400) tickN(g, 1);
  }
  chk('已通关（前置条件）', g.won === true);
  g.hardReset();
  chk('重开后回到第 1 关（房间 0）', g.roomId === 0, `roomId=${g.roomId}`);
  chk('重开后清除通关状态', !g.won && !g.levelClear);
  chk('重开后进度清零', g.time === 0 && g.levelTimes.length === 0,
    `time=${g.time} times=${g.levelTimes.length}`);
}

/* ---------- 6. 过场期间世界必须停住（不能偷偷切关/掉血） ---------- */
console.log('\n[6] 过场期间世界静止');
{
  const g = makeGame();
  toFirstGoalRoom(g);
  const from = g.roomId;
  touchGoal(g);
  const deaths0 = g.deaths;
  tickN(g, 30);
  chk('过场期间不会意外死亡', g.deaths === deaths0, `deaths=${g.deaths}`);
  chk('过场期间房间没变', g.roomId === from, `roomId=${g.roomId}`);
}

console.log(`\n=== 关卡流程：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
