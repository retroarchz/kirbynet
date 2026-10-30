const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'tripla-menu.snapshot'))));
  W.players.forEach((p, j) => { const m = p.g.ram(0);
    for (let i = 0; i < 4; i++) console.log('P' + (j + 1), 'lp' + i, Array.from({ length: 0x24 }, (_, k) => m.r8(0x020229F0 + 0x24 * i + k).toString(16).padStart(2, '0')).join(''));
  });
};
