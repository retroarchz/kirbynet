import struct, json
from PIL import Image
R=open('coop/rom_barco.gba','rb').read();A=0x08000000;G=0x090EC814-A
u32=lambda o: struct.unpack_from('<I',R,o)[0]
def frame(gid,f,w,h):
  e=u32(G+4*gid)-A; fr=u32(u32(e+28)-A+8*f)-A; px=[[0]*w for _ in range(h)]; tw=w//8
  for ty in range(h//8):
    for tx in range(tw):
      o=fr+(ty*tw+tx)*32
      for y in range(8):
        for x in range(4):
          b=R[o+y*4+x]; px[ty*8+y][tx*8+x*2]=b&15; px[ty*8+y][tx*8+x*2+1]=b>>4
  return px
ESC,CLA=7,9   # anel de dentro (escuro) e de fora (claro)
SUBE=5
exec(open('flutua/maos.py').read())
def base(f):
  p=frame(657,f,16,32); o=[[0]*32 for _ in range(32)]
  for y in range(32):
    for x in range(16):
      if p[y][x] and 0<=y-SUBE<32: o[y-SUBE][x+8]=p[y][x]
  def patch(T,esp):   # mãos levantadas (levitação), flutua/maos.py
    for y,s in T.items():
      for i,ch in enumerate(s):
        x=-3+i
        if esp: x=15-x
        if ch!='?': o[y-SUBE][x+8]=0 if ch=='.' else int(ch,16)
  if f==0: patch(FRENTE,False); patch(FRENTE,True)
  if f==1: patch(COSTAS,False); patch(COSTAS,True)
  if f==2: patch(LADO,False)
  return o
def anel(o,cor,viz8):
  n=[r[:] for r in o]
  for y in range(32):
    for x in range(32):
      if o[y][x]: continue
      for dy,dx in ((0,1),(1,0),(0,-1),(-1,0))+(((1,1),(1,-1),(-1,1),(-1,-1)) if viz8 else ()):
        yy,xx=y+dy,x+dx
        if 0<=yy<32 and 0<=xx<32 and o[yy][xx]: n[y][x]=cor; break
  return n
def aura(o): return anel(anel(o,ESC,True),CLA,False)
# faÃ­scas do 379: pixels de aura do quadro f que nÃ£o existem no quadro parado da mesma direÃ§Ã£o
G379={3:0,4:0,5:1,6:1,7:2,8:2}
def faiscas(f):
  a=frame(379,f,32,32); b=frame(379,G379[f],32,32)
  return [(y,x,{9:ESC,10:CLA}[a[y][x]]) for y in range(32) for x in range(32) if a[y][x] in (9,10) and b[y][x] not in (9,10) and not b[y][x]]
quad=[]
for f in range(9):
  d=[0,1,2,0,0,1,1,2,2][f]; o=aura(base(d))
  if f>=3:
    for y,x,c in faiscas(f):
      if not o[y][x]: o[y][x]=c
  quad.append(o)
# folha de prÃ©via em cores
exec(open('surf/dump.py').read().replace("R=open(sys.argv[1],'rb').read()","R=R").split('def img')[0])
P=cores(paleta(0x3adf)); P[ESC]=(40,88,200); P[CLA]=(136,200,248)
S=5; im=Image.new('RGB',(9*36*S,36*S),(56,104,168))
for i,o in enumerate(quad):
  t=Image.new('RGBA',(32,32))
  for y in range(32):
    for x in range(32):
      if o[y][x]: t.putpixel((x,y),P[o[y][x]]+(255,))
  t=t.resize((32*S,32*S),Image.NEAREST); im.paste(t,(i*36*S,2*S),t)
im.save('flutua/ele.png')
# bytes 4bpp em blocos 8x8
out=bytearray()
for o in quad:
  for ty in range(4):
    for tx in range(4):
      for y in range(8):
        for x in range(0,8,2):
          out.append(o[ty*8+y][tx*8+x] | (o[ty*8+y][tx*8+x+1]<<4))
open('flutua/ele.bin','wb').write(out); print(len(out))
