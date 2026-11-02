// Quanto o kirbycoop.js custa por quadro (pre + post + recv) comparado a rodar o motor (2 GBAs, como no site)
const { abre } = require('./base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[700]];
(async () => {
  const ap = [await abre(2), await abre(2)];
  for (const p of NAV) for (let i = 0; i < p[0]; i++) { ap[0].step(p.length > 1 ? [p[1], p[1]] : []); ap[1].step(p.length > 1 ? [p[1], p[1]] : []); }
  const caixa = [[], []], kc = [0, 1].map(i => KC.create({ m: ap[i].ram(i), me: i, n: 2, romWrite: (o, b) => ap[i].s.romWrite(o, b), send: (b) => caixa[1 - i].push(b) }));
  kc.forEach(k => k.liga());
  if (process.env.SOLO) console.log("solo:", ap[0].s.solo(0), ap[1].s.solo(1));
  let tm = 0, tk = 0; const SEQ = ['R', 'R|A', 'B', 'L', 'L|A', 'A', 'D', ''];
  for (let f = 0; f < 1200; f++) for (let i = 0; i < 2; i++) {
    const t0 = performance.now();
    for (const b of caixa[i].splice(0)) kc[i].recv(b);
    kc[i].pre();
    const t1 = performance.now();
    const ks = ['', '']; ks[i] = SEQ[Math.floor(f / 20) % SEQ.length]; ap[i].step(ks);
    const t2 = performance.now();
    kc[i].post(f % 40 < 20 ? 16 : 0);
    const t3 = performance.now();
    tk += (t1 - t0) + (t3 - t2); tm += t2 - t1;
  }
  console.log('por quadro: motor (2 GBAs)', (tm / 2400).toFixed(2), 'ms | kirbycoop', (tk / 2400).toFixed(2), 'ms');
})();
