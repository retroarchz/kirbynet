// só para teste: o treinador fica com 1 Pokémon (o 2º da equipe dele é apagado enquanto a batalha é preparada)
module.exports = (W) => {
  const ENEMY = 0x02023AAC, vs = W.step;
  W.step = (k) => {
    vs(k);
    W.players.forEach((p, i) => { const m = p.g.ram(0), cb = m.r32(0x03002664); if (cb !== 0x080C2965 && cb !== 0x0803F431 && m.r8(ENEMY + 0x68 + 0x58)) { for (let j = 0; j < 0x68; j++) m.w8(ENEMY + 0x68 + j, 0); } });
    if (process.env.VIGIA) W.players.forEach((p, i) => { const m = p.g.ram(0), c = m.r32(0x03002664).toString(16); if (c !== W['cb' + i]) { W['cb' + i] = c; console.log('CB2', W.f, 'P' + (i + 1), c, 'qtd', m.r8(0x02023044), 'abs', m.r8(0x02023209).toString(16)); } });
  };
};
