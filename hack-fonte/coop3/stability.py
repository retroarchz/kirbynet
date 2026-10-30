"""Apply stability fixes to Claude's qc9 test ROM; never updates the site ROM."""
import hashlib
import struct
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'metaknight'))
from thumb import Asm

source, target = map(Path, sys.argv[1:3])
rom = bytearray(source.read_bytes())

def half(address, old, new):
    off = address - 0x08000000
    actual = struct.unpack_from('<H', rom, off)[0]
    assert actual == old, (hex(address), hex(actual), hex(old))
    struct.pack_into('<H', rom, off, new)

# AI_ThinkingStruct: saved battler snapshots start at +0x20, stride 0x14.
# Slot 4 previously wrote into the next heap header at +0x70.
# Keep all original offsets and reserve six snapshots instead of four.
half(0x0808D552, 0x2070, 0x2098)

# HasNoMonsToSwitch: each human owns a contiguous pair, not the original trio.
# Leave all other battle types and the trainer's shared party on the original path.
function = 0x080519D0
entry = 0x09FF8000
original = bytes(rom[function-0x08000000:function-0x08000000+16])
assert original == bytes.fromhex('f0b557464e464546e0b4071c0906090e')
a = Asm(entry)
regs = ['r0','r1','r2','r3','r4','r5','r6','r7']
a.push(regs, lr=True)
a.ldr_lit('r3', 0x0203FE00); a.ldrb_i('r3','r3',0); a.cmpi('r3',0); a.bc('eq','original')
a.ldr_lit('r3', 0x030055F4); a.ldrb_i('r3','r3',0); a.cmpi('r3',3); a.bc('ne','original')
a.ldr_lit('r3', 0x0203F40C); a.ldrb_r('r4','r3','r0')
a.mov('r3',1); a.alu('tst','r4','r3'); a.bc('ne','original')
a.movh('r5','r4'); a.addi('r5',2)
a.label('loop')
a.mov('r0',0x68); a.alu('mul','r0','r4'); a.ldr_lit('r1',0x020235CC); a.add_r('r0','r0','r1')
a.ldr_lit('r3',0x080338E9); a.bl('call_r3'); a.cmpi('r0',0); a.bc('ne','available')
a.addi('r4',1); a.alu('cmp','r4','r5'); a.bc('lo','loop')
a.mov('r0',1); a.b('return')
a.label('available'); a.mov('r0',0)
a.label('return'); a.movh('r12','r0'); a.pop(regs); a.pop(['r3']); a.movh('r0','r12'); a.bx('r3')
a.label('original'); a.pop(regs); a.pop(['r3']); a.movh('lr','r3'); a.ldr_lit('r3',entry+0x200|1); a.bx('r3')
a.label('call_r3'); a.bx('r3'); a.pool()
code=a.build()
assert len(code)<0x200
tramp=original+struct.pack('<HHI',0x4B00,0x4718,(function+16)|1)
assert set(rom[entry-0x08000000:entry-0x08000000+0x200+len(tramp)])=={0xFF}
rom[entry-0x08000000:entry-0x08000000+len(code)]=code
rom[entry+0x200-0x08000000:entry+0x200-0x08000000+len(tramp)]=tramp
rom[function-0x08000000:function-0x08000000+16]=struct.pack('<HHIII',0x4778,0x46C0,0xE59FC000,0xE12FFF1C,entry|1)

target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(rom)
print('AI saved battlers: 4 -> 6 (0x70 -> 0x98 bytes)')
print('Fainted human checks only its own two party slots in coop-3')
print(target, hashlib.sha256(rom).hexdigest())
