const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'espera2.snapshot'))));
  W.fala(2); W.play([[200]]);
  const m = W.players[1].g.ram(0);           // P2 (vê o Brendan)
  const h = (a, n) => { let x = 0; for (let i = 0; i < n; i += 4) x = (x * 31 + m.r32(a + i)) >>> 0; return x.toString(16); };
  let last = '';
  const orig = W.step; W.step = (k) => { orig(k);
    const g = m.r32(0x02023574); if (!g) return;
    const b0 = m.r32(g), st = [h(b0, 0x800), h(b0 + 0x800, 0x800), h(b0 + 0x1000, 0x800), h(b0 + 0x1800, 0x800), 'spr4=' + m.r8(0x0203F664 + 4), 'spr0=' + m.r8(0x0203F664)].join(' ');
    if (st !== last) { console.log('B', W.f, 'buf0', b0.toString(16), st, 'cb1', m.r32(0x03002660).toString(16), 'main', m.r32(0x03005504).toString(16), 'ctrl0', m.r32(0x0203FA00).toString(16), 'ctrl4', m.r32(0x0203FA10).toString(16)); last = st; } };
  for (const i of [0, 2, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  W.play([[2400]]);
};
