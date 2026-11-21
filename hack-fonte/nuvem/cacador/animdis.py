# lê scripts de animação de batalha do Quetzal (comandos do pokeemerald-expansion)
import struct
def u8(r,a): return r[a-0x08000000]
def u16(r,a): return struct.unpack_from('<H',r,a-0x08000000)[0]
def u32(r,a): return struct.unpack_from('<I',r,a-0x08000000)[0]
NOMES={0:'loadspritegfx',1:'unloadspritegfx',2:'createsprite',3:'createvisualtask',4:'delay',5:'waitforvisualfinish',6:'nop',7:'nop2',8:'end',
 9:'playse',0xa:'monbg',0xb:'clearmonbg',0xc:'setalpha',0xd:'blendoff',0xe:'call',0xf:'return',0x10:'setarg',0x11:'choosetwoturnanim',
 0x12:'jumpifmoveturn',0x13:'goto',0x14:'fadetobg',0x15:'restorebg',0x16:'waitbgfadeout',0x17:'waitbgfadein',0x18:'changebg',
 0x19:'playsewithpan',0x1a:'setpan',0x1b:'panse',0x1c:'loopsewithpan',0x1d:'waitplaysewithpan',0x1e:'setbldcnt',0x1f:'createsoundtask',
 0x20:'waitsound',0x21:'jumpargeq',0x22:'monbg_static',0x23:'clearmonbg_static',0x24:'jumpifcontest',0x25:'fadetobgfromset',
 0x26:'panse_adjustnone',0x27:'panse_adjustall',0x28:'splitbgprio',0x29:'splitbgprio_all',0x2a:'splitbgprio_foes',0x2b:'invisible',
 0x2c:'visible',0x2d:'teamattack_moveback',0x2e:'teamattack_movefwd',0x2f:'stopsound'}
FIXO={0:2,1:2,4:1,5:0,6:0,7:0,8:0,9:2,0xa:1,0xb:1,0xc:2,0xd:0,0xe:4,0xf:0,0x10:3,0x11:8,0x12:5,0x13:4,0x14:1,0x15:0,0x16:0,0x17:0,0x18:1,
 0x19:3,0x1a:1,0x1b:6,0x1c:5,0x1d:4,0x1e:2,0x20:0,0x21:7,0x22:1,0x23:1,0x24:4,0x25:3,0x26:6,0x27:6,0x28:1,0x29:0,0x2a:1,0x2b:1,0x2c:1,
 0x2d:1,0x2e:1,0x2f:0}
def tam(r,a):
    c=u8(r,a)
    if c==2: n=u8(r,a+6); return 7+2*n
    if c in (3,): n=u8(r,a+6); return 7+2*n
    if c==0x1f: n=u8(r,a+5); return 6+2*n
    return 1+FIXO[c]
def lista(r,a,limite=400,seguir=False):
    out=[]; fim=a+limite
    while a<fim:
        c=u8(r,a); n=tam(r,a); b=r[a-0x08000000:a-0x08000000+n]
        desc=NOMES.get(c,'?%02x'%c)
        if c==2: desc+=' tmpl=%08x bat=%02x args=%s'%(u32(r,a+1),u8(r,a+5),[struct.unpack_from('<h',b,7+2*i)[0] for i in range(u8(r,a+6))])
        elif c==3: desc+=' fn=%08x pri=%d args=%s'%(u32(r,a+1),u8(r,a+5),[struct.unpack_from('<h',b,7+2*i)[0] for i in range(u8(r,a+6))])
        elif c in (0xe,0x13,0x24): desc+=' %08x'%u32(r,a+1)
        elif c in (0,1,9): desc+=' %04x'%u16(r,a+1)
        else: desc+=' '+b[1:].hex()
        out.append((a,b,desc))
        if c in (8,0xf,0x13): break
        a+=n
    return out
if __name__=='__main__':
    import sys
    r=open(sys.argv[1],'rb').read()
    for mv in map(int,sys.argv[2:]):
        p=u32(r,0x0846AB1C+4*mv); print('== golpe',mv,hex(p))
        for a,b,d in lista(r,p): print(' ',hex(a),d)
