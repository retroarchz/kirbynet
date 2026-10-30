// P1 fala e espera; P2 fala. Esperado (pedido): os dois continuam esperando.
module.exports = (W) => {
  W.info('antes');
  W.fala(0); W.play([[200]]); W.info('P1 falou'); W.shot('p1.png');
  W.fala(1); W.play([[300]]); W.info('P2 falou'); W.shot('p1p2.png');
  W.play([[600]]); W.info('depois de 10s'); W.shot('p1p2-10s.png');
};
