const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'tripla-menu.snapshot'))));
  const m = W.players[1].g.ram(0);
  for (let a = 0x03000000; a < 0x03008000; a += 2) {
    const v = Array.from({ length: 16 }, (_, i) => m.r16(a + 2 * i));
    if (v.includes(0xD6FF) && v.filter(x => x === 0xFFFF).length >= 2 && v.filter(x => x >= 0xD6D8 && x < 0xD800).length >= 2) console.log('tags?', a.toString(16), v.map(x => x.toString(16)).join(' '));
  }
  console.log('RAW', Array.from({length:16},(_,i)=>(0x3000CF0+4*i).toString(16).slice(-3)+':'+m.r16(0x3000CF0+4*i).toString(16)).join(' '));
};
