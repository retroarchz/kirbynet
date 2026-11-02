// Batalha de 3 contra o treinador: onde fica cada Pokémon na tela (sprite, prioridade) e se a luta segue com 1 ou 2 inimigos.
// INIMIGOS=1: o treinador só tem 1 Pokémon (o 2º da equipe dele é apagado antes da batalha, só neste teste).
// TURNOS=n: joga n escolhas de golpe com os três. Grava .runtime/<RUN>/campo-menu.snapshot no 1º menu.
const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
const PARTY = 0x020235CC, ENEMY = 0x02023AAC, MONS = 0x0203F424, SPR = 0x02020630, SPRID = 0x0203F664, CTRL = 0x0203FA00;
module.exports = (W) => {
  const H = (x) => x.toString(16);
  W.players.forEach(p => p.hle.autoLiga());
  W.players.forEach(p => { p.hle.aoCaixas = (at, b) => p.g.romWrite(at, b); });
  if (process.env.COORDS) W.players.forEach(p => p.g.romWrite(0x9FE4560 + 32, new Uint8Array(JSON.parse(process.env.COORDS))));
  const sprites = (t) => W.players.forEach((p, i) => {
    const m = p.g.ram(0), v = [];
    for (let b = 0; b < 6; b++) {
      const id = m.r8(SPRID + b), o = SPR + id * 0x44;
      if (!(m.r8(o + 0x3E) & 1)) { v.push(`b${b}: -`); continue; }
      const x = (m.r16(o + 0x20) << 16 >> 16) + (m.r16(o + 0x24) << 16 >> 16), y = (m.r16(o + 0x22) << 16 >> 16) + (m.r16(o + 0x26) << 16 >> 16);
      v.push(`b${b}: spr ${id} esp ${m.r16(MONS + b * 0x60)} x ${x} y ${y} sub ${m.r8(o + 0x43)} pri ${(m.r16(o + 4) >> 10) & 3} invis ${(m.r8(o + 0x3E) >> 2) & 1}`);
    }
    console.log('SPR', t, 'P' + (i + 1), 'qtd', m.r8(0x02023044), v.join(' | '));
  });
  const ligados = () => W.players.every(p => p.hle.resumo.ligados === 3 && p.g.ram(0).r32(0x03002660) === 0x080C5761);
  for (let k = 0; k < 3000 && !ligados(); k++) W.step(['', '', '']);
  // equipes reais (como no niveis.js)
  const eqs = JSON.parse(fs.readFileSync(path.join(W.out, '..', 'equipes.json')));
  W.players.forEach((p, i) => { const m = p.g.ram(0), e = eqs[i]; e.v.forEach((b, k) => m.w8(PARTY + k, b)); m.w8(0x020235C9, e.qtd); });
  const um = process.env.INIMIGOS === '1';
  const vs = W.step; W.step = (k) => {
    vs(k);
    if (um) W.players.forEach((p, i) => { const m = p.g.ram(0); if (m.r32(0x03002664) !== 0x080C2965 && m.r32(0x03002664) !== 0x0803F431 && m.r8(ENEMY + 0x68 + 0x58)) { console.log('APAGA 2o inimigo', W.f, 'P' + (i + 1), 'cb2', m.r32(0x03002664).toString(16)); for (let j = 0; j < 0x68; j++) m.w8(ENEMY + 0x68 + j, 0); } });
    if (process.env.VIGIA) W.players.forEach((p, i) => { const m = p.g.ram(0), c = m.r32(0x03002664).toString(16); if (c !== (W['cb' + i])) { W['cb' + i] = c; console.log('CB2', W.f, 'P' + (i + 1), c, 'cb1', m.r32(0x03002660).toString(16), 'qtd', m.r8(0x02023044)); } });
  };
  const fala1 = (i) => W.play([[16, ...W.k(i, 'R')], [150], [8, ...W.k(i, 'A')], [240]]);
  fala1(0); W.play([[200]]); fala1(1); W.play([[300]]); fala1(2); W.play([[300]]);
  for (const i of [0, 2, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  console.log('INIMIGOS', W.players.map(p => { const m = p.g.ram(0); return [0, 1, 2].map(s => m.r8(ENEMY + s * 0x68 + 0x58)).join('/'); }).join(' '));
  let k = 0;
  if (process.env.INICIO) { for (; k < 3000 && W.players[0].g.ram(0).r32(0x03002664) !== 0x0803F431; k++) W.step(['', '', '']); fs.writeFileSync(path.join(W.out, 'inicio.snapshot'), v8.serialize(W.debugSnapshot())); console.log('INICIO gravado', W.f); return; }
  for (; k < 6000 && !W.players.every((p, i) => p.g.ram(0).r32(CTRL + 8 * i) === 0x0808E8ED); k++) W.step(['', '', '']);
  console.log('MENU em', k, 'quadros', W.f, 'cb2', W.players.map(p => H(p.g.ram(0).r32(0x03002664))).join(','));
  W.play([[30]]);
  sprites('menu'); W.shot('campo-menu.png');
  fs.writeFileSync(path.join(W.out, 'campo-menu.snapshot'), v8.serialize(W.debugSnapshot()));
  const T = +(process.env.TURNOS || 0);
  if (!T) return;
  const turno = [0, 0, 0], noMenu = [false, false, false];
  const tecla = (p, j, k) => {
    const m = p.g.ram(0), c = 2 * j, ctrl = m.r32(CTRL + 4 * c);
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
  let fim = false;
  for (let k = 0; k < T * 1500 && !fim; k++) {
    W.step(W.players.map((p, i) => tecla(p, i, k)));
    if (k % 1500 === 1499) { sprites('t' + Math.round(k / 1500)); W.shot('campo-t' + Math.round(k / 1500) + '.png'); console.log('TURNOS', turno.join(','), 'hp', W.players.map(p => { const m = p.g.ram(0); return [0, 1, 2, 3, 4, 5].map(b => m.r16(MONS + b * 0x60 + 0x2A)).join('/'); }).join(' '), 'cb2', W.players.map(p => H(p.g.ram(0).r32(0x03002664))).join(',')); }
    fim = W.players.every(p => p.g.ram(0).r32(0x03002664) === 0x080C2965);
  }
  console.log('FIM', fim, W.f, 'turnos', turno.join(','));
  W.shot('campo-fim.png');
};
