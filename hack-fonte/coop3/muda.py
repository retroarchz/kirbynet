# Muda tabelas por batalhador para a área livre (já com 6 lugares) trocando cada literal que o CÓDIGO lê.
# uso: muda.py rom_entrada rom_saida tabelas.json  -> imprime o mapa e quantos literais trocou
import json, struct, sys
src, dst, tj = sys.argv[1:4]
d = bytearray(open(src, 'rb').read())
FREE, FEND = 0x0203F400, 0x0203FE00
tabs = json.load(open(tj))
# literais lidos por "ldr Rd,[pc,#]" (só esses: dados que só parecem endereço ficam intactos)
lit = set()
for j in range(0, len(d) - 1, 2):
    h = d[j] | d[j + 1] << 8
    if h >> 11 == 0b01001: lit.add(((j + 4) & ~3) + (h & 0xff) * 4)
a = FREE; mapa = []
for nome, base, k in tabs:
    base = int(base, 16); al = 4 if k % 4 == 0 else (2 if k % 2 == 0 else 1)
    a = (a + 3) & ~3
    mapa.append((nome, base, k, a)); a += 6 * k
assert a <= FEND, hex(a)
troca = {}
for o in lit:
    if o + 4 > len(d): continue
    v = struct.unpack_from('<I', d, o)[0]
    for nome, base, k, nb in mapa:
        if base <= v < base + 4 * k:
            troca[o] = (v, nb + (v - base), nome); break
for o, (v, nv, nome) in troca.items(): struct.pack_into('<I', d, o, nv)
open(dst, 'wb').write(d)
cont = {}
for o, (v, nv, nome) in troca.items(): cont[nome] = cont.get(nome, 0) + 1
for nome, base, k, nb in mapa: print('%-30s %08x -> %08x  (6 x %-3d) literais trocados: %d' % (nome, base, nb, k, cont.get(nome, 0)))
print('total literais: %d, área usada até %08x' % (len(troca), a))
