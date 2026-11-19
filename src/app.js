import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { makeCardArt, makeCardBack, hashStr, mulberry32 } from './cardart.js';

const CARD_W = 1, CARD_H = 1.335, CARD_D = 0.024, CARD_R = 0.058;
const FLOOR_Y = -1.15;
const FAN_R = 4.0;
let STEP = 0.185;                   // fan spacing (radians), auto-tightened on narrow frames
const FOV = 42;

// two tiers: character cards in front, action cards fanned behind.
const ROWS = [
  { y: -0.17, z: 0.20, scale: 1.0, step: 0.205, rMul: 1.0 },
  { y: 0.55, z: -1.10, scale: 0.74, step: 0.150, rMul: 0.88 },
];
const CAM_HOME = new THREE.Vector3(0, 0.42, 5.15);
const CAM_FOCUS = new THREE.Vector3(0, 0.2, 3.8);
const FOCUS_Z = 1.02;               // focused card distance from camera plane
const LOOK_HOME = new THREE.Vector3(0, 0.1, 0);
const LOOK_FOCUS = new THREE.Vector3(0, 0.08, 0);

// lighting per view: the fan reads brighter, the opened card keeps its moody key
const LIGHT = {
  home:  { exp: 1.05, key: 1.3,  amb: 0.52, env: 0.24, spot: 11, rim: 13, warm: 9 },
  focus: { exp: 0.95, key: 0.95, amb: 0.34, env: 0.14, spot: 9,  rim: 10, warm: 7 },
};
let lightMix = 0;                 // 0 = fan, 1 = detail

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const DEFAULT_CARDS = [
  { title: 'Rồng', sub: 'Long Nhãn', type: 'role', tags: ['Kiểm toán'],
    desc: 'Buộc một người nộp bài riêng để lộ danh tính lá đã đánh.' },
  { title: 'Sửa', sub: 'Hành động', type: 'feature', cost: 1, tags: ['+1 điểm'],
    desc: 'Cộng 1 điểm cho Nhiệm vụ.' },
  { title: 'Lân', sub: 'Lân Chỉ', type: 'role', tags: ['Chỉ định'],
    desc: 'Ép một người vào đội đề xuất, Đội trưởng phải thay người khác ra.' },
  { title: 'Hiến Tế', sub: 'Hành động', type: 'feature', cost: 2, tags: ['+2 điểm'],
    desc: 'Cộng 2 điểm. Mỗi người chỉ dùng được một lần.' },
  { title: 'Phượng', sub: 'Phượng Dục', type: 'role', tags: ['Giải cách ly'],
    desc: 'Gỡ Cách ly, đặt Miễn trừ, đưa người đó vào đội ngay.' },
  { title: 'Phá', sub: 'Hành động', type: 'feature', cost: 2, tags: ['-2 điểm'],
    desc: 'Trừ 2 điểm của Nhiệm vụ.' },
  { title: 'Rùa', sub: 'Quy Giáp', type: 'role', tags: ['Bảo hộ'],
    desc: 'Một người không thể bị Cách ly ở cuối vòng này.' },
  { title: 'Canh Gác', sub: 'Trấn Môn', type: 'role', tags: ['Thẩm vấn'],
    desc: 'Buộc một người lật một lá chưa đánh, thu hẹp lá đã nộp.' },
];

const state = {
  cards: [], focusIdx: null, hoverIdx: null, clock: 0, ready: false,
  fitScale: 1, focusScale: 1.2, stepScale: 1, stage: 0, stage2: 0,
  tokens: [], gem: null, allTokens: [], hoverToken: null, tokScale: 1,
  pointerRaw: new THREE.Vector2(),
};

/* ------------------------------------------------------------------ data */

function typeOf(name, group) {
  const g = String(group || '').toLowerCase();
  const n = String(name).toLowerCase();
  if (/^(logo|màu|mau|bàn|ban |board|palette)/.test(n)) return 'skip';
  if (/token|ngọc|chip|marker/.test(g)) return 'token';
  if (/oánh|đòn|don|battle|action|feature|skill/.test(g)) return 'feature';
  if (/nhân vật|nhan vat|thẻ nv|role|character/.test(g)) return 'role';
  if (/^(role|character|nhan-?vat|r[-_])/.test(n)) return 'role';
  if (/^(feat|feature|skill|tinh-?nang|f[-_])/.test(n)) return 'feature';
  if (/^(token|marker|chip)/.test(n)) return 'token';
  return null;
}

function titleFrom(name) {
  return String(name)
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const norm = (s) => String(s).toLowerCase().normalize('NFC');

// Bản tĩnh (GitHub Pages) không có server.js: /api/* trả 404 nên đọc data.json.
let STATIC = null;
async function staticData() {
  if (STATIC) return STATIC;
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    STATIC = res.ok ? await res.json() : {};
  } catch { STATIC = {}; }
  return STATIC;
}

async function discoverExtras() {
  try {
    const res = await fetch('api/extras', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* fall through to data.json */ }
  return (await staticData()).extras || { backs: [], clouds: [] };
}

async function discover() {
  try {
    const res = await fetch('api/cards', { cache: 'no-store' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) return list;
    }
  } catch { /* fall through to data.json */ }
  const st = await staticData();
  return Array.isArray(st.cards) && st.cards.length ? st.cards : null;
}

function loadTexture(src) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(src, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

async function buildDeck() {
  const [found, extras] = await Promise.all([discover(), discoverExtras()]);

  // card backs: match by kind keyword, per-card override via titles.json "back"
  const backTex = {};
  await Promise.all((extras.backs || []).map(async (b) => {
    const t = await loadTexture(b.file);
    if (!t) return;
    const ia = t.image.width / t.image.height, ca = CARD_W / CARD_H;
    t.repeat.set(Math.min(1, ca / ia), Math.min(1, ia / ca));
    t.offset.set((1 - t.repeat.x) / 2, (1 - t.repeat.y) / 2);
    backTex[norm(b.name)] = t;
  }));
  const backKeys = Object.keys(backTex);
  const pickBack = (kw) => {
    const k = backKeys.find((k) => k.includes(norm(kw)));
    return k ? backTex[k] : null;
  };
  const entries = [];

  if (found) {
    for (const f of found) {
      const t = typeOf(f.name, f.group);
      if (t === 'token' || t === 'skip') continue;   // token art / logo / palette are not cards
      entries.push({ ...f, type: t });
    }
  }

  if (!entries.length) {
    return {
      cards: DEFAULT_CARDS.map((c, i) => ({
        ...c, index: i + 1, total: DEFAULT_CARDS.length,
        kindTag: c.type === 'role' ? 'nhân vật' : 'item',
        backTex: pickBack(c.type === 'role' ? 'nhân vật' : 'item'),
      })),
      extras,
    };
  }

  let alt = 0;
  const cards = entries.slice(0, 32).map((e, i) => {
    const type = e.type || (alt++ % 2 ? 'feature' : 'role');
    const base = titleFrom(e.name);
    const title = e.title || (/^\d+$/.test(base) ? 'Lá ' + base : base);
    return {
      title,
      sub: type === 'role' ? 'Nhân vật' : 'Đòn đánh',
      type,
      tags: [],
      desc: '',
      note: e.note || '',
      file: e.file,
      index: i + 1, total: Math.min(entries.length, 32),
      fromArt: true,
      kindTag: e.back || (type === 'role' ? 'nhân vật' : 'item'),
      backTex: pickBack(e.back || (type === 'role' ? 'nhân vật' : 'item')),
    };
  });

  // cover-crop each supplied image onto the card face
  await Promise.all(cards.map(async (c) => {
    const tex = await loadTexture(c.file);
    if (!tex) return;
    const ia = tex.image.width / tex.image.height, ca = CARD_W / CARD_H;
    tex.repeat.set(Math.min(1, ca / ia), Math.min(1, ia / ca));
    tex.offset.set((1 - tex.repeat.x) / 2, (1 - tex.repeat.y) / 2);
    c.tex = tex;
  }));

  return { cards, extras };
}

/* ------------------------------------------------------------- textures */

function canvasTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function radialTex(inner, outer, stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, inner, s / 2, s / 2, outer);
  for (const [p, col] of stops) g.addColorStop(p, col);
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  return canvasTex(c);
}

/* -------------------------------------------------------------- geometry */

function cardShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const SHAPE = cardShape(CARD_W, CARD_H, CARD_R);

const FACE_GEO = new THREE.ShapeGeometry(SHAPE, 14);
{
  const p = FACE_GEO.attributes.position, uv = FACE_GEO.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) + CARD_W / 2) / CARD_W, (p.getY(i) + CARD_H / 2) / CARD_H);
  }
  uv.needsUpdate = true;
}

const BODY_GEO = new THREE.ExtrudeGeometry(SHAPE, {
  depth: CARD_D, bevelEnabled: true, bevelThickness: 0.006,
  bevelSize: 0.006, bevelSegments: 3, curveSegments: 14,
});
BODY_GEO.translate(0, 0, -CARD_D / 2);

const FACE_Z = CARD_D / 2 + 0.0062;

/* --------------------------------------------------------------- shaders */

const FOIL = {
  uniforms: {
    uTime: { value: 0 },
    uA: { value: new THREE.Color('#f4d9a0') },
    uB: { value: new THREE.Color('#8fe4d8') },
    uAmt: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uAmt;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      float fres = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 2.2);
      float s = smoothstep(0.15, 1.0, sin((vUv.x*2.6 + vUv.y*1.7 + uTime*0.05) * 6.28318));
      vec3 col = mix(uA, uB, clamp(vUv.y*0.75 + vUv.x*0.25, 0.0, 1.0));
      float a = (0.05 + fres*0.5) * (0.30 + 0.70*s) * uAmt;
      gl_FragColor = vec4(col * a, a);
    }`,
};

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.62 }, uGrain: { value: 0.05 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      float ca = 0.0018 * r2;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + d * ca).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - d * ca).b;
      c *= mix(1.0, smoothstep(1.25, 0.30, r2 * 1.7), uVig);
      c += (rnd(vUv * vec2(1920.0, 1080.0) + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/* ----------------------------------------------------------------- scene */

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1415');
scene.fog = new THREE.FogExp2('#1b1415', 0.042);

const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.1, 60);
camera.position.copy(CAM_HOME);
camera.lookAt(LOOK_HOME);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
scene.environmentIntensity = 0.14;

// lights
const key = new THREE.DirectionalLight('#ffe6c2', 0.95);
key.position.set(-2.6, 3.4, 4.2);
scene.add(key);

const rim = new THREE.PointLight('#f6b347', 10, 14, 2);
rim.position.set(3.2, 1.1, 1.4);
scene.add(rim);

const warm = new THREE.PointLight('#801a18', 7, 13, 2);
warm.position.set(-3.4, -0.4, 2.2);
scene.add(warm);

const spot = new THREE.SpotLight('#fff3d8', 9, 12, 0.55, 0.6, 1.6);
spot.position.set(0, 3.6, 2.4);
spot.target.position.set(0, 0, 0.6);
scene.add(spot, spot.target);

const ambient = new THREE.AmbientLight('#2a2018', 0.34);
scene.add(ambient);

// soft backdrop so the void behind the cards is not pure black
{
  const bgTex = radialTex(0, 128, [
    [0, 'rgba(128,80,54,0.72)'],
    [0.40, 'rgba(80,46,36,0.46)'],
    [0.72, 'rgba(44,26,26,0.22)'],
    [1, 'rgba(10,8,9,0.05)'],
  ]);
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 26),
    new THREE.MeshBasicMaterial({ map: bgTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  backdrop.position.set(0, 0.9, -7.5);
  scene.add(backdrop);
}

// floor glow pool
const glowTex = radialTex(0, 128, [[0, 'rgba(190,140,80,0.45)'], [0.45, 'rgba(120,50,40,0.16)'], [1, 'rgba(0,0,0,0)']]);
const floorGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
);
floorGlow.rotation.x = -Math.PI / 2;
floorGlow.position.y = FLOOR_Y - 0.01;
scene.add(floorGlow);

// dust
{
  const N = reduced ? 220 : 520;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 11;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 5;
    pos[i * 3 + 2] = -2.5 + Math.random() * 5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(g, new THREE.PointsMaterial({
    map: radialTex(0, 64), size: 0.055, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, color: '#ecd6b4', sizeAttenuation: true,
  }));
  dust.name = 'dust';
  scene.add(dust);
}

/* ---------------------------------------------------------------- clouds */

const cloudDrift = [];
// x, y, z, width, opacity: a composed field small puffs framing the corners,
// a few big soft ones deep behind, nothing crossing the card mass (|x| < 3.4)
const CLOUD_SLOTS = [
  [-6.6, 2.6, -7.4, 2.6, 0.105],
  [7.0, 3.0, -7.8, 2.3, 0.10],
  [-5.6, -2.0, -6.6, 2.0, 0.085],
  [5.8, -1.8, -6.9, 1.9, 0.085],
  [-9.6, 1.0, -9.6, 3.2, 0.06],
  [9.8, 0.7, -10.0, 3.0, 0.06],
  [0.6, 3.6, -9.8, 2.1, 0.055],
  [3.4, 3.5, -7.2, 1.4, 0.09],
  [-3.5, 3.6, -7.6, 1.3, 0.09],
];

async function spawnClouds(list) {
  if (!list || !list.length) return;
  const rng = mulberry32(1337);
  const n = Math.min(list.length, CLOUD_SLOTS.length);
  for (let i = 0; i < n; i++) {
    const tex = await loadTexture(list[i].file);
    if (!tex) continue;
    const [x, y, z, w0, op0] = CLOUD_SLOTS[i];
    const w = w0 * (0.94 + rng() * 0.12);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: op0 * (0.92 + rng() * 0.16),
      depthWrite: false, blending: THREE.AdditiveBlending, color: '#ecd8c2',
    }));
    sp.scale.set(w, (w * tex.image.height) / tex.image.width, 1);
    sp.position.set(x, y, z);
    sp.renderOrder = -3;
    scene.add(sp);
    cloudDrift.push({
      sp, x, y,
      ax: 0.7 + rng() * 1.5, ay: 0.22 + rng() * 0.45,
      ph: rng() * 6.283, sp2: 0.45 + rng() * 0.7, rot: rng() * 6.283,
    });
  }
}

/* -------------------------------------------------------------- the cards */

const cardBackTex = canvasTex(makeCardBack(3));

const FAN_ROOT = new THREE.Group();
scene.add(FAN_ROOT);

function makeCard(data, i) {
  const group = new THREE.Group();
  const inner = new THREE.Group();       // flips
  group.add(inner);

  const rng = mulberry32(hashStr(data.title) + i * 97);
  const accent = data.type === 'role' ? '#f6b347' : '#50bd8f';

  const faceTex = data.tex || canvasTex(makeCardArt({ ...data, seed: i }));

  const faceMat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.74, metalness: 0.0,
    map: faceTex || null, envMapIntensity: 1.0,
  });

  const face = new THREE.Mesh(FACE_GEO, faceMat);
  face.position.z = FACE_Z;
  inner.add(face);

  const back = new THREE.Mesh(FACE_GEO, new THREE.MeshStandardMaterial({
    map: data.backTex || cardBackTex, roughness: 0.62, metalness: 0.1,
    envMapIntensity: 0.6, color: data.backTex ? '#ffffff' : '#c8c8c8',
  }));
  back.position.z = -FACE_Z;
  back.rotation.y = Math.PI;
  inner.add(back);

  inner.add(new THREE.Mesh(BODY_GEO, new THREE.MeshStandardMaterial({
    color: '#18100f', roughness: 0.7, metalness: 0.25, envMapIntensity: 0.5,
  })));

  const foilMat = new THREE.ShaderMaterial({
    ...FOIL,
    uniforms: THREE.UniformsUtils.clone(FOIL.uniforms),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  foilMat.uniforms.uA.value.set(accent);
  const foil = new THREE.Mesh(FACE_GEO, foilMat);
  foil.position.z = FACE_Z + 0.0014;
  foil.scale.setScalar(0.995);
  inner.add(foil);

  // fake-mirror removed: reflections need a floor near the cards, otherwise they
  // land off-frame. The glow pool carries the ground instead.

  FAN_ROOT.add(group);
  return {
    data, group, inner, face, faceMat, back, foilMat,
    pos: new THREE.Vector3(), rot: new THREE.Euler(), scale: 1,
    flip: 0, hover: 0, dim: 0, bornAt: 0.12 + i * 0.085,
    accent,
  };
}

/* ---------------------------------------------------------------- tokens */

const TOKEN_ROOT = new THREE.Group();
TOKEN_ROOT.visible = false;
scene.add(TOKEN_ROOT);

const TOK = { rowY: -0.42, step: 1.2, dist: 0.42 };

function makeTokenDisc(tex, radius, gem) {
  // UV mặt trên của CylinderGeometry là u = 0.5 + z/2r, v = 0.5 - x/2r, nên ảnh gốc
  // hiện ra lật ngang và xoay 90 độ. repeat(-1,-1) + xoay -90 quanh tâm là khớp ảnh gốc
  // (kiểm bằng ảnh dò: chấm ở góc trên-trái của file png ra đúng góc trên-trái trên đĩa).
  tex.center.set(0.5, 0.5);
  tex.repeat.set(-1, -1);
  tex.rotation = -Math.PI / 2;
  tex.needsUpdate = true;

  const rimMat = new THREE.MeshStandardMaterial({
    color: gem ? '#4b3a1b' : '#2a1f17', roughness: 0.4, metalness: 0.9,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex, roughness: gem ? 0.48 : 0.62, metalness: 0.2,
    emissive: new THREE.Color('#150c07'), emissiveIntensity: 0.8,
  });
  // trụ dẹt: hai mặt tròn = mặt token, thân = viền kim loại
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.055, 56),
    [rimMat, faceMat, faceMat]
  );
  disc.rotation.x = Math.PI / 2;   // trục Y thành trục Z, mặt phẳng hướng về camera
  const g = new THREE.Group();
  g.add(disc);
  return { g, disc };
}

async function spawnTokens(list, info) {
  if (!list?.length) return;
  const items = [];
  for (const t of list) {
    const tex = await loadTexture(t.file);
    if (!tex) continue;
    const key = norm(t.name);
    const meta = info?.[t.name] || info?.[key] || {};
    const gem = /ngọc|ngoc|gem/.test(key);
    const { g, disc } = makeTokenDisc(tex, gem ? 0.62 : 0.47, gem);
    TOKEN_ROOT.add(g);
    items.push({ g, disc, gem, data: { name: meta.name || t.name, rule: meta.rule || '' } });
  }
  state.gem = items.find((x) => x.gem) || null;
  state.tokens = items.filter((x) => !x.gem);
  state.allTokens = items;
  buildTokenManifest();
}

// khung hẹp thì xếp token thành nhiều hàng thay vì thu nhỏ tới mức không đọc được
const tokenCols = () => (state.tokens.length > 4 && (state.vw || 5.6) < 3.6 ? 3 : Math.max(1, state.tokens.length));

function fitTokens() {
  const n = Math.max(1, state.tokens.length);
  const cols = tokenCols();
  const rows = Math.ceil(n / cols);
  const spanX = (cols - 1) * TOK.step + 1.0;
  const spanY = (rows - 1) * TOK.step * 0.94 + 2.5;
  const vw = state.vw || 5.6, vh = state.vh || 3.5;
  state.tokScale = Math.min(1, (vw * 0.9) / spanX, (vh * 0.9) / spanY);
}

// vị trí của token thứ i (đã nhân tỉ lệ), gốc ở tâm hàng trên
function tokenSlot(i, n) {
  const cols = tokenCols();
  const row = Math.floor(i / cols);
  const inRow = Math.min(cols, n - row * cols);
  const dx = (i % cols) - (inRow - 1) / 2;
  return {
    x: dx * TOK.step * state.tokScale,
    y: (TOK.rowY - row * TOK.step * 0.94) * state.tokScale,
    z: TOK.dist - Math.abs(dx) * 0.09,
  };
}

/* --------------------------------------------------------------- layout */

const rowInfo = (c) => ROWS[Math.min(c.row || 0, ROWS.length - 1)];

// shrink the whole fan so it always fits the frame, whatever the aspect
function fitRoot() {
  const cards = state.cards.length ? state.cards : [{ row: 0, rowIdx: 0, rowCount: 8 }];
  const half = () => {
    let hx = 0, hi = -9, lo = 9;
    for (const c of cards) {
      const spec = rowInfo(c);
      const n = c.rowCount || 1;
      const a = ((c.rowIdx || 0) - (n - 1) / 2) * spec.step * state.stepScale;
      hx = Math.max(hx, Math.abs(Math.sin(a) * FAN_R * spec.rMul) + (CARD_W / 2) * spec.scale + 0.06);
      hi = Math.max(hi, spec.y + (CARD_H / 2) * spec.scale);
      lo = Math.min(lo, spec.y - (CARD_H / 2) * spec.scale);
    }
    return { hx, hy: Math.max(Math.abs(hi), Math.abs(lo)) };
  };
  const dist = CAM_HOME.z - 0.4;
  const vh = 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const vw = vh * camera.aspect;
  state.vw = vw; state.vh = vh;
  const W = vw * 0.505;

  state.stepScale = 1;
  let { hx, hy } = half();
  if (hx > W) { state.stepScale = Math.max(0.42, W / hx); ({ hx, hy } = half()); }

  state.fitScale = Math.min(1.25, W / hx, (vh * 0.45) / hy);

  // focused card: 80% of frame height (or 72% width), never a hand-tuned constant
  const df = CAM_FOCUS.z - FOCUS_Z;
  const fvh = 2 * df * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const fvw = fvh * camera.aspect;
  state.focusScale = Math.min(1.3, (fvh * 0.78) / CARD_H, (fvw * 0.68) / CARD_W);
  fitTokens();
}

function layoutTargets(c, i) {
  const spec = rowInfo(c);
  const n = c.rowCount || state.cards.length;
  const mid = (n - 1) / 2;
  const spread = 0.42 + 0.58 * Math.min(1, state.stage);   // hero: tight hand, showcase: full fan
  const a = ((c.rowIdx ?? i) - mid) * spec.step * state.stepScale * spread;
  // rotation.y = -a exactly + z on the same arc = the cards sit on tangent
  // planes of a cylinder, which is the only arrangement that cannot intersect
  const pos = new THREE.Vector3(
    Math.sin(a) * FAN_R * spec.rMul,
    spec.y + Math.cos(a) * 0.03,
    // arc z + a small symmetric step back + a hair of index bias: the arc alone
    // leaves the two middle cards almost coplanar, and a corner then clips
    spec.z - FAN_R * spec.rMul * (1 - Math.cos(a))
      - 0.05 * Math.abs((c.rowIdx ?? i) - mid)
      - 0.05 * (c.rowIdx ?? i)
  );
  const rot = new THREE.Euler(-0.055, -a * 0.5, 0);
  let scale = spec.scale, dim = 0;

  if (state.focusIdx === i) {
    pos.set(-0.06, 0.16, FOCUS_Z);
    rot.set(0, 0, 0);
    scale = state.focusScale / (FAN_ROOT.scale.x || 1);
  } else if (state.focusIdx !== null) {
    const dir = Math.sign(i - state.focusIdx) || 1;
    pos.x += dir * 0.42;
    pos.z -= 1.5;
    rot.y = -dir * 0.25;
    scale *= 0.9;
    dim = 1;
  }
  return { pos, rot, scale, dim };
}

/* ------------------------------------------------------------------ boot */

let composer, bloom, grade;

async function boot() {
  // canvas text must be drawn with the final font metrics, not a fallback
  try {
    await document.fonts.load('104px "DFVN"', 'Rồng Phượng Ác Linh');
    await document.fonts.ready;
  } catch { /* older engines */ }
  const { cards: deck, extras } = await buildDeck();
  state.cards = deck.map((d, i) => makeCard(d, i));

  // assign tiers: characters (role) in front, action cards behind
  const tiers = ['role', 'feature'].filter((t) => deck.some((d) => d.type === t));
  if (!tiers.length) tiers.push('feature');
  const counts = {};
  for (const d of deck) {
    d.row = Math.max(0, tiers.indexOf(d.type));
    counts[d.row] = (counts[d.row] || 0) + 1;
  }
  const seen = {};
  for (const d of deck) {
    d.rowIdx = seen[d.row] = (seen[d.row] || 0) + 1;
    d.rowIdx -= 1;
    d.rowCount = counts[d.row];
  }

  // intro pose: all cards in a stack, low
  for (const c of state.cards) {
    c.row = c.data.row; c.rowIdx = c.data.rowIdx; c.rowCount = c.data.rowCount;
    c.group.position.set(0, -1.4, 1.4);
    c.group.rotation.set(0.5, 0, 0);
    c.group.scale.setScalar(0.72);
  }
  FAN_ROOT.scale.setScalar(0.001);
  state.fitScale = 1;
  fitRoot();

  await spawnClouds(extras?.clouds);
  await spawnTokens(extras?.tokens, extras?.tokenInfo);

  // post
  const dpr = Math.min(devicePixelRatio, 2);
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, {
    type: THREE.HalfFloatType, samples: 4,
  }));
  composer.setPixelRatio(1);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.45, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GRADE);
  grade.renderToScreen = true;
  composer.addPass(grade);

  state.ready = true;
  window.ARCA = { THREE, scene, camera, renderer, state, cards: state.cards, composer, bloom, grade };
  document.getElementById('loading')?.classList.add('gone');
  updateHud();
  animate();
}

/* ------------------------------------------------------------------- hud */

function updateHud() {
  const has = state.focusIdx !== null;
  document.body.classList.toggle('focused', has);
  const panel = document.getElementById('info');
  const counter = document.getElementById('counter');
  const n = String(state.cards.length).padStart(2, '0');
  if (counter) counter.textContent = `${String((state.focusIdx ?? 0) + 1).padStart(2, '0')} / ${n}`;
  const now = document.getElementById('idx-now');
  if (now) now.textContent = String((state.focusIdx ?? 0) + 1).padStart(2, '0');
  const all = document.getElementById('idx-all');
  if (all) all.textContent = '/ ' + n;
  if (!has || !panel) { panel?.classList.remove('on'); return; }
  const d = state.cards[state.focusIdx].data;
  const kind = panel.querySelector('.kind');
  const KIND = { 'nhân vật': 'Lá Nghề', item: 'Lá Hành Động', 'nhiệm vụ': 'Lá Kiếp Nạn', 'biểu quyết': 'Lá Biểu Quyết' };
  kind.textContent = KIND[d.kindTag] || (d.type === 'role' ? 'Lá Nghề' : 'Lá Hành Động');
  kind.dataset.type = d.type === 'role' ? 'role' : 'feature';
  panel.querySelector('h2').textContent = d.title;
  panel.querySelector('.sub').textContent = d.sub || '';
  panel.querySelector('p').textContent = d.desc || '';
  const noteBox = panel.querySelector('.note');
  const noteText = panel.querySelector('.note-body');
  const note = d.note || d.desc || '';
  noteText.textContent = note;
  noteBox.classList.toggle('on', !!note);
  const tags = panel.querySelector('.tags');
  tags.innerHTML = '';
  for (const t of d.tags || []) {
    const s = document.createElement('span'); s.textContent = t; tags.appendChild(s);
  }
  panel.classList.add('on');
}

/* ----------------------------------------------------------- token caption */

const tokEl = document.getElementById('tok');
const tokName = document.getElementById('tok-name');
const tokRule = document.getElementById('tok-rule');

function buildTokenManifest() {
  if (!tokEl) return;
  const m = document.getElementById('tok-count');
  if (m) m.textContent = String(state.tokens.length).padStart(2, '0');
  setTokenCaption(null);
}

function setTokenCaption(i) {
  if (!tokName || !tokRule) return;
  const tk = i === null || i === undefined ? null : state.allTokens[i];
  if (!tk) {
    tokName.textContent = 'Token đánh dấu';
    tokRule.textContent = 'Đưa chuột lên một token để đọc công dụng.';
    tokEl?.classList.remove('sel');
    return;
  }
  tokName.textContent = tk.data.name;
  tokRule.textContent = tk.data.rule;
  tokEl?.classList.add('sel');
}

/* ------------------------------------------------------------- interaction */

const heroEl = document.getElementById('hero');
const hudEl = document.querySelector('.hud');
document.getElementById('cta')?.addEventListener('click', () => {
  scrollTo({ top: innerHeight, behavior: 'smooth' });
});

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pick() {
  ndc.set(state.pointerRaw.x, state.pointerRaw.y);
  ray.setFromCamera(ndc, camera);
  const faces = state.cards.map((c) => c.face);
  const hit = ray.intersectObjects(faces, false)[0];
  return hit ? state.cards.findIndex((c) => c.face === hit.object) : null;
}

function pickToken() {
  const all = state.allTokens;
  if (!all?.length) return null;
  ndc.set(state.pointerRaw.x, state.pointerRaw.y);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(all.map((t) => t.disc), false)[0];
  return hit ? all.findIndex((t) => t.disc === hit.object) : null;
}

addEventListener('pointermove', (e) => {
  state.pointerRaw.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (state.ready && state.stage2 > 0.35) {
    const h = pickToken();
    if (h !== state.hoverToken) {
      state.hoverToken = h;
      setTokenCaption(h);
      document.body.style.cursor = h !== null ? 'pointer' : 'default';
    }
    return;
  }
  if (state.ready && state.stage > 0.6) {
    const h = pick();
    if (h !== state.hoverIdx) {
      state.hoverIdx = h;
      document.body.style.cursor = h !== null ? 'pointer' : 'default';
    }
  }
}, { passive: true });

addEventListener('pointerdown', () => {
  if (!state.ready || state.stage < 0.6 || state.stage2 > 0.35) return;
  const h = pick();
  if (h === null) { state.focusIdx = null; }
  else state.focusIdx = state.focusIdx === h ? null : h;
  updateHud();
});

addEventListener('keydown', (e) => {
  if (!state.ready || state.stage < 0.6 || state.stage2 > 0.35) return;
  const n = state.cards.length;
  if (e.key === 'Escape') state.focusIdx = null;
  else if (e.key === 'ArrowRight') state.focusIdx = state.focusIdx === null ? 0 : (state.focusIdx + 1) % n;
  else if (e.key === 'ArrowLeft') state.focusIdx = state.focusIdx === null ? n - 1 : (state.focusIdx - 1 + n) % n;
  else if (e.key === ' ') { e.preventDefault(); if (state.focusIdx === null) state.focusIdx = 0; else state.cards[state.focusIdx].flip = state.cards[state.focusIdx].flip > 0.5 ? 0 : Math.PI; }
  else return;
  updateHud();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
  bloom?.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  fitRoot();
});

/* ------------------------------------------------------------------ loop */

const camLook = new THREE.Vector3().copy(LOOK_HOME);
const tmpV = new THREE.Vector3();
const clock = new THREE.Clock();
let dust = null;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.clock += dt;
  const t = state.clock;

  if (!dust) dust = scene.getObjectByName('dust');

  // camera parallax + focus dolly
  const camTarget = state.focusIdx !== null ? CAM_FOCUS : CAM_HOME;
  const lookTarget = state.focusIdx !== null ? LOOK_FOCUS : LOOK_HOME;
  const px = state.pointerRaw.x, py = state.pointerRaw.y;
  camera.position.x = damp(camera.position.x, camTarget.x + px * 0.34, 3.2, dt);
  camera.position.y = damp(camera.position.y, camTarget.y + py * 0.16, 3.2, dt);
  camera.position.z = damp(camera.position.z, camTarget.z, 3.0, dt);
  camLook.x = damp(camLook.x, lookTarget.x + px * 0.08, 3.4, dt);
  camLook.y = damp(camLook.y, lookTarget.y + py * 0.05, 3.4, dt);
  camera.lookAt(camLook);

  // scroll stage: hero (0) → showcase cards (1) → token row (2)
  const rawStage = Math.min(2, Math.max(0, scrollY / Math.max(1, innerHeight)));
  state.stage = damp(state.stage, rawStage, 6.5, dt);
  state.stage2 = Math.min(1, Math.max(0, state.stage - 1));
  const st = Math.min(1, state.stage);
  const ex = state.stage2;
  if (state.focusIdx !== null && (st < 0.6 || ex > 0.3)) { state.focusIdx = null; updateHud(); }
  if (state.hoverIdx !== null && (st < 0.6 || ex > 0.3)) {
    state.hoverIdx = null;
    document.body.style.cursor = 'default';
  }

  FAN_ROOT.scale.setScalar(damp(FAN_ROOT.scale.x, state.fitScale * (0.86 + 0.14 * st), 3.2, dt));
  // hero offset measured in frame units so it adapts to any aspect:
  // wide → cards sit up-right of the copy; portrait → copy on top, cards below it
  const narrow = camera.aspect < 1.05;
  const ox = narrow ? 0 : (state.vw || 5.6) * 0.186;
  const oy = narrow ? -(state.vh || 3.5) * 0.17 : 0;   // wide: keep the fan vertically centred
  // màn thẻ: quạt lệch 15px sang trái tâm khung, bù lại
  FAN_ROOT.position.x = damp(FAN_ROOT.position.x, ox * Math.pow(1 - st, 1.8) + 0.07 * st, 3.4, dt);
  // +0.075 ở màn thẻ: quạt đo được lệch 14px xuống dưới tâm khung
  FAN_ROOT.position.y = damp(FAN_ROOT.position.y, oy * (1 - st) + 0.075 * st, 3.4, dt);
  FAN_ROOT.position.z = damp(FAN_ROOT.position.z, -0.35 * (1 - st), 3.4, dt);

  if (heroEl) {
    const fade = Math.max(0, 1 - st * 2.7);
    heroEl.style.opacity = fade.toFixed(3);
    heroEl.style.transform = `translate3d(0, ${(-st * 150).toFixed(1)}px, 0)`;
    heroEl.style.visibility = fade < 0.02 ? 'hidden' : 'visible';
  }
  if (hudEl) hudEl.style.opacity = Math.min(1, Math.max(0, (st - 0.55) / 0.35)).toFixed(3);

  state.cards.forEach((c, i) => {
    const { pos, rot, scale, dim } = layoutTargets(c, i);
    const live = t > c.bornAt || ex > 0.02;   // sang màn token thì bỏ hẳn animation chia
    const k = live ? 5.2 : 0;

    // idle float
    const calm = 1 - Math.min(1, ex * 4);
    const bob = reduced ? 0 : Math.sin(t * 0.9 + i * 0.7) * 0.022 * calm;
    const sway = reduced ? 0 : Math.sin(t * 0.55 + i * 1.3) * 0.012 * calm;

    const hovered = state.hoverIdx === i && state.focusIdx === null;
    c.hover = damp(c.hover, hovered ? 1 : 0, 9, dt);

    // hover: lift the card out of the fan (along +y) instead of pushing it
    // forward; a forward push would slide it through the neighbour in front
    const tx = rot.x + c.hover * (-py * 0.06 + 0.02) + (live ? 0 : 0.4);
    const ty = rot.y + c.hover * (-px * 0.06) + (live ? 0 : 0.2);
    const tz = rot.z + c.hover * (px * 0.03);

    // hover pulls the card out along its own normal: still parallel to its
    // neighbours, so it can never pass through one
    tmpV.set(
      pos.x + Math.sin(rot.y) * c.hover * 0.72 + sway * c.hover * 2,
      pos.y + bob + c.hover * 0.06,
      pos.z + Math.cos(rot.y) * c.hover * 0.72
    );
    if (!live) tmpV.set(0, -1.4, 1.4);
    // màn token: lá trượt lên khỏi khung thay vì biến mất đột ngột
    if (ex > 0.001) {
      tmpV.y += ex * ex * 4.2;
      tmpV.z += ex * 1.1;
      tmpV.x *= 1 - ex * 0.35;
    }

    c.group.position.x = damp(c.group.position.x, tmpV.x, live ? 6.2 : 0, dt);
    c.group.position.y = damp(c.group.position.y, tmpV.y, live ? 6.2 : 0, dt);
    // 4.2 để lá hover cũ còn bay về khi rê chuột nhanh, đủ để cắt vào lá bên cạnh
    c.group.position.z = damp(c.group.position.z, tmpV.z, live ? 6.2 : 0, dt);

    c.group.rotation.x = damp(c.group.rotation.x, live ? tx : 0.5, 5.2, dt);
    c.group.rotation.y = damp(c.group.rotation.y, live ? ty : 0.0, 5.2, dt);
    c.group.rotation.z = damp(c.group.rotation.z, live ? tz : 0, 5.2, dt);

    const s = (scale + c.hover * 0.07) * (live ? 1 : 0.72) * (1 - 0.92 * ex);
    c.group.scale.setScalar(damp(c.group.scale.x, s, 5, dt));

    // flip
    c.inner.rotation.y = damp(c.inner.rotation.y, c.flip, 5.5, dt);

    // dim
    c.dim = damp(c.dim, dim, 6, dt);
    const shade = 1 - c.dim * 0.62;
    c.faceMat.color.setScalar(shade);
    c.faceMat.envMapIntensity = 1 - c.dim * 0.75;
    c.foilMat.uniforms.uAmt.value = (0.26 + c.hover * 0.4) * shade;

  });

  // ---- token row (màn 2) ----
  if (state.allTokens.length) {
    const ease = ex * ex * (3 - 2 * ex);
    TOKEN_ROOT.visible = ex > 0.002;
    // khung dọc: nhấc cả cụm lên để không đè caption ở đáy
    TOKEN_ROOT.position.y = damp(TOKEN_ROOT.position.y, camera.aspect < 1.05 ? 0.36 : 0, 4, dt);
    if (ex < 0.35 && state.hoverToken !== null) { state.hoverToken = null; setTokenCaption(null); }
    document.body.classList.toggle('tokon', ex > 0.45);

    const n = state.tokens.length;
    state.tokens.forEach((tk, i) => {
      const isHov = state.hoverToken !== null && state.allTokens[state.hoverToken] === tk;
      tk.h = damp(tk.h || 0, isHov ? 1 : 0, 8, dt);
      const slot = tokenSlot(i, n);
      const x = slot.x;
      const y = slot.y + tk.h * 0.05;
      const z = slot.z + tk.h * 0.62;
      tk.g.position.x = damp(tk.g.position.x, x, 6, dt);
      tk.g.position.y = damp(tk.g.position.y, THREE.MathUtils.lerp(-2.9, y, ease), 6, dt);
      tk.g.position.z = damp(tk.g.position.z, THREE.MathUtils.lerp(1.7, z, ease), 6, dt);
      tk.g.scale.setScalar(damp(tk.g.scale.x, THREE.MathUtils.lerp(0.4, 1, ease) * (1 + tk.h * 0.07), 6, dt));
      // nghiêng vào tâm khung: token bên trái xoay +y, bên phải xoay -y
      const faceIn = slot.x === 0 ? 0 : -Math.sign(slot.x) * 0.34;
      tk.g.rotation.y = damp(tk.g.rotation.y, Math.sin(t * 0.55 + i * 0.9) * 0.26 * (1 - tk.h) + tk.h * faceIn, 4, dt);
      tk.g.rotation.x = damp(tk.g.rotation.x, -0.05 + tk.h * 0.1, 4, dt);
    });

    const gm = state.gem;
    if (gm) {
      const gy = (TOK.rowY + 1.28) * state.tokScale;
      gm.g.position.x = damp(gm.g.position.x, 0, 6, dt);
      gm.g.position.y = damp(gm.g.position.y, THREE.MathUtils.lerp(2.9, gy, ease), 6, dt);
      gm.g.position.z = damp(gm.g.position.z, THREE.MathUtils.lerp(1.7, -0.15, ease), 6, dt);
      gm.g.scale.setScalar(damp(gm.g.scale.x, THREE.MathUtils.lerp(0.4, 1, ease), 6, dt));
      gm.g.rotation.y = Math.sin(t * 0.42) * 0.34;
      gm.g.rotation.x = damp(gm.g.rotation.x, -0.03, 4, dt);
    }
  }

  if (!reduced) {
    for (const cl of cloudDrift) {
      cl.sp.position.x = cl.x + Math.sin(t * 0.045 * cl.sp2 + cl.ph) * cl.ax;
      cl.sp.position.y = cl.y + Math.sin(t * 0.062 * cl.sp2 + cl.ph * 1.7) * cl.ay;
      cl.sp.material.rotation = Math.sin(t * 0.03 + cl.rot) * 0.05;
    }
  }

  if (dust && !reduced) {
    dust.rotation.y = t * 0.02;
    dust.position.y = Math.sin(t * 0.25) * 0.12;
  }

  // reactive lighting + per-view brightness
  lightMix = damp(lightMix, state.focusIdx === null ? 0 : 1, 3.2, dt);
  const L = (a, b) => a + (b - a) * lightMix;
  warm.position.x = damp(warm.position.x, -3.4 + px * 1.2, 2, dt);
  rim.position.y = damp(rim.position.y, 1.1 + py * 0.6, 2, dt);
  spot.intensity = L(LIGHT.home.spot, LIGHT.focus.spot) + Math.sin(t * 1.4) * 1.1;
  key.intensity = L(LIGHT.home.key, LIGHT.focus.key);
  ambient.intensity = L(LIGHT.home.amb, LIGHT.focus.amb);
  scene.environmentIntensity = L(LIGHT.home.env, LIGHT.focus.env);
  renderer.toneMappingExposure = L(LIGHT.home.exp, LIGHT.focus.exp);
  rim.intensity = L(LIGHT.home.rim, LIGHT.focus.rim);
  warm.intensity = L(LIGHT.home.warm, LIGHT.focus.warm);

  grade.uniforms.uTime.value = t;
  composer.render();
}

boot();
