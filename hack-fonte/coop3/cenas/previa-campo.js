// prévia: mexe só nos sprites já criados (y e prioridade) para ver como fica antes de mudar o jogo
module.exports = (W) => {
  const SPR = 0x02020630, SPRID = 0x0203F664;
  W.play([[2]]); W.shot('previa-antes.png');
  const Y = +(process.env.Y || 84), SUB = +(process.env.SUB || 15), atual = { 0: 80, 2: 84, 4: 92 };
  W.players.forEach(p => { const m = p.g.ram(0); for (const b of [0, 2, 4]) { const o = SPR + m.r8(SPRID + b) * 0x44; m.w16(o + 0x22, m.r16(o + 0x22) + Y - atual[b]); if (b === 4) m.w8(o + 0x43, SUB); } });
  W.play([[2]]); W.shot('previa-' + Y + '-' + SUB + '.png');
};
