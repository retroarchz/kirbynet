// GIF: Sandro (P1), Luan (P2), André (P3) contra o mesmo treinador
const fs = require('fs'), path = require('path');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  const dir = path.join(W.out, 'quadros'); fs.mkdirSync(dir, { recursive: true });
  const CONT = !!process.env.CONTINUA; if (!CONT) for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  let n = CONT ? fs.readdirSync(dir).length : 0, cont = 0; const grava = () => { if (cont++ % 12 === 0) W.shot(path.join('quadros', 'q' + String(n++).padStart(4, '0') + '.png')); };
  const orig = W.step; W.step = (k) => { orig(k); grava(); };
  if (CONT) W.debugRestore(require('v8').deserialize(fs.readFileSync(path.join(W.out, '..', 'gif-fim.snapshot'))));
  else { W.fala(0); W.play([[120]]); W.fala(1); W.play([[200]]); W.fala(2); W.play([[200]]);
  for (const i of [0, 1, 2]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); } }
  const turno = [0, 0, 0], noMenu = [false, false, false];
  const tecla = (p, j, k) => {
    const m = p.g.ram(0), b = 2 * j, ctrl = m.r32(0x0203FA00 + 4 * b);
    if (ctrl === 0x0808E8ED) {
      if (!noMenu[j]) { noMenu[j] = true; turno[j]++; }
      if (k % 20) return '';
      const buf = m.r32(0x02023538) + 0x24 + b * 0x200, cur = m.r8(0x0203FA40 + b);
      const ok = [0, 1, 2, 3].filter(i => m.r16(buf + 4 + 2 * i) && m.r8(buf + 12 + i) > 0), want = ok.length ? ok[turno[j] % ok.length] : cur;
      if (cur !== want) { if ((cur & 1) !== (want & 1)) return want & 1 ? 'R' : 'L'; return want & 2 ? 'D' : 'U'; }
      return 'A';
    }
    noMenu[j] = false;
    return k % 40 === j * 10 ? 'A' : '';
  };
  let ult = '', ultF = 0; const v8 = require('v8');
  for (let k = 0; k < +(process.env.FRAMES || 9000); k++) {
    W.step(W.players.map((p, j) => tecla(p, j, k)));
    if (process.env.RASTRO) {
      const e = W.players.map(p => { const m = p.g.ram(0); return [m.r32(0x02023040).toString(16), m.r32(0x03005504).toString(16), m.r32(0x0203FA0C).toString(16)].join('/'); }).join(' ');
      if (e !== ult) { console.log('R', W.f, e); ult = e; ultF = W.f; }
      if (k % 300 === 0) fs.writeFileSync(path.join(W.out, '..', 'gif-k' + Math.floor(k / 300) + '.snapshot'), v8.serialize(W.debugSnapshot()));
    }
  }
  if (process.env.RASTRO) console.log('ULTIMA MUDANCA', ultF);
  if (process.env.PASSOS) {
    // de volta à praia: fecha os diálogos e cada um anda numa direção
    W.play([[120], [6, 'A', 'A', 'A'], [60], [6, 'A', 'A', 'A'], [90]]);
    const pos = () => W.players.map(p => { const m = p.g.ram(0); return [m.r16(0x02038D20) - 7, m.r16(0x02038D22) - 7, m.r8(0x03003511), m.r8(0x03003513)]; });
    const a = pos();
    for (let r = 0; r < 4; r++) W.play([[16, 'L', 'U', 'R'], [10]]);
    for (let r = 0; r < 3; r++) W.play([[16, 'U', 'L', 'U'], [10]]);
    W.play([[120]]);
    console.log('PASSOS antes', JSON.stringify(a), 'depois', JSON.stringify(pos()));
  }
  console.log('QUADROS', n);
  W.players.forEach((p, j) => { const m = p.g.ram(0); console.log('FIM P' + (j + 1), 'main', m.r32(0x03005504).toString(16), 'ctrl', [0,1,2,3,4].map(b => m.r32(0x0203FA00 + 4 * b).toString(16)).join(','), 'exec', m.r32(0x02023040).toString(16), 'cb2', m.r32(0x03002664).toString(16), 'link', m.r8(0x03003511), m.r8(0x03003513)); });
  fs.writeFileSync(path.join(W.out, '..', 'gif-fim.snapshot'), require('v8').serialize(W.debugSnapshot()));
};
