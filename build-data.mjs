// Ghi data.json tĩnh cho bản deploy (GitHub Pages không chạy được server.js).
// Chạy: node build-data.mjs   -> sinh data.json ở gốc repo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CARD_DIR = path.join(ROOT, 'assets', 'cards');
const BACK_DIR = path.join(ROOT, 'assets', 'mặt sau của thẻ');
const CLOUD_DIR = path.join(ROOT, 'assets', 'mây');
const TOKEN_DIR = path.join(CARD_DIR, 'token');
const IMG = /\.(png|jpe?g|webp|avif|gif)$/i;

const rel = (p) => path.relative(ROOT, p).split(path.sep).map(encodeURIComponent).join('/');

async function listing(dir) {
  try {
    const files = (await fs.readdir(dir)).filter((f) => IMG.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return files.map((f) => ({ name: path.parse(f).name, file: rel(path.join(dir, f)) }));
  } catch { return []; }
}

const cards = [];
const walk = async (dir, group) => {
  let ents = [];
  try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (full.split(path.sep).length - ROOT.split(path.sep).length <= 3) await walk(full, group || e.name);
    } else if (IMG.test(e.name)) {
      cards.push({ name: path.parse(e.name).name, file: rel(full), group });
    }
  }
};
await walk(CARD_DIR, '');
cards.sort((a, b) => (a.group || '').localeCompare(b.group || '') ||
  a.name.localeCompare(b.name, undefined, { numeric: true }));

let meta = {};
try { meta = JSON.parse(await fs.readFile(path.join(CARD_DIR, 'titles.json'), 'utf8')); } catch { /* optional */ }
for (const o of cards) {
  const v = meta[o.name] ?? meta[o.group ? o.group + '/' + o.name : o.name];
  if (typeof v === 'string' && v.trim()) o.title = v.trim();
  else if (v && typeof v === 'object') {
    if (typeof v.title === 'string' && v.title.trim()) o.title = v.title.trim();
    if (typeof v.note === 'string' && v.note.trim()) o.note = v.note.trim();
    if (typeof v.back === 'string' && v.back.trim()) o.back = v.back.trim();
  }
}

let tokenInfo = {};
try { tokenInfo = JSON.parse(await fs.readFile(path.join(TOKEN_DIR, 'tokens.json'), 'utf8')); } catch { /* optional */ }

const data = {
  cards,
  extras: {
    backs: await listing(BACK_DIR),
    clouds: await listing(CLOUD_DIR),
    tokens: await listing(TOKEN_DIR),
    tokenInfo,
  },
};
await fs.writeFile(path.join(ROOT, 'data.json'), JSON.stringify(data, null, 1));
console.log(`data.json: ${cards.length} lá, ${data.extras.tokens.length} token, ${data.extras.backs.length} mặt sau, ${data.extras.clouds.length} mây`);
