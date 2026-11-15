import struct, base64, random
from PIL import Image
exec(open('flutua/gera.py').read().split('# folha de prévia')[0])   # quad (finais), base, aura, ESC, CLA
R2=open('coop/rom_barco.gba','rb').read()
NE=5   # estágios 0..4 (0 = sem aura); o 5º é o quadro final
def estagio(d,s):
  b=base(d); a=aura(b)
  if s==0: return b
  ys=[y for y in range(32) for x in range(32) if a[y][x] in (ESC,CLA) and not b[y][x]]
  top,bot=min(ys),max(ys)
  T=bot-(bot-top+1)*s/NE          # a aura sobe dos pés até a cabeça
  o=[r[:] for r in b]; rnd=random.Random(d*10+s)
  for y in range(32):
    for x in range(32):
      c=a[y][x]
      if c not in (ESC,CLA) or b[y][x]: continue
      if c==ESC and y>=T: o[y][x]=ESC
      elif c==CLA and y>=T+2: o[y][x]=CLA
      elif y>=T-3 and rnd.random()<0.35: o[y][x]=CLA   # faíscas na frente da subida
  return o
est=[estagio(d,s) for s in range(NE) for d in range(3)]
def bytes4(o):
  out=bytearray()
  for ty in range(4):
    for tx in range(4):
      for y in range(8):
        for x in range(0,8,2): out.append(o[ty*8+y][tx*8+x] | (o[ty*8+y][tx*8+x+1]<<4))
  return out
E0=0x90F3000; D=0x90F4E00; T=0x90F6000; OAM=0x90F6140
blob=bytearray()
for o in est: blob+=bytes4(o)
assert E0+len(blob)==D
for o in quad: blob+=bytes4(o)
blob+=bytes(T-E0-len(blob))
blob+=b''.join(struct.pack('<II',D+512*(i if i<9 else 0),0x200) for i in range(40))
assert E0+len(blob)==OAM
blob+=bytes.fromhex('0002008000080000')   # OAM "apagado" (affineMode 2): o Lapras nasce sem aparecer
print('zeros?', all(b==0 for b in R2[E0-0x08000000:E0-0x08000000+len(blob)]), len(blob))
open('flutua/blob2.b64','w').write(base64.b64encode(bytes(blob)).decode())
# prévia
exec(open('surf/dump.py').read().replace("R=open(sys.argv[1],'rb').read()","R=R2").split('def img')[0])
P=cores(paleta(0x3adf)); P[ESC]=(40,88,200); P[CLA]=(136,200,248)
S=4; im=Image.new('RGB',(6*36*S,3*36*S),(56,104,168))
for d in range(3):
  for s in range(6):
    o=est[s*3+d] if s<NE else quad[d]
    t=Image.new('RGBA',(32,32))
    for y in range(32):
      for x in range(32):
        if o[y][x]: t.putpixel((x,y),P[o[y][x]]+(255,))
    t=t.resize((32*S,32*S),Image.NEAREST); im.paste(t,(s*36*S,d*36*S),t)
im.save('flutua/cresce.png')
