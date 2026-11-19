// Zero-dep static server + card discovery endpoint.
// Drop images in assets/cards/ and they appear on the next refresh.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CARD_DIR = path.join(ROOT, 'assets', 'cards');
const BACK_DIR = path.join(ROOT, 'assets', 'mặt sau của thẻ');
const CLOUD_DIR = path.join(ROOT, 'assets', 'mây');
const TOKEN_DIR = path.join(CARD_DIR, 'token');
const PORT = Number(process.env.PORT) || 5173;
const IMG = /\.(png|jpe?g|webp|avif|gif)$/i;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.otf': 'font/otf', '.ttf': 'font/ttf',
};

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/extras') {
    const listing = async (dir) => {
      try {
        const files = (await fs.readdir(dir)).filter((f) => IMG.test(f))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return files.map((f) => ({
          name: path.parse(f).name,
          file: path.relative(ROOT, path.join(dir, f)).split(path.sep).map(encodeURIComponent).join('/'),
        }));
      } catch { return []; }
    };
    let tokenInfo = {};
    try { tokenInfo = JSON.parse(await fs.readFile(path.join(TOKEN_DIR, 'tokens.json'), 'utf8')); } catch { /* optional */ }
    return send(res, 200, JSON.stringify({
      backs: await listing(BACK_DIR),
      clouds: await listing(CLOUD_DIR),
      tokens: await listing(TOKEN_DIR),
      tokenInfo,
    }), MIME['.json']);
  }

  if (url.pathname === '/api/cards') {
    try {
      const out = [];
      const walk = async (dir, group) => {
        const ents = await fs.readdir(dir, { withFileTypes: true });
        for (const e of ents) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (full.split(path.sep).length - ROOT.split(path.sep).length <= 3) await walk(full, group || e.name);
          } else if (IMG.test(e.name)) {
            out.push({
              name: path.parse(e.name).name,
              file: path.relative(ROOT, full).split(path.sep).map(encodeURIComponent).join('/'),
              group,
            });
          }
        }
      };
      await walk(CARD_DIR, '');
      out.sort((a, b) => (a.group || '').localeCompare(b.group || '') ||
        a.name.localeCompare(b.name, undefined, { numeric: true }));

      // optional display names/notes: assets/cards/titles.json
      //   "1": "Quạt Thần"                    → title only
      //   "1": {"title": "Quạt Thần", "note": "Sử dụng bài được 1 điểm"}
      try {
        const meta = JSON.parse(await fs.readFile(path.join(CARD_DIR, 'titles.json'), 'utf8'));
        for (const o of out) {
          const v = meta[o.name] ?? meta[o.group ? o.group + '/' + o.name : o.name];
          if (typeof v === 'string' && v.trim()) o.title = v.trim();
          else if (v && typeof v === 'object') {
            if (typeof v.title === 'string' && v.title.trim()) o.title = v.title.trim();
            if (typeof v.note === 'string' && v.note.trim()) o.note = v.note.trim();
            if (typeof v.back === 'string' && v.back.trim()) o.back = v.back.trim();
          }
        }
      } catch { /* no titles file, or bad json */ }

      return send(res, 200, JSON.stringify(out), MIME['.json']);
    } catch {
      return send(res, 200, '[]', MIME['.json']);
    }
  }

  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');

  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) throw new Error('dir');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'not found');
  }
}).listen(PORT, () => console.log(`\n  ARCA showcase → http://localhost:${PORT}\n`));
