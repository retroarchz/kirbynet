// Protótipo: 2 "aparelhos" (cada um um motor), cada um só usa o próprio GBA. O cabo vira pacotes com atraso de rede.
const { abre } = require('./base.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
const D = 0x020382D0, SEND = 0x030036B0, RECV = 0x03002490, BLK = 0x14, FLAGS_RAM = 0x0203FFE0;
const STUB = [0x01, 0x48, 0x00, 0x68, 0x70, 0x47, 0xC0, 0x46, 0xE0, 0xFF, 0x03, 0x02];   // ldr r0,=FLAGS_RAM; ldr r0,[r0]; bx lr
const ATRASO = +(process.env.ATRASO || 3), VAR = +(process.env.VAR || 0), QUADROS = +(process.env.QUADROS || 3000);
(async () => {
  const A = await abre(2);
  if (process.env.CONST) A.s.romWrite(0x30D60, new Uint8Array([+process.env.CONST, 0x38]));
  A.play(NAV.map(p => p.length === 1 ? p : [p[0], p[1], p[1]]));
  const snap = A.s.snapshot();
  const B = await abre(2); B.s.restore(snap); B.f = A.f;
  const ap = [A, B];   // aparelho k usa o GBA k do seu motor
  const flags = [A.ram(0).r32(0x03002554), A.ram(1).r32(0x03002554)];
  ap.forEach((W, k) => { W.s.romWrite(0x157308, new Uint8Array(STUB)); for (let i = 0; i < 2; i++) W.ram(i).w32 ? 0 : 0; });
  const w32 = (m, a, v) => { m.w16(a, v & 0xFFFF); m.w16(a + 2, v >>> 16); };
  ap.forEach((W, k) => { for (let i = 0; i < 2; i++) w32(W.ram(i), FLAGS_RAM, flags[i]); });
  const rede = [];   // [quando, para, pacote]
  const ult = [null, null];   // último pacote entregue de cada um
  let t = 0; const hist = [new Map(), new Map()]; let pausas = [0, 0], erros = [];
  const pega = (m, a) => Array.from({ length: BLK / 2 }, (_, j) => m.r16(a + 2 * j));
  const poe = (m, a, v) => v.forEach((x, j) => m.w16(a + 2 * j, x));
  for (let q = 0; q < QUADROS; q++, t++) {
    const tecla = q % 120 < 50 ? 'R' : q % 120 < 100 ? 'L' : (q % 240 < 110 ? 'A' : 'B');
    ap.forEach((W, k) => {
      const m = W.ram(k);
      for (let j = 0; j < rede.length;) { const [quando, para, pk] = rede[j]; if (para === k && quando <= t) { ult[1 - k] = pk; rede.splice(j, 1); } else j++; }
      if (ult[1 - k]) poe(m, RECV + (1 - k) * BLK, ult[1 - k]);
      poe(m, RECV + k * BLK, pega(m, SEND));
      const antes = m.r32(D);
      const ks = ['', '']; ks[k] = tecla; W.step(ks);
      if (m.r32(D) === antes) pausas[k]++;
      if (process.env.DBG && k === 0 && q >= 100 && q < 130) { const lin = []; for (let sb = 0; sb < 2; sb++) { const esc = m.r8(D + 0x2A4 + sb), lei = m.r8(D + 0x2A8 + sb); lin.push(`sb${sb} alvo ${m.r8(D + 0x2A0 + sb)} ult ${m.r32(D + 0xA0 + sb * 0x80 + ((esc - 1) & 15) * 8)} lendo ${m.r32(D + 0xA0 + sb * 0x80 + lei * 8)}`); } console.log(q, 'jogo', m.r32(D), m.r32(D) === antes ? 'PAUSA' : '', 'f4', m.r16(D + 4).toString(16), lin.join(' | '), 'recv1 quadro', m.r32(RECV + BLK + 0x10)); }
      const pk = pega(m, SEND);
      rede.push([t + ATRASO + Math.floor(Math.random() * (VAR + 1)), 1 - k, pk]);
      if (m.r16(D + 4) & 0x8000) erros.push([q, k, m.r8(0x02038580)]);
      // estado para comparar: posição dos 2 Kirbys e a sorte, pelo quadro do jogo
      const gq = m.r32(D), est = [0, 1].map(p => m.r32(0x02020EE0 + p * 0x2B8 + 0x40) + ',' + m.r32(0x02020EE0 + p * 0x2B8 + 0x44)).join(' ') + ' rng ' + m.r32(0x030068D8).toString(16);
      if (!hist[k].has(gq)) hist[k].set(gq, est);
    });
    if (q === 60 && !process.env.SEMRESYNC) ap.forEach((W, k) => { const m = W.ram(k); for (let sb = 0; sb < 2; sb++) if (sb !== k) { const esc = m.r8(D + 0x2A4 + sb), lei = m.r8(D + 0x2A8 + sb), ult = m.r32(D + 0xA0 + sb * 0x80 + ((esc - 1) & 15) * 8), at = m.r32(D + 0xA0 + sb * 0x80 + lei * 8); m.w8(D + 0x2A0 + sb, (ult - at) & 0xFF); } pausas[k] = 0; });
    if (erros.length) break;
  }
  let iguais = 0, dif = 0, prim = null;
  for (const [gq, e] of hist[0]) if (hist[1].has(gq)) { if (hist[1].get(gq) === e) iguais++; else { dif++; if (!prim) prim = [gq, e, hist[1].get(gq)]; } }
  console.log(`const ${process.env.CONST||5} atraso ${ATRASO}+0..${VAR}: quadros ${QUADROS}, quadro do jogo ${A.ram(0).r32(D)} / ${B.ram(1).r32(D)}, pausas ${pausas}, erros ${JSON.stringify(erros.slice(0, 3))}, estados iguais ${iguais} diferentes ${dif}`, prim ? 'primeira diferença ' + JSON.stringify(prim) : '');
  const out = []; A.shot('hleA.png'); B.shot('hleB.png');
})();
