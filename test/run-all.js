/* 测试总入口：在同一进程内依次 require 三套测试
   （Windows 沙箱下 spawnSync 同一个 node.exe 会 EBUSY，故改为进程内执行）
   每个子测试通过覆盖 process.exit 捕获退出码与统计。 */
const path = require('path');

const suites = [
  ['关卡几何校验', 'levels.js'],
  ['物理与传送门', 'headless.js'],
  ['集成与渲染', 'integration.js'],
  ['关卡可达性', 'reachability.js'],
  ['端到端玩法', 'gameplay.js'],
  ['关卡流程推进', 'progression.js'],
  ['关卡可玩性', 'playable.js'],
  ['自定义模式', 'custom-mode.js'],
  ['分享码与地图大厅', 'sharecode.js'],
  ['本轮修复回归', 'fixes.js'],
  // 难度守卫放最后：它跑最慢，而且断言的是"整体难度与不可偷鸡"，
  // 放在其他套件之后便于一眼看出「改关卡有没有把难度改回去」。
  ['难度守卫 7B', 'difficulty.js'],
  ['交付验收', 'acceptance.js'],
];

const results = [];
let allOk = true;

for (const [name, file] of suites) {
  console.log(`\n${'\u2500'.repeat(52)}\n  ${name}\n${'\u2500'.repeat(52)}`);
  let captured = '';
  const origLog = console.log, origErr = console.error, origExit = process.exit;

  // 捕获输出与退出码
  console.log = (...a) => { captured += a.join(' ') + '\n'; };
  console.error = (...a) => { captured += a.join(' ') + '\n'; };
  let code = 0;
  process.exit = (c) => { code = c || 0; throw new Error('__EXIT__'); };

  try {
    delete require.cache[require.resolve(path.join(__dirname, file))];
    require(path.join(__dirname, file));
  } catch (e) {
    if (e.message !== '__EXIT__') captured += '  运行异常: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n') + '\n';
  } finally {
    console.log = origLog; console.error = origErr; process.exit = origExit;
  }

  for (const l of captured.split('\n').filter(l => l.includes('\u2717'))) console.log(l);
  const m = captured.match(/通过 (\d+)\s*\/\s*失败 (\d+)/);
  const p = m ? +m[1] : 0, f = m ? +m[2] : -1;
  results.push([name, p, f]);
  if (f !== 0 || code !== 0) allOk = false;
  console.log(`  → 通过 ${p} / 失败 ${f}`);
}

console.log(`\n${'='.repeat(52)}`);
let tp = 0, tf = 0;
for (const [n, p, f] of results) {
  console.log(`  ${n.padEnd(16)} 通过 ${String(p).padStart(3)}  失败 ${f < 0 ? 'ERR' : String(f).padStart(3)}`);
  tp += p; if (f > 0) tf += f;
}
console.log(`${'='.repeat(52)}`);
console.log(`  合计：通过 ${tp}  ${tf > 0 ? '\u2717 失败 ' + tf : '\u2713 全部通过'}`);
console.log(`${'='.repeat(52)}\n`);
process.exitCode = allOk ? 0 : 1;
