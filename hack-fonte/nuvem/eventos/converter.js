// Converte o que o usuário editou no HMA num pronto do site.
// uso: node converter.js EDITADA.gba BASE.gba   (BASE.gba feita pelo base.js na mesma versão do site em que ele começou)
// Mostra cada trecho mudado; se algum cai numa faixa que o site usa (mods/coop), avisa e NÃO converte.
// Saída: EDITADA.gba.eventos.json = [[endereço, original, novo], ...] (mudanças sobre bytes do jogo) e
//        [[endereço, novo], ...] (dados novos em espaço que era livre, 0xFF), no formato do QZ_NUVEM.
const fs = require('fs');
const [ed, base] = process.argv.slice(2).map((f) => new Uint8Array(fs.readFileSync(f)));
const prot = JSON.parse(fs.readFileSync(process.argv[3] + '.protegido.json', 'utf8'));
if (ed.length !== base.length) console.log('AVISO: tamanho mudou', base.length, '->', ed.length, '(o HMA aumentou a ROM?)');
const n = Math.min(ed.length, base.length), trechos = [];
for (let i = 0; i < n; i++) {
  if (ed[i] === base[i]) continue;
  let j = i, k = i;
  while (k < n && k - j < 16) { if (ed[k] !== base[k]) j = k; k++; }   // junta diferenças a menos de 16 bytes
  trechos.push([i, j + 1]); i = j;
}
if (ed.length > n) trechos.push([n, ed.length]);
const hx = (a, b, c) => Buffer.from(c.subarray(a, b)).toString('hex');
const fix = [], novo = [], ruins = [];
for (const [a, b] of trechos) {
  const bate = prot.filter(([p, q]) => a < q && p < b);
  const eraLivre = base.subarray(a, Math.min(b, base.length)).every((v) => v === 0xFF) && b <= base.length;
  console.log((bate.length ? 'PROBLEMA ' : '') + '0x' + (a + 0x08000000).toString(16) + '..+' + (b - a) + ' bytes ' + (eraLivre ? '(espaço livre -> dado novo)' : '(mudou dado do jogo)') + (bate.length ? ' bate em: ' + [...new Set(bate.map((x) => x[2]))].join(', ') : ''));
  if (bate.length) ruins.push([a, b]);
  else if (eraLivre) novo.push([a, hx(a, b, ed)]);
  else fix.push([a, hx(a, b, base), hx(a, b, ed)]);
}
console.log(trechos.length, 'trechos:', fix.length, 'mudanças,', novo.length, 'dados novos,', ruins.length, 'em cima do site');
if (!ruins.length) { fs.writeFileSync(process.argv[2] + '.eventos.json', JSON.stringify({ fix, novo })); console.log('gravado', process.argv[2] + '.eventos.json'); }
else console.log('NÃO converti: refazer essas partes no HMA (ou mudar o lugar dos dados) antes.');
