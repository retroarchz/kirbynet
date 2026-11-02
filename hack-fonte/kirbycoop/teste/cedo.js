// Troca para mundos separados CEDO (TROCA = quadro), no meio do menu do multiplayer; os dois continuam o menu cada um no
// seu GBA. Confere se chegam na fase sem erro de cabo e se o Kirby do outro aparece/anda.
const { abre } = require('./base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[900]];
const K = { A: 1, B: 2, START: 8, R: 16, L: 32, D: 128 }, bits = (s) => (s || '').split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
const TROCA = +(process.env.TROCA || 1700), ATRASO = 3, D = 0x020382D0;
(async () => {
  const ap = [await abre(2), await abre(2)], plano = [];
  for (const p of NAV) for (let i = 0; i < p[0]; i++) plano.push(p[1] || '');
  for (let i = 0; i < 600; i++) plano.push(i < 200 ? 'R' : '');   // depois: os dois andam para a direita
  const rede = [], kc = [null, null];
  let f = 0;
  const liga = (i) => { const W = ap[i]; kc[i] = KC.create({ m: W.ram(i), me: i, n: 2, romWrite: (o, b) => W.s.romWrite(o, b), send: (b) => rede.push([f + ATRASO, 1 - i, b]) }); kc[i].liga(); };
  const est = (i) => { const m = ap[i].ram(i); return `multi ${m.r8(0x03002558)} qD ${m.r32(D)} D4 ${m.r16(D + 4).toString(16)} erro ${m.r16(D + 4) & 0x8000 ? 'SIM' : 'não'} sala ${m.r16(0x02020EE0 + 0x60)}/${m.r16(0x02020EE0 + 0x1A8 + 0x60)} x ${(m.r32(0x02020EE0 + 0x40) | 0) >> 8}/${(m.r32(0x02020EE0 + 0x1A8 + 0x40) | 0) >> 8}`; };
  for (; f < plano.length; f++) {
    if (f === TROCA) { liga(0); liga(1); console.log('troca no quadro', f, '| A:', est(0)); }
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < rede.length;) { const [q, para, b] = rede[j]; if (para === i && q <= f) { rede.splice(j, 1); kc[i].recv(b); } else j++; }
      if (kc[i]) { const ks = ['', '']; ks[i] = plano[f]; kc[i].pre(); ap[i].step(ks); kc[i].post(bits(plano[f])); }
      else ap[i].step([plano[f], plano[f]]);
    }
    if (f % 300 === 0 && f >= TROCA) console.log('q' + f, 'A:', est(0), '|| B:', est(1));
  }
  console.log('fim A:', est(0)); console.log('fim B:', est(1));
  ap[0].shot('cedoA.png'); ap[1].shot('cedoB.png');
})();
