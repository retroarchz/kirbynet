const { abre } = require('./base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[700]];
(async () => {
  const W = await abre(2);
  for (const p of NAV) for (let i = 0; i < p[0]; i++) W.step(p.length > 1 ? [p[1], p[1]] : []);
  const me = +(process.env.ME || 1), m = W.ram(me);
  const kc = KC.create({ m, me, n: 2, romWrite: (o, b) => W.s.romWrite(o, b), send: () => {} }); kc.liga();
  const mede = (rot) => { const d0 = m.r32(0x020382D0), t = performance.now(); let tm = 0; for (let f = 0; f < 300; f++) { kc.pre(); const ks = ['', '']; ks[me] = f % 60 < 30 ? 'R' : 'L'; const a = performance.now(); W.step(ks); tm += performance.now() - a; kc.post(f % 60 < 30 ? 16 : 32); } console.log(rot, 'ms/quadro', ((performance.now() - t) / 300).toFixed(2), 'motor', (tm / 300).toFixed(2), '| quadros do jogo andados em 300 chamadas:', m.r32(0x020382D0) - d0, '| x', (m.r32(0x02020EE0 + me * 0x1A8 + 0x40) | 0) >> 8); };
  mede('2 GBAs');
  console.log('solo', W.s.solo(me));
  mede('solo  '); mede('solo  ');
})();
