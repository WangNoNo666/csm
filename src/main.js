/* ============================================================
   主体：主循环 + 玩家绘制 + HUD
   ============================================================ */

const canvas = document.getElementById('game');
const game = new Game(canvas);
let DPR = 1;

function fit() {
  const wrap = document.getElementById('stage');
  const maxW = wrap.clientWidth;
  const maxH = wrap.clientHeight;
  const aspect = (CFG.ROOM_W * CFG.TILE) / (CFG.ROOM_H * CFG.TILE);
  let w = maxW, h = w / aspect;
  if (h > maxH) { h = maxH; w = h * aspect; }
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  game.renderer.resize(Math.round(w), Math.round(h), DPR);
  canvas.style.width = Math.round(w) + 'px';
  canvas.style.height = Math.round(h) + 'px';
}
addEventListener('resize', fit);

/* ---------------------- 玩家绘制 ---------------------- */
function drawPlayer(g, p, cam, time) {
  const x = p.cx - cam.x, y = p.cy - cam.y;

  // 高速拖尾（传送门惯性的速度残影）
  if (p.trail.length > 1) {
    g.save();
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      const a = (t.t / 0.22) * (i / p.trail.length) * 0.5;
      g.globalAlpha = a;
      g.fillStyle = '#7fd4ff';
      const s = 6 * (i / p.trail.length) + 2;
      g.fillRect(t.x - cam.x - s / 2, t.y - cam.y - s / 2, s, s);
    }
    g.restore();
  }

  g.save();
  g.translate(x, y);
  g.scale(p.squashX, p.squashY);

  const w = p.w, h = p.h;

  if (p.coyote > 0 && !p.grounded && p.coyoteFx > 0.01) {
    g.strokeStyle = `rgba(255,220,140,${p.coyoteFx * 0.8})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, h / 2 + 3, 7 + (1 - p.coyoteFx) * 4, 0, 7); g.stroke();
  }

  // ★ 空中跳（原凌波微步/超级跳的位置）：白色小气环
  if (p.airJumpFx > 0.01) {
    const k = 1 - p.airJumpFx;
    g.strokeStyle = `rgba(190,240,255,${p.airJumpFx * 0.8})`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 8 + k * 16, 0, 7); g.stroke();
  }
  // 墙跳：蹬墙那一侧爆一圈白
  if (p.wallJumpFx > 0.01) {
    const k = 1 - p.wallJumpFx;
    g.strokeStyle = `rgba(220,235,255,${p.wallJumpFx * 0.8})`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 2, 8 + k * 16, 0, 7); g.stroke();
  }
  // 贴墙下滑：墙面一侧的小摩擦线
  if (p.wallSlide && p.wallDir !== 0) {
    g.strokeStyle = 'rgba(200,225,255,.5)';
    g.lineWidth = 1.4;
    const sx = p.wallDir * (w / 2 + 2);
    for (let i = 0; i < 3; i++) {
      const yy = -4 + i * 5 + (time * 40 % 5);
      g.beginPath();
      g.moveTo(sx, yy); g.lineTo(sx + p.wallDir * 3, yy + 3);
      g.stroke();
    }
  }

  // 身体
  const bodyGrd = g.createLinearGradient(0, -h / 2, 0, h / 2);
  bodyGrd.addColorStop(0, '#f2f7ff');
  bodyGrd.addColorStop(1, '#c9d9f0');
  g.fillStyle = bodyGrd;
  roundRect(g, -w / 2, -h / 2, w, h, 3.2);
  g.fill();

  // 边缘光
  g.strokeStyle = 'rgba(255,255,255,.85)';
  g.lineWidth = 1;
  roundRect(g, -w / 2, -h / 2, w, h, 3.2);
  g.stroke();
  g.shadowBlur = 0;

  // 眼睛（朝向）
  const ex = p.facing * 2.2;
  const blink = (Math.sin(time * 2.2) > 0.97) ? 0.15 : 1;
  g.fillStyle = '#1d2740';
  g.fillRect(ex - 2.6, -3.4, 2.2, 3.4 * blink);
  g.fillRect(ex + 0.9, -3.4, 2.2, 3.4 * blink);

  // 围巾（表现动感）
  const vlen = clamp(Math.hypot(p.vx, p.vy) / 200, 0.25, 2.2);
  const wind = -p.vx * 0.03;
  g.strokeStyle = '#ff6b8a';
  g.lineWidth = 2.6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-p.facing * (w / 2 - 1), -h / 2 + 3);
  g.quadraticCurveTo(
    -p.facing * (w / 2 + 5 * vlen) + wind, -h / 2 + 5 - 3 * vlen,
    -p.facing * (w / 2 + 9 * vlen) + wind * 1.6, -h / 2 + 4 + 5 * vlen
  );
  g.stroke();

  g.restore();
}

function drawBox(g, b, cam, time) {
  const x = b.x - cam.x, y = b.y - cam.y;
  g.save();
  const grd = g.createLinearGradient(x, y, x, y + b.h);
  grd.addColorStop(0, '#c8a06a');
  grd.addColorStop(1, '#8d6a3e');
  g.fillStyle = grd;
  roundRect(g, x, y, b.w, b.h, 3);
  g.fill();
  g.strokeStyle = '#5f4626';
  g.lineWidth = 1.5;
  roundRect(g, x, y, b.w, b.h, 3);
  g.stroke();
  // 木纹
  g.strokeStyle = 'rgba(90,66,34,.5)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + 2, y + b.h / 2); g.lineTo(x + b.w - 2, y + b.h / 2);
  g.moveTo(x + b.w / 2, y + 2); g.lineTo(x + b.w / 2, y + b.h - 2);
  g.stroke();
  // 符文（提示可穿传送门）
  g.fillStyle = 'rgba(120,220,255,.55)';
  g.beginPath(); g.arc(x + b.w / 2, y + b.h / 2, 2.6 + Math.sin(time * 3) * 0.5, 0, 7); g.fill();
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---------------------- 渲染一帧 ---------------------- */
function render() {
  const g = game.renderer.g;
  const camBase = game.cam;
  const sh = game.shakeOffset;

  game.renderer.clear();

  // 传送门激活时，先画"门中世界"（在房间之上、实体之下）
  const cam = { x: camBase.x - sh.x, y: camBase.y - sh.y };

  game.renderer.drawBackground(game, cam);

  // 房间几何
  game.renderer.drawRoom(game, cam, 1, null);

  // 门内的视图
  const P = game.portals;
  if (P.ready && P.a.roomId === game.roomId || (P.a.active && P.b.active)) {
    // 先画"远处那扇门"的视图（递归层）
    for (const p of [P.a, P.b]) {
      const o = P.other(p);
      if (!p.active || !o.active) continue;
      // 只画与当前房间相关联的门
      if (p.roomId !== game.roomId && o.roomId !== game.roomId) continue;
      if (p.roomId !== game.roomId) continue;
      game.renderer.drawPortalView(game, cam, p, o, 0);
    }
  }

  // 房间内的机关（门/移动块在墙之上）
  for (const gt of game.room.gates) { g.save(); g.translate(-cam.x, -cam.y); gt.draw(g); g.restore(); }
  for (const mv of game.room.movers) { g.save(); g.translate(-cam.x, -cam.y); mv.draw(g); g.restore(); }

  // 危险区
  for (const h of game.room.hazards) { g.save(); g.translate(-cam.x, -cam.y); h.draw(g); g.restore(); }

  // 压力板 / 拉杆
  for (const pl of game.room.plates) { g.save(); g.translate(-cam.x, -cam.y); pl.draw(g); g.restore(); }
  for (const lv of game.room.levers) { g.save(); g.translate(-cam.x, -cam.y); lv.draw(g); g.restore(); }

  // 水晶 / 终点
  for (const c of game.room.crystals) { g.save(); g.translate(-cam.x, -cam.y); c.draw(g); g.restore(); }
  if (game.room.goal) { g.save(); g.translate(-cam.x, -cam.y); game.room.goal.draw(g); g.restore(); }

  // 世界内浮字提示（走到跟前才淡入）
  for (const t of game.room.texts) {
    if (t.alpha <= 0.01) continue;
    g.save();
    g.globalAlpha = t.alpha;
    g.translate(t.x - cam.x, t.y - cam.y);
    drawWorldHint(g, t, game.time);
    g.restore();
  }

  // 箱子
  for (const b of game.room.crates) drawBox(g, b, cam, game.time);

  // 玩家
  if (!game.won || game.winT < 6) drawPlayer(g, game.player, cam, game.time);

  // 粒子
  g.save(); g.translate(-cam.x, -cam.y);
  game.fx.draw(g);
  g.restore();

  // 门壳（最上层，保证发光可见）
  for (const p of [P.a, P.b]) {
    if (p.active && p.roomId === game.roomId) game.renderer.drawPortalShell(game, cam, p, game.time);
  }
  // 如果有门在别的房间，画一个指向提示
  for (const p of [P.a, P.b]) {
    if (p.active && p.roomId !== game.roomId) {
      drawRemotePortalMarker(g, cam, p, game);
    }
  }

  // 房间切换扫场
  if (game.transition > 0.01) {
    const t = game.transition;
    const W = game.renderer.W, H = game.renderer.H;
    g.save();
    g.globalAlpha = Math.min(1, t * 1.5);
    g.fillStyle = '#eaf4ff';
    g.fillRect(0, 0, W, H * Math.max(0, (t - 0.55) * 2.2));
    g.fillRect(0, H * Math.min(1, 1 - t * 2.0), W, H);
    g.restore();
  }

  drawHUD(g, game);
}

function drawRemotePortalMarker(g, cam, p, game) {
  const r = game.rooms[p.roomId];
  if (!r) return;
  // 在屏幕边缘显示一个小箭头 + 颜色点
  const px = p.x - cam.x, py = p.y - cam.y;
  const t = game.time;
  g.save();
  g.globalAlpha = 0.55 + Math.sin(t * 4) * 0.15;
  g.strokeStyle = p.color;
  g.lineWidth = 2;
  g.beginPath(); g.arc(clamp(px, 18, game.renderer.W - 18), clamp(py, 18, game.renderer.H - 18), 7, 0, 7); g.stroke();
  g.fillStyle = p.color;
  g.beginPath(); g.arc(clamp(px, 18, game.renderer.W - 18), clamp(py, 18, game.renderer.H - 18), 3, 0, 7); g.fill();
  g.restore();
}

/* ---------------------- HUD ---------------------- */

/** 底部操作提示：完全跟随自定义键位 */
function hudKeyLine() {
  const k = (a) => keyLabel(KEYBINDS[a]);
  return `${k('left')}${k('right')} 移动 · ${k('jump')} 跳/空跳 · ${k('down')} 快降 · `
    + `${k('portal')}/${k('portal2')} 开门 · ${k('clear')} 清门 · ${k('reset')} 重生`;
}

/** 世界内的浮字提示：小气泡 + 下指箭头 */
function drawWorldHint(g, t, time) {
  const bob = Math.sin(time * 2 + t.x * 0.03) * 2.5;
  g.font = '600 11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  g.textAlign = 'center';
  const tw = g.measureText(t.text).width;
  const w = tw + 20, h = 22;
  const bx = -w / 2, by = -h - 10 + bob;

  // 气泡
  g.fillStyle = 'rgba(8,14,26,.88)';
  roundRect(g, bx, by, w, h, 6); g.fill();
  g.strokeStyle = 'rgba(140,210,255,.55)'; g.lineWidth = 1;
  roundRect(g, bx, by, w, h, 6); g.stroke();

  // 下指小三角
  g.fillStyle = 'rgba(8,14,26,.88)';
  g.beginPath();
  g.moveTo(-4, by + h - 0.5);
  g.lineTo(4, by + h - 0.5);
  g.lineTo(0, by + h + 6);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(140,210,255,.55)';
  g.beginPath();
  g.moveTo(-4, by + h); g.lineTo(0, by + h + 6); g.lineTo(4, by + h);
  g.stroke();

  // 文字
  g.fillStyle = '#e2f0ff';
  g.textBaseline = 'middle';
  g.fillText(t.text, 0, by + h / 2 + 0.5);
  g.textBaseline = 'alphabetic';
}

function drawHUD(g, game) {
  const W = game.renderer.W;
  g.save();

  // 房间名 / 进度
  g.font = '600 13px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  g.textAlign = 'left';
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, 0, W, 34);
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.fillText(`${game.roomId + 1} / ${game.rooms.length}  ·  ${game.room.name}`, 14, 22);

  // 空中跳状态（显示剩余次数）★ 第十三版：冲刺已移除，这里改画「空中跳」
  const p = game.player;
  g.textAlign = 'right';
  const canAir = p.airJumpUsable;
  const n = p.airJumps, maxShown = Math.max(1, CFG.AIR_JUMP_MAX);
  g.fillStyle = canAir ? '#8fe3ff' : 'rgba(255,255,255,.28)';
  g.fillText('空跳', W - 14 - 12 - Math.max(0, n - 1) * 13, 22);
  // 剩余次数用小菱形表示
  for (let i = 0; i < maxShown; i++) {
    const cx = W - 16 - i * 13;
    g.save();
    g.translate(cx, 17);
    g.rotate(Math.PI / 4);
    g.fillStyle = i < n ? (canAir ? '#8fe3ff' : 'rgba(143,227,255,.5)') : 'rgba(255,255,255,.16)';
    g.fillRect(-3.6, -3.6, 7.2, 7.2);
    g.restore();
  }

  // 死亡数
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.fillText(`死亡 ${game.deaths}`, W / 2, 22);

  // ---- 当前目标（常驻）----
  if (game.objective && !game.won) {
    const flash = game.objFlash / 0.55;
    g.font = '600 13px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    g.textAlign = 'left';
    const tw = g.measureText(game.objective).width;
    const bw = tw + 46, bx = W / 2 - bw / 2, by = 42;
    g.fillStyle = 'rgba(10,18,32,.78)';
    roundRect(g, bx, by, bw, 28, 8); g.fill();
    g.strokeStyle = flash > 0.01
      ? `rgba(255,214,110,${0.4 + flash * 0.6})`
      : 'rgba(120,200,255,.32)';
    g.lineWidth = flash > 0.01 ? 1.8 : 1;
    roundRect(g, bx, by, bw, 28, 8); g.stroke();
    // 小三角指示
    g.fillStyle = flash > 0.01 ? '#ffd76e' : '#6fc7ff';
    g.beginPath();
    g.moveTo(bx + 13, by + 11); g.lineTo(bx + 21, by + 14); g.lineTo(bx + 13, by + 17);
    g.closePath(); g.fill();
    g.fillStyle = flash > 0.01 ? '#ffe9a8' : '#dceaff';
    g.fillText(game.objective, bx + 28, by + 18.5);
  }

  // ---- 目标方向指示（世界外的目标在屏幕边缘画箭头）----
  if (game.objArrow && !game.won) {
    const cam = game.cam;
    const sx = game.objArrow.x - cam.x;
    const sy = game.objArrow.y - cam.y;
    const M = 26;
    const inX = sx > M && sx < W - M, inY = sy > M && sy < game.renderer.H - M;
    if (!inX || !inY) {
      const cxs = clamp(sx, M, W - M), cys = clamp(sy, M, game.renderer.H - M);
      const ang = Math.atan2(sy - cys, sx - cxs);
      g.save();
      g.translate(cxs, cys);
      g.rotate(ang);
      g.globalAlpha = 0.55 + Math.sin(game.time * 5) * 0.18;
      g.fillStyle = '#ffd76e';
      g.beginPath();
      g.moveTo(11, 0); g.lineTo(-7, -7.5); g.lineTo(-3, 0); g.lineTo(-7, 7.5);
      g.closePath(); g.fill();
      g.restore();
      g.globalAlpha = 1;
    }
  }

  // 提示条
  if (game.hintTimer > 0 && game.currentHint) {
    const a = clamp(game.hintTimer, 0, 1) * clamp((4.2 - game.hintTimer) * 4 + 1, 0, 1);
    g.globalAlpha = Math.min(1, a);
    g.font = '500 13px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    const tw = g.measureText(game.currentHint).width;
    const bx = W / 2 - tw / 2 - 16, by = game.renderer.H - 62;
    g.fillStyle = 'rgba(8,12,22,.82)';
    roundRect(g, bx, by, tw + 32, 32, 8); g.fill();
    g.strokeStyle = 'rgba(120,200,255,.35)'; g.lineWidth = 1;
    roundRect(g, bx, by, tw + 32, 32, 8); g.stroke();
    g.fillStyle = '#dceaff';
    g.textAlign = 'center';
    g.fillText(game.currentHint, W / 2, by + 21);
    g.globalAlpha = 1;
  }

  // 传送门状态小卡
  g.textAlign = 'left';
  g.font = '600 11px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
  const P = game.portals;
  let bx = 14, by = game.renderer.H - 30;
  const items = [
    { key: keyLabel(KEYBINDS.portal), p: P.a, label: '蓝门' },
    { key: keyLabel(KEYBINDS.portal2), p: P.b, label: '橙门' },
  ];
  for (const it of items) {
    const act = it.p.active;
    g.globalAlpha = 0.95;
    g.fillStyle = 'rgba(8,12,22,.7)';
    roundRect(g, bx, by, 78, 22, 6); g.fill();
    g.strokeStyle = act ? it.p.color : 'rgba(255,255,255,.18)';
    g.lineWidth = 1.2;
    roundRect(g, bx, by, 78, 22, 6); g.stroke();
    g.fillStyle = act ? it.p.color : 'rgba(255,255,255,.4)';
    g.beginPath(); g.arc(bx + 13, by + 11, 4, 0, 7); g.fill();
    g.fillStyle = act ? '#e8f2ff' : 'rgba(255,255,255,.45)';
    g.fillText(`${it.key} ${it.label}${act ? '' : ' —'}`, bx + 22, by + 15);
    bx += 86;
  }

  // 操作提示（常驻，右下角）—— 键位跟随自定义设置实时变化
  g.textAlign = 'right';
  g.font = '500 11px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
  g.fillStyle = 'rgba(255,255,255,.32)';
  g.fillText(hudKeyLine(), W - 14, game.renderer.H - 16);

  // 本关通过（过场）：金色横幅 + 下一关预览
  if (game.levelClear) {
    const t = clamp((CFG.LEVEL_CLEAR_DELAY - game.levelClearT) / 0.28, 0, 1);
    g.globalAlpha = t * 0.82;
    g.fillStyle = '#050810';
    g.fillRect(0, 0, W, game.renderer.H);
    g.globalAlpha = t;
    g.textAlign = 'center';
    g.fillStyle = '#ffd76e';
    g.font = '700 30px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    g.fillText(`第 ${game.roomId + 1} 关 · 通过`, W / 2, game.renderer.H / 2 - 16);
    const isLast = game.roomId >= game.rooms.length - 1;
    g.fillStyle = 'rgba(255,255,255,.82)';
    g.font = '500 14px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    const lt = game.levelTimes[game.roomId] || 0;
    g.fillText(`本关用时 ${lt.toFixed(1)} 秒`, W / 2, game.renderer.H / 2 + 16);
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.font = '500 12px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    g.fillText(isLast ? '即将结算…' : `即将进入第 ${game.roomId + 2} 关…`,
      W / 2, game.renderer.H / 2 + 46);
  }

  // 全部通关
  if (game.won) {
    g.globalAlpha = clamp(game.winT * 2, 0, 0.86);
    g.fillStyle = '#050810';
    g.fillRect(0, 0, W, game.renderer.H);
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.fillStyle = '#ffd76e';
    g.font = '700 34px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    g.fillText('全 部 通 关', W / 2, game.renderer.H / 2 - 34);
    g.fillStyle = 'rgba(255,255,255,.82)';
    g.font = '500 14px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    g.fillText(`${game.rooms.length} 关全清 · 死亡 ${game.deaths} 次 · 总用时 ${game.time.toFixed(1)} 秒`,
      W / 2, game.renderer.H / 2 + 4);
    // 每关用时一览
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.font = '500 11px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    const per = game.levelTimes.map((v, i) => `${i + 1}·${(v || 0).toFixed(0)}s`).join('   ');
    g.fillText(per, W / 2, game.renderer.H / 2 + 30);
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.font = '500 12px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    g.fillText('按 R 从第 1 关重新开始', W / 2, game.renderer.H / 2 + 60);
  }

  // 暂停
  if (game.paused) {
    g.globalAlpha = 0.6;
    g.fillStyle = '#050810';
    g.fillRect(0, 0, W, game.renderer.H);
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = '700 24px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    g.fillText('暂停', W / 2, game.renderer.H / 2);
    g.font = '500 13px -apple-system, "Segoe UI", "PingFang SC", sans-serif';
    g.fillStyle = 'rgba(255,255,255,.6)';
    g.fillText('按 Esc 继续', W / 2, game.renderer.H / 2 + 26);
  }

  g.restore();
}

/* ---------------------- 主循环 ---------------------- */
let last = performance.now();
function loop(now) {
  const raw = (now - last) / 1000;
  last = now;
  // 卡顿保护：单帧最多补 0.25s，避免"死亡螺旋"
  game.acc += Math.min(raw, 0.25);

  let steps = 0;
  while (game.acc >= CFG.DT && steps < CFG.MAX_STEPS) {
    game.input.beginStep();

    // Esc 暂停：在 beginStep 之后判定，保证边沿输入不会丢也不会重复
    if (game.input.hit('pause')) {
      game.paused = !game.paused;
      if (game.paused) game.audio.resume();
    }

    // 通关结算画面：此时 step() 会提前返回（世界已停），
    // 所以「按 R 重开」必须在这里处理，否则按键永远收不到。
    if (game.won && game.input.hit('reset')) {
      game.hardReset();
      continue;
    }

    if (!game.paused) game.step(CFG.DT);

    game.acc -= CFG.DT;
    steps++;
  }
  // 补算次数用尽说明严重掉帧，直接丢弃积压，防止越积越多
  if (steps === CFG.MAX_STEPS) game.acc = 0;

  render();
  requestAnimationFrame(loop);
}

/* ---------------------- 启动 ---------------------- */
fit();
game.start();
game.input.beginStep();
requestAnimationFrame(loop);

// 需要用户手势才能开音频
const unlock = () => { game.audio.init(); game.audio.resume(); };
addEventListener('pointerdown', unlock, { once: true });
addEventListener('keydown', unlock, { once: true });

// 暴露给调试
window.__game = game;
