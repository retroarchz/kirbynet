const { abre } = require('./base.js'), fs = require('fs'), v8 = require('v8');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
const T = 0x030011D0;
const tipos = (m) => { const o = []; for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14, f = m.r32(t + 8); if (f < 0x08000000) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6); const s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; const tpl = m.r32(s + 0xB0);
  if (m.r8(s) === 1 && tpl >= 0x08000000 && tpl < 0x0A000000) o.push(m.r8(s + 0x82).toString(16) + '@' + m.r16(s + 0x60) + ':' + ((m.r32(s + 0x40) | 0) >> 8) + ',' + ((m.r32(s + 0x44) | 0) >> 8)); } return o.join(' '); };
(async () => {
  const W = await abre(2); W.play(NAV.map(p => p.length === 1 ? p : [p[0], p[1], p[1]]));
  const plano = process.argv[2] || 'R'; let sala = -1, vistos = new Set();
  for (let k = 0; k < +(process.env.Q || 3000); k++) {
    const c = plano.split(',')[Math.floor(k / 40) % plano.split(',').length];
    W.step([k % 40 < 30 ? c : '', '']);
    const m = W.ram(0), s = m.r16(0x02020EE0 + 0x60);
    if (s !== sala) { sala = s; console.log(W.f, 'SALA', s, 'x', (m.r32(0x02020EE0 + 0x40) | 0) >> 8, 'y', (m.r32(0x02020EE0 + 0x44) | 0) >> 8); }
    if (k % 30 === 0) { const t = tipos(m); for (const x of t.split(' ')) { const ty = parseInt(x, 16); if (x && ty >= 0x5d && ty <= 0x65 && !vistos.has(x.split(':')[0])) { vistos.add(x.split(':')[0]); console.log(W.f, 'ITEM', x); } } }
  }
  for (const [pl, qq] of (process.env.MAIS ? JSON.parse(process.env.MAIS) : [])) for (let k = 0; k < qq; k++) {
    const c = pl.split(',')[Math.floor(k / 40) % pl.split(',').length];
    W.step([k % 40 < 30 ? c : '', '']);
    const m = W.ram(0), s = m.r16(0x02020EE0 + 0x60);
    if (s !== sala) { sala = s; console.log(W.f, 'SALA', s, 'x', (m.r32(0x02020EE0 + 0x40) | 0) >> 8, 'y', (m.r32(0x02020EE0 + 0x44) | 0) >> 8); }
    if (k % 30 === 0) { const t = tipos(m); for (const x of t.split(' ')) { const ty = parseInt(x, 16); if (x && ty >= 0x5d && ty <= 0x65 && !vistos.has(x.split(':')[0])) { vistos.add(x.split(':')[0]); console.log(W.f, 'ITEM', x); } } }
    if (process.env.LISTA && k % 300 === 0) console.log(W.f, 'objs', tipos(m));
  }
  console.log('fim x', (W.ram(0).r32(0x02020EE0 + 0x40) | 0) >> 8, 'y', (W.ram(0).r32(0x02020EE0 + 0x44) | 0) >> 8); W.shot('anda.png');
  if (process.env.SNAP) fs.writeFileSync(process.env.SNAP, v8.serialize(W.s.snapshot()));
})();
