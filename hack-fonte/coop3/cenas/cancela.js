// P1 e P2 esperando; P2 aperta R (cancela). Depois A no P1 não pode começar nada.
const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'espera2.snapshot'))));
  W.play([[6, ...W.k(1, 'RB')], [200]]); W.info('P2 cancelou'); W.shot('p2-cancelou.png');
  W.play([[6, ...W.k(0, 'A')], [300]]); W.info('A no P1 depois do cancelamento'); W.shot('p1-a-sozinho.png');
};
