/* ============================================================
   最终交付验收 —— 一次跑完，确认 7 项需求全部落地
   ------------------------------------------------------------
   与其它测试套件的区别：这里不重复验证物理细节，而是做
   「端到端 + 静态"体检"」：引导数据完整性、每房间可渲染、
   键位映射、冲刺参数、界面文案是否与键位一致。
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js', 'util.js', 'input.js', 'actor.js', 'portal.js', 'player.js', 'props.js',
  'levels.js', 'fx.js', 'audio.js', 'render.js', 'game.js'];
let bundle = '';
for (const f of files) bundle += '\n' + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game, ROOMS, Room, KEYBINDS, KEY_ALIASES, ACTIONS, keyLabel, STEP_ALLOWED };\n';
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
const { CFG, Game, ROOMS, Room, KEYBINDS, KEY_ALIASES, ACTIONS, keyLabel, STEP_ALLOWED } = sb.__X;
const T = CFG.TILE;

let ok = 0, bad = 0;
const chk = (n, c, e = '') => {
  if (c) { ok++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); }
  else { bad++; console.log('  \u2717 ' + n + '  ' + e); }
};

console.log('=== 最终交付验收 ===\n');

/* ---- 1. 关卡规模（需求：20 个关卡 + 反偷鸡） ---- */
console.log('[关卡规模]');
{
  chk('关卡数 = 20', ROOMS.length === 20, `实际 ${ROOMS.length}`);
  const ids = ROOMS.map(r => r.id).join(',');
  chk('关卡 id 连续为 0..19',
    ids === Array.from({ length: 20 }, (_, i) => i).join(','), ids);
  const portalRooms = ROOMS.filter(r => r.needPortal).length;
  // ★ 反偷鸡硬指标：至少 14 关必须用门（用户原话"不用传送门直接跳就完了"）
  chk('强制用门关卡（needPortal ≥ 14）', portalRooms >= 14, `${portalRooms} 关`);
  const totalSteps = ROOMS.reduce((n, r) => n + (r.steps || []).length, 0);
  chk('分步引导脚本 ≥ 60 条（20 关逐关引导）', totalSteps >= 60, `${totalSteps} 条`);

  // ★ 回归：**每一关都必须有可完成的出口**（终点 or 通往别处的链接）。
  {
    const dead = [];
    for (const r of ROOMS) {
      const hasGoal = (r.map || []).some(row => String(row).includes('G'));
      const hasLink = (r.links || []).length > 0;
      // ⚠️ 房间 0 是教学关 —— 它靠"从地板缺口掉下去"推进到房间 1，
      //    既没有 'G' 也没有 links，属于设计。其余每一关都必须有出口。
      const hasExit = hasGoal || hasLink || (r.id === 0);
      if (!hasExit) dead.push(`房间${r.id} ${r.name}`);
      if (r.id === 0 && hasGoal) dead.push('房间 0 不该有终点（它是靠掉落口出去的）');
    }
    chk('除教学关外每一关都有终点或出口（无死路）',
      dead.length === 0, dead.join('; ') || '20 关全部可完成');
    const goalRooms = ROOMS.filter(r => (r.map || []).some(row => String(row).includes('G'))).length;
    // 只有房间 0（教学关，靠掉落口进房间 1）没有 'G'，其余 19 关都有。
    chk('带终点的关卡数 = 19（只有房间 0 除外）', goalRooms === 19, `${goalRooms} 关`);
  }
}

/* ---- 2. 引导数据完整性（需求 3：到了压力板关卡后知道该干什么） ---- */
console.log('\n[引导数据]');
for (const r of ROOMS) {
  chk(`房间${r.id} ${r.name} 有 objective / hint / texts`,
    !!r.objective && !!r.hint && (r.texts || []).length > 0,
    `"${r.objective}" · ${(r.texts || []).length} 条浮字`);
}
{
  const objs = ROOMS.map(r => r.objective);
  chk('各房间 objective 互不相同', new Set(objs).size === objs.length,
    `${new Set(objs).size}/${objs.length}`);
  const hintCount = ROOMS.reduce((n, r) => n + (r.texts || []).length, 0);
  chk('房内浮字总数 ≥ 30 条', hintCount >= 30, `${hintCount} 条`);
  // 压力板关（房间3）与传送门关（4/5/6）必须有分步脚本，否则玩家会卡住
  for (const rid of [3, 4, 5, 6]) {
    chk(`房间${rid} 有分步引导脚本`, (ROOMS[rid].steps || []).length > 0,
      `${(ROOMS[rid].steps || []).length} 步`);
  }

  // ★ 回归：分步脚本的 when 表达式必须真的能编译执行。
  //   compileStepExpr 内部 try/catch 会把异常吞成 false，所以
  //   「表达式写错（例如 p.py() 在真实 Player 上取不到）」不会报错，
  //   只会让引导永远停在第 1 步 —— 必须显式跑一遍才能发现。
  {
    const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576;
    const bad = [];
    const allowed = new Set([...STEP_ALLOWED]);
    let n = 0;
    // 注意：要用 g.rooms（steps 已被 compileSteps 编译出 fn），
    // 不能直接用 ROOMS（那是源定义，只有 when 字符串）。
    for (const r of g.rooms) {
      g.switchRoom(r.id, false);
      const env = g.buildStepEnv(r, g.player, g.portals, false, false);
      for (const s of (r.steps || [])) {
        n++;
        try {
          const hit = s.fn(env);
          if (typeof hit !== 'boolean') bad.push(`房间${r.id} 「${s.when}」返回 ${typeof hit}`);
        } catch (e) {
          bad.push(`房间${r.id} 「${s.when}」运行期抛错: ${e.message}`);
        }
        // 校验表达式只用了白名单标识符。
        // 注意先剔除「成员访问」中的属性名：p.cy / p.waveFx 里的 cy/waveFx
        // 不是自由标识符，而是属性名，不受白名单约束（这也是设计意图——
        // p 透传真实 Player，可以读它任何字段）。
        const expr = String(s.when || '').replace(/\.\s*[A-Za-z_$][A-Za-z0-9_$]*/g, '.');
        for (const id of expr.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) {
          if (!allowed.has(id) && !['true', 'false', 'undefined', 'null'].includes(id)) {
            bad.push(`房间${r.id} 「${s.when}」用了白名单外的 ${id}`);
          }
        }
        if (s.at && typeof s.at === 'string') {
          try { s.arrowFn(env, CFG.TILE); } catch (e) { bad.push(`房间${r.id} at「${s.at}」抛错`); }
        }
      }
    }
    chk('所有分步脚本的 when 都能真跑通（不是被 try/catch 吞成 false）',
      bad.length === 0, bad.join('; ') || `${n} 条全部可执行`);
  }
}

/* ---- 3. 每个房间都可正常渲染 + 物理推进 ---- */
console.log('\n[渲染与物理]');
{
  const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576;
  for (let rid = 0; rid < ROOMS.length; rid++) {
    g.switchRoom(rid, false);
    let err = null;
    try { for (let i = 0; i < 60; i++) g.step(CFG.DT); } catch (e) { err = e.message; }
    chk(`房间${rid} 推进 60 步无异常`, !err, err || 'OK');
  }
}

/* ---- 3b. 关卡推进流程（需求：通关后进入下一关，而不是卡住） ---- */
console.log('\n[关卡推进]');
{
  const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576;
  chk('有 win() 标记本关通过', typeof g.win === 'function');
  chk('有 advanceLevel() 切下一关', typeof g.advanceLevel === 'function');
  chk('有 hardReset() 回到第 1 关', typeof g.hardReset === 'function');
  chk('过场时长配置存在', typeof CFG.LEVEL_CLEAR_DELAY === 'number' && CFG.LEVEL_CLEAR_DELAY > 0,
    `${CFG.LEVEL_CLEAR_DELAY}s`);
  chk('初始 levelClear 为 false', g.levelClear === false);
  chk('初始 levelTimes 为空', Array.isArray(g.levelTimes) && g.levelTimes.length === 0);
  // win() 不应该直接结束游戏
  g.win();
  chk('win() 只标记本关通过，不直接判定全部通关', g.levelClear === true && g.won === false,
    `levelClear=${g.levelClear} won=${g.won}`);
}

/* ---- 4. 键位映射（需求 1 / 6 / 7） ---- */
console.log('\n[键位映射]');
{
  chk('默认 C = 跳跃', KEYBINDS.jump === 'KeyC', `实际 ${keyLabel(KEYBINDS.jump)}`);
  chk('★ 冲刺动作已被移除（KEYBINDS 里没有 dash）',
    !Object.prototype.hasOwnProperty.call(KEYBINDS, 'dash'),
    `dash=${KEYBINDS.dash}`);
  chk('默认 B = 蓝色传送门', KEYBINDS.portal === 'KeyB', `实际 ${keyLabel(KEYBINDS.portal)}`);
  chk('默认 O = 橙色传送门', KEYBINDS.portal2 === 'KeyO', `实际 ${keyLabel(KEYBINDS.portal2)}`);
  chk('默认 P = 清空传送门（腾出 C 给跳跃）', KEYBINDS.clear === 'KeyP', `实际 ${keyLabel(KEYBINDS.clear)}`);
  chk('清空键已不是 C（不再误触）', KEYBINDS.clear !== 'KeyC');
  chk('默认 ↓ = 快速下降', KEYBINDS.down === 'ArrowDown', `实际 ${keyLabel(KEYBINDS.down)}`);
  chk('默认 ← → = 左 / 右移动',
    KEYBINDS.left === 'ArrowLeft' && KEYBINDS.right === 'ArrowRight');
  chk('默认 ↑ = 上（攀爬/看）', KEYBINDS.up === 'ArrowUp');
  chk('可绑定动作 ≥ 8 个（冲刺移除后仍 ≥ 8）', ACTIONS.length >= 8, `${ACTIONS.length} 个`);
  chk('ACTIONS 里不含 dash（冲刺已移除）', !ACTIONS.some(a => a.id === 'dash'),
    ACTIONS.map(a => a.id).join(','));
  chk('所有动作都有中文标签', ACTIONS.every(a => !!a.label));

  // 兼容别名：仍可用空格 / WASD / QE
  chk('空格仍兼容为 jump', KEY_ALIASES.Space === 'jump');
  chk('W 作为 ↑ 的别名', KEY_ALIASES.KeyW === 'up');
  chk('A / D 作为左右别名', KEY_ALIASES.KeyA === 'left' && KEY_ALIASES.KeyD === 'right');
  chk('★ Shift 不再是冲刺别名（冲刺已移除）', KEY_ALIASES.ShiftLeft !== 'dash',
    `ShiftLeft=${KEY_ALIASES.ShiftLeft}`);
  chk('Q / E 仍兼容为两个门', KEY_ALIASES.KeyQ === 'portal' && KEY_ALIASES.KeyE === 'portal2');
  chk('L 兼容为清空门', KEY_ALIASES.KeyL === 'clear');

  // 自定义按键能力
  const ic = fs.readFileSync(path.join(dir, 'input.js'), 'utf8');
  chk('支持运行时改键 rebind()', /rebind\s*\(/.test(ic));
  chk('改动前会解绑冲突键（避免一键双用）', /unbind|冲突|delete\s+KEYBINDS/.test(ic));
  chk('持久化到 localStorage', /localStorage/.test(ic) && /saveBinds/.test(ic));
  chk('提供按键捕获 captureAction', /captureAction/.test(ic));
  chk('拒绝把 Escape 绑成动作键', /Escape/.test(ic));
}

/* ---- 5. 冲刺已移除，改为「空中跳」（需求 5 + ★第十三版彻底取消冲刺） ---- */
console.log('\n[空中跳参数]');
{
  // ★ 第十三版：玩家的原话是「取消冲刺（太影响平衡了）」。
  //   所以旧的所有 DASH_* 断言全部作废 —— 现在要断言的是**它们不存在**。
  const dashKeys = Object.keys(CFG).filter(k => /^DASH/.test(k));
  chk('★ CFG 里已无任何 DASH_* 参数', dashKeys.length === 0, dashKeys.join(',') || '（干净）');

  const pj = fs.readFileSync(path.join(dir, 'player.js'), 'utf8');
  chk('★ player.js 里没有 dashing / dashUsable / dashCount 残留',
    !/\bdashing\b/.test(pj) && !/dashUsable/.test(pj) && !/dashCount/.test(pj));
  chk('★ player.js 里没有 startDash / doSuperJump / doWaveDash 残留',
    !/startDash|doSuperJump|doWaveDash/.test(pj));
  chk('★ actor.js 里没有 dashT / dashCd / dashFreezeT 残留', (() => {
    const ac = fs.readFileSync(path.join(dir, 'actor.js'), 'utf8');
    return !/dashT|dashCd|dashFreezeT|dashing/.test(ac);
  })());
  chk('★ input.js 里没有 dash 动作行', (() => {
    const ic = fs.readFileSync(path.join(dir, 'input.js'), 'utf8');
    return !/id:\s*'dash'/.test(ic);
  })());

  // 替代品：空中跳。只有 1 次、比地面跳弱、落地回满。
  chk('空中跳次数上限存在（AIR_JUMP_MAX ≥ 1）', CFG.AIR_JUMP_MAX >= 1, `MAX=${CFG.AIR_JUMP_MAX}`);
  chk('★ 空中跳只有 1 次（不能当位移手段刷）', CFG.AIR_JUMP_MAX === 1, `MAX=${CFG.AIR_JUMP_MAX}`);
  chk('空中跳初速存在且为正', CFG.AIR_JUMP_SPEED > 0, `${CFG.AIR_JUMP_SPEED}`);
  chk('★ 空中跳弱于地面跳（不给额外位移）',
    CFG.AIR_JUMP_SPEED < CFG.JUMP_SPEED, `${CFG.AIR_JUMP_SPEED} < ${CFG.JUMP_SPEED}`);
  chk('玩家用 airJumps 计数', /airJumps/.test(pj));
  chk('落地后回满空中跳次数', /airJumps\s*=\s*CFG\.AIR_JUMP_MAX/.test(pj));

  // ★ 本轮两个核心修复必须有回归断言
  chk('★ 惯性保护参数存在（PORTAL_INERTIA_KEEP ≈ 1.2s）',
    CFG.PORTAL_INERTIA_KEEP >= 1.0, `keep=${CFG.PORTAL_INERTIA_KEEP}`);
  chk('★ movementX 里存在"超速不刹车"分支（overSpeed）',
    /overSpeed/.test(pj), /overSpeed/.test(pj) ? '' : '缺失');
}

/* ---- 5b. 传送门是唯一的远程位移手段（★第十三版：冲刺已移除） ---- */
console.log('\n[传送门平衡]');
{
  chk('PORTAL_R 扩大（判定范围 ≥ 20px）', CFG.PORTAL_R >= 20, `实际 ${CFG.PORTAL_R}`);
  chk('判定半宽 max(4, R-w/2) ≥ 14px',
    Math.max(4, CFG.PORTAL_R - CFG.P_W / 2) >= 14,
    `${Math.max(4, CFG.PORTAL_R - CFG.P_W / 2).toFixed(1)}px`);
  chk('开启下落吸附辅助 PORTAL_SNAP > 0', (CFG.PORTAL_SNAP || 0) > 0, `snap=${CFG.PORTAL_SNAP}`);
  chk('出门速度增益 PORTAL_EXIT_BOOST > 1', CFG.PORTAL_EXIT_BOOST > 1, `${CFG.PORTAL_EXIT_BOOST}`);
  chk('出门速度下限 PORTAL_EXIT_MIN > 0（慢进门也有位移）',
    CFG.PORTAL_EXIT_MIN > 0, `${CFG.PORTAL_EXIT_MIN}`);
  chk('★ 出门保底速度（含增益）> 跑跳速度（门必须强于普通移动）',
    CFG.PORTAL_EXIT_MIN * CFG.PORTAL_EXIT_BOOST > CFG.RUN_SPEED,
    `${(CFG.PORTAL_EXIT_MIN * CFG.PORTAL_EXIT_BOOST).toFixed(0)} vs RUN_SPEED=${CFG.RUN_SPEED}`);
  // 实测：浅落差进门 → 从墙面门横飞，位移必须 > 跑跳水平距离（实测 3.84 格）。
  // ⚠️ 这里**不能依赖某一关的具体几何** —— 关卡每轮都会重做。
  //    直接在空场里搭一个"地板 + 落地门 + 右侧墙门"的最小场景来测物理。
  chk('★ 实测浅落差出门位移 > 跑跳水平距离（3.84 格）', (() => {
    const FT = CFG.TILE;
    // 造一个 30×18 的空房：地面 16 行、右墙 20 列
    const map = [];
    for (let y = 0; y < CFG.ROOM_H; y++) {
      let row = '';
      for (let x = 0; x < CFG.ROOM_W; x++) {
        row += (y === 0 || y === CFG.ROOM_H - 1 || x === 0 || x === CFG.ROOM_W - 1
          || y === 16 || x === 20) ? '#' : ' ';
      }
      map.push(row);
    }
    const def = {
      id: 0, name: 'portal-probe', hint: '', objective: '', map, links: [],
      palette: null, texts: [], plates: [], gates: [], movers: [], hazards: [],
    };
    const r = new Room(def);
    const g2 = new Game(cv);
    g2.renderer.W = 960; g2.renderer.H = 576;
    // 手动装载这一间（不改动 ROOMS）
    g2.rooms = [r];
    g2.roomId = 0; g2.room = r;
    const SURF = 16 * FT;
    const doorX = 8 * FT + 0.5 * FT;
    g2.portals.a.place(doorX, SURF - 2, 0, 0);        // 地板门，法线朝上
    g2.portals.b.place(20 * FT, 6 * FT, 3, 0);        // 左侧墙门 → 出口朝左
    const PP = g2.player;
    PP.reset(doorX - CFG.P_W / 2, SURF - 2 - CFG.P_H - 2 * FT);
    let out = false, xOut = 0;
    for (let i = 0; i < 400; i++) {
      g2.step(CFG.DT);
      if (PP.portalCd > 0) { out = true; xOut = PP.x; break; }
    }
    if (!out) return false;
    let minX = xOut;
    for (let i = 0; i < 150; i++) { g2.step(CFG.DT); minX = Math.min(minX, PP.x); }
    return (xOut - minX) / FT > 3.84;
  })());
  // ★ 第十一版修复：墙面门放不下（竖向实心未合并）→ 现在必须能放
  chk('★ findPortalSpot 的面宽闸门已放宽到 < 1 格',
    (() => {
      const gc = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
      return /f\.to\s*-\s*f\.from\s*<\s*T\s*\*\s*0\.9/.test(gc);
    })(), '竖向 1 格高的墙面也应能放门');
  chk('★ Room.build 里有竖向实心合并（3b 通道）',
    (() => {
      const gc = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
      return /3b\)\s*纵向合并|纵向合并/.test(gc);
    })());
}

/* ---- 6. 传送门触发门槛（需求 2 / 3 / 4） ---- */
console.log('\n[传送门触发]');
{
  const pc = fs.readFileSync(path.join(dir, 'portal.js'), 'utf8');
  chk('存在"朝门内速度"闸门（vAlong ≤ -minSpeed）', /vAlong\s*>\s*-minSpeed/.test(pc));
  chk('玩家与箱子的速度阈值不同（避免误吸）', /minSpeed\s*=\s*isPlayer\s*\?\s*26\s*:\s*40/.test(pc));
  chk('存在"主动横推"通道（箱子可被推进门）', /pushIn/.test(pc));
  // ⚠️ 这里不能用「`!isPlayer` 到 `pushIn` 相距 200 字符」来判定 ——
  //    portal.js 在两者之间插入了一段解释「为什么横推速度要用 topPush」
  //    的长注释，字符串距离被撑开到 ~800 字符，正则就断了，
  //    于是这条**本来是对的**断言会误报失败。
  //    改为只检查**语义**：
  //      ① pushIn 初值必须是 false（玩家不会因为"默认值"误触发）
  //      ② 唯一的赋值点必须在 `if (!isPlayer && ...)` 里（玩家进不去）
  chk('横推通道只对非玩家实体开放（玩家在门上跑不误吸）',
    /let\s+pushIn\s*=\s*false/.test(pc) && /if\s*\(\s*!isPlayer[\s\S]*?\n\s*pushIn\s*=/.test(pc));
  chk('出口速度沿出口门法线重定向', /n_out|exit/.test(pc) && /normal/.test(pc));
}

/* ---- 7. 箱子脱困（需求 4） ---- */
console.log('\n[道具脱困]');
{
  const pp = fs.readFileSync(path.join(dir, 'props.js'), 'utf8');
  chk('PushBox 有 resolveStuck', /resolveStuck\s*\(/.test(pp));
  chk('PushBox 有 deepestOverlap', /deepestOverlap\s*\(/.test(pp));
  chk('PushBox 有 trySlideOut', /trySlideOut\s*\(/.test(pp));
  chk('PushBox 有 unstickToSpawn 兜底', /unstickToSpawn\s*\(/.test(pp));
}

/* ---- 8. 进阶操作教程（需求 4 + ★第十三版：冲刺招式全部下线） ---- */
console.log('\n[进阶操作教程]');
{
  const allText = ROOMS.map(r =>
    [r.hint, r.objective, ...(r.texts || []).map(t => t.text),
     ...(r.steps || []).map(s => s.text)].join(' ')).join(' ');
  chk('★ 教程里已不再出现"凌波微步/波冲"',
    !/凌波微步|波冲|斜冲/.test(allText) ? true : false,
    /凌波微步|波冲|斜冲/.test(allText) ? '仍有残留' : '已清理');
  chk('★ 教程里已不再出现超级跳', !/超级跳/.test(allText));
  chk('★ 教程里已不再出现"冲刺"二字', !/冲刺/.test(allText));
  chk('教程教了墙跳', /墙跳/.test(allText));
  chk('★ 教程教了"传送门弹射/惯性"（冲刺的替代位移手段）',
    /弹射|惯性/.test(allText), '');
  const legendHtml2 = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const legendBlock = (legendHtml2.match(/<div id="help">[\s\S]*?<\/div>/) || [''])[0];
  chk('进阶招式不写在下方图例里（只做进教程）',
    !/凌波微步|超级跳|墙跳/.test(legendBlock), `图例长度 ${legendBlock.length}`);
  chk('★ 图例里也没有残留的冲刺键位',
    !/冲刺/.test(legendBlock) && !/<b>X<\/b>/.test(legendBlock), '');
}

/* ---- 9. 界面文案与键位一致 ---- */
console.log('\n[界面文案]');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  chk('index.html 图例含 C 跳跃', /<b>C<\/b>\s*跳跃/.test(html));
  chk('★ index.html 图例不再含 X 冲刺', !/<b>X<\/b>\s*冲刺/.test(html));
  chk('★ index.html 图例不再出现"冲刺"', !/冲刺/.test(html));
  chk('index.html 图例含 ↓ 快速下降', /<b>↓<\/b>\s*快速下降/.test(html));
  chk('index.html 图例含 B 蓝门 / O 橙门',
    /<b>B<\/b>\s*蓝门\s*·\s*<b>O<\/b>\s*橙门/.test(html));
  chk('index.html 标注了 20 关', /20\s*关/.test(html));
  chk('index.html 有自定义按键入口（键位 / 选关 / 编辑器）', /btnBinds|btnSelect|btnEditor/.test(html));
  chk('index.html 有自定义按键入口', /btnBinds|键位设置/.test(html));

  const allText = ROOMS.map(r =>
    [r.hint, r.objective, ...(r.texts || []).map(t => t.text),
     ...(r.steps || []).map(s => s.text)].join(' ')).join(' ');
  chk('引导文案里没有残留的 Shift 冲刺说法', !/Shift/i.test(allText),
    /Shift/i.test(allText) ? '仍在提 Shift' : '已清理');
  chk('引导文案里没有残留的"空格/W 跳跃"说法', !/空格\/W|W\s*跳跃/.test(allText));
  chk('引导文案里没有残留的"Q/E 开门"说法',  !/Q\/E|Q、E/.test(allText));
  chk('引导文案里没有残留的"C 清空传送门"说法', !/C\s*清空/.test(allText));
}

console.log(`\n=== 验收：通过 ${ok} / 失败 ${bad} ===`);
process.exit(bad ? 1 : 0);
