const { abre } = require('./base.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
(async () => {
  const W = await abre(2); W.play(NAV.map(p => p.length === 1 ? p : [p[0], p[1], p[1]])); W.play([[200, 'R', ''], [60]]);
  const m = W.ram(0), H = x => (x >>> 0).toString(16);
  // procura um vetor de 0x80 tarefas de 0x14 bytes: main (+8) aponta para a ROM em muitas
  let best = null;
  for (const [lo, hi] of [[0x03000000, 0x03007000], [0x02000000, 0x0203F000]]) for (let a = lo; a < hi; a += 4) {
    let ok = 0; for (let i = 0; i < 0x80; i += 1) { const f = m.r32(a + i * 0x14 + 8); if (f >= 0x08000000 && f < 0x08800000 && (f & 1)) ok++; }
    if (ok > 20 && (!best || ok > best[1])) best = [a, ok];
  }
  console.log('gTasks?', H(best[0]), best[1]);
  const T = best[0], objs = [];
  for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14, f = m.r32(t + 8); if (!(f >= 0x08000000)) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6); const s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off;
    const kind = m.r8(s); if (kind === 1) { const tpl = m.r32(s + 0xB0); objs.push(`t${i} ${H(s)} tipo ${m.r8(s + 0x82)} hp ${m.r16(s + 0x80) << 16 >> 16} sala ${m.r16(s + 0x60)} x ${(m.r32(s + 0x40) | 0) >> 8} y ${(m.r32(s + 0x44) | 0) >> 8} molde ${H(tpl)} main ${H(f)}`); } }
  console.log(objs.join('\n'));
  W.shot('tarefas.png');
})();
