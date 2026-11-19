// Procedural card art on <canvas>. Only used when no image is supplied for a card.
// Drop files into assets/cards/ and this never runs for them.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const PAL = {
  role:    { ink: '#1b100c', mid: '#2a1613', edge: '#120a08', accent: '#f6b347', accent2: '#ffe9c4', glow: 'rgba(246,179,71,0.28)' },
  feature: { ink: '#0e1714', mid: '#16302a', edge: '#08110e', accent: '#50bd8f', accent2: '#d6f7e6', glow: 'rgba(80,189,143,0.22)' },
};

// Font stacks with full Vietnamese coverage, best first (Windows → macOS → Linux)
const F_SERIF = '"DFVN", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
const F_MONO = '"Segoe UI Mono", "Cascadia Mono", Consolas, "DejaVu Sans Mono", ui-monospace, monospace';

const W = 1024, H = 1434;

let NOISE = null;
function noiseTile() {
  if (NOISE) return NOISE;
  const c = document.createElement('canvas'); c.width = c.height = 220;
  const x = c.getContext('2d'); const d = x.createImageData(220, 220);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 16;
  }
  x.putImageData(d, 0, 0);
  NOISE = c; return c;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (n) => ROMAN[n] || String(n);

function glyph(ctx, R, rng, accent) {
  const kind = Math.floor(rng() * 4);
  ctx.save();
  ctx.strokeStyle = accent; ctx.fillStyle = accent;
  ctx.lineWidth = 4; ctx.shadowColor = accent; ctx.shadowBlur = 26;
  if (kind === 0) {                       // rotated squares
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const s = R * (0.3 + 0.2 * i);
      ctx.save(); ctx.rotate(((i % 2 ? 1 : -1) * i * Math.PI) / 10);
      ctx.beginPath(); ctx.rect(-s, -s, s * 2, s * 2); ctx.stroke(); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.13, 0, 7); ctx.fill();
  } else if (kind === 1) {                // broken rings
    const n = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const r = R * (0.18 + 0.13 * i), a = rng() * 6.2832;
      ctx.beginPath(); ctx.arc(0, 0, r, a, a + 1.1 + rng() * 1.5); ctx.stroke();
    }
  } else if (kind === 2) {                // polygon + spokes
    const n = 3 + Math.floor(rng() * 4);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i * 6.2832) / n;
      const x = Math.cos(a) * R * 0.58, y = Math.sin(a) * R * 0.58;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62);
      ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9);
      ctx.stroke();
    }
  } else {                                // layered arcs + lattice
    for (let k = 0; k < 3; k++) {
      const r = R * (0.25 + k * 0.22);
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 6;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, -R * 0.9); ctx.lineTo(0, R * 0.9); ctx.stroke();
  }
  ctx.restore();
}

function sunburst(ctx, cx, cy, R, rng) {
  ctx.save(); ctx.translate(cx, cy);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * 6.2832 + rng() * 0.02;
    const l = 0.16 + rng() * 0.34;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62);
    ctx.lineTo(Math.cos(a) * R * (0.62 + l * 0.42), Math.sin(a) * R * (0.62 + l * 0.42));
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
  }
  ctx.restore();
}

function fitText(ctx, text, max, start, font) {
  let size = start;
  for (;;) {
    ctx.font = font.replace('%S', size);
    if (ctx.measureText(text).width <= max || size < 26) return size;
    size -= 2;
  }
}

export function makeCardArt(card) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const P = PAL[card.type] || PAL.feature;
  const rng = mulberry32(hashStr(card.title + card.type));

  // ground
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, P.ink); g.addColorStop(0.45, P.mid); g.addColorStop(1, P.edge);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // type glow
  const rg = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, 720);
  rg.addColorStop(0, P.glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

  // frame
  ctx.strokeStyle = P.accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 2.5;
  rr(ctx, 30, 30, W - 60, H - 60, 22); ctx.stroke();
  ctx.globalAlpha = 0.13; ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff';
  rr(ctx, 48, 48, W - 96, H - 96, 14); ctx.stroke();
  ctx.globalAlpha = 1;

  // corner diamonds
  ctx.fillStyle = P.accent; ctx.globalAlpha = 0.75;
  for (const [x, y] of [[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-7, -7, 14, 14); ctx.restore();
  }
  ctx.globalAlpha = 1;

  // header
  ctx.fillStyle = P.accent; ctx.globalAlpha = 0.9;
  ctx.font = `600 22px ${F_MONO}`;
  ctx.letterSpacing = '7px';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText('A R C A', 78, 126);
  ctx.textAlign = 'right';
  ctx.fillText(roman(card.index || 1) + ' / ' + roman(card.total || 1), W - 78, 126);
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;

  // emblem
  const cx = W / 2, cy = H * 0.42, R = 268;
  sunburst(ctx, cx, cy, R, rng);
  ctx.save(); ctx.translate(cx, cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, R * (0.9 + i * 0.055), 0, 7); ctx.stroke(); }
  glyph(ctx, R, rng, P.accent);
  ctx.restore();

  // holographic foil sweep
  const fg = ctx.createLinearGradient(0, H * 0.2, W, H * 0.55);
  fg.addColorStop(0, 'rgba(255,255,255,0)');
  fg.addColorStop(0.42, 'rgba(255,255,255,0.055)');
  fg.addColorStop(0.55, 'rgba(255,255,255,0.02)');
  fg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);

  // cost pip (features)
  if (card.type === 'feature' && card.cost) {
    ctx.save(); ctx.translate(148, 236);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * 6.2832) / 6;
      i ? ctx.lineTo(Math.cos(a) * 52, Math.sin(a) * 52) : ctx.moveTo(Math.cos(a) * 52, Math.sin(a) * 52);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.strokeStyle = P.accent; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = P.accent2; ctx.font = `300 46px ${F_SERIF}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(card.cost), 0, 2);
    ctx.restore();
  }

  // title block
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = P.accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W / 2 - 96, 1042); ctx.lineTo(W / 2 + 96, 1042); ctx.stroke();
  ctx.globalAlpha = 1;

  // type pill — the role must be readable on the card itself
  const isRole = card.type === 'role';
  const typeLabel = isRole ? 'LÁ ROLE' : 'LÁ TÍNH NĂNG';
  ctx.font = `600 26px ${F_MONO}`;
  ctx.letterSpacing = '6px';
  const pw = ctx.measureText(typeLabel).width + 46;
  const ph = 58, py = 1072;
  ctx.fillStyle = isRole ? 'rgba(246,179,71,0.18)' : 'rgba(80,189,143,0.16)';
  rr(ctx, W / 2 - pw / 2, py, pw, ph, ph / 2); ctx.fill();
  ctx.globalAlpha = 0.7; ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = P.accent2; ctx.textBaseline = 'middle';
  ctx.fillText(typeLabel, W / 2, py + ph / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '1px';

  const size = fitText(ctx, card.title, 860, 104, `400 %Spx ${F_SERIF}`);
  ctx.font = `400 ${size}px ${F_SERIF}`;
  ctx.fillStyle = '#f7f1e4';
  ctx.fillText(card.title, W / 2, 1268);

  // tag chips
  const tags = (card.tags || []).slice(0, 3);
  if (tags.length) {
    ctx.font = `500 22px ${F_MONO}`;
    ctx.letterSpacing = '3px';
    const pad = 24, gap = 12, hh = 46;
    const widths = tags.map((t) => ctx.measureText(t.toUpperCase()).width + pad * 2);
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (tags.length - 1)) / 2;
    tags.forEach((t, i) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.24)'; ctx.lineWidth = 1;
      rr(ctx, x, 1322, widths[i], hh, hh / 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.68)'; ctx.textAlign = 'center';
      ctx.fillText(t.toUpperCase(), x + widths[i] / 2, 1354);
      x += widths[i] + gap;
    });
    ctx.letterSpacing = '0px';
  }

  // grain
  ctx.globalAlpha = 1;
  ctx.fillStyle = ctx.createPattern(noiseTile(), 'repeat');
  ctx.fillRect(0, 0, W, H);

  // inner vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.86);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  return c;
}

export function makeCardBack(seed = 1) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed * 7919 + 13);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#180c0a'); g.addColorStop(0.5, '#2a1210'); g.addColorStop(1, '#120807');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.translate(W / 2, H / 2);
  for (let ring = 0; ring < 16; ring++) {
    const R = 110 + ring * 34;
    const n = 6 + ring * 2;
    ctx.strokeStyle = `rgba(246,179,71,${0.05 + (ring % 3) * 0.02})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 6.2832 + ring * 0.09;
      const x = Math.cos(a) * R, y = Math.sin(a) * R * 1.02;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(246,179,71,0.7)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 190, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 176, 0, 7); ctx.stroke();
  glyph(ctx, 150, rng, '#d9a961');
  ctx.restore();

  ctx.fillStyle = 'rgba(246,179,71,0.92)';
  ctx.font = `600 26px ${F_MONO}`;
  ctx.letterSpacing = '12px'; ctx.textAlign = 'center';
  ctx.fillText('A R C A', W / 2, H - 118);
  ctx.letterSpacing = '0px';

  ctx.strokeStyle = 'rgba(246,179,71,0.42)'; ctx.lineWidth = 2;
  rr(ctx, 30, 30, W - 60, H - 60, 22); ctx.stroke();
  ctx.fillStyle = ctx.createPattern(noiseTile(), 'repeat');
  ctx.fillRect(0, 0, W, H);
  return c;
}
