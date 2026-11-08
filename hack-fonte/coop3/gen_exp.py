# Experiência e "aprender golpe" na luta dos 3: o lugar que mostra a tela (expGetterBattlerId, gBattleStruct+0x23 bits 3-4,
# só 0..3) não cabia o lugar 4 (3º jogador): a tela ia para o jogador do lugar 0 ou 2. Agora o campo usa os bits 3-5
# (0..7): leitores com deslocamento 26/29, máscaras 0x38, limpezas 0x39; a limpeza do bit 5 (0x0809235C) passa ao bit 6.
# As 2 escolhas do lugar (getexp 0x08072466 e tarefa do controle 0x0808BF32) usam o dono: espaço & 6 na luta de 3.
import sys, struct, json, capstone, os
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm
R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB); md.skipdata = True
def lit(j):
    t = ((j.address + 4) & ~3) + int(j.op_str.split('#')[1].rstrip(']'), 16)
    return struct.unpack('<I', R[t - 0x08000000:t - 0x08000000 + 4])[0]
esc = {}; log = []
def h16(addr, novo, velho):
    o = addr - 0x08000000; v = R[o] | R[o + 1] << 8
    assert v == velho, (hex(addr), hex(v), hex(velho)); esc[addr] = novo
ins = []
for a0 in range(0, 0x400000, 0x100000):
    for x in md.disasm(R[a0:a0 + 0x100040], 0x08000000 + a0):
        if x.address >= 0x08000000 + a0 + 0x100000: break
        ins.append(x)
for k, i in enumerate(ins):
        if not (i.mnemonic == 'adds' and i.op_str.endswith('#0x23')): continue
        nx = ins[k + 1:k + 6]; t = ' ; '.join(x.mnemonic + ' ' + x.op_str for x in nx)
        if not nx or nx[0].mnemonic != 'ldrb': continue
        if not (('#0x1b' in t and '#0x1e' in t) or ('#0x18' in t and 'ands' in t) or ('#0x19' in t and 'rsbs' in t) or ('#0x21' in t and 'rsbs' in t) or ('#0x20' in t and ('ands' in t or 'orrs' in t))): continue
        for j in nx:
            v = R[j.address - 0x08000000] | R[j.address - 0x08000000 + 1] << 8
            if j.mnemonic == 'lsls' and j.op_str.endswith('#0x1b'): h16(j.address, (v & ~(0x1F << 6)) | 26 << 6, v); log.append(('ler', hex(j.address)))
            elif j.mnemonic == 'lsrs' and j.op_str.endswith('#0x1e'): h16(j.address, (v & ~(0x1F << 6)) | 29 << 6, v); log.append(('ler', hex(j.address)))
            elif j.mnemonic == 'movs' and j.op_str.endswith('#0x18'): h16(j.address, (v & 0xFF00) | 0x38, v); log.append(('mascara', hex(j.address)))
            elif j.mnemonic == 'movs' and j.op_str.endswith('#0x19'): h16(j.address, (v & 0xFF00) | 0x39, v); log.append(('limpa', hex(j.address)))
            elif j.mnemonic == 'movs' and j.op_str.endswith('#0x21'): h16(j.address, (v & 0xFF00) | 0x41, v); log.append(('bit5->6', hex(j.address)))
            elif j.mnemonic == 'movs' and j.op_str.endswith('#0x20') and 0x08070000 <= j.address < 0x08090000: h16(j.address, (v & 0xFF00) | 0x40, v); log.append(('bit5->6', hex(j.address)))
# o primeiro teste de máscara de 0x0808C600 lê o byte de outra forma (r1 carregado antes): conferido à mão
FLAG, ABSENT, PIDX, GBS, VEN = 0x0203FE00, 0x02023209, 0x0203F400, 0x0202352C, 0x0808A492
E = 0x09FF3D00
a = Asm(E)
# --- getexp (chamado de 0x08072466; volta em 0x080724F2): lugar = quem tem o Pokémon que ganhou experiência
a.label('getexp')
a.push(['r4'], lr=True)
a.ldr_lit('r0', GBS); a.ldr_i('r0', 'r0', 0); a.addi('r0', 0x20); a.ldrb_i('r1', 'r0', 2)   # r0 = gBattleStruct+0x20; r1 = espaço
a.ldr_lit('r2', ABSENT); a.ldrb_i('r2', 'r2', 0)
a.ldr_lit('r3', FLAG); a.ldrb_i('r3', 'r3', 0); a.cmpi('r3', 0); a.bc('eq', 'g_orig')
a.mov('r4', 6); a.alu('and_', 'r4', 'r1')                                         # dono: espaço & 6 (0, 2, 4)
a.mov('r3', 1); a.h(0x40A3); a.alu('tst', 'r2', 'r3'); a.bc('eq', 'g_poe')         # lsls r3, r4 ; ausente?
a.label('g_orig')                                                                 # o que o jogo fazia
a.ldr_lit('r3', PIDX); a.ldrh_i('r3', 'r3', 4); a.alu('cmp', 'r3', 'r1'); a.bc('ne', 'g_0')
a.mov('r3', 4); a.alu('tst', 'r2', 'r3'); a.bc('ne', 'g_0'); a.mov('r4', 2); a.b('g_poe')
a.label('g_0'); a.mov('r4', 0); a.mov('r3', 1); a.alu('tst', 'r2', 'r3'); a.bc('eq', 'g_poe'); a.mov('r4', 2)
a.label('g_poe')
if os.environ.get('DEPURA'):   # só teste: anota (espaço, lugar) em 0x0203F300 (+0 contador)
    a.push(['r2', 'r3'])
    a.ldr_lit('r2', 0x0203F300); a.ldrb_i('r3', 'r2', 0); a.addi('r3', 1); a.strb_i('r3', 'r2', 0); a.lsl('r3', 'r3', 1); a.add_r('r2', 'r2', 'r3')
    a.ldrb_i('r3', 'r0', 2); a.strb_i('r3', 'r2', 0); a.strb_i('r4', 'r2', 1)
    a.pop(['r2', 'r3'])
a.ldrb_i('r1', 'r0', 3); a.mov('r2', 0x38); a.alu('bic', 'r1', 'r2'); a.lsl('r4', 'r4', 3); a.alu('orr', 'r1', 'r4'); a.strb_i('r1', 'r0', 3)
a.ldr_lit('r1', 0x080724F3); a.h(0x9101); a.pop(['r4']); a.pop([], pc=True)     # str r1,[sp,#4]
# --- tarefa do controle (chamada de 0x0808BF32; r0 = espaço, r2 = gBattleStruct; volta em 0x0808BF5C com r0/r2 como o jogo)
a.label('tarefa')
a.push(['r4'], lr=True)
a.ldr_lit('r3', FLAG); a.ldrb_i('r3', 'r3', 0); a.cmpi('r3', 0); a.bc('eq', 't_orig')
a.cmpi('r0', 5); a.bc('hi', 't_fim')                        # espaço 6 = fim: vai direto ao encerramento (0x0808C628)
a.mov('r4', 6); a.alu('and_', 'r4', 'r0'); a.b('t_poe')
a.label('t_orig'); a.mov('r4', 0); a.cmpi('r0', 2); a.bc('ls', 't_poe'); a.mov('r4', 2)
a.label('t_poe')
a.addi('r2', 0x23); a.ldrb_i('r0', 'r2', 0); a.mov('r1', 0x38); a.alu('bic', 'r0', 'r1'); a.lsl('r4', 'r4', 3); a.alu('orr', 'r0', 'r4'); a.strb_i('r0', 'r2', 0)
a.ldr_lit('r1', 0x0808BF5D); a.h(0x9101); a.pop(['r4']); a.pop([], pc=True)
a.label('t_fim'); a.ldr_lit('r1', 0x0808C629); a.h(0x9101); a.pop(['r4']); a.pop([], pc=True)
# --- tarefa: continuar para o próximo Pokémon? (chamada de 0x0808C5F8; r2 = gBattleStruct; volta 0x0808C61A = continua,
# 0x0808C628 = termina). Coop de 2: espaços 0-2 com o lugar 0, 3-5 com o lugar 2. Luta de 3: mesmo dono (espaço & 6)
a.label('segue')
a.push([], lr=True)
a.movh('r3', 'r2'); a.addi('r3', 0x20); a.ldrb_i('r1', 'r3', 3); a.ldrb_i('r3', 'r3', 2); a.mov('r0', 0x38); a.alu('and_', 'r1', 'r0')
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 's_orig')
a.b('s_cont')   # luta de 3: passa por todos os espaços na mesma tarefa (o dono de cada um é posto em 'tarefa'; espaço 6 encerra)
a.label('s_orig')
a.cmpi('r3', 2); a.bc('hi', 's_2'); a.cmpi('r1', 0); a.bc('eq', 's_cont')
a.label('s_2'); a.cmpi('r3', 5); a.bc('hi', 's_fim'); a.cmpi('r1', 0x10); a.bc('eq', 's_cont')
a.label('s_fim'); a.ldr_lit('r0', 0x0808C629); a.h(0x9000); a.pop([], pc=True)     # str r0,[sp]
a.label('s_cont'); a.ldr_lit('r0', 0x0808C61B); a.h(0x9000); a.pop([], pc=True)
# --- 0x0826233C (chamada de 0x0808D29A): o lugar vinha de "espaço <= 2 ? 0 : 2"; agora é o do campo (bits 3-5).
# Chamada de 0x0826236E; grava em [sp+0x58] do chamador (= sp+0x5C aqui) e volta em 0x0826237C
a.label('f3')
a.push([], lr=True)
a.ldr_lit('r2', GBS); a.ldr_i('r2', 'r2', 0); a.addi('r2', 0x20); a.ldrb_i('r2', 'r2', 3); a.lsl('r2', 'r2', 26); a.h(0x0F52)   # lsrs r2,r2,#29
a.h(0x9217)                                                    # str r2,[sp,#0x5C]
a.ldr_lit('r1', 0x0826237D); a.h(0x9100); a.pop([], pc=True)   # str r1,[sp]
a.label('via'); a.bx('r3'); a.pool()
# --- 0x08033F64 (lugar r0, máscara de 1 espaço r1): o pacote do cabo vale para esse lugar? Coop de 2: lugar 0 = espaços 0-2,
# lugar 2 = 3-5, lugar 4 recusado sempre (os pacotes do 3º jogador e do espaço 2 para o lugar 2 eram descartados e a batalha
# esperava para sempre). Luta de 3: lugar 2p = espaços 2p e 2p+1.
a.label('dono')
a.push(['r4', 'r5'], lr=True)
a.lsl('r4', 'r0', 24); a.h(0x0E24)                            # lsrs r4,r4,#24 (lugar)
a.lsl('r5', 'r1', 24); a.h(0x0E2D)                            # lsrs r5,r5,#24 (máscara)
a.cmpi('r5', 0); a.bc('eq', 'd_nao')
a.movh('r0', 'r5'); a.subi('r0', 1); a.alu('tst', 'r0', 'r5'); a.bc('ne', 'd_nao')   # um bit só
a.cmpi('r5', 0x3F); a.bc('hi', 'd_nao')
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 'd_orig')
a.mov('r0', 1); a.alu('tst', 'r4', 'r0'); a.bc('ne', 'd_nao')                          # lugar do inimigo
a.mov('r0', 3); a.h(0x40A0); a.alu('tst', 'r5', 'r0'); a.bc('eq', 'd_nao'); a.b('d_sim')   # lsls r0,r4
a.label('d_orig')
a.mov('r0', 0); a.ldr_lit('r3', 0x080F7859); a.bl('via2'); a.alu('cmp', 'r4', 'r0'); a.bc('ne', 'd_o2')
a.mov('r0', 7); a.alu('tst', 'r5', 'r0'); a.bc('eq', 'd_nao'); a.b('d_sim')
a.label('d_o2')
a.mov('r0', 2); a.ldr_lit('r3', 0x080F7859); a.bl('via2'); a.alu('cmp', 'r4', 'r0'); a.bc('ne', 'd_nao')
a.mov('r0', 7); a.alu('bic', 'r5', 'r0'); a.cmpi('r5', 0); a.bc('eq', 'd_nao')
a.label('d_sim'); a.mov('r0', 1); a.pop(['r4', 'r5']); a.pop([], pc=True)
a.label('d_nao'); a.mov('r0', 0); a.pop(['r4', 'r5']); a.pop([], pc=True)
a.label('via2'); a.bx('r3'); a.pool()
code = a.build(); assert E + len(code) <= 0x09FF4000, hex(E + len(code))
def site(addr, alvo):
    off = (VEN - (addr + 2 + 4)) >> 1
    b = struct.pack('<H', 0x4B01) + struct.pack('<HH', 0xF000 | (off >> 11) & 0x7FF, 0xF800 | off & 0x7FF)
    if addr % 4 == 0: b += struct.pack('<H', 0x46C0)
    return b + struct.pack('<I', alvo | 1)
lista = [[E - 0x08000000, list(code)]]
for addr, novo in sorted(esc.items()): lista.append([addr - 0x08000000, list(struct.pack('<H', novo))])
lista.append([0x08072466 - 0x08000000, list(site(0x08072466, a.labels['getexp']))])
lista.append([0x0808BF32 - 0x08000000, list(site(0x0808BF32, a.labels['tarefa']))])
lista.append([0x0808C5F8 - 0x08000000, list(site(0x0808C5F8, a.labels['segue']))])
# as funções do coop que recalculavam o lugar pelas metades passam a usar o lugar recebido em r0 (o do campo)
for ad, novo in ((0x08262082, 0x1C06), (0x08262084, 0x46C0), (0x08262086, 0x46C0), (0x08262088, 0x46C0),
                 (0x082624CA, 0x1C05), (0x082624CC, 0x46C0), (0x082624CE, 0x46C0), (0x082624D0, 0x46C0)):
    lista.append([ad - 0x08000000, list(struct.pack('<H', novo))])
# 0x08033F64 inteira vai para 'dono' (bx pc; ldr ip; bx ip)
lista.append([0x08033F64 - 0x08000000, list(struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, a.labels['dono'] | 1))])
VEN_ALTO = 0x084BDBD4
off = (VEN_ALTO - (0x0826236E + 2 + 4)) >> 1
lista.append([0x0826236E - 0x08000000, list(struct.pack('<H', 0x4B01) + struct.pack('<HH', 0xF000 | (off >> 11) & 0x7FF, 0xF800 | off & 0x7FF) + struct.pack('<I', a.labels['f3'] | 1))])
# caixa de subir de nível (0x0808D2DC): passa o lugar de verdade (campo >> 3) em vez de "0 ou 2"
for ad, novo in ((0x0808C638, 0x08C0), (0x0808C63A, 0x46C0), (0x0808C63C, 0x46C0)): lista.append([ad - 0x08000000, list(struct.pack('<H', novo))])
# nada dentro dos bytes que os desvios sobrescrevem
desvios = [(0x08072466, 10), (0x0808BF32, 10), (0x0808C5F8, 12)]
lista = [x for x in lista if not any(d - 0x08000000 < x[0] < d - 0x08000000 + n for d, n in desvios) or len(x[1]) > 2]
json.dump(lista, open('exp_patch.json', 'w'))
from collections import Counter
print('escritas:', len(lista)); print('pontos:', Counter(t for t, _ in log), 'código', len(code), 'bytes')
for t, ad in log: print(' ', t, ad)
