const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', process.env.DE || 'tripla-batalha.snapshot'))));
  W.players.forEach((p, i) => {
    const m = p.g.ram(0);
    console.log('P' + (i + 1), 'hb', Array.from({ length: 6 }, (_, b) => m.r8(0x0203F9F8 + b)), 'spr', Array.from({ length: 6 }, (_, b) => m.r8(0x0203F664 + b)), 'pidx', Array.from({ length: 6 }, (_, b) => m.r16(0x0203F400 + 2 * b)), 'pos', Array.from({ length: 6 }, (_, b) => m.r8(0x0203F40C + b)), 'count', m.r8(0x02023044), 'aus', m.r8(0x02023209));
    for (let s = 0; s < 64; s++) {
      const a = 0x02020630 + 0x44 * s, fl = m.r16(a + 0x3E);
      if (!(fl & 1)) continue;
      const oam0 = m.r16(a), oam1 = m.r16(a + 2), oam2 = m.r16(a + 4);
      console.log('  s' + s, 'cb', m.r32(a + 0x1C).toString(16), 'x', m.r16(a + 0x20) << 16 >> 16, 'y', m.r16(a + 0x22) << 16 >> 16, 'x2', m.r16(a + 0x24) << 16 >> 16, 'y2', m.r16(a + 0x26) << 16 >> 16, 'fl', fl.toString(16), 'oam', oam0.toString(16), oam1.toString(16), 'tile', (oam2 & 0x3FF).toString(16), 'pal', oam2 >> 12, 'tag', m.r16(a + 0x40).toString(16), m.r16(a + 0x42).toString(16), 'd', Array.from({ length: 8 }, (_, k) => m.r16(a + 0x2E + 2 * k)).join(','));
    }
  });
};
