// Continua da escolha de equipe da dupla: escolhem, lutam apertando A, voltam ao mapa. P3 parado no mapa.
const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'dupla-equipe.snapshot'))));
  for (const i of [0, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
  W.info('equipes escolhidas'); W.shot('equipes.png');
  const st = () => W.players.slice(0, 2).map(p => { const m = p.g.ram(0); return [m.r32(0x03002664).toString(16), m.r32(0x03002660).toString(16), m.r8(0x03003511), m.r8(0x03003513), JSON.stringify(p.hle.ids), JSON.stringify(p.hle.duo), m.r8(0x030034e4), m.r8(0x030055F4)]; });
  let lastSt = ''; const origStep = W.step; W.step = (k) => { origStep(k); if (W.f > 16000) { const x = JSON.stringify(st()); if (x !== lastSt) { console.log('T', W.f, x); lastSt = x; } } };
  W.log = (i, m) => { if (W.f > 16900 && W.f < 17060) console.log('C', W.f, 'P' + (i + 1), m.k === 'c' ? m.w.map(v => v.toString(16)).join(' ') : JSON.stringify(m)); };
  let viuBatalha = false; const turno = [0, 0], noMenu = [false, false];
  // menu de golpes (0x0808E8ED): a cada rodada um golpe diferente com PP; fora dele, A a cada 40 quadros
  const tecla = (p, j, k) => {
    const m = p.g.ram(0), b = 2 * j, ctrl = m.r32(0x0203FA00 + 4 * b);
    if (ctrl === 0x0808E8ED) {
      if (!noMenu[j]) { noMenu[j] = true; turno[j]++; }
      if (k % 20) return '';
      const buf = m.r32(0x02023538) + 0x24 + b * 0x200, cur = m.r8(0x0203FA40 + b);
      const pp = [0, 1, 2, 3].map(i => m.r16(buf + 4 + 2 * i) ? m.r8(buf + 12 + i) : 0);
      const ok = [0, 1, 2, 3].filter(i => pp[i] > 0), want = ok.length ? ok[turno[j] % ok.length] : cur;
      if (cur !== want) { if ((cur & 1) !== (want & 1)) return want & 1 ? 'R' : 'L'; return want & 2 ? 'D' : 'U'; }
      return 'A';
    }
    noMenu[j] = false;
    return k % 40 === 0 ? 'A' : '';
  };
  for (let k = 0; k < +(process.env.FRAMES || 30000); k++) {
    W.step(W.players.map((p, j) => j > 1 ? '' : tecla(p, j, k)));
    // atalho do teste: inimigos (lugares 1 e 3) com 1 de vida, para a batalha acabar logo
    if (viuBatalha && process.env.ATALHO !== '0' && k % 300 === 0) W.players.slice(0, 2).forEach(p => { const m = p.g.ram(0); for (const b of [1, 3]) if (m.r16(0x0203F424 + b * 0x60 + 0x2A) > 1) m.w16(0x0203F424 + b * 0x60 + 0x2A, 1); });
    const cb = W.players.map(p => p.g.ram(0).r32(0x03002664));
    if (cb[0] === 0x0803F431 && !viuBatalha) { viuBatalha = true; W.info('batalha'); W.shot('batalha.png'); }
    if (k % 2000 === 0) { W.info('quadro'); W.shot('q' + W.f + '.png'); }
    if (viuBatalha && cb[0] === 0x080C2965 && cb[1] === 0x080C2965) { W.play([[300]]); W.info('voltaram'); W.shot('voltaram.png'); break; }
  }
  fs.writeFileSync(path.join(W.out, '..', 'dupla-volta.snapshot'), v8.serialize(W.debugSnapshot()));
  W.play([[600]]); W.info('10s depois'); W.shot('voltaram-10s.png');
};
