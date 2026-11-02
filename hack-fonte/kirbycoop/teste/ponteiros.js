const { abre } = require('./base.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
(async () => {
  const W = await abre(2); W.play(NAV.map(p => p.length === 1 ? p : [p[0], p[1], p[1]]));
  const vistos = {};
  for (let k = 0; k < 700; k++) { W.step([['R', 'B', 'R|A', 'D|A', 'L', 'B'][Math.floor(k / 40) % 6], 'B']); const m = W.ram(0);
    for (let o = 0; o < 0x1A8; o += 4) { const v = m.r32(0x02020EE0 + o); if (v >= 0x02000000 && v < 0x04000000) (vistos[o.toString(16)] = vistos[o.toString(16)] || new Set()).add(v.toString(16)); } }
  for (const [o, s] of Object.entries(vistos)) console.log('+0x' + o, [...s].slice(0, 4).join(' '));
})();
