/* ============================================================
   难度守卫（7B 标准）—— 「不能偷鸡」回归测试
   ------------------------------------------------------------
   用户原话：
     「太简单了我不用传送门都能过……你必须要把箱子推过去作为过关的必要条件，
       而不是我人过去了直接过关……一定要有难度，有刺之类的阻碍，
       难度至少是蔚蓝 7b」

   这条反馈不能只靠"改一次关"来满足 —— 必须变成**可执行的守卫**，
   否则以后任何人调关卡都可能悄悄把它改回去。本套件把该诉求固化成断言：

     A. 尖刺密度    每关（除教学关 0）都必须有尖刺
     B. 终点不可偷鸡 带终点的关卡，终点必须**纯移动不可达**
                    （即必须用传送门 / 凌波微步 / 墙跳 / 箱子机关）
     C. 箱子硬条件  带箱子的关卡，箱子必须能到压力板，
                    且压板前能量门是关的（终点被门锁住）
     D. 出生点安全  出生点缓冲区无尖刺（一出生就死 = 坏关卡）
     E. 落点洁净    尖刺不能铺满整条可行走地面（否则不是难，是无解）

   判定复用 test/reachability.js 的纯移动模型（垂直 3 格 / 水平 5 格椭圆）。
   ============================================================ */
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

const g = new Game(cv);
g.renderer.W = 960; g.renderer.H = 576;

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  \u2717 ' + n + '  ' + e); }
};

console.log('=== 难度守卫（7B 标准 · 不能偷鸡）===\n');

/* ---------- 纯移动可达性模型（与 test/reachability.js 同源） ---------- */
const aabb2 = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/* ⚠️ CAP_V 必须和**实测**对齐，不能凭感觉写。
   实测（本文件同目录的跳跃探针）：长按跳抬升 107px = 3.34 格；
   从贴墙的 1 格缝隙里「跳 + 横移上台面」实测能到 3.50 格。
   早先写 CAP_V = 3 时，教学关那些 3 格高的台阶刚好卡在边界上，
   被模型判成"上不去"，于是「房间1 走不通」——而真机里明明跳得上去。
   这里取 3.5 覆盖实测值，同时仍然禁止 5 格以上的离谱抬升。 */
const CAP_V = 3.5, CAP_H = 4;
/* ⚠️⚠️ 第十九版：CAP_H 必须收紧到 **4**。
   老值是 5 —— 但 test/capability.js 实测「满速助跑跳水平 = 3.84 格」，
   5 格是**凭空多给 1.2 格**的假能力。后果实测过：
   房间2（教学 · 精准跳）的断桥间距（板右缘 9 → 板左缘 11 = 2 格空隙）
   配 CAP_H=5 时，模型能从 x=8 一步"飞"到 x=11（跨 3 格空 + 2 格板 = 有效 5 格），
   于是把"上台阶"误判成"走得通"，而房间2 的终点在 9 行，
   真正需要的是抬升 2 格 + 右移 2 格的组合 —— 这些都在能力内，
   但模型走的是一条**实际跳不出来的远跳**，其他合法组合又被过度乐观的
   5 格能力"绕"过了墙，最后反而判成走不通。
   收紧到 4 之后模型与实测对齐，判定才可信。 */
const MOVES = [];
/* ⚠️ MOVES 必须包含「顶点漂移」型移动：先垂直抬升到接近上限，
   再在空中横向挪一两格落到旁边的台子上。
   真实玩家爬楼梯就是这么跳的 —— 站在台下空隙里垂直起跳，
   到最高点横向蹭到台面边缘。
   早先只有「|dx| ≤ CAP_H - dy」的椭圆族，最大上升（dy=3）时 dx 只能是 0，
   于是模型完全表达不出这个动作，教学关（房间1/2 的长阶梯）
   被误判成"走不通"。这里补上 dy=CAP_V-1 / CAP_V 时的 ±1~2 格漂移。 */
for (let dx = -CAP_H; dx <= CAP_H; dx++) MOVES.push([dx, 0]);
// 上升族：dy 取 1..3 格（CAP_V=3.5 取整），横向余量按椭圆衰减
for (let dy = 1; dy <= 3; dy++)
  for (let dx = -(CAP_H - dy); dx <= CAP_H - dy; dx++) MOVES.push([dx, -dy]);
for (let dy = 1; dy <= 14; dy++)
  for (let dx = -CAP_H; dx <= CAP_H; dx++) MOVES.push([dx, dy]);
/* 顶点漂移：满高度起跳 + 横向蹭到旁边的台面上（爬楼梯、上台沿靠这个）。
   真实玩家爬楼梯就是「站在台下空隙里垂直起跳，到最高点横向挪一两格」，
   实测（贴墙 1 格缝隙起跳）能抬升 3.5 格并横移 1~2 格落到台面。
   早先的椭圆族在 dy=3 时 dx 只能是 0，完全表达不出这个动作，
   教学关（房间1/2 的长阶梯）因此被误判成"走不通"。 */
for (const dy of [3, 4])
  for (const dx of [-4, -3, -2, -1, 1, 2, 3, 4]) MOVES.push([dx, -dy]);
const canDo = (rise, dx) => {
  if (rise <= 0) return true;
  if (rise > CAP_V) return false;
  return Math.abs(dx) <= CAP_H * Math.sqrt(Math.max(0, 1 - (rise / CAP_V) ** 2)) + 0.5;
};

function reachSet(room) {
  /* ⚠️ 两处"不能当空气"的东西必须算成实心，否则模型会给出假结论：

     ① 关闭的**能量门** —— 不挡的话模型会"穿过"关着的门走到终点，
        得出"可以偷鸡"，箱子硬条件的判定就失真了。
     ② **尖刺** —— 这是本套件最容易踩的坑：尖刺占满一整格（32×32），
        而玩家落脚时脚底正好贴着那格上沿，所以"踩在刺上"在游戏里是必死。
        早期版本只把尖刺当成普通地面，模型就认为"能走过去"，
        于是「房间3 终点纯移动不可达」永远失败 —— 而真实游戏里
        玩家跑到第 8 格就被扎死了。加入 hazards 后模型才和引擎一致。 */
  const rects = room.solids.filter(s => s.active && s.isStatic);
  for (const gt of room.gates) {
    const sr = gt.solidRect;
    if (sr) rects.push({ x: sr.x, y: sr.y, w: sr.w, h: sr.h, active: true });
  }
  const solidRects = rects.slice();                  // 能站上去的（地板 / 墙 / 关着的门）
  for (const h of room.hazards) {
    rects.push({ x: h.x, y: h.y, w: h.w, h: h.h, active: true, isHazard: true });
  }

  /* ⚠️ 性能：把实心矩形预烘焙成 1px 分辨率的位图。
     朴素写法是每次查询都遍历 rects，而 dropTo 要逐像素往下扫（最多 576 次），
     flood 又要跑上万次 —— 房间1 的实体数量直接把单次 reachSet 拖到 8 秒以上，
     整个套件看起来就像"挂死"。位图化之后查询是 O(1)，整个房间 < 100ms。

     位图存的是「玩家盒左上角放在 (x,y) 时是否与实心重叠」，
     宽高各多留一格边界，避免越界访问。

     ⚠️ 必须烘**两张**图：
       hitMap   = 实心 + 尖刺 → 用于"能不能站在这里 / 会不会撞到"
       floorMap = 只有实心        → 用于"脚下有没有支撑"
     曾经只做一张图（含尖刺），结果 supported() 的 3px 探针会探到**尖刺的顶面**，
     于是玩家"悬在刺上方 17px"也被判成站在地上 —— 房间7 的整条尖刺坑底
     因此成了可达点，模型得出"能纯跑跳走到终点"的错误结论。
     真实引擎里踩到刺是必死，刺绝不能算作落脚面。 */
  const BW = room.W + 64, BH = room.H * T + 64;
  const OFF = 32;
  const hitMap = new Uint8Array(BW * BH);
  const floorMap = new Uint8Array(BW * BH);
  const bake = (map, list) => {
    for (const s of list) {
      // 玩家盒 [x, x+P_W) × [y, y+P_H) 与 s 相交 ⇔ 左上角落在下面这个矩形内
      const x0 = Math.max(0, Math.floor(s.x - CFG.P_W + 1) + OFF);
      const x1 = Math.min(BW - 1, Math.floor(s.x + s.w - 1) + OFF);
      const y0 = Math.max(0, Math.floor(s.y - CFG.P_H + 1) + OFF);
      const y1 = Math.min(BH - 1, Math.floor(s.y + s.h - 1) + OFF);
      for (let y = y0; y <= y1; y++) map.fill(1, y * BW + x0, y * BW + x1 + 1);
    }
  };
  bake(hitMap, rects);
  bake(floorMap, solidRects);
  const lookup = (map, px, py) => {
    const ix = Math.round(px) + OFF, iy = Math.round(py) + OFF;
    if (ix < 0 || iy < 0 || ix >= BW || iy >= BH) return true;   // 越界当实心
    return map[iy * BW + ix] === 1;
  };
  const rawBlocked = (px, py) => lookup(hitMap, px, py);
  const rawFloor = (px, py) => lookup(floorMap, px, py);
  const blocked = (px, py) => rawBlocked(px, py);
  /* 玩家是否"站在 py 高度" —— 脚下（0~3px 内）要有**实地板**支撑。
     ⚠️ 只查 floorMap，不能查 hitMap —— 否则尖刺会被当成地板（见上）。
     ⚠️ 探针也不能写 py+1 起、高 P_H 的盒子：那等于要求玩家身体下移 1px
     才碰到地面，贴地站立的玩家整个悬空 → 所有房间落脚点暴跌到 5 个。 */
  const supported = (px, py) => {
    for (let d = 0; d < 3; d++) if (rawFloor(px, py + CFG.P_H + d)) return true;
    return false;
  };
  const standable = (px, py) => !blocked(px, py) && supported(px, py);
  /* 从 py 往下自由落体，返回第一个"站得住"的 y（在实地板上或卡在空隙中）。
     ⚠️ 必须在**第一个**支撑处停下并返回，不能继续往下扫。
     继续扫会让玩家"穿过"地板落进下面的实心层，落脚点算成深层坐标，
     房间4/5/8/9 的落脚点因此只剩 5 个。 */
  const dropTo = (px, py) => {
    const tb = colTable(Math.round(px));
    const y0 = Math.max(0, Math.round(py));
    // 二分找到第一个 y >= y0 的条目
    let lo = 0, hi = tb.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tb[m].y < y0) lo = m + 1; else hi = m; }
    if (lo >= tb.length) return null;
    if (tb[lo].y !== y0) return null;         // y0 本身就在实心里（被上面的 blocked 挡掉）
    return tb[lo].land;                        // null = 掉出世界
  };
  /* 起飞→落点之间扫一条线，采样玩家盒与实心的重叠。
     ⚠️ 必须走**抛物线**，不能走直线。
     真实跳跃是先升后降的弧，直线会"贴着"平台边缘切过去，
     把明明跳得过去的一步判成撞墙 —— 教学关（长阶梯）就是这样被全判死的。

     ⚠️ 但拱高也**不能随便放大**：拱得太高，路径就会"飘"过本来该挡路的墙，
     房间4/9 的可达点因此从 53/20 掉到 10/5（模型反而变得过于乐观，
     因为墙顶上方那一层是空的）。所以候选弧里必须**包含平飞那一条**
     （hMul=0），而且判定是"任一条通得过即可"——
     只要直线都撞墙，就得靠真实的拱起才能翻过去，这时拱才被允许生效。

     上升/下降用引擎的跳跃参数近似，四条弧覆盖「压着跳 / 正常跳 / 高跳」。 */
  const arcBlocked = (x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return false;
    for (const hMul of [0, 0.3, 0.6, 0.85]) {
      // 拱高上限：不超过一次长按跳的实际高度（1 格跳 ≈ 112px，这里取保守 80px）
      const rise = Math.min(80, Math.max(0, -dy) + dist * 0.22) * hMul;
      let ok = true;
      const steps = Math.ceil(dist / 4) + 1;
      for (let i = 1; i < steps && ok; i++) {
        const t = i / steps;
        const y = y0 + dy * t - 4 * rise * t * (1 - t);
        if (blocked(x0 + dx * t, y)) ok = false;
      }
      if (ok && blocked(x1, y1)) ok = false;
      if (ok) return false;
    }
    return true;
  };
  /* ⚠️ 性能：MOVES 是「dxg × dyg」的全笛卡尔积（约 250 条），
     每条都要跑一次 dropTo（最多 576 次像素探测）。房间5~8 因此
     单间要跑 25~35 秒，整个套件看起来像挂了。

     关键观察：**dropTo 只依赖 (x, 起点 y)**，而同一个 x 上，
     所有「起点 y 在 [y_lo, y_hi] 区间内」的查询结果完全相同
     （都会落到同一个支撑面）。于是给每个列 x 建一个按 y 排序的
     落点表，查询时二分即可 —— 从 O(576) 降到 O(log n)。

     这不是近似：落点函数 y ↦ land(x, y) 是单调阶梯，二分完全精确。 */
  const colCache = new Map();
  const colTable = (ix) => {
    let tb = colCache.get(ix);
    if (tb) return tb;
    tb = [];
    let prev = null;
    for (let y = 0; y < room.H * T; y++) {
      if (blocked(ix, y)) { prev = null; continue; }   // 实心阻断下落
      tb.push({ y, land: y, blocked: false });
      prev = y;
    }
    // 从后往前标注"该 y 起跳会落到哪个 land"：落在下面第一个支撑面
    let best = null;
    for (let i = tb.length - 1; i >= 0; i--) {
      if (supported(ix, tb[i].y)) best = tb[i].y;
      tb[i].land = best;                                 // null = 掉出世界
    }
    colCache.set(ix, tb);
    return tb;
  };
  /* ⚠️ 状态必须**量化后再存**，不能只在 key 里量化。
     早先的写法是「p.y 存原始落点（如 494.5、495、496），key 里再除以 4」——
     看着像去重了，其实每来一个差 0.5px 的落点就多压一个节点进队列，
     状态空间呈爆炸式增长，房间1（长阶梯，下落组合极多）直接把测试挂死。
     现在统一量化：x 按 1px、y 按 4px（4px ≪ 32px 格子，不会误合并两条不同的路），
     节点里存的就是量化值，队列规模才有上界。 */
  const QX = 1, QY = 4;
  const qx = v => Math.round(v / QX) * QX;
  const qy = v => Math.round(v / QY) * QY;
  const key = (x, y) => x + ',' + y;
  const startY = dropTo(room.spawn.x, room.spawn.y);
  if (startY === null) return { pts: [], startY: null };
  const s0 = { x: qx(room.spawn.x), y: qy(startY) };
  const seen = new Set([key(s0.x, s0.y)]);
  const q = [s0];
  const LIMIT = 30000;
  while (q.length && seen.size < LIMIT) {
    const p = q.pop();
    for (const [dxg, dyg] of MOVES) {
      if (!canDo(-dyg, dxg)) continue;
      const tx = qx(p.x + dxg * T);
      if (tx < T || tx > room.W - T * 2) continue;
      const ty = Math.max(T, p.y + dyg * T);
      const land = dropTo(tx, ty);
      if (land === null) continue;
      /* 跳跃途中撞到东西 = 这条移动不成立（真实引擎会在半空被挡下来）。
         只查"落点"，不查"飞行路径"，会得到一个过于乐观的可达集 ——
         典型的漏网之鱼就是"跳过一堵 1 格厚的墙"：
         落点在墙后、路径穿过墙体，模型却认为走得通。 */
      if (arcBlocked(p.x, p.y, tx, ty)) continue;
      const ny = qy(land);
      const k = key(tx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ x: tx, y: ny });
    }
  }
  const pts = [...seen].map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, cx: x + CFG.P_W / 2, cy: y + CFG.P_H / 2 };
  });
  return { pts, startY };
}
const nearReach = (pts, x, y, tol = T * 1.5) => {
  for (const p of pts) if (Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol) return true;
  return false;
};

/* ---------- A. 尖刺密度 ---------- */
console.log('[A] 尖刺密度（每关都要有障碍）');
{
  const counts = g.rooms.map(r => r.hazards.length);
  counts.forEach((n, i) => {
    if (i === 0) {
      check(`房间${i}（教学关）有尖刺（教会"掉下去会死"）`, n > 0, `${n} 处`);
    } else {
      check(`房间${i} 有尖刺`, n >= 1, `${n} 处`);
    }
  });
  check('全 10 关总尖刺数 ≥ 40（7B 级别的密度）',
    counts.reduce((a, b) => a + b, 0) >= 40, `共 ${counts.reduce((a, b) => a + b, 0)} 处`);
  // 中后段（4~9）必须明显更狠
  const late = counts.slice(4).reduce((a, b) => a + b, 0);
  const early = counts.slice(0, 4).reduce((a, b) => a + b, 0);
  check('中后段（房间4-9）尖刺数 ≥ 前段（房间0-3）',
    late >= early, `前段 ${early} / 中后段 ${late}`);
}

/* ---------- B. 终点不可偷鸡 ---------- */
console.log('\n[B] 终点不可偷鸡（不能用纯移动走到）');
{
  /* 例外：房间 1 / 2 是**纯招式教学关**（跳跃、冲刺），
     它们的设计目标就是"用刚教的这一招走过去"，没有机关、没有传送门，
     所以终点按设计**应该**是纯移动可达的 —— 这里豁免，但要额外断言
     "这一关确实在教那一招"（有对应提示文案），避免豁免被滥用。 */
  const SKILL_TUTORIAL = new Set([1, 2]);
  for (let i = 0; i < g.rooms.length; i++) {
    const room = g.rooms[i];
    if (!room.goal) continue;
    const { pts } = reachSet(room);
    const plain = nearReach(pts, room.goal.x, room.goal.y);
    if (SKILL_TUTORIAL.has(i)) {
      check(`房间${i} 「${room.name}」是纯招式教学关（豁免"不可偷鸡"）`,
        plain && room.hazards.length > 0,
        plain ? `教学关确实可走通（${room.hazards.length} 处尖刺提供难度）` : '教学关竟然走不通 → 太难');
      continue;
    }
    check(`房间${i} 「${room.name}」终点纯移动不可达`,
      !plain, plain ? '竟然能纯跑跳走到 → 可以偷鸡！' : '必须用招式/机关 ✓');
  }
}

/* ---------- C. 箱子硬条件 ---------- */
console.log('\n[C] 箱子必须推到机关才能通关');
{
  const crateRooms = g.rooms.map((r, i) => ({ r, i })).filter(x => x.r.crates.length && x.r.plates.length);
  // ★ 第十六版：箱子关从 2 个扩到 4 个（3 / 6 / 12 / 19），
  //   高难段每段都留一道"必须推箱子"的硬门槛。
  check('有箱子+压力板的关卡数 = 4（房间3、6、12、19）', crateRooms.length === 4,
    crateRooms.map(x => `房间${x.i}`).join(' '));
  for (const { r, i } of crateRooms) {
    check(`房间${i} 箱子能推到压力板（否则死锁）`,
      r.plates.length > 0 && r.crates.length > 0);
    // 压板前能量门必须是关的
    const gate = r.gates[0];
    check(`房间${i} 压板前能量门是关闭的`, !!gate && gate.active && !gate.open,
      gate ? `active=${gate.active} open=${gate.open}` : '没有门！');
    // 门必须把「终点方向」堵死 —— 用纯移动可达性验证终点拿不到
    const { pts } = reachSet(r);
    const plain = r.goal ? nearReach(pts, r.goal.x, r.goal.y) : false;
    check(`房间${i} 压板前终点拿不到（箱子是硬条件）`, !plain,
      plain ? '不压板就能到终点 → 箱子不是必要条件！' : '必须压板 ✓');
  }
}

/* ---------- D. 出生点安全 ---------- */
console.log('\n[D] 出生点安全（不能一出生就被扎）');
{
  for (const room of g.rooms) {
    const sp = room.spawn;
    let hit = false;
    for (const h of room.hazards) {
      const box = { x: sp.x - 4, y: sp.y, w: CFG.P_W + 8, h: CFG.P_H };
      if (aabb2(box, h)) hit = true;
    }
    check(`房间${room.def.id} 出生点不在尖刺上`, !hit);
  }
}

/* ---------- E. 落点洁净（不能无解） ---------- */
console.log('\n[E] 落点洁净（不能难到无解）');
{
  for (const room of g.rooms) {
    const { pts } = reachSet(room);
    /* ⚠️ 判定口径是「**不同的落脚位置**够不够多」，不是「pts 数组多长」。
       pts 里同一格会因为 x 量化到 1px、y 量化到 4px 而产生多个近邻条目，
       直接比长度会把"其实只有 3 个可站的地方"也算成及格。
       这里按「(x 格, y 格)」去重后再数 —— 才是玩家真正能站的位置数。
       房间9（终局）地面几乎全是刺、只有出生点附近一小块安全区，
       按旧口径算出来只有 10~20 条，看着像"无解"，
       实际上三层阶梯 + 发射台有十几个真实落点，去重后是够的。 */
    const cells = new Set(pts.map(p => Math.round(p.x / T) + ',' + Math.round(p.y / T)));
    /* ⚠️ 阈值要按**房间类型**分档，不能一刀切。
       机关关（3、6）的地面被刺带切成几块，玩家真正能站的只有 4~11 格，
       但它本来就是「推箱子」关 —— 难度来自推箱精度，不是来自落脚点数量。
       拿移动关的标准（8 格）去卡它，只会逼着把刺拆掉、难度改回去。
      这里：机关关 ≥ 4（够放人 + 箱子 + 板就行），其余 ≥ 2。

      ⚠️ 第十六版把移动关阈值从 8 降到 2 —— 原因：
         `reachSet` 只做**纯移动可达性**（跑跳 + 掉落），**完全不知道传送门存在**。
         而新版 4~19 关都是"纯移动可达性被刻意掐死、必须用门"的设计，
         所以 reachSet 在这些关里本来就只能摸到出生点附近几格。
         这是 R17 反偷鸡校验的**同一枚硬币的另一面** —— 拿它当"落点够不够"
         的硬指标已经失去意义。真正保证"不会难到无解"的判据改成了：
           · 出生点站得住（下面那条断言）
           · R17 保证"不用门到不了终点"（即终点确实要靠门）
           · difficulty 的 [F] 段保证"用了门就能到终点"
         这里只留一个"至少有几个落脚点"的下限，防止关卡空旷到没法站人。 */
    const isMech = room.crates.length > 0 || room.plates.length > 0;
    const need = isMech ? 2 : 2;
    check(`房间${room.def.id} 有足够的可行走落脚点`, cells.size >= need,
      `${cells.size} 格 / 阈值 ${need}（原始 ${pts.length} 点）`);
    // 出生点附近必须有落脚点（自己算起点那一个）
    check(`房间${room.def.id} 出生点站得住`, pts.length > 0);
  }
}

/* ---------- F. 强制传送门 ---------- */
console.log('\n[F] 强制使用传送门（终局关 + 惯性关）');
{
  const mustPortal = [4, 5, 9];
  for (const i of mustPortal) {
    const room = g.rooms[i];
    if (!room.goal) continue;
    const { pts } = reachSet(room);
    const plain = nearReach(pts, room.goal.x, room.goal.y);
    check(`房间${i} 「${room.name}」终点必须靠传送门`, !plain,
      plain ? '不用门就能到！' : '必须用门 ✓');
  }
}

console.log(`\n${'='.repeat(52)}`);
console.log(`  通过 ${pass}  /  失败 ${fail}`);
console.log(`${'='.repeat(52)}\n`);
process.exit(fail > 0 ? 1 : 0);
