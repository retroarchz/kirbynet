// 2+ GBAs do Amazing Mirror no motor do site; navega por plano de botões e salva fotos lado a lado
const fs = require('fs'), path = require('path');
const SITE = 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz';
const KnCore = require(SITE + '/kncore.js');
const { png } = (() => { const zlib = require('zlib'); return { png(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = b => { let c = ~0; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))])); } }; })();
const K = { A: 1, B: 2, SELECT: 4, START: 8, R: 16, L: 32, U: 64, D: 128, RB: 256, LB: 512 };
async function abre(n, saves) {
  const eng = await KnCore.load(fs.readFileSync(SITE + '/kncore.wasm'));
  const rom = new Uint8Array(fs.readFileSync(SITE + '/roms/Kirby & The Amazing Mirror (USA).gba'));
  const s = eng.create(n, rom, saves || []);
  for (let i = 0; i < n; i++) s.render(i, true);
  const W = { s, n, f: 0 };
  W.step = (ks) => { s.runFrame(Array.from({ length: n }, (_, i) => (ks && ks[i] || '').split('|').filter(Boolean).reduce((m, x) => m | K[x], 0))); W.f++; };
  W.play = (plan) => { for (const p of plan) for (let i = 0; i < p[0]; i++) W.step(p.slice(1)); };
  W.shot = (file) => { const out = new Uint8Array(240 * n * 160 * 4), one = new Uint8Array(240 * 160 * 4);
    for (let i = 0; i < n; i++) { s.video(i, one); for (let y = 0; y < 160; y++) out.set(one.subarray(y * 960, (y + 1) * 960), (y * 240 * n + i * 240) * 4); }
    for (let k = 3; k < out.length; k += 4) out[k] = 255; png(path.join(__dirname, file), 240 * n, 160, out); };
  W.ram = (i) => s.ram(i);
  return W;
}
module.exports = { abre, K };
