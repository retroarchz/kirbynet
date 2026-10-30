const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', process.env.DE || 'tripla-batalha.snapshot'))));
  for (let k = 0; k < 6; k++) { W.play([[500]]); console.log('M', W.f, JSON.stringify(W.players.map(p => { const m = p.g.ram(0); return [m.r32(0x03005504).toString(16), m.r32(0x0203FA00).toString(16), m.r32(0x0203FA08).toString(16), m.r32(0x0203FA10).toString(16), m.r32(0x02023040).toString(16), Array.from({length:6},(_,b)=>m.r8(0x0203F664+b))]; }))); }
  W.shot('mais.png');
  fs.writeFileSync(path.join(W.out, '..', 'tripla-menu.snapshot'), v8.serialize(W.debugSnapshot()));
};
