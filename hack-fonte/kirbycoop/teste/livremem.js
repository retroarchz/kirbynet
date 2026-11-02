const { abre } = require('./base.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
(async () => {
  const W = await abre(2); const usados = new Set();
  const marca = () => { for (let i = 0; i < 2; i++) { const m = W.ram(i); for (let a = 0x0203F000; a < 0x02040000; a += 2) if (m.r16(a)) usados.add(a & ~0xF); } };
  for (const p of NAV) { for (let k = 0; k < p[0]; k++) { W.step([p[1] || '', p[1] || '']); if (k % 20 === 0) marca(); } }
  for (let k = 0; k < 900; k++) { W.step([k % 100 < 50 ? 'R|B' : 'L|A', 'B']); if (k % 10 === 0) marca(); }
  const livres = []; for (let a = 0x0203F000; a < 0x02040000; a += 16) if (!usados.has(a)) livres.push(a);
  // faixas livres contínuas
  const fx = []; let ini = null, ant = null; for (const a of livres) { if (ini === null || a !== ant + 16) { if (ini !== null) fx.push([ini, ant + 16]); ini = a; } ant = a; } if (ini !== null) fx.push([ini, ant + 16]);
  console.log(fx.filter(([a, b]) => b - a >= 0x40).map(([a, b]) => a.toString(16) + '-' + b.toString(16)).join(' '));
})();
