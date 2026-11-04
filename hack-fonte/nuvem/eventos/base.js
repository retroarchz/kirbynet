// ROM base para editar eventos no HexManiac Advance (HMA): a ROM do site com TUDO que o site escreve nela já aplicado
// (mods do QZ_NUVEM no game.js, moto da Cynthia, e o que o coop escreve na hora: tela da tripla e caixas de vida).
// Assim o HMA vê essas áreas como ocupadas e não grava eventos novos em cima delas.
// uso: node base.js SAIDA.gba   (gera também SAIDA.gba.protegido.json = faixas que o site usa)
const fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..', '..', '..');
const ROM = 'PokemonQuetzalCoop3Teste.gba', SHA = 'cee4fb273fd301762c2dc29d65d83db08f1d68ca';
const g = fs.readFileSync(path.join(SITE, 'game.js'), 'utf8');
const src = g.slice(g.indexOf('const QZ_NUVEM = {'), g.indexOf('function romGameCode')) + '\nmodule.exports = { QZ_NUVEM, quetzalNuvem };';
const m = {}; new Function('module', src)(m); const { QZ_NUVEM, quetzalNuvem } = m.exports;
const rom = new Uint8Array(fs.readFileSync(path.join(SITE, 'roms', ROM)));
if (!quetzalNuvem(rom)) throw new Error('os mods do QZ_NUVEM não aplicaram nesta ROM');
const prot = [];   // [início, fim, de onde]
const hexlen = (h) => h.length / 2;
for (const [at, , data] of QZ_NUVEM.fix) prot.push([at, at + hexlen(data), 'QZ_NUVEM.fix']);
for (const [at, data] of QZ_NUVEM.novo) prot.push([at, at + hexlen(data), 'QZ_NUVEM.novo']);
for (const [, to, , total] of QZ_NUVEM.tabelas) prot.push([to, to + total * 4, 'QZ_NUVEM.tabelas']);
const moto = fs.readFileSync(path.join(SITE, 'hack-fonte', 'nuvem', 'moto', 'moto.bin'));
prot.push([0xF4E7D4, 0xF4E7D4 + moto.length, 'moto/capacete (tecla 0)']);
const L = require(path.join(SITE, 'linkhle.js'));
for (const [at, b] of (L.GAMES[SHA].tela || [])) { rom.set(Uint8Array.from(b), at); prot.push([at, at + b.length, 'coop: tela da tripla']); }
prot.push([0xAB6F8, 0xAB6F8 + 12, 'coop: caixas de vida']);
fs.writeFileSync(process.argv[2], rom);
fs.writeFileSync(process.argv[2] + '.protegido.json', JSON.stringify(prot));
console.log('base gravada:', process.argv[2], '|', prot.length, 'faixas protegidas');
