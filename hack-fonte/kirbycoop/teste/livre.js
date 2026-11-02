// Etapa 1/2: cada aparelho roda só o próprio GBA e NUNCA espera. O pacote do amigo é montado aqui (últimos botões dele).
// ESTADO=1: além disso, a posição do Kirby do amigo vem da rede (etapa 2).
const { abre } = require('./base.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
const D = 0x020382D0, SEND = 0x030036B0, RECV = 0x03002490, BLK = 0x14, FLAGS_RAM = 0x0203FFE0, KIRBYS = 0x02020EE0, KSZ = 0x1A8;
const STUB = [0x01, 0x48, 0x00, 0x68, 0x70, 0x47, 0xC0, 0x46, 0xE0, 0xFF, 0x03, 0x02];
const ATRASO = +(process.env.ATRASO || 3), VAR = +(process.env.VAR || 2), QUADROS = +(process.env.QUADROS || 2400), ESTADO = !!process.env.ESTADO;
const pacote = (K, quadro, u6) => { const k = K & 0x3FF, hw = [k | (k << 12) & 0xFFFF, k >> 4 | (k << 8) & 0xFFFF, k >> 8 | (k << 4) & 0xFFFF]; const v = new Array(10).fill(0);
  v[0] = 0x20 | (u6 << 8); v[1] = hw[0]; v[2] = hw[1]; v[3] = hw[2]; v[4] = hw[0]; v[5] = hw[1]; v[6] = hw[2]; v[8] = quadro & 0xFFFF; v[9] = quadro >>> 16; return v; };
(async () => {
  const A = await abre(2);
  A.play(NAV.map(p => p.length === 1 ? p : [p[0], p[1], p[1]]));
  const B = await abre(2); B.s.restore(A.s.snapshot());
  const ap = [A, B];
  const w32 = (m, a, v) => { m.w16(a, v & 0xFFFF); m.w16(a + 2, v >>> 16); };
  const s32 = (m, a) => m.r32(a) | 0;
  const flags = [A.ram(0).r32(0x03002554), A.ram(1).r32(0x03002554)];
  ap.forEach(W => { W.s.romWrite(0x157308, new Uint8Array(STUB)); for (let i = 0; i < 2; i++) w32(W.ram(i), FLAGS_RAM, flags[i]); });
  const rede = [], soube = [{ k: 0 }, { k: 0 }];   // o que cada aparelho sabe do outro
  let pausas = [0, 0], erros = [], err = [], maxErr = 0, t = 0;
  for (let q = 0; q < QUADROS; q++, t++) {
    const tecla = q % 160 < 60 ? 'R' : q % 160 < 70 ? 'R|A' : q % 160 < 130 ? 'L' : (q % 320 < 150 ? 'A' : 'B');
    ap.forEach((W, k) => {
      const m = W.ram(k), o = 1 - k, kb = KIRBYS + o * KSZ;
      for (let j = 0; j < rede.length;) { const [quando, para, msg] = rede[j]; if (para === k && quando <= t) { soube[k] = msg; rede.splice(j, 1); } else j++; }
      m.w16(D + 4, m.r16(D + 4) & ~8);   // sem conferência de sincronia: os mundos são separados de propósito
      const v = pacote(soube[k].k, m.r32(D), m.r8(D + 6)); v.forEach((x, j) => m.w16(RECV + o * BLK + 2 * j, x));
      if (ESTADO && soube[k].x != null) { w32(m, kb + 0x40, soube[k].x); w32(m, kb + 0x44, soube[k].y); m.w16(kb + 0x50, soube[k].vx); m.w16(kb + 0x52, soube[k].vy); }
      const antes = m.r32(D); const ks = ['', '']; ks[k] = tecla; W.step(ks);
      if (m.r32(D) === antes) pausas[k]++;
      if (m.r16(D + 4) & 0x8000) erros.push([q, k, m.r8(0x02038580)]);
      const eu = KIRBYS + k * KSZ;
      const K = { A: 1, B: 2, R: 16, L: 32 }, kk = tecla.split('|').reduce((s, x) => s | K[x], 0);
      rede.push([t + ATRASO + Math.floor(Math.random() * (VAR + 1)), o, { k: kk, x: s32(m, eu + 0x40), y: s32(m, eu + 0x44), vx: m.r16(eu + 0x50), vy: m.r16(eu + 0x52) }]);
    });
    // erro: onde cada aparelho mostra o Kirby do outro x onde ele realmente está (pixels)
    for (const k of [0, 1]) { const o = 1 - k, real = ap[o].ram(o), visto = ap[k].ram(k); const dx = (s32(real, KIRBYS + o * KSZ + 0x40) - s32(visto, KIRBYS + o * KSZ + 0x40)) / 256, dy = (s32(real, KIRBYS + o * KSZ + 0x44) - s32(visto, KIRBYS + o * KSZ + 0x44)) / 256; const e = Math.hypot(dx, dy); err.push(e); maxErr = Math.max(maxErr, e); }
    if (erros.length) break;
    if (q === 600) { A.shot('livreA.png'); B.shot('livreB.png'); }
  }
  err.sort((a, b) => a - b);
  console.log(`${ESTADO ? 'com estado' : 'só botões'} atraso ${ATRASO}+0..${VAR}: pausas ${pausas} erros ${JSON.stringify(erros.slice(0, 2))} | Kirby do amigo fora do lugar (px): mediana ${err[err.length >> 1].toFixed(1)} 90% ${err[Math.floor(err.length * .9)].toFixed(1)} máx ${maxErr.toFixed(1)}`);
})();
