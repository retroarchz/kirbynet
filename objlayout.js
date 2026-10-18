// Layout completo de um objeto do Super Adventure Island II (32 objetos), achado por engenharia reversa:
// tabelas de 16 bits (entrada 2i), de 32 bits (4i), de 8 bits (i) e uma pilha de 64 bytes por objeto.
(function (root) {
  "use strict";
  const WORD = [0x619, 0x759, 0x799, 0x7d9, 0x819, 0x859, 0x899, 0x8d9, 0x919, 0x959, 0x999, 0x9d9,
                0xa39, 0xa79, 0xab9, 0xaf9, 0xb39, 0xb79, 0xbb9, 0xbf9, 0xc39, 0xc79, 0x14bc, 0x153c, 0x15fc];
  const DWORD = [0x659, 0x6d9];
  const BYTE = [0xa19, 0x14fc, 0x151c, 0x157c, 0x159c, 0x15bc, 0x15dc, 0x163c, 0x165c, 0x167c, 0x169c];
  const STACK = 0xcbc, STACK_LEN = 0x40;
  const SIZE = WORD.length * 2 + DWORD.length * 4 + BYTE.length + STACK_LEN;   // 133 bytes

  function read(r, i, out = new Uint8Array(SIZE)) {
    let k = 0;
    for (const b of WORD) { out[k++] = r[b + 2 * i]; out[k++] = r[b + 2 * i + 1]; }
    for (const b of DWORD) for (let j = 0; j < 4; j++) out[k++] = r[b + 4 * i + j];
    for (const b of BYTE) out[k++] = r[b + i];
    const sb = STACK + STACK_LEN * i;
    for (let j = 0; j < STACK_LEN; j++) out[k++] = r[sb + j];
    return out;
  }
  function write(r, i, blk) {
    let k = 0;
    for (const b of WORD) { r[b + 2 * i] = blk[k++]; r[b + 2 * i + 1] = blk[k++]; }
    for (const b of DWORD) for (let j = 0; j < 4; j++) r[b + 4 * i + j] = blk[k++];
    for (const b of BYTE) r[b + i] = blk[k++];
    const sb = STACK + STACK_LEN * i;
    for (let j = 0; j < STACK_LEN; j++) r[sb + j] = blk[k++];
  }
  // campos úteis dentro do bloco
  const OFF_FLAGS = 0;                         // WORD[0] = $0619
  const OFF_X = WORD.length * 2 + 1;           // X inteiro (16 bits) dentro do DWORD de $0659
  const OFF_Y = WORD.length * 2 + 4 + 1;
  const OFF_BANK = WORD.length * 2 + DWORD.length * 4 + BYTE.indexOf(0x157c);
  const flags = (blk) => blk[OFF_FLAGS] | (blk[OFF_FLAGS + 1] << 8);
  const xOf = (blk) => blk[OFF_X] | (blk[OFF_X + 1] << 8);
  const yOf = (blk) => blk[OFF_Y] | (blk[OFF_Y + 1] << 8);
  const bankOf = (blk) => blk[OFF_BANK];

  const api = { WORD, DWORD, BYTE, STACK, STACK_LEN, SIZE, read, write, flags, xOf, yOf, bankOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ObjLayout = api;
})(typeof self !== "undefined" ? self : this);
