const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'dupla-equipe.snapshot'))));
  const hex = (m, a, n) => Array.from({ length: n }, (_, i) => m.r16(a + 2 * i).toString(16).padStart(4, '0')).join(' ');
  const dump = (t) => W.players.slice(0, 2).forEach((p, i) => { const m = p.g.ram(0); console.log(t, W.f, 'P' + (i + 1), 'cb', m.r32(0x03002664).toString(16), 'etapa', m.r8(0x0202339C), 'lnk', m.r8(0x03003511), m.r8(0x03003512), m.r8(0x03003513), 'F0/F4', m.r8(0x030055F0), m.r8(0x030055F4), 'ids', JSON.stringify(p.hle.ids));
    for (let s = 0; s < 3; s++) console.log('   recv', s, hex(m, 0x020223C4 + 0x100 * s, 8)); console.log('   lp', [0,1,2].map(s => hex(m, 0x020229F0 + 0x24 * s, 4) + ' | name ' + hex(m, 0x020229F0 + 0x24 * s + 8, 4)).join(' || ')); });
  const orig = W.step; let prev = [0, 0];
  W.step = (k) => { orig(k); W.players.slice(0, 2).forEach((p, i) => { const m = p.g.ram(0), e = m.r8(0x0202339C), cb = m.r32(0x03002664); if (cb === 0x9ff004d && e !== prev[i]) { dump('etapa'); prev[i] = e; } if (cb === 0x800cce5 && prev[i] !== 99) { dump('ERRO'); prev[i] = 99; } }); };
  for (const i of [0, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
};
