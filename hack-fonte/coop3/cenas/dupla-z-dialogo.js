// O A que fecha o diálogo não pode iniciar a dupla: só um A novo, depois de soltar.
module.exports = (W) => {
  W.players.forEach(p => p.hle.autoLiga());
  const fala1 = (i) => W.play([[16, ...W.k(i, 'R')], [150], [8, ...W.k(i, 'A')], [240]]);
  const est = (t) => console.log('=', t, W.f, W.players.map((p, i) => 'P' + (i + 1) + ' duo ' + JSON.stringify(p.hle.duo) + ' cb2 ' + p.g.ram(0).r32(0x03002664).toString(16)).join(' | '));
  fala1(1); W.play([[200]]); fala1(2); W.play([[300]]);
  est('os dois só com o A do diálogo: NÃO pode ter começado');
  W.play([[6, ...W.k(2, 'A')], [60]]); est('Z novo no P3: tem de começar');
  W.play([[300]]); est('+300');
};
