const fs = require('fs'), path = require('path'), v8 = require('v8');
const Q = 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad/qz';
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'dupla-equipe.snapshot'))));
  const st = () => W.players.slice(0, 2).map(p => { const m = p.g.ram(0); return [m.r32(0x03002664).toString(16), m.r8(0x03003511), m.r8(0x03003513), JSON.stringify(p.hle.sub), p.hle.open]; });
  let last = JSON.stringify(st());
  const orig = W.step; W.step = (k) => { orig(k); const s = JSON.stringify(st()); if (s !== last) { console.log('F', W.f, s); last = s; } };
  for (const i of [0, 1]) { const a = require(Q + '/escolhe3.js')(W, i); W.play([...a('A'), [200]]); }
};
