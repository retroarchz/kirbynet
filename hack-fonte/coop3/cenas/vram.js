const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', process.env.DE || 'tripla-menu.snapshot'))));
  const SZ = [[1,2,4,8],[2,4,4,8],[2,1,8,8]].map((r,shape)=>r), T = [[1,4,16,64],[2,4,8,32],[2,4,8,32]];
  W.players.slice(0, 1).forEach((p, i) => { const m = p.g.ram(0); const rows = [];
    for (let s = 0; s < 64; s++) { const a = 0x02020630 + 0x44 * s; if (!(m.r16(a + 0x3E) & 1)) continue;
      const o0 = m.r16(a), o1 = m.r16(a + 2), shape = o0 >> 14, size = o1 >> 14, n = T[shape][size], t = m.r16(a + 4) & 0x3FF, sheet = m.r16(a + 0x40);
      rows.push([t, n, 's' + s, m.r32(a + 0x1C).toString(16), 'sheet' + sheet.toString(16), (m.r16(a + 0x3E) & 4) ? 'inv' : '']); }
    rows.sort((x, y) => x[0] - y[0]); let tot = 0; const seen = new Set();
    for (const r of rows) { console.log('  tile', r[0].toString(16), 'n', r[1], r.slice(2).join(' ')); if (!seen.has(r[0])) { seen.add(r[0]); tot += r[1]; } }
    console.log('P' + (i + 1), 'tiles (aprox, sem repetir início)', tot);
  });
};
