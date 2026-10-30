const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(__dirname, '../.runtime/gif-k29.snapshot'))));
  const m = W.players[0].g.ram(0); let ult = '';
  for (let k = 0; k < 160; k++) {
    W.step([]);
    const res = m.r32(0x02023538), bufB = res + 0x1124 + 3 * 0x200;
    const s = 'comm ' + Array.from({ length: 6 }, (_, i) => m.r8(0x0202339C + i)).join(',') + ' acao ' + Array.from({ length: 6 }, (_, i) => m.r8(0x0203F684 + i)).join(',') +
      ' golpe ' + Array.from({ length: 6 }, (_, i) => m.r16(0x0203F704 + 2 * i)).join(',') + ' exec ' + m.r32(0x02023040).toString(16) + ' bufB3 ' + Array.from({ length: 6 }, (_, i) => m.r8(bufB + i).toString(16)).join(' ') + ' aus ' + m.r8(0x02023209).toString(2);
    if (s !== ult) { console.log(W.f, s); ult = s; }
  }
};
