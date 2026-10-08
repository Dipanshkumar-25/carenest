/* Spectral Drape: a glowing sheet of dots folding in 3D. Needs <canvas id="drape">. */
(function () {
  const c = document.getElementById('drape'), g = c.getContext('2d');
  const COLS = 90, ROWS = 46, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W, H, D, t = 0, mx = 0, my = 0;
  function size() { D = Math.min(devicePixelRatio || 1, 2); W = c.width = innerWidth * D; H = c.height = innerHeight * D; }
  addEventListener('resize', size); size();
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });
  function draw() {
    const day = document.documentElement.dataset.theme === 'light';
    g.globalCompositeOperation = 'source-over'; g.fillStyle = day ? '#f1f2fa' : '#0a0a0a'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = day ? 'source-over' : 'lighter';
    const k = Math.min(W, H * 1.8) * 0.42, a = 0.5 + mx * 0.6, b = -0.35 + my * 0.4;
    for (let i = 0; i < COLS; i++) {
      const u = i / (COLS - 1) - 0.5;
      for (let j = 0; j < ROWS; j++) {
        const v = j / (ROWS - 1) - 0.5;
        const X = u * 3.2, Y = v * 1.8 + Math.sin(u * 6 + t * 0.8) * 0.12;
        const Z = (Math.sin(u * 5 + t * 0.6) * 0.35 + Math.sin(v * 4 - t * 0.5 + u * 3) * 0.25) * 1.6 + Math.cos(v * 3 + t * 0.4) * 0.3;
        const x1 = X * Math.cos(a) + Z * Math.sin(a), z1 = -X * Math.sin(a) + Z * Math.cos(a);
        const y1 = Y * Math.cos(b) - z1 * Math.sin(b), z2 = Y * Math.sin(b) + z1 * Math.cos(b);
        const s = 4 / (4 + z2);
        const hue = (200 + (u + 0.5) * 150 + z2 * 40 + t * 8) % 360;
        g.fillStyle = day ? `hsla(${hue},80%,52%,${Math.min(0.7, 0.1 + 0.5 * s * s)})` : `hsla(${hue},95%,62%,${Math.min(0.85, 0.12 + 0.55 * s * s)})`;
        g.beginPath(); g.arc(W / 2 + x1 * k * s, H * 0.55 + y1 * k * s, 1.5 * D * s, 0, 6.283); g.fill();
      }
    }
  }
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  (function loop() { draw(); if (!still) { t += 0.012; requestAnimationFrame(loop); } })();
})();
