// P1 e P2 esperando; A no P2 não pode iniciar; A no P1 inicia a dupla com P3 no mapa.
const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  const snap = path.join(W.out, '..', 'espera2.snapshot');
  if (process.env.DE_ESPERA2) { W.debugRestore(v8.deserialize(fs.readFileSync(snap))); }
  else {
    W.fala(0); W.play([[200]]); W.fala(1); W.play([[300]]);
    fs.writeFileSync(snap, v8.serialize(W.debugSnapshot()));
  }
  W.info('dois esperando');
  for (let n = 0; n < 4; n++) W.play([[6, ...W.k(1, 'A')], [40]]);
  W.play([[120]]); W.info('depois de 4x A no P2'); W.shot('a-no-p2.png');
  W.play([[6, ...W.k(0, 'A')], [30]]); W.info('A no P1 +30');
  W.play([[120]]); W.info('A no P1 +150'); W.shot('a-no-p1.png');
  W.play([[400]]); W.info('A no P1 +550'); W.shot('a-no-p1-b.png');
  fs.writeFileSync(path.join(W.out, '..', 'dupla-equipe.snapshot'), v8.serialize(W.debugSnapshot()));
};
