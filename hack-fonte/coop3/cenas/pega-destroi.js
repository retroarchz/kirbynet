// motor instrumentado: quem escreve nas bandeiras do sprite 0 no quadro em que ele some
module.exports = (W) => {
  W.players.forEach(p => { p.hle.aoCaixas = (at, b) => p.g.romWrite(at, b); });
  const H = (x) => (x >>> 0).toString(16), m = W.players[0].g.ram(0), alvo = +(process.env.ALVO || 8913);
  W.players.forEach(p => p.g.ram(0).watch(0x0203FA00, 0));
  while (W.f < alvo) W.step(['', '', '']);
  m.watch(+(process.env.END || 0x0202066E), +(process.env.LEN || 2));
  try { for (let k = 0; k < 3; k++) { W.step(['', '', '']); console.log('passou', W.f); } }
  catch (e) { const c = m.cpu(); console.log('PEGOU', W.f, 'fault', m.fault().map(H), 'regs', c.map((v, i) => 'r' + i + '=' + H(v)).join(' ')); const s = []; for (let a = c[13]; a < c[13] + 0x80; a += 4) { const v = m.r32(a); if (v >= 0x08000000 && v < 0x0A000000) s.push(H(v)); } console.log('pilha', s.join(' ')); }
};
