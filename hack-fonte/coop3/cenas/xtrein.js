const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'espera2.snapshot'))));
  W.fala(2); W.play([[200]]);
  for (const i of [0, 2, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  for (let k = 0; k < 900; k++) { W.step([]); if (W.players[0].g.ram(0).r32(0x03002664) === 0x0803F431) break; }
  for (let t = 0; t < 14; t++) { W.play([[30]]); W.players.forEach((p, j) => { const m = p.g.ram(0);
    console.log('P' + (j + 1), [0, 2, 4].map(b => { const s = m.r8(0x0203F664 + b), a = 0x02020630 + 0x44 * s; return b + ':s' + s + ' x' + (m.r16(a + 0x20) << 16 >> 16) + '+' + (m.r16(a + 0x24) << 16 >> 16) + ' fl' + m.r16(a + 0x3E).toString(16); }).join('  '), 'f', W.f); }); }
};
