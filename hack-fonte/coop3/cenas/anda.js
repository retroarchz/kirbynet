// Depois de voltar ao mapa: cada um anda numa direção; todos têm que continuar conectados (3)
const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', process.env.DE || 'dupla-volta.snapshot'))));
  W.play([[6, 'A', 'A', 'A'], [90], [3, 'A', 'A', 'A'], [60]]);
  const pos = () => W.players.map(p => { const r = p.g.ram(0); return [r.r16(0x02038D20) - 7, r.r16(0x02038D22) - 7, r.r8(0x03003511), r.r8(0x03003513)]; });
  const a = pos(); W.shot('antes-andar.png');
  for (let j = 0; j < 3; j++) { const k = ['', '', '']; k[j] = ['D', 'L', 'U'][j]; W.play([[20, ...k], [60]]); }
  W.play([[120]]); const b = pos(); W.shot('depois-andar.png');
  console.log('ANTES', JSON.stringify(a), 'DEPOIS', JSON.stringify(b));
  console.log(b.every((x, j) => x[2] === 4 && x[3] === 3 && (x[0] !== a[j][0] || x[1] !== a[j][1])) ? 'PASSOU: 3 conectados e andando' : 'FALHOU');
};
