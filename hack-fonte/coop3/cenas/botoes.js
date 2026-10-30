module.exports = (W) => {
  const m = W.players[0].g.ram(0), r = () => [0x28,0x2A,0x2C,0x2E].map(o => m.r16(0x03002660+o).toString(16)).join(' ');
  W.step(['A']); console.log('A 1o', r()); W.step(['A']); console.log('A 2o', r()); W.step(['']); console.log('solto', r());
  W.step(['R']); console.log('R', r());
};
