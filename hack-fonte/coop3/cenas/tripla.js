// P1 e P2 esperando (sem A do host); P3 fala com o mesmo treinador: os três avançam juntos.
const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'espera2.snapshot'))));
  W.play([[400]]); W.info('dois esperando, 400 quadros sem A');
  W.fala(2); W.play([[200]]); W.info('P3 falou'); W.shot('tripla-equipe.png');
  for (const i of [0, 2, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  W.play([[2400]]); W.info('depois de escolher'); W.shot('tripla-batalha.png');
  fs.writeFileSync(path.join(W.out, '..', 'tripla-batalha.snapshot'), v8.serialize(W.debugSnapshot()));
};
