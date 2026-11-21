# põe as entradas do Caçador (entradas.json) no game.js
import json, re, os
AQUI = os.path.dirname(os.path.abspath(__file__))
GJ = os.path.join(AQUI, '..', '..', '..', 'game.js')
e = json.load(open(os.path.join(AQUI, 'entradas.json'), encoding='utf-8'))
s = open(GJ, encoding='utf-8').read()
assert 'Caçador (habilidade 321)' not in s, 'já aplicado'
# trocas de valor em entradas fix existentes
for addr, novo in e['fix_trocas'].items():
    m = re.search(r'(\[%s, "[0-9a-f]+", ")([0-9a-f]+)("\])' % re.escape(addr), s)
    assert m, addr
    s = s[:m.start(2)] + novo + s[m.end(2):]
# remove a entrada fix da paleta da Arboliva e a novo em 0x1FFF700 (com o comentário de cima, se for dela)
for addr in e['fix_remover'] + e['novo_remover']:
    m = re.search(r'\n[ ]*\[%s, [^\n]*' % re.escape(addr), s)
    assert m, addr
    s = s[:m.start()] + s[m.end():]
# fix novos: logo depois do bloco do Sirfetch'd
anc = s.index("// ícone do time: o desenho troca de cor dentro da paleta 1")
fim = s.index('\n', anc) + 1
bloco = "    // Caçador (habilidade 321, Sirfetch'd): floresta com bases de musgo enquanto ele estiver em campo e adversários\n" \
        "    // presos (não trocam nem fogem); fonte: hack-fonte/nuvem/cacador/cacador.py\n"
for at, orig, novo, com in e['fix_novos']:
    bloco += '    [0x%X, "%s",\n               "%s"],   // %s\n' % (at, orig, novo, com)
s = s[:fim] + bloco + s[fim:]
# tabelas: total novo e valores acrescentados
for to, (total, extra) in e['tabelas'].items():
    m = re.search(r'\[(0x[0-9A-Fa-f]+), %s, (\d+), (\d+), (0x[0-9A-Fa-f]+|0), \[([^\]]*)\]\]' % re.escape(to), s)
    assert m, to
    vals = m.group(5) + ''.join(', 0x%08X' % v for v in extra)
    novo = '[%s, %s, %s, %d, %s, [%s]]' % (m.group(1), to, m.group(2), total, m.group(4), vals)
    s = s[:m.start()] + novo + s[m.end():]
open(GJ, 'w', encoding='utf-8').write(s)
print('ok')
