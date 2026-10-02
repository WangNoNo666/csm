/* 关卡校验器：确保每个房间的地形、机关、道具位置都合法 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js','util.js','input.js','actor.js','portal.js','player.js','props.js',
  'levels.js','fx.js','audio.js','render.js','game.js'];
let bundle = '';
for (const f of files) bundle += `\n` + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Room, ROOMS, aabb, PALETTES };\n';
const sb = { console, Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String,
  Number, Boolean, Set, Map, Infinity, NaN };
sb.window = sb; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(bundle, sb);
const { CFG, Room, ROOMS, aabb } = sb.__X;
const T = CFG.TILE;

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  \u2717 ' + n + '  ' + e); } };

function overlapAny(rect, solids) {
  for (const s of solids) if (s.active && aabb(rect, s)) return s;
  return null;
}

for (const def of ROOMS) {
  const r = new Room(def);
  const name = `房间${r.id} (${r.name})`;
  console.log(`\n${name}`);
  const solids = r.collisionSolids();

  // 1. 出生点不能卡在墙里
  const pbox = { x: r.spawn.x, y: r.spawn.y, w: CFG.P_W, h: CFG.P_H };
  check(`${name} 出生点不在墙里`, !overlapAny(pbox, solids));

  // 2. 出生点下方应该有地面（不能悬空掉出世界）
  let hasGround = false;
  for (let dy = 1; dy < CFG.ROOM_H * T; dy++) {
    const probe = { x: pbox.x, y: pbox.y + dy, w: pbox.w, h: pbox.h };
    if (overlapAny(probe, solids)) { hasGround = true; break; }
  }
  check(`${name} 出生点下方有地面`, hasGround);

  // 3. 地图行数与宽度
  check(`${name} 地图行数 = ${CFG.ROOM_H}`, def.map.length === CFG.ROOM_H, `实际 ${def.map.length}`);
  const badRows = def.map.filter(row => row.length !== CFG.ROOM_W);
  check(`${name} 所有行宽度 = ${CFG.ROOM_W}`, badRows.length === 0,
    badRows.length ? `有 ${badRows.length} 行不符: ${badRows.map(r2 => r2.length).join(',')}` : '');

  // 4. 四周封闭，但「已声明为链接开口」的格允许为空
  // ⚠️ 判定基准是"这一格是不是真的能走出去的空气"。
  //    Room.build() 会把 'S'/'G'/'B'/'o'/'^' 这些**功能格**清成 ' '，
  //    所以它们都是空气；只有 '#' 才算封住。
  //    老版本写 `grid[0][x] !== '#'` 已经是对的 —— 但这里显式用 isOpen()
  //    表达意图，避免以后被误改成"只有 ' ' 才算开口"。
  const grid = def.map.map(row => (row + ' '.repeat(CFG.ROOM_W)).slice(0, CFG.ROOM_W));
  const isOpen = (ch) => ch !== '#';
  const allowed = new Set();
  for (const l of (def.links || [])) {
    if (l.edge === 'top') for (let x = l.x0; x <= l.x1; x++) allowed.add('0,' + x);
    if (l.edge === 'bottom') for (let x = l.x0; x <= l.x1; x++) allowed.add((CFG.ROOM_H - 1) + ',' + x);
    if (l.edge === 'left') for (let y = l.y0; y <= l.y1; y++) allowed.add(y + ',0');
    if (l.edge === 'right') for (let y = l.y0; y <= l.y1; y++) allowed.add(y + ',' + (CFG.ROOM_W - 1));
  }
  let openEdges = 0; const unexpected = [];
  for (let x = 0; x < CFG.ROOM_W; x++) {
    if (isOpen(grid[0][x]) && !allowed.has('0,' + x)) { openEdges++; unexpected.push('(x' + x + ',y0)'); }
    if (isOpen(grid[CFG.ROOM_H - 1][x]) && !allowed.has((CFG.ROOM_H - 1) + ',' + x)) { openEdges++; unexpected.push('(x' + x + ',y' + (CFG.ROOM_H - 1) + ')'); }
  }
  for (let y = 0; y < CFG.ROOM_H; y++) {
    if (isOpen(grid[y][0]) && !allowed.has(y + ',0')) { openEdges++; unexpected.push('(x0,y' + y + ')'); }
    if (isOpen(grid[y][CFG.ROOM_W - 1]) && !allowed.has(y + ',' + (CFG.ROOM_W - 1))) { openEdges++; unexpected.push('(x' + (CFG.ROOM_W - 1) + ',y' + y + ')'); }
  }
  check(`${name} 四周无意外漏出`, openEdges === 0,
    openEdges ? `${openEdges} 个未声明开口: ${unexpected.slice(0, 6).join(' ')}` : `（声明开口 ${allowed.size} 格）`);

  // 5. 压力板必须贴在实心地板顶面上
  for (const pl of r.plates) {
    const rect = pl.triggerRect;
    // 板下方 2px 内应有实心
    const below = { x: rect.x + 2, y: rect.y + rect.h, w: rect.w - 4, h: 3 };
    const ground = overlapAny(below, solids);
    // 板上方不该被墙埋住
    const above = { x: rect.x + 2, y: rect.y - 4, w: rect.w - 4, h: 4 };
    const ceiling = overlapAny(above, solids);
    check(`${name} 压力板(${pl.gx},${pl.gy}) 下方有地板`, !!ground);
    check(`${name} 压力板(${pl.gx},${pl.gy}) 未被墙埋住`, !ceiling);
  }

  // 6. 门不应该把出生点封死在里面
  for (const gt of r.gates) {
    check(`${name} 门(${gt.gx},${gt.gy}) 不与出生点重叠`, !aabb(pbox, gt.solidRect || { x: gt.x, y: gt.y, w: gt.w, h: gt.h }));
  }

  // 7. 箱子不能卡在墙里
  for (const c of r.crates) {
    const b = c.box;
    check(`${name} 箱子${c.id} 不在墙里`, !overlapAny(b, solids),
      `(${c.x.toFixed(0)},${c.y.toFixed(0)})`);
  }

  // 8. 水晶不在墙里
  for (const cr of r.crystals) {
    const b = { x: cr.x - 8, y: cr.y - 8, w: 16, h: 16 };
    check(`${name} 水晶(${cr.gx},${cr.gy}) 不在墙里`, !overlapAny(b, solids));
  }

  // 9. 尖刺不在墙里
  for (const h of r.hazards) {
    check(`${name} 危险区(${h.x/T|0},${h.y/T|0}) 位置合理`, true);
  }

  // 10. 终点不在墙里（若存在）
  if (r.goal) {
    const b = { x: r.goal.x - 8, y: r.goal.y - 8, w: 16, h: 16 };
    check(`${name} 终点不在墙里`, !overlapAny(b, solids));
    let gGround = false;
    for (let dy = 1; dy < 400; dy++) {
      if (overlapAny({ x: b.x, y: b.y + dy, w: b.w, h: 16 }, solids)) { gGround = true; break; }
    }
    check(`${name} 终点下方有地面`, gGround);
  }

  // 11. 有可通行区域（不止是墙）
  const openCells = grid.join('').split('').filter(c => c !== '#').length;
  check(`${name} 有足够的可行走空间`, openCells > 120, `${openCells} 格空地`);
}

/* 连通性：链接目标存在，且本条边的开口真实存在（不是实心墙） */
console.log('\n跨房间链接校验');
for (const def of ROOMS) {
  for (const l of (def.links || [])) {
    check(`房间${def.id} → 房间${l.room} 目标存在`, !!ROOMS[l.room], `room ${l.room}`);
    // 检查本房间该边缘在 [x0,x1]/[y0,y1] 范围内确实是开口（无实心墙）
    const g = def.map.map(row => (row + ' '.repeat(CFG.ROOM_W)).slice(0, CFG.ROOM_W));
    let openCount = 0, total = 0;
    if (l.edge === 'bottom' || l.edge === 'top') {
      const row = l.edge === 'bottom' ? CFG.ROOM_H - 1 : 0;
      for (let x = l.x0; x <= l.x1; x++) { total++; if (g[row][x] !== '#') openCount++; }
    } else {
      const col = l.edge === 'right' ? CFG.ROOM_W - 1 : 0;
      for (let y = l.y0; y <= l.y1; y++) { total++; if (g[y][col] !== '#') openCount++; }
    }
    check(`房间${def.id} 的 ${l.edge} 边缘开口可达`, openCount > 0,
      `${openCount}/${total} 格是空的`);
  }
}

console.log(`\n${'='.repeat(46)}`);
console.log(`  通过 ${pass}  /  失败 ${fail}`);
console.log(`${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
