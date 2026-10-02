/* ============================================================
   test/sharecode.js —— 分享码编解码回归测试
   ------------------------------------------------------------
   为什么要单独测：分享码是「自定义地图大厅」的传输协议，
   一旦编解码有 off-by-one，玩家会遇到"码生成成功但导入报错"，
   而且错得很隐蔽（实测踩过两类）：
     ① 游程长度只存 1 字节 → 超过 256 的连通墙溢出 → 地图被截断
     ② 解码循环边界写成 `k + 2 < len` → 多读 1 字节 → 地图整体错位
   所以这里对**全部 20 个官方关卡**做全量往返，外加坏码拒绝。
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');

const csrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'custom.js'), 'utf8');
const grab = (re) => { const m = csrc.match(re); if (!m) throw new Error('抽取失败: ' + re); return m[0]; };

const pure = `
const CFG = { ROOM_W: 30, ROOM_H: 18 };
${grab(/const CELL_BITS = \{[\s\S]*?\n  const BITS_CELL = \[[^\]]*\];/)}
${grab(/function b64urlEncode[\s\S]*?\n  \}/)}
${grab(/function b64urlDecode[\s\S]*?\n  \}/)}
${grab(/function encodeMapBytes[\s\S]*?\n  \}\n/)}
${grab(/function decodeMapBytes[\s\S]*?\n  \}\n/)}
${grab(/function makeShareCode[\s\S]*?\n  \}\n/)}
${grab(/function parseShareCode[\s\S]*?\n  \}\n/)}
globalThis.__S = { makeShareCode, parseShareCode };
`;
const sb = {
  console, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
  Uint8Array, Error, TextEncoder, TextDecoder,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
};
sb.globalThis = sb; vm.createContext(sb); vm.runInContext(pure, sb);
const { makeShareCode, parseShareCode } = sb.__S;

const ROOMS = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'levels.js'), 'utf8') + ';ROOMS', {});

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  \u2717 ' + n + '  ' + e); }
};

let allOk = true, maxLen = 0, sumLen = 0;
for (const r of ROOMS) {
  const code = makeShareCode(r.name, r.map);
  maxLen = Math.max(maxLen, code.length); sumLen += code.length;
  let back = null;
  try { back = parseShareCode(code); } catch (e) { allOk = false; console.log('   房间' + r.id + ' 抛错: ' + e.message); continue; }
  if (back.map.join('\n') !== r.map.join('\n') || back.name !== r.name) {
    allOk = false; console.log('   房间' + r.id + ' 往返不一致');
  }
}
check('20 个官方关卡分享码全部无损往返', allOk);
check('分享码长度可控（最长 < 700 字）', maxLen < 700, `最长 ${maxLen}，平均 ${Math.round(sumLen / ROOMS.length)}`);
check('分享码只含安全字符（A-Za-z0-9-_.）', ROOMS.every(r => /^[A-Za-z0-9\-_.]+$/.test(makeShareCode(r.name, r.map))));

const bads = ['', 'hello', 'PR2.abc.xx', 'PR1.@@@.@@@', 'PR1.-.@@@', 'PR1.'];
let rejected = 0;
for (const t of bads) { try { parseShareCode(t); } catch (e) { rejected++; } }
check('坏码全部被拒绝', rejected === bads.length, `${rejected}/${bads.length}`);

// 空名字也应能走通
try {
  const c = makeShareCode('', ROOMS[1].map);
  const b = parseShareCode(c);
  check('无名关卡也能分享（名字段留空）', b.name === '' && b.map.join('\n') === ROOMS[1].map.join('\n'));
} catch (e) { check('无名关卡也能分享（名字段留空）', false, e.message); }

console.log(`\n=== 分享码：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
