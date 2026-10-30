const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'espera2.snapshot'))));
  W.fala(2); W.play([[200]]);
  const m = W.players[0].g.ram(0);
  let last = '';
  const orig = W.step; W.step = (k) => { orig(k);
    if (m.r32(0x03002664) !== 0x0803F431 && m.r32(0x03002660) !== 0x08042829) return;
    // sprites que usam tiles 0x100..0x160
    const us = []; for (let s = 0; s < 64; s++) { const a = 0x02020630 + 0x44 * s; if (!(m.r16(a + 0x3E) & 1)) continue; const t = m.r16(a + 4) & 0x3FF; if (t >= 0x100 && t < 0x160) us.push('s' + s + ':' + t.toString(16) + ':' + m.r32(a + 0x1C).toString(16) + ':' + m.r16(a + 0x40).toString(16)); }
    const st = us.join(' ') + ' | spr ' + Array.from({ length: 6 }, (_, b) => m.r8(0x0203F664 + b)).join(',') + ' hb ' + Array.from({ length: 6 }, (_, b) => m.r8(0x0203F9F8 + b)).join(',');
    if (st !== last) { console.log('T', W.f, st); last = st; } };
  for (const i of [0, 2, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  W.play([[2400]]);
};
