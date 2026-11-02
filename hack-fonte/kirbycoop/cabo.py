# Kirby AM, coop com mundos separados: a função do cabo do jogo (MultiSioMain 0x08157308, chamada 1 vez por quadro no laço
# principal antes das tarefas) deixa de mexer no fio. O site entrega os pacotes dos outros direto em gMultiSioRecv e o
# valor de retorno (bandeiras do cabo) em BANDEIRAS. Aproveitando que ela roda 1 vez por quadro, ela também atende a caixa
# de correio de MORTES: inimigos que morreram em outro aparelho. Cada um leva um "golpe falso" do meu Kirby pela rotina do
# próprio jogo (sub_0809B1E4), que zera a vida e toca a animação de derrotado igual a um golpe de verdade. Cada morte tem o
# seu golpe falso (GOLPES + i*0x80), do Kirby que bateu: com unk68 = 0x200 e o inimigo marcado (unkC bit 2) vira "engolido"
# e o jogo põe o inimigo na boca daquele Kirby (kirby->unkE8), como na tela de quem engoliu.
# Memória (livre no multiplayer, 0x0203F000-0x0203FFFF): GOLPES (8 x 0x80 bytes, o site preenche), CAIXA (+0 quantos, +4 ponteiros)
# e CHAMADAS (+0 quantas, +4 até 4 pares [função|1, r0]): o site pede para o jogo chamar uma rotina dele, ex. sub_080725E0(Kirby
# do amigo) cria a estrela que o amigo cuspiu na tela de quem recebe (o espelho pula a rotina que cria a estrela).
import json, struct, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'metaknight'))
from thumb import Asm

ROM = Path(__file__).resolve().parents[2] / 'roms' / 'Kirby & The Amazing Mirror (USA).gba'
d = ROM.read_bytes()
B = 0x08000000
MULTISIO, LEVOU_GOLPE = 0x08157308, 0x0809B1E4
GOLPES, CAIXA, BANDEIRAS, MAX = 0x0203F400, 0x0203F880, 0x0203F8C0, 8
CHAMADAS, MAXCH = 0x0203F8D0, 4
BASE = 0x08F80200
assert all(x == 0xFF for x in d[BASE - B:BASE - B + 0x100]), 'área não está livre'

a = Asm(BASE)
a.label('cabo')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
# o cabo de verdade não é mais usado: RCNT em modo "uso geral" solta este GBA do cabo emulado (no site o motor passa a
# rodar só este GBA; preso ao cabo, o GBA escravo ficava esperando o mestre que não roda mais)
a.ldr_lit('r0', 0x04000134); a.ldr_lit('r1', 0x8000); a.strh_i('r1', 'r0', 0)
a.ldr_lit('r4', CAIXA); a.ldrb_i('r5', 'r4', 0); a.cmpi('r5', MAX); a.bc('ls', 'n_ok'); a.mov('r5', MAX)
a.label('n_ok')
a.mov('r0', 0); a.strb_i('r0', 'r4', 0)                       # esvazia antes (nada roda duas vezes)
a.mov('r6', 0)
a.label('laco')
a.alu('cmp', 'r6', 'r5'); a.bc('hs', 'fim')
a.lsl('r0', 'r6', 2); a.add_r('r0', 'r0', 'r4'); a.ldr_i('r7', 'r0', 4)
a.cmpi('r7', 0); a.bc('eq', 'prox')
a.ldrb_i('r0', 'r7', 0); a.cmpi('r0', 1); a.bc('ne', 'prox')  # ainda é um objeto
a.mov('r0', 0); a.mov('r1', 0x80); a.strh_r('r0', 'r7', 'r1')  # vida 0 (deslocamento 0x80 não cabe no strh imediato)
a.lsl('r0', 'r6', 7); a.ldr_lit('r1', GOLPES); a.add_r('r0', 'r0', 'r1'); a.str_i('r0', 'r7', 0x6C)   # quem bateu: o golpe falso nº i
a.movh('r0', 'r7'); a.ldr_lit('r3', LEVOU_GOLPE | 1); a.bl('via_r3')
a.label('prox')
a.addi('r6', 1); a.b('laco')
a.label('fim')
a.ldr_lit('r4', CHAMADAS); a.ldrb_i('r5', 'r4', 0); a.cmpi('r5', MAXCH); a.bc('ls', 'nc_ok'); a.mov('r5', MAXCH)
a.label('nc_ok')
a.mov('r0', 0); a.strb_i('r0', 'r4', 0)
a.mov('r6', 0)
a.label('laco2')
a.alu('cmp', 'r6', 'r5'); a.bc('hs', 'fim2')
a.lsl('r0', 'r6', 3); a.add_r('r0', 'r0', 'r4'); a.ldr_i('r3', 'r0', 4); a.ldr_i('r0', 'r0', 8)
a.cmpi('r3', 0); a.bc('eq', 'prox2')
a.bl('via_r3')
a.label('prox2')
a.addi('r6', 1); a.b('laco2')
a.label('fim2')
a.ldr_lit('r0', BANDEIRAS); a.ldr_i('r0', 'r0', 0)
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.bx('r1')
a.label('via_r3'); a.bx('r3')
a.pool()
codigo = a.build()
# MultiSioMain: ldr r3,=cabo; bx r3; nop; .word cabo   (MultiSioMain 0x08157308 é alinhada em 4)
assert MULTISIO % 4 == 0
stub = struct.pack('<HHI', 0x4B00, 0x4718, a.labels['cabo'] | 1)
out = {'patches': [[BASE - B, list(codigo)], [MULTISIO - B, list(stub)]], 'golpes': GOLPES, 'caixa': CAIXA, 'bandeiras': BANDEIRAS, 'max': MAX, 'chamadas': CHAMADAS, 'maxch': MAXCH}
Path(__file__).with_name('cabo.json').write_text(json.dumps(out))
print('código', len(codigo), 'bytes em', hex(BASE))
