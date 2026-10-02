/* ============================================================
   数学 / 几何工具
   ============================================================ */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// 与帧率无关的指数逼近
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const approach = (v, target, delta) => {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
};
const rand = (a, b) => a + Math.random() * (b - a);

/** AABB 相交（开区间，接触不算相交） */
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function aabbPadded(a, b, p) {
  return a.x < b.x + b.w + p && a.x + a.w > b.x - p && a.y < b.y + b.h + p && a.y + a.h > b.y - p;
}
function rectC(c) { return { x: c.x, y: c.y, w: c.w, h: c.h }; }
