// com o motor instrumentado: onde o P1 pula para o endereço 0
module.exports = (W) => {
  W.players.forEach(p => { p.hle.aoCaixas = (at, b) => p.g.romWrite(at, b); });
  const H = (x) => (x >>> 0).toString(16), m = W.players[0].g.ram(0);
  W.players.forEach(p => p.g.ram(0).watch(0x0203FA00, 0));   // só o pulo para 0 (sem vigiar escrita)
  try { for (let k = 0; k < 1200 && m.r32(0x03002664); k++) W.step(['', '', '']); console.log('não pegou; cb2', H(m.r32(0x03002664)), W.f); }
  catch (e) { const c = m.cpu(); console.log('PEGOU', W.f, String(e).slice(0, 80), 'fault', m.fault().map(H), 'regs', c.map((v, i) => 'r' + i + '=' + H(v)).join(' ')); }
};
