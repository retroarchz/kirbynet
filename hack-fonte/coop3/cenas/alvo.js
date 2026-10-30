const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'tripla-menu.snapshot'))));
  const m = W.players[0].g.ram(0), H = x => x.toString(16);
  const st = () => [H(m.r32(0x0203FA00)), m.r8(0x03005570), m.r8(0x0203FA40)];
  const buf = m.r32(0x02023538) + 0x24;
  console.log('golpes', [0,1,2,3].map(i => m.r16(buf + 4 + 2 * i)), 'pp', [0,1,2,3].map(i => m.r8(buf + 12 + i)));
  W.play([[6, ...W.k(0, 'A')], [30]]); console.log('menu golpes', st());
  for (const mv of ['', 'R', 'D', 'L']) {          // tenta cada golpe até abrir a escolha de alvo
    if (mv) W.play([[6, ...W.k(0, mv)], [20]]);
    W.play([[6, ...W.k(0, 'A')], [30]]);
    const s = st(); console.log('depois do A', mv, s);
    if (s[0] !== '808e8ed') break;
  }
  const vis = [];
  for (let k = 0; k < 7; k++) { W.play([[6, ...W.k(0, 'R')], [20]]); vis.push(m.r8(0x03005570)); }
  console.log('DIREITA', JSON.stringify(vis)); vis.length = 0;
  for (let k = 0; k < 7; k++) { W.play([[6, ...W.k(0, 'L')], [20]]); vis.push(m.r8(0x03005570)); }
  console.log('ESQUERDA', JSON.stringify(vis)); W.shot('alvo.png');
};
