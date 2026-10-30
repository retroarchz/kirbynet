// tripla: grava quadros da abertura (a cada 20) para ver a pose dos três treinadores
const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'espera2.snapshot'))));
  W.fala(2); W.play([[200]]);
  for (const i of [0, 2, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  const m = W.players[0].g.ram(0); let n = 0;
  for (let k = 0; k < 5000; k++) { W.step([]); if (m.r32(0x03002664) === 0x0803F431 && k % 25 === 0 && n < 60) { W.shot('f' + String(n++).padStart(2, '0') + '.png'); } }
  W.info('fim'); W.shot('fim.png');
  console.log('SPR', JSON.stringify(W.players.map(p => Array.from({ length: 6 }, (_, b) => p.g.ram(0).r8(0x0203F664 + b)))), 'MAIN', W.players.map(p => p.g.ram(0).r32(0x03005504).toString(16)));
  fs.writeFileSync(path.join(W.out, '..', 'tripla-menu.snapshot'), v8.serialize(W.debugSnapshot()));
};
