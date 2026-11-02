// Atraso no mapa com 3 ligados: quantos quadros entre um jogador andar e cada outro ver o boneco dele andar.
// Mede parado, depois de um aparelho engasgar (PARA quadros parado, como aba/PC que trava) e com um aparelho mais lento.
// RESTORE=1 RUN_NAME=atraso CENA=cenas/atraso.js node espera.js
module.exports = (W) => {
  W.players.forEach(p => p.hle.autoLiga());
  const n = W.players.length;
  const objs = (i) => { const m = W.players[i].g.ram(0), v = {}; for (let o = 0; o < 24; o++) { const q = 0x02038D10 + o * 0x24; if ((m.r8(q) & 1) && m.r8(q + 8) >= 200) v[m.r8(q + 8) - 200] = [m.r16(q + 0x10), m.r16(q + 0x12)]; } return v; };
  const pos = (i) => { const m = W.players[i].g.ram(0), q = 0x02038D10 + m.r8(0x02039075) * 0x24; return [m.r16(q + 0x10), m.r16(q + 0x12)]; };
  const fila = (i) => { const d = W.players[i].hle.debugSnapshot(), m = W.players[i].g.ram(0); return 'inbox ' + d.inbox.map(([k, q]) => 'v' + k + ':' + q.length).join(',') + ' jogo ' + m.r8(0x03003510 + 0xFBD); };
  const ligados = () => W.players.every(p => p.hle.resumo.ligados === n && p.g.ram(0).r32(0x03002660) === 0x080C5761);
  for (let k = 0; k < 3000 && !ligados(); k++) W.step(W.players.map(() => ''));
  W.play([[120]]);
  console.log('LIGADOS', ligados(), W.f, W.players.map((p, i) => 'P' + (i + 1) + ' ' + pos(i) + ' vê ' + JSON.stringify(objs(i))).join(' | '));
  const dirs = W.players.map(() => 'L');
  // de anda 1 passo; para cada outro: quadro em que a posição dele mudou e quadro em que cada outro viu
  const mede = (t) => {
    const res = [];
    for (let de = 0; de < n; de++) {
      dirs[de] = dirs[de] === 'R' ? 'L' : 'R';
      const ini = pos(de)[0], k = W.players.map(() => ''); k[de] = dirs[de]; let f1 = 0; const f2 = {};
      for (let t = 0; t < 400; t++) {
        if (t === 40 && !f1) { dirs[de] = dirs[de] === 'R' ? 'L' : 'R'; k[de] = dirs[de]; }   // parede: tenta o outro lado
        W.step(t < 10 || (t >= 40 && t < 50) ? k : W.players.map(() => ''));
        if (!f1 && pos(de)[0] !== ini) f1 = t + 1;
        for (let em = 0; em < n; em++) if (em !== de && !f2[em]) { const o = objs(em)[de]; if (o && o[0] !== ini) f2[em] = t + 1; }
        if (f1 && Object.keys(f2).length === n - 1) break;
      }
      for (let em = 0; em < n; em++) if (em !== de) res.push(`P${de + 1}->P${em + 1} ${f2[em] ? f2[em] - f1 : 'NUNCA'}`);
      W.play([[30]]);
    }
    console.log('EST', t, W.f, W.players.map((p, i) => { const m = p.g.ram(0); return 'P' + (i + 1) + ' pos ' + pos(i) + ' vê ' + JSON.stringify(objs(i)) + ' cabo ' + m.r8(0x03003511) + ' n ' + m.r8(0x03003513) + ' cb1 ' + m.r32(0x03002660).toString(16) + ' cb2 ' + m.r32(0x03002664).toString(16) + ' lig ' + p.hle.resumo.ligados + ' f ' + p.hle.resumo.fase + ' trava ' + m.r8(0x03000FDC) + ' ctx ' + m.r8(0x03000EE8); }).join(' | '));
    W.shot('atraso-' + t.replace(/ /g, '_') + '.png');
    console.log('ATRASO', t, res.join('  '), '|', W.players.map((_, i) => 'P' + (i + 1) + ' ' + fila(i)).join(' ; '));
  };
  mede('normal');
  mede('normal2');
  const PARA = +(process.env.PARA || 120);
  for (const q of [1, 0]) {
    W.para = W.players.map(() => 0); W.para[q] = PARA;
    W.play([[PARA + 2]]);
    console.log('P' + (q + 1), 'ficou parado', PARA, 'quadros', W.players.map((_, i) => 'P' + (i + 1) + ' ' + fila(i)).join(' ; '));
    mede('depois do P' + (q + 1) + ' parar');
    W.play([[600]]);
    mede('10s depois do P' + (q + 1) + ' parar');
  }
  // aparelho mais lento: P3 roda 1 de cada 12 quadros a menos (55 fps contra 60) por 30 s
  W.para = W.players.map(() => 0);
  for (let k = 0; k < 1800; k++) { if (k % 12 === 0) W.para[2] = 1; W.step(W.players.map(() => '')); }
  mede('P3 lento 30s');
  W.shot('atraso-fim.png');
};
