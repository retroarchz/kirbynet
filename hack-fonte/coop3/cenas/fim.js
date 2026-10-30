const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(__dirname, '../.runtime/gif-fim.snapshot'))));
  W.players.forEach((p, j) => { const m = p.g.ram(0);
    console.log('P' + (j + 1), 'hp', [0,1,2,3,4].map(b => m.r16(0x0203F424 + b * 0x60 + 0x2A)), 'esp', [0,1,2,3,4].map(b => m.r16(0x0203F424 + b * 0x60)), 'aus', m.r8(0x02023209).toString(2), 'comm', Array.from({ length: 8 }, (_, i) => m.r8(0x0202339C + i)), 'count', m.r8(0x02023044)); });
  W.play([[600]]); W.shot('fim-depois.png');
  W.players.forEach((p, j) => { const m = p.g.ram(0); console.log('depois P' + (j + 1), 'main', m.r32(0x03005504).toString(16), 'exec', m.r32(0x02023040).toString(16), 'comm', Array.from({ length: 8 }, (_, i) => m.r8(0x0202339C + i))); });
};
