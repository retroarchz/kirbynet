const fs = require('fs');
module.exports = (W) => { W.players.forEach((p, j) => { const m = p.g.ram(0); const b = Buffer.alloc(0x68 * 6); for (let k = 0; k < b.length; k++) b[k] = m.r8(0x020235CC + k); fs.writeFileSync(require('path').join(__dirname, '../.runtime/gif/party') + j + '.bin', b); }); };
