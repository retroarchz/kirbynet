import struct,sys
from PIL import Image
R=open(sys.argv[1],'rb').read(); A=0x08000000; GFX=0x090EC814-A
u32=lambda o: struct.unpack_from('<I',R,o)[0]; u16=lambda o: struct.unpack_from('<H',R,o)[0]
ok=lambda p: A<=p<A+len(R)
pal_cache={}
def paleta(tag):
  if tag in pal_cache: return pal_cache[tag]
  b=struct.pack('<HH',tag,0); o=-1; res=None
  while True:
    o=R.find(b,o+1)
    if o<0: break
    if o%4==0 and R[o-1] in (8,9) and u32(o-4)%2==0: res=u32(o-4); break
  pal_cache[tag]=res; return res
def cores(a): return [((c&31)*8,((c>>5)&31)*8,((c>>10)&31)*8) for c in struct.unpack_from('<16H',R,a-A)]
def img(gid,f=0):
  e=u32(GFX+4*gid)
  if not ok(e): return None
  e-=A; w,h=struct.unpack_from('<hh',R,e+8); imgs=u32(e+28)
  if not ok(imgs) or not(0<w<=64 and 0<h<=64): return None
  fr=u32(imgs-A+8*f); sz=u32(imgs-A+8*f+4)&0xFFFF
  if not ok(fr): return None
  p=paleta(u16(e+2)); P=cores(p) if p else [(i*16,i*16,i*16) for i in range(16)]
  im=Image.new('RGBA',(w,h)); tw=w//8
  for ty in range(h//8):
    for tx in range(tw):
      o=fr-A+(ty*tw+tx)*32
      for y in range(8):
        for x in range(4):
          b=R[o+y*4+x]
          for k,c in ((0,b&15),(1,b>>4)):
            if c: im.putpixel((tx*8+x*2+k,ty*8+y),P[c]+(255,))
  return im
def nframes(gid):
  e=u32(GFX+4*gid)-A; imgs=u32(e+28)-A; n=0
  while n<64 and ok(u32(imgs+8*n)) and (u32(imgs+8*n+4)&0xFFFF) in (0x80,0x100,0x200,0x400,0x800): n+=1
  return n
