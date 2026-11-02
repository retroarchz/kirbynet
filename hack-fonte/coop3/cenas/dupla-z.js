// Z (A) na espera vale para qualquer um que espera, com o host na luta ou não. Batalha inteira e volta ao mapa.
// QUEM = "1,2" (dois convidados, o host fica no mapa) ou "0,1" (host + convidado, Z no convidado).
const fs = require('fs'), path = require('path');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  const [a, b] = (process.env.QUEM || '1,2').split(',').map(Number), par = [a, b];
  const fora = [0, 1, 2].find(i => !par.includes(i));
  W.players.forEach(p => p.hle.autoLiga());
  W.players.forEach(p => { p.hle.aoCaixas = (at, b) => p.g.romWrite(at, b); });
  const resumo = (t) => W.players.forEach((p, i) => { const m = p.g.ram(0), c = p.hle.resumo; console.log('=', t, W.f, 'P' + (i + 1), 'cb2', m.r32(0x03002664).toString(16), 'cabo', m.r8(0x03003511), 'id', m.r8(0x03003512), 'n', m.r8(0x03003513), 'lig', c.ligados, 'nv', c.n, 'f', c.fase, 'sub', JSON.stringify(p.hle.sub), 'duo', JSON.stringify(p.hle.duo)); });
  W.fala(a); W.play([[200]]); W.fala(b); W.play([[300]]);
  resumo('dois esperando');
  if (!W.players[a].hle.duo) { W.play([[6, ...W.k(b, 'A')], [30]]); resumo('Z +30'); }
  W.play([[600]]); resumo('equipe'); W.shot('z-equipe.png');
  for (const i of par) { const f = require(Q + '/escolhe3.js')(W, i); W.play([...f('A'), [200]]); }
  resumo('equipes escolhidas');
  W.players.forEach((p, i) => { const m = p.g.ram(0), n = []; for (let s = 0; s < 6; s++) n.push(m.r8(0x020235CC + s * 0x68 + 0x58)); console.log('NIVEIS', 'P' + (i + 1), n.join(',')); });
  par.sort((x, y) => x - y);   // botões da batalha: a posição é a da ordem do cabo, não a de quem falou primeiro
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
    if (viu && !W.fotoD && ++W.fotoN > 900) { W.fotoD = 1; W.shot('z-caixas.png'); console.log('FLAG tripla', W.players.map(p => p.g.ram(0).r8(0x0203FE00)).join(',')); }
    if (k % 4000 === 0) resumo('quadro');
        if (viu && cb[0] === 0x080C2965 && cb[1] === 0x080C2965) break;
  }
  const conta = W.players.map(() => ({})); const ini = W.f;
  const log0 = W.log; W.log = (i, m) => { if (m.k === 'c') { const c = m.w[0].toString(16); conta[i][c] = (conta[i][c] || 0) + 1; if (['2222', '2ffe', 'cafe', '5fff', '5566', 'aaab', 'bbbb', 'aabb', 'eeee', '4444', '6666', '7777', 'ccdd', 'cccc'].includes(c) || !['bebe'].includes(c) && conta[i][c] <= 2) console.log('CMD', W.f, 'P' + (i + 1), m.w.map(v => v.toString(16)).join(' ')); } else if (!['au', 'st', 'cap'].includes(m.k)) console.log('MSG', W.f, 'P' + (i + 1), JSON.stringify(m)); };
  const estL = () => W.players.forEach((p, i) => { const m = p.g.ram(0); console.log('L', W.f, 'P' + (i + 1), 'enviados', JSON.stringify(conta[i]), 'sq', m.r8(0x03003510 + 0x339), 'cb', m.r32(0x03003484).toString(16), 'stat', m.r32(0x03003480).toString(16)); });
  resumo('voltaram'); W.shot('z-voltaram.png');
  const t0 = W.f, tres = () => W.players.every(p => p.hle.resumo.ligados === 3 && p.g.ram(0).r32(0x03002660) === 0x080C5761 && !p.g.ram(0).r8(0x03000FDC));
  for (let i = 0; i < 2400 && !tres(); i++) W.step(['', '', '']);
  console.log('=== TRES DE NOVO:', tres(), 'em', W.f - t0, 'quadros; quem ficou fora: P' + (fora + 1));
  resumo('fim');
  // o que cada um enxerga dos outros: objetos de jogador do coop (ids 200+) e a fila de comandos ainda não entregue
  const ve = (t) => W.players.forEach((p, i) => { const m = p.g.ram(0), v = []; for (let o = 0; o < 24; o++) { const q = 0x02038D10 + o * 0x24; if ((m.r8(q) & 1) && m.r8(q + 8) >= 200) v.push(m.r8(q + 8) + ':' + m.r16(q + 0x10) + ',' + m.r16(q + 0x12)); } const d = p.hle.debugSnapshot(), eu = m.r16(0x02038D10 + m.r8(0x02039075) * 0x24 + 0x10) + ',' + m.r16(0x02038D10 + m.r8(0x02039075) * 0x24 + 0x12); console.log('V', t, W.f, 'P' + (i + 1), 'eu', eu, 'vejo', v.join(' '), 'fila', JSON.stringify(d.inbox.map(([k, q]) => [k, q.length])), 'eco', d.echo.length, 'rq', m.r8(0x03003510 + 0xFBD), 'ids', JSON.stringify(d.ids), 'myid', m.r8(0x030055F0), 'count', m.r8(0x030055F4), 'tab40', Array.from({ length: 6 }, (_, k) => m.r8(0x03004540 + k).toString(16)).join(' '), 'a8', Array.from({ length: 4 }, (_, k) => m.r8(0x030045A8 + k)).join(' '), 'lp', Array.from({ length: 3 }, (_, k) => { let n = ''; for (let j = 0; j < 4; j++) n += m.r8(0x020229F0 + k * 0x24 + 8 + j).toString(16).padStart(2, '0'); return n; }).join(' ')); });
  W.play([[120]]); ve('antes');
  const fora2 = ['', '', '']; fora2[fora] = 'L';
  W.play([[40, ...fora2], [60]]); ve('fora andou L');
  W.play([[300]]); ve('+300');
  const dentro = ['', '', '']; dentro[b] = 'L';
  W.play([[40, ...dentro], [60]]); ve('dupla andou L');
  W.play([[300]]); ve('+300');
  estL();
  // atraso: quantos quadros entre um jogador andar e o outro enxergar a nova posição
  const pos = (i) => { const m = W.players[i].g.ram(0), q = 0x02038D10 + m.r8(0x02039075) * 0x24; return m.r16(q + 0x10); };
  const viu2 = (de, em) => { const m = W.players[em].g.ram(0); for (let o = 0; o < 24; o++) { const q = 0x02038D10 + o * 0x24; if ((m.r8(q) & 1) && m.r8(q + 8) === 200 + de) return m.r16(q + 0x10); } return null; };
  for (const [de, em] of [[b, a], [fora, a], [a, b], [fora, b]]) {
    const ks = ['', '', '']; ks[de] = 'R'; const alvo = pos(de) + 1; let f1 = 0, f2 = 0;
    for (let t = 0; t < 200 && !(f1 && f2); t++) { W.step(t < 18 ? ks : ['', '', '']); if (!f1 && pos(de) >= alvo) f1 = t + 1; if (!f2 && viu2(de, em) >= alvo) f2 = t + 1; }
    console.log('ATRASO', 'P' + (de + 1) + ' -> tela do P' + (em + 1), 'andou no quadro', f1, 'o outro viu no quadro', f2, 'diferença', f2 ? f2 - f1 : 'NUNCA');
    W.play([[60]]);
  }
  W.shot('z-fim.png');
};
