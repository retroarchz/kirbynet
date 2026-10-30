const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'tripla-batalha.snapshot'))));
  W.players.forEach((p, i) => { const m = p.g.ram(0), H = x => x.toString(16);
    const g = m.r32(0x02023574), ext = m.r32(0x0203FE04);
    console.log('P' + (i + 1), 'GPTR', H(g), 'bufs', [0, 1, 2, 3].map(k => H(m.r32(g + 4 * k))).join(','), '+134..', [0x134, 0x138, 0x13C].map(o => H(m.r32(g + o))).join(','), 'EXT', H(ext), ext ? [0, 1, 2].map(k => H(m.r32(ext + 4 * k))).join(',') : '');
    for (const b of [0, 2, 4]) { const s = m.r8(0x0203F664 + b); if (s >= 64) continue; const a = 0x02020630 + 0x44 * s, im = m.r32(a + 0x0C), tpl = m.r32(a + 0x14);
      console.log('   b' + b, 's' + s, 'images', H(im), 'img0', H(m.r32(im)), H(m.r16(im + 4)), 'tpl', H(tpl), 'tpl.images', H(m.r32(tpl + 0xC))); }
  });
};
