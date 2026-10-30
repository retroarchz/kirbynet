const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(__dirname, '../.runtime/gif-k29.snapshot'))));
  const m = W.players[0].g.ram(0);
  for (const b of [1, 3]) { const a = 0x0203F424 + b * 0x60; console.log('mon' + b, Array.from({ length: 0x60 }, (_, k) => m.r8(a + k).toString(16).padStart(2, '0')).join('').replace(/(.{32})/g, '$1 ')); }
  console.log('golpes3', [0,1,2,3].map(i => m.r16(0x0203F424 + 3 * 0x60 + 0xC + 2 * i)));
  console.log('selecao3', m.r32(0x0203F68C + 4 * 3).toString(16), 'disable3', Array.from({ length: 44 }, (_, k) => m.r8(0x0203F740 + 3 * 44 + k).toString(16).padStart(2, '0')).join(''));
  console.log('scripts sel', Array.from({ length: 6 }, (_, i) => m.r32(0x0203F68C + 4 * i).toString(16)).join(' '));
};
