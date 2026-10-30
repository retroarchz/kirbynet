const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'tripla-menu.snapshot'))));
  const m = W.players[0].g.ram(0), hp = () => [0,1,2,3,4].map(b => m.r16(0x0203F424 + b * 0x60 + 0x2A));
  console.log('HP antes', JSON.stringify(hp()));
  W.play([[6, ...W.k(0, 'A')], [30]]);
  for (const mv of ['', 'R', 'D', 'L']) { if (mv) W.play([[6, ...W.k(0, mv)], [20]]); W.play([[6, ...W.k(0, 'A')], [30]]); if (m.r32(0x0203FA00) === 0x0808E04D) break; }
  console.log('ctrl', m.r32(0x0203FA00).toString(16));
  for (let k = 0; k < 6 && m.r8(0x03005570) !== 4; k++) W.play([[6, ...W.k(0, 'R')], [20]]);
  console.log('cursor', m.r8(0x03005570)); W.shot('mira4.png');
  W.play([[6, ...W.k(0, 'A')], [40]]);
  for (let k = 0; k < 6000; k++) {
    W.step(['', k % 40 === 0 ? 'A' : '', k % 40 === 20 ? 'A' : '']);
    if (k % 300 === 0) { const h = hp(); if (k % 1200 === 0) console.log('HP', W.f, JSON.stringify(h)); }
    if (k % 150 === 0 && k < 4500) W.shot('t' + String(k / 150).padStart(2, '0') + '.png');
  }
  console.log('HP depois', JSON.stringify(hp()));
};
