const { abre } = require('./base.js'), fs = require('fs'), v8 = require('v8');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
(async () => {
  const W = await abre(+(process.env.N || 2));
  W.play(NAV.map(p => p.length === 1 ? p : [p[0], ...Array(W.n).fill(p[1])]));
  const H = (x) => (x >>> 0).toString(16), D = 0x020382D0;
  const est = (i) => { const m = W.ram(i); return `P${i + 1} quad ${m.r32(D)} f4 ${H(m.r16(D + 4))} u6 ${m.r8(D + 6)} atraso ${[0,1,2,3].map(k => m.r8(D + 0x2A0 + k))} esc ${[0,1,2,3].map(k => m.r8(D + 0x2A4 + k))} lei ${[0,1,2,3].map(k => m.r8(D + 0x2A8 + k))} 2AC ${m.r8(D + 0x2AC)} 2AD ${m.r8(D + 0x2AD)} flags ${H(m.r32(0x03002554))} siocnt ${H(m.siocnt())} 2558 ${m.r8(0x03002558)} hum ${m.r8(0x0203AD30)} env ${Array.from({ length: 10 }, (_, k) => H(m.r16(0x030036B0 + 2 * k))).join('.')}`; };
  for (let i = 0; i < W.n; i++) console.log(est(i));
  let pausas = 0; for (let k = 0; k < 600; k++) { const a = W.ram(0).r32(D); W.step(Array(W.n).fill(k % 60 < 30 ? 'R' : 'L')); if (W.ram(0).r32(D) === a) pausas++; }
  console.log('600 quadros andando: pausas do jogo', pausas);
  for (let i = 0; i < W.n; i++) console.log(est(i));
  W.shot('mede.png');
  const m = W.ram(0); console.log('recv', [0,1,2,3].map(i => Array.from({ length: 10 }, (_, k) => H(m.r16(0x03002490 + i * 0x14 + 2 * k))).join('.')).join(' | '));
})();
