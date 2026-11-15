// Regressões do worker: node hack-fonte/nuvem/flutua/teste-vigia.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../../..', 'engine-worker.js'), 'utf8');
const trecho = source.slice(source.indexOf('const FLUTUA ='), source.indexOf('function barcoVigia()'));
const barcos = source.slice(source.indexOf('function barcoVigia()'), source.indexOf('function edVigia()'));
const CAMPO = 0x03002664, OBJ = 0x02038D10, SPR = 0x02020630;
const ATUAL = 0x03000FF8, PROX = 0x03000FFA, EST = 0x03000FFC;
function jogo() {
  const mem = new Map(), writes = [];
  const read = (a, n) => { let v = 0; for (let i = 0; i < n; i++) v |= (mem.get(a + i) || 0) << (8 * i); return v >>> 0; };
  const put = (a, v, n) => { for (let i = 0; i < n; i++) mem.set(a + i, (v >>> (8 * i)) & 255); };
  const ram = {};
  for (const [bits, n] of [[8, 1], [16, 2], [32, 4]]) {
    ram['r' + bits] = a => read(a, n);
    ram['w' + bits] = (a, v) => { writes.push([a, v]); put(a, v, n); };
  }
  const run = { frames: 200, s: { ram: () => ram, romWrite: (a, b) => writes.push(['rom', a, b]) } };
  const c = vm.createContext({ run, edBus: () => ram, BARCO: { FLAG: 0x0203FF39 } });
  vm.runInContext(trecho, c);
  vm.runInContext(barcos, c);
  put(0x09089094 + 28, 0x090F6000, 4);
  put(CAMPO, 0x080C2965, 4); put(OBJ, 1, 1); put(OBJ + 4, 10660, 2);
  put(SPR + 0x3E, 1, 1); put(0x02039070, 8, 1); put(EST, 2, 1);
  return { run, ram, writes, put, step: () => vm.runInContext('flutuaVigia()', c), barcos: () => vm.runInContext('barcoVigia(); barcoOutros()', c) };
}
let j = jogo();
j.put(PROX, 365, 2); j.step(); assert.equal(j.ram.r16(PROX), 438);
j = jogo(); j.put(ATUAL, 365, 2); j.step(); assert.equal(j.ram.r16(PROX), 438); assert.equal(j.ram.r8(EST), 6);
// O cache ainda diz 438, mas a batalha alterou o áudio por fora dele.
j = jogo(); j.put(ATUAL, 438, 2); j.put(CAMPO, 0x0803F431, 4); j.step();
assert.equal(j.writes.length, 0); assert.equal(j.run.flutuaMusRetoma, true);
j.put(CAMPO, 0x080C2965, 4); j.step(); assert.equal(j.ram.r16(PROX), 438); assert.equal(j.ram.r8(EST), 6);
j.put(EST, 2, 1); j.put(PROX, 0, 2); j.step(); assert.equal(j.ram.r8(EST), 2); // não reinicia a cada quadro
// Transição para uma casa: não tocar na RAM, nem substituir a música de destino.
j = jogo(); j.put(CAMPO, 0, 4); j.put(0x02039075, 127, 1); j.step(); assert.equal(j.writes.length, 0);
j.put(CAMPO, 0x080C2965, 4); j.step(); assert.equal(j.writes.length, 0);
for (const [a, v] of [[OBJ, 0], [OBJ + 0x23, 64], [OBJ + 0x23, 255], [SPR + 0x3E, 0]]) {
  j = jogo(); j.put(a, v, 1); j.step(); assert.equal(j.writes.length, 0);
}
j = jogo(); j.put(0x02039070, 0, 1); j.put(ATUAL, 365, 2); j.put(PROX, 400, 2); j.step();
assert.equal(j.ram.r16(PROX), 400); assert.equal(j.ram.r8(EST), 2);
j = jogo(); j.run.flutuaMusRetoma = true; j.put(PROX, 400, 2); j.step(); assert.equal(j.ram.r16(PROX), 400);
j = jogo(); j.put(0x0203FF39, 1, 1); j.put(PROX, 365, 2); j.step(); assert.equal(j.ram.r16(PROX), 365);
j = jogo(); j.put(OBJ + 4, 10000, 2); j.put(PROX, 365, 2); j.step(); assert.equal(j.ram.r16(PROX), 365);
for (const cb of [0, 0x0803F431]) {
  j = jogo(); j.run.barco = {}; j.put(CAMPO, cb, 4); j.barcos(); assert.equal(j.writes.length, 0);
}
for (const [a, v] of [[0x02039075, 127], [OBJ, 0]]) {
  j = jogo(); j.run.barco = {}; j.put(a, v, 1); j.barcos(); assert.equal(j.writes.length, 0);
}
console.log('OK: música após batalha, fila de destino, barco/outros personagens e proteção de objetos/sprites nas transições.');
