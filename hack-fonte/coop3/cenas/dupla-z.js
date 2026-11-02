// Z (A) na espera vale para qualquer um que espera, com o host na luta ou não. Batalha inteira e volta ao mapa.
// QUEM = "1,2" (dois convidados, o host fica no mapa) ou "0,1" (host + convidado, Z no convidado).
const fs = require('fs'), path = require('path');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  const [a, b] = (process.env.QUEM || '1,2').split(',').map(Number), par = [a, b];
  const fora = [0, 1, 2].find(i => !par.includes(i));
  W.players.forEach(p => p.hle.autoLiga());
  const resumo = (t) => W.players.forEach((p, i) => { const m = p.g.ram(0), c = p.hle.resumo; console.log('=', t, W.f, 'P' + (i + 1), 'cb2', m.r32(0x03002664).toString(16), 'cabo', m.r8(0x03003511), 'id', m.r8(0x03003512), 'n', m.r8(0x03003513), 'lig', c.ligados, 'nv', c.n, 'f', c.fase, 'sub', JSON.stringify(p.hle.sub), 'duo', JSON.stringify(p.hle.duo)); });
  W.fala(a); W.play([[200]]); W.fala(b); W.play([[300]]);
  resumo('dois esperando');
  if (!W.players[a].hle.duo) { W.play([[6, ...W.k(b, 'A')], [30]]); resumo('Z +30'); }
  W.play([[600]]); resumo('equipe'); W.shot('z-equipe.png');
  for (const i of par) { const f = require(Q + '/escolhe3.js')(W, i); W.play([...f('A'), [200]]); }
  resumo('equipes escolhidas');
  W.fotoN = 0; let viu = false; const turno = [0, 0], noMenu = [false, false];
  const tecla = (p, j, k) => {
    const m = p.g.ram(0), c = 2 * j, ctrl = m.r32(0x0203FA00 + 4 * c);
    if (ctrl === 0x0808E8ED) {
      if (!noMenu[j]) { noMenu[j] = true; turno[j]++; }
      if (k % 20) return '';
      const buf = m.r32(0x02023538) + 0x24 + c * 0x200, cur = m.r8(0x0203FA40 + c);
      const pp = [0, 1, 2, 3].map(i => m.r16(buf + 4 + 2 * i) ? m.r8(buf + 12 + i) : 0);
      const ok = [0, 1, 2, 3].filter(i => pp[i] > 0), want = ok.length ? ok[turno[j] % ok.length] : cur;
      if (cur !== want) { if ((cur & 1) !== (want & 1)) return want & 1 ? 'R' : 'L'; return want & 2 ? 'D' : 'U'; }
      return 'A';
    }
    noMenu[j] = false;
    return k % 40 === 0 ? 'A' : '';
  };
  for (let k = 0; k < +(process.env.FRAMES || 26000); k++) {
    W.step(W.players.map((p, i) => { const j = par.indexOf(i); return j < 0 ? '' : tecla(p, j, k); }));
    if (viu && k % 300 === 0) par.forEach(i => { const m = W.players[i].g.ram(0); for (const c of [1, 3]) if (m.r16(0x0203F424 + c * 0x60 + 0x2A) > 1) m.w16(0x0203F424 + c * 0x60 + 0x2A, 1); });
    const cb = par.map(i => W.players[i].g.ram(0).r32(0x03002664));
    if (cb[0] === 0x0803F431 && !viu) { viu = true; resumo('batalha'); W.shot('z-batalha.png'); }
    if (k % 4000 === 0) resumo('quadro');
    if (viu && process.env.FOTO && ++W.fotoN === +process.env.FOTO) { W.shot('z-luta.png'); return; }
    if (viu && cb[0] === 0x080C2965 && cb[1] === 0x080C2965) break;
  }
  resumo('voltaram'); W.shot('z-voltaram.png');
  const t0 = W.f, tres = () => W.players.every(p => p.hle.resumo.ligados === 3 && p.g.ram(0).r32(0x03002660) === 0x080C5761 && !p.g.ram(0).r8(0x03000FDC));
  for (let i = 0; i < 2400 && !tres(); i++) W.step(['', '', '']);
  console.log('=== TRES DE NOVO:', tres(), 'em', W.f - t0, 'quadros; quem ficou fora: P' + (fora + 1));
  resumo('fim');
  W.play([[16, 'R', 'L', 'U'], [60]]); resumo('andaram'); W.shot('z-fim.png');
};
