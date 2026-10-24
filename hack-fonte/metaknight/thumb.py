# Montador Thumb mínimo (ARM7TDMI), só com as instruções que o hack usa.
import struct

COND = dict(eq=0, ne=1, hs=2, lo=3, mi=4, pl=5, hi=8, ls=9, ge=10, lt=11, gt=12, le=13)


def r(x):
    if x == 'lr': return 14
    return int(x[1:]) if isinstance(x, str) else x


class Asm:
    def __init__(self, base):
        self.base = base          # endereço (0x08xxxxxx) do primeiro byte
        self.items = []           # (tipo, dados)
        self.labels = {}
        self.lits = []            # (label, valor)
        self.nlit = 0             # nomes únicos (há vários blocos de literais)

    def here(self):
        return self.base + sum(self._size(i) for i in self.items)

    def _size(self, it):
        return {'h': 2, 'bl': 4, 'word': 4, 'align': 0}[it[0]] if it[0] != 'align' else it[2]

    def label(self, name):
        self.labels[name] = self.here()

    def h(self, v):
        self.items.append(('h', v & 0xFFFF))

    # ---- instruções ----
    def mov(self, d, imm): self.h(0x2000 | r(d) << 8 | imm)
    def cmpi(self, n, imm): self.h(0x2800 | r(n) << 8 | imm)
    def addi(self, d, imm): self.h(0x3000 | r(d) << 8 | imm)
    def subi(self, d, imm): self.h(0x3800 | r(d) << 8 | imm)
    def lsl(self, d, m, imm): self.h(imm << 6 | r(m) << 3 | r(d))
    def ldr_i(self, d, n, imm): self.h(0x6800 | (imm >> 2) << 6 | r(n) << 3 | r(d))
    def str_i(self, d, n, imm): self.h(0x6000 | (imm >> 2) << 6 | r(n) << 3 | r(d))
    def ldrb_i(self, d, n, imm): self.h(0x7800 | imm << 6 | r(n) << 3 | r(d))
    def strb_i(self, d, n, imm): self.h(0x7000 | imm << 6 | r(n) << 3 | r(d))
    def ldrh_i(self, d, n, imm): self.h(0x8800 | (imm >> 1) << 6 | r(n) << 3 | r(d))
    def strh_i(self, d, n, imm): self.h(0x8000 | (imm >> 1) << 6 | r(n) << 3 | r(d))
    def ldrb_r(self, d, n, m): self.h(0x5C00 | r(m) << 6 | r(n) << 3 | r(d))
    def strb_r(self, d, n, m): self.h(0x5400 | r(m) << 6 | r(n) << 3 | r(d))
    def ldrh_r(self, d, n, m): self.h(0x5A00 | r(m) << 6 | r(n) << 3 | r(d))
    def add_r(self, d, n, m): self.h(0x1800 | r(m) << 6 | r(n) << 3 | r(d))
    def alu(self, op, d, m):
        self.h(0x4000 | dict(and_=0, eor=1, orr=12, bic=14, tst=8, mul=13, cmp=10)[op] << 6 | r(m) << 3 | r(d))
    def movh(self, d, s):
        d, s = r(d), r(s)
        if d < 8 and s < 8:   # no ARMv4T, MOV de alto registro com dois baixos não vale: usa add rd, rs, #0
            return self.h(0x1C00 | s << 3 | d)
        self.h(0x4600 | (d >> 3) << 7 | (s >> 3) << 6 | (s & 7) << 3 | (d & 7))
    def bx(self, s): s = r(s); self.h(0x4700 | (s >> 3) << 6 | (s & 7) << 3)
    def push(self, regs, lr=False): self.h(0xB400 | lr << 8 | sum(1 << r(x) for x in regs))
    def pop(self, regs, pc=False): self.h(0xBC00 | pc << 8 | sum(1 << r(x) for x in regs))
    def addsp(self, imm): self.h(0xB000 | imm >> 2)
    def b(self, lab): self.items.append(('b', lab))
    def bc(self, cond, lab): self.items.append(('bc', (cond, lab)))
    def bl(self, lab): self.items.append(('bl', lab))
    def bfar(self, cond, lab):
        # desvio condicional sem o limite de 256 bytes: condição invertida pula um "b" comum (2 KB)
        inv = {'eq': 'ne', 'ne': 'eq', 'hs': 'lo', 'lo': 'hs', 'hi': 'ls', 'ls': 'hi', 'mi': 'pl', 'pl': 'mi',
               'ge': 'lt', 'lt': 'ge', 'gt': 'le', 'le': 'gt'}[cond]
        skip = '_far%d' % len(self.items)
        self.bc(inv, skip); self.b(lab); self.label(skip)
    def ldr_lit(self, d, value):
        name = '_lit%d' % self.nlit
        self.nlit += 1
        self.lits.append((name, value))
        self.items.append(('ldrlit', (r(d), name)))
    def word(self, v): self.items.append(('word', v))
    def pool(self):
        # alinha em 4 e despeja os literais pendentes
        if self.here() % 4: self.h(0x46C0)  # nop (mov r8,r8)
        for name, v in self.lits:
            self.label(name); self.word(v)
        self.lits = []

    def _size(self, it):
        return 4 if it[0] in ('bl', 'word') else 2

    def build(self):
        out = bytearray()
        pc = self.base
        for kind, a in self.items:
            if kind == 'h':
                out += struct.pack('<H', a)
            elif kind == 'word':
                out += struct.pack('<I', a & 0xFFFFFFFF)
            elif kind == 'b':
                off = (self._target(a) - (pc + 4)) >> 1
                assert -1024 <= off < 1024, a
                out += struct.pack('<H', 0xE000 | off & 0x7FF)
            elif kind == 'bc':
                cond, lab = a
                off = (self._target(lab) - (pc + 4)) >> 1
                assert -128 <= off < 128, lab
                out += struct.pack('<H', 0xD000 | COND[cond] << 8 | off & 0xFF)
            elif kind == 'bl':
                off = (self._target(a) - (pc + 4)) >> 1
                assert -(1 << 21) <= off < (1 << 21), a
                out += struct.pack('<HH', 0xF000 | (off >> 11) & 0x7FF, 0xF800 | off & 0x7FF)
            elif kind == 'ldrlit':
                d, name = a
                t = self.labels[name]
                imm = t - ((pc + 4) & ~3)
                assert 0 <= imm < 1024 and imm % 4 == 0, name
                out += struct.pack('<H', 0x4800 | d << 8 | imm >> 2)
            pc += 4 if kind in ('bl', 'word') else 2
        return bytes(out)

    def _target(self, lab):
        return lab if isinstance(lab, int) else self.labels[lab]
