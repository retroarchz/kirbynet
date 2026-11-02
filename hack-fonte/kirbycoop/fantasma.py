# Kirby & The Amazing Mirror, coop pelo site com mundos separados (cada aparelho roda só o próprio GBA).
# "Fantasma": na tela de cada um, o Kirby de OUTRO aparelho (e os golpes dele) não colide com nada: não bate, não engole,
# não pega item, não leva dano. Quem decide o que ele faz é o aparelho dele; o site avisa os outros (dano, morte).
# As 3 funções de colisão entre objetos (tabela gUnk_0834BD88: 0x080364E4, 0x080365C8, 0x0803699C, chamadas com (r0, r1)
# = os dois objetos) ganham na entrada um desvio para o código abaixo, que devolve 0 (não colidiu) se um lado é fantasma.
# Os Kirbys do computador (id >= gNumHumanPlayers) são do aparelho do P1 (id 0).
# Saída: fantasma.json = [[deslocamento na ROM, [bytes]], ...] para o site escrever na ROM carregada (romWrite).
import json, struct, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'metaknight'))
from thumb import Asm

ROM = Path(__file__).resolve().parents[2] / 'roms' / 'Kirby & The Amazing Mirror (USA).gba'
d = ROM.read_bytes()
B = 0x08000000
LOCAL, HUMANOS = 0x0203AD3C, 0x0203AD30
BASE = 0x08F80000
assert all(x == 0xFF for x in d[BASE - B:BASE - B + 0x400]), 'área não está livre'
HANDLERS = [0x080364E4, 0x080365C8, 0x0803699C]

a = Asm(BASE)
# é_fantasma(r0 = objeto) -> r0 = 1/0 (estraga r1, r2)
a.label('fantasma')
a.cmpi('r0', 0); a.bc('eq', 'nao')
a.ldrb_i('r1', 'r0', 0); a.cmpi('r1', 0); a.bc('eq', 'kirby')        # kind 0 = um Kirby
# estrela de habilidade solta por um Kirby (tipo 0xA3/0xA4 em +0x82): NÃO é fantasma, qualquer um pode comer (o site
# apaga a estrela dos outros aparelhos quando ela some num deles). O Kirby do amigo continua fantasma: só o daqui come
a.mov('r1', 0x82); a.ldrb_r('r1', 'r0', 'r1')
a.cmpi('r1', 0xA3); a.bc('eq', 'nao')
a.cmpi('r1', 0xA4); a.bc('eq', 'nao')
# senão: sobe pelo dono (parent em +0x70) até 3 níveis procurando um Kirby: golpe de golpe (ex. o campo da Faísca)
# também é do Kirby. Só segue ponteiros para EWRAM/IWRAM (0x02/0x03xxxxxx)
a.mov('r2', 3)
a.label('sobe')
a.ldr_i('r0', 'r0', 0x70); a.cmpi('r0', 0); a.bc('eq', 'nao')
a.h(0x0E01)                                                            # lsr r1, r0, #24
a.cmpi('r1', 2); a.bc('lo', 'nao'); a.cmpi('r1', 3); a.bc('hi', 'nao')
a.ldrb_i('r1', 'r0', 0); a.cmpi('r1', 0); a.bc('eq', 'kirby')
a.subi('r2', 1); a.bc('ne', 'sobe'); a.b('nao')
a.label('kirby')
a.mov('r1', 0x56); a.ldrb_r('r1', 'r0', 'r1')                          # id do jogador dele
a.ldr_lit('r2', LOCAL); a.ldrb_i('r2', 'r2', 0)
a.alu('cmp', 'r1', 'r2'); a.bc('eq', 'nao')                            # é o meu Kirby
a.cmpi('r2', 0); a.bc('ne', 'sim')                                     # não sou o P1: todo Kirby alheio é fantasma
a.ldr_lit('r2', HUMANOS); a.ldrb_i('r2', 'r2', 0)
a.alu('cmp', 'r1', 'r2'); a.bc('hs', 'nao')                            # sou o P1: os do computador são meus
a.label('sim'); a.mov('r0', 1); a.bx('lr')
a.label('nao'); a.mov('r0', 0); a.bx('lr')
a.pool()
# algum(r0, r1) -> r0 = 1 se um dos dois é fantasma (guarda r1..r3)
a.label('algum')
a.push(['r1', 'r2', 'r3', 'r4'], lr=True)
a.movh('r4', 'r1')
a.bl('fantasma'); a.cmpi('r0', 0); a.bc('ne', 'fim')
a.movh('r0', 'r4'); a.bl('fantasma')
a.label('fim'); a.pop(['r1', 'r2', 'r3', 'r4']); a.pop(['r3']); a.bx('r3')
a.pool()
# uma entrada por função: [r3 original na pilha] -> devolve r3; se fantasma volta com 0; senão roda as 6 instruções
# deslocadas e continua em F+12
entradas = {}
for F in HANDLERS:
    nome = 'e%x' % F
    entradas[F] = nome
    a.label(nome)
    a.pop(['r3'])                                                       # r3 original
    a.push(['r0', 'r1', 'r2'], lr=True)
    a.bl('algum')
    a.cmpi('r0', 0)
    a.pop(['r0', 'r1', 'r2'])                                           # pop e mov de registrador alto não mexem nas bandeiras
    a.movh('r12', 'r3'); a.pop(['r3']); a.movh('lr', 'r3'); a.movh('r3', 'r12')   # lr original, sem estragar r0-r3
    a.bc('eq', nome + 'v')
    a.mov('r0', 0); a.bx('lr')
    a.label(nome + 'v')
    for k in range(6): a.h(struct.unpack_from('<H', d, F - B + 2 * k)[0])
    a.push(['r0']); a.ldr_lit('r0', (F + 12) | 1); a.movh('r12', 'r0'); a.pop(['r0']); a.bx('r12')
    a.pool()
codigo = a.build()
patches = [[BASE - B, list(codigo)]]
for F in HANDLERS:
    alvo = a.labels[entradas[F]] | 1
    # F: push {r3}; ldr r3,[pc,#4]; bx r3; nop; .word alvo  (12 bytes)
    assert F % 4 == 0
    patches.append([F - B, list(struct.pack('<HHHHI', 0xB408, 0x4B01, 0x4718, 0x46C0, alvo))])
Path(__file__).with_name('fantasma.json').write_text(json.dumps(patches))
print('código', len(codigo), 'bytes em', hex(BASE), {hex(k): hex(a.labels[v]) for k, v in entradas.items()})
