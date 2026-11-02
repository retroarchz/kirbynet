// Sala do Amazing Mirror com o Meta Knight: 2 aparelhos x 2 GBAs, ROM com o hack em todos, P2 com a Sapphire.
// Menu em lockstep (Especial escrito em todos os GBAs, como o worker), depois mundos separados (kirbycoop).
// Teste: node mksala.js (ORIG=1 sem o hack; FOTO=1 tira fotos; Q=quadros)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const SITE = 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz';
const KnCore = require(SITE + '/kncore.js'), KC = require(SITE + '/kirbycoop.js');
const g = fs.readFileSync(SITE + '/game.js', 'utf8');
const AM = eval(g.slice(g.indexOf('const AM_METAKNIGHT = ['), g.indexOf('];', g.indexOf('const AM_METAKNIGHT = [')) + 1).replace('const AM_METAKNIGHT =', ''));
const _i = g.indexOf('function amMetaKnight(rom)'), _j = g.indexOf('}', g.indexOf('return 1;', _i)) + 1;
const amMetaKnight = eval('(' + g.slice(_i, _j).split('AM_METAKNIGHT').join('AM') + ')');
const ESP = 0x0203FFB8, ADE0 = 0x0203ADE0, AD1C = 0x0203AD1C, KIRBYS = 0x02020EE0, KSZ = 0x1A8, SHADOW = 0x0203FF00;
const K = { A: 1, B: 2, SELECT: 4, START: 8, R: 16, L: 32, U: 64, D: 128, E: 0x400 }, bits = (s) => (s || '').split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
const MK = !process.env.ORIG;
function png(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = b => { let c = ~0; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]));
}
(async () => {
  const eng = await KnCore.load(fs.readFileSync(SITE + '/kncore.wasm'));
  const mk = () => { const r = new Uint8Array(fs.readFileSync(SITE + '/roms/Kirby & The Amazing Mirror (USA).gba')); if (MK && amMetaKnight(r) !== 1) throw new Error('hack não entrou'); return r; };
  const ap = [0, 1].map(() => { const s = eng.create(2, mk(), []); s.render(0, true); s.render(1, true); return s; });
  const espW = (s, k) => { for (let i = 0; i < 2; i++) { const r = s.ram(i); if (r) for (let p = 0; p < 2; p++) r.w8(ESP + p, k[p] & 0x400 ? 1 : 0); } };
  let f = 0;
  const passo = (ks) => { const k = ks.map(bits); for (const s of ap) { if (MK) espW(s, k); s.runFrame(k); }
    // P2 escolheu a Sapphire na Collection Room (a tinta escolhida fica em gUnk_0203ADE0, só na RAM)
    for (const s of ap) { const r = s.ram(1); if (r) r.w8(ADE0, 7); } f++; };
  const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A']];
  for (const p of NAV) for (let i = 0; i < p[0]; i++) passo(p.length > 1 ? [p[1], p[1]] : ['', '']);
  let lig = -1; while (lig < 0) { passo(['', '']); if (f % 30 === 0 && KC.naFase(ap[0].ram(0))) lig = f; if (f > 6000) throw new Error('não achou a fase'); }
  console.log('fase no quadro', lig, 'tinta P1/P2 no GBA do A:', ap[0].ram(0).r8(AD1C), ap[0].ram(0).r8(AD1C + 1), 'no GBA do B:', ap[1].ram(1).r8(AD1C), ap[1].ram(1).r8(AD1C + 1));
  const rede = []; let t = 0;
  const kc = [0, 1].map(i => { const s = ap[i]; const c = KC.create({ m: s.ram(i), me: i, n: 2, especial: MK ? ESP : 0, romWrite: (o, b) => s.romWrite(o, b),
    send: (b) => rede.push([t + 3, 1 - i, b]) }); c.liga(); return c; });
  const Q = +(process.env.Q || 900), def = [0, 0], defOutro = [0, 0], sombra = [0, 0], err = [];
  for (; t < Q; t++) {
    const tec = ['', t < 150 ? 'R' : t % 120 < 40 ? 'E' : t % 120 < 70 ? 'B' : t % 120 < 90 ? 'R|A' : 'L'];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < rede.length;) { const [q, para, b] = rede[j]; if (para === i && q <= t) { rede.splice(j, 1); kc[i].recv(b); } else j++; }
      const s = ap[i], m = s.ram(i), k = [0, 0]; k[i] = bits(tec[i]) & 0x3FF;
      kc[i].pre(); if (MK) m.w8(ESP + i, bits(tec[i]) & 0x400 ? 1 : 0);
      s.runFrame(k); kc[i].post(bits(tec[i]) & 0x7FF);
    }
    for (let i = 0; i < 2; i++) { const m = ap[i].ram(i), fl = m.r32(KIRBYS + KSZ + 8);
      if (tec[1] === 'E') { (i === 1 ? def : defOutro)[i === 1 ? 1 : 0]++; }
      if (fl & 0x8000) (i === 1 ? def : defOutro)[i === 1 ? 0 : 1]++;
      if (m.r32(SHADOW + 0x28)) sombra[i]++; }
    const a = KIRBYS + KSZ; err.push(Math.hypot((ap[1].ram(1).r32(a + 0x40) | 0) - (ap[0].ram(0).r32(a + 0x40) | 0), (ap[1].ram(1).r32(a + 0x44) | 0) - (ap[0].ram(0).r32(a + 0x44) | 0)) / 256);
    if (process.env.FOTO && [200, 260, 330, 420].includes(t)) for (let i = 0; i < 2; i++) { const one = new Uint8Array(240 * 160 * 4); ap[i].video(i, one); for (let x = 3; x < one.length; x += 4) one[x] = 255; png(`t${t}_${'AB'[i]}.png`, 240, 160, one); }
  }
  err.sort((x, y) => x - y);
  console.log('quadros com o P2 segurando defesa:', def[1], '| flag de defesa (0x8000) do P2 no GBA dele:', def[0], '| na tela do P1:', defOutro[1]);
  console.log('quadros com sombra do MK do P2 desenhada: tela A', sombra[0], 'tela B', sombra[1], 'de', Q);
  console.log('P2 fora do lugar na tela do P1 (px): mediana', err[err.length >> 1].toFixed(1), 'máx', err[err.length - 1].toFixed(1));
  for (let i = 0; i < 2; i++) { const m = ap[i].ram(i); console.log('aparelho', 'AB'[i], 'erro de cabo?', !!(m.r16(0x020382D4) & 0x8000), 'habilidade P2', m.r8(KIRBYS + KSZ + 0x103), 'stateFn P2', m.r32(KIRBYS + KSZ + 0x78).toString(16)); }
})().catch(e => { console.error(e); process.exit(1); });
