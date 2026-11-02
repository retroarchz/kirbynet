// Batalha de 3: o que cada jogador tem na equipe (nível +0x58, vida +0x5A, máx +0x5C) e na batalha (gBattleMons +0x2A hp, nível?)
const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  const PARTY = 0x020235CC, MONS = 0x0203F424;
  const eq = (t) => W.players.forEach((p, i) => { const m = p.g.ram(0), v = []; for (let s = 0; s < 6; s++) { const o = PARTY + s * 0x68; v.push(`${s}:pid ${m.r32(o).toString(16)} nv ${m.r8(o + 0x58)} hp ${m.r16(o + 0x5A)}/${m.r16(o + 0x5C)}`); } console.log('E', t, 'P' + (i + 1), v.join(' | ')); });
  const bat = (t) => W.players.forEach((p, i) => { const m = p.g.ram(0), v = []; for (let b = 0; b < 6; b++) { const o = MONS + b * 0x60, h = []; for (let k = 0x24; k < 0x34; k++) h.push(m.r8(o + k).toString(16)); v.push(`b${b} esp ${m.r16(o)} [${h.join(' ')}]`); } console.log('B', t, 'P' + (i + 1), v.join(' | ')); });
  W.players.forEach(p => p.hle.autoLiga());
  W.players.forEach(p => { p.hle.aoCaixas = (at, b) => p.g.romWrite(at, b); });
  W.play([[60]]);
  // equipes reais de cada um (a da nuvem), com a contagem certa
  const eqs = JSON.parse(fs.readFileSync(path.join(W.out, '..', 'equipes.json')));
  W.players.forEach((p, i) => { const m = p.g.ram(0), e = eqs[i]; e.v.forEach((b, k) => m.w8(PARTY + k, b)); m.w8(0x020235C9, e.qtd); });
  eq('antes');
  // vigia: quadro exato em que o nível de cada vaga muda, em cada jogador
  const vs = W.step; let ant = {}; W.step = (k) => { vs(k); W.players.forEach((p, i) => { const m = p.g.ram(0), n = []; for (let s = 0; s < 6; s++) n.push(m.r8(PARTY + s * 0x68 + 0x58)); const c = n.join(','); if (c !== ant[i]) { ant[i] = c; console.log('N', W.f, 'P' + (i + 1), c, 'cb2', m.r32(0x03002664).toString(16), 'fala', m.r16(0x03004570), 'tipo', m.r32(0x02022FBC).toString(16), 'tar', Array.from({ length: 16 }, (_, t) => m.r8(0x03005640 + 40 * t + 4) ? m.r32(0x03005640 + 40 * t).toString(16).slice(1) : '').filter(Boolean).slice(4).join(','), 'ctx', m.r8(0x03000EE8), 'pc', m.r32(0x03000EB0 + 8).toString(16)); } }); };
  const fala1 = (i) => W.play([[16, ...W.k(i, 'R')], [150], [8, ...W.k(i, 'A')], [240]]);
  const ordem = (process.env.ORDEM || '1,2,0').split(',').map(Number);
  fala1(ordem[0]); W.play([[200]]); fala1(ordem[1]); W.play([[300]]); fala1(ordem[2]); W.play([[300]]);
  W.info('os tres falaram');
  for (const i of [0, 2, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  eq('equipes escolhidas');
  W.play([[1200]]); eq('entrando'); W.shot('niveis-a.png');
  W.play([[600]]); W.shot('niveis.png');
  if (process.env.SOTELA) {
    if (process.env.ATEFIM) {
      for (let k = 0; k < 9000 && W.players[0].g.ram(0).r32(0x03002664) !== 0x080C2965; k++) { W.step(W.players.map(() => k % 40 < 6 ? 'A' : '')); if (k % 120 === 0) W.players.forEach(p => { const q = p.g.ram(0); for (const c of [1, 3]) if (q.r16(0x0203F424 + c * 0x60 + 0x2A) > 1) q.w16(0x0203F424 + c * 0x60 + 0x2A, 1); }); }
      W.play([[400]]);
      console.log('FIM flag', W.players.map(p => p.g.ram(0).r8(0x0203FE00)).join(','), 'cb2', W.players.map(p => p.g.ram(0).r32(0x03002664).toString(16)).join(','), 'cabo', W.players.map(p => p.g.ram(0).r8(0x03003513)).join(','));
    }
    return;
  }
  eq('na batalha');
  // menu de alvo do Cubchoo (P1): por quais posições o cursor passa em cada golpe modificado
  const m = W.players[0].g.ram(0), O = 0x0203F424, H = (x) => x.toString(16);
  const estado = () => [H(m.r32(0x0203FA00)), m.r8(0x03005570), m.r8(0x0203FA40)];
  const golpes = (process.env.GOLPES || '681,682,329,58').split(',').map(Number);
  golpes.forEach((g, i) => { m.w16(O + 0x0C + 2 * i, g); m.w8(O + 0x24 + i, 5); });
  console.log('moves', [0, 1, 2, 3].map(i => m.r16(O + 0x0C + 2 * i)));
  W.play([[6, ...W.k(0, 'A')], [40]]); console.log('LUTAR', estado());
  for (let g = 0; g < 4; g++) {
    const cur = m.r8(0x0203FA40);
    if ((cur & 1) !== (g & 1)) W.play([[6, ...W.k(0, g & 1 ? 'R' : 'L')], [14]]);
    if ((m.r8(0x0203FA40) & 2) !== (g & 2)) W.play([[6, ...W.k(0, g & 2 ? 'D' : 'U')], [14]]);
    W.play([[6, ...W.k(0, 'A')], [30]]);
    const e = estado(), inicio = e[1], dir = [], esq = [];
    if (e[0] === '808e8ed') { console.log('GOLPE', golpes[g], 'sem cursor (saiu direto ou recusado)', e); continue; }
    for (let k = 0; k < 7; k++) { W.play([[6, ...W.k(0, 'R')], [16]]); dir.push(m.r8(0x03005570)); }
    for (let k = 0; k < 7; k++) { W.play([[6, ...W.k(0, 'L')], [16]]); esq.push(m.r8(0x03005570)); }
    for (let k = 0; k < 7; k++) { W.play([[6, ...W.k(0, 'D')], [16]]); dir.push(m.r8(0x03005570)); }
    console.log('GOLPE', golpes[g], 'tela', e[0], 'inicio', inicio, 'DIREITA/BAIXO', JSON.stringify(dir), 'ESQUERDA', JSON.stringify(esq));
    W.shot('alvo-' + golpes[g] + '.png');
    if (g === 0 && process.env.USA) {   // usa de verdade no 4
      for (let k = 0; k < 6 && m.r8(0x03005570) !== 4; k++) W.play([[6, ...W.k(0, 'R')], [16]]);
      W.shot('alvo-no-4.png'); console.log('cursor em', m.r8(0x03005570)); W.play([[6, ...W.k(0, 'A')], [60]]);
      for (let k = 0; k < 500; k++) W.step(['', k % 40 < 6 ? 'A' : '', k % 40 < 6 ? 'A' : '']);
      W.shot('esc-placa.png');
      m.w8(0x0203FF80 + 4 * 16, 2); W.play([[150]]); W.shot('esc-cristal.png');
      m.w8(0x0203FF80 + 4 * 16, 0); W.play([[150]]); W.shot('esc-sumiu.png');
      const caixa = () => W.players.map((p, i) => { const q = p.g.ram(0), id = q.r8(0x0203F9F8 + 4), o = 0x02020630 + id * 68; return 'P' + (i + 1) + ' id ' + id + ' ativo ' + (q.r8(o + 0x3E) & 1) + ' invis ' + ((q.r8(o + 0x3E) >> 2) & 1) + ' tile ' + (q.r16(o + 4) & 1023); }).join(' | ');
      console.log('CAIXA4 sumiu', caixa());
      for (const f of [120, 240, 360, 480]) { for (let k = 0; k < 120; k++) W.step(['', k % 40 < 6 ? 'A' : '', k % 40 < 6 ? 'A' : '']); console.log('CAIXA4 +' + f, caixa()); }
      W.shot('esc-depois.png');
      W.players.forEach((p, i) => { const q = p.g.ram(0); console.log('TAREFA P' + (i + 1), 'fase', q.r8(0x0203FF80 + 64), 'sprite', q.r8(0x0203FF80 + 67), 'desenhada', q.r8(0x0203FF80 + 77)); });
      return;
      W.shot('escudo.png');
      const fases = () => W.players.map((p, i) => 'P' + (i + 1) + ' ' + [0, 2, 4].map(b => p.g.ram(0).r8(0x0203FF80 + b * 16)).join(',')).join(' | ');
      console.log('FASES', fases());
      for (let r = 0; r < 5; r++) { for (let k = 0; k < 1200; k++) W.step(['', k % 40 < 6 ? 'A' : '', k % 40 < 6 ? 'A' : '']); console.log('FASES +' + (r + 1), fases(), 'cb2', W.players[1].g.ram(0).r32(0x03002664).toString(16)); if (r === 0) W.shot('escudo2.png'); W.play([[6, ...W.k(0, 'A')], [40], [6, ...W.k(0, 'A')], [40]]); }
      W.players.forEach((p, i) => { const q = p.g.ram(0), v = []; for (let b = 0; b < 6; b++) v.push(Array.from({ length: 4 }, (_, k) => q.r8(0x0203FF80 + b * 16 + k).toString(16)).join(' ')); console.log('ESCUDO P' + (i + 1), v.join(' | ')); });
      return;
    }
    W.play([[6, ...W.k(0, 'B')], [30]]); console.log('  voltou', estado());
  }
  W.shot('longa.png');
  // joga turnos: todos apertam A; a cada ~10 s fotografa e olha a equipe
  for (let r = 1; r <= 0; r++) {
    for (let k = 0; k < 600; k++) W.step(W.players.map(() => k % 40 < 6 ? 'A' : ''));
    eq('turnos ' + r); W.shot('niveis-t' + r + '.png');
  }
};
