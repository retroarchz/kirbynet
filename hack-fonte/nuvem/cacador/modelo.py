# modelo do desenho da floresta com as bases de musgo (mesma conta do código do GBA)
import struct, sys
from PIL import Image
rom=open("C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/roms/PokemonQuetzalPtBrAlpha9v1.gba",'rb').read()
def lz(p):
    o=p-0x08000000; size=int.from_bytes(rom[o+1:o+4],'little'); o+=4; out=bytearray()
    while len(out)<size:
        f=rom[o]; o+=1
        for b in range(8):
            if len(out)>=size: break
            if f&(0x80>>b):
                v=rom[o]<<8|rom[o+1]; o+=2; n=(v>>12)+3; d=(v&0xFFF)+1
                for _ in range(n): out.append(out[-d])
            else: out.append(rom[o]); o+=1
    return bytes(out)
pi,pp,pm=struct.unpack_from('<3I',rom,0x1129530+12*72)
T,P,M=lz(pi),lz(pp),lz(pm)
L=[154,145,140,135,130,127,124,122,120,118,116,115,114,113,112,112,112,112,113,114,115,116,118,120,122,124,127,130,135,140,145,154]
def floresta(x,y):
    e=struct.unpack_from('<H',M,2*((y//8)*32+x//8))[0]; tn,hf,vf=e&0x3ff,e>>10&1,e>>11&1
    sx=7-x%8 if hf else x%8; sy=7-y%8 if vf else y%8
    b=T[tn*32+sy*4+sx//2]; return (b>>4) if sx&1 else b&15
def base(x,y):
    for bx,by in ((0,48),(-112,101)):
        k=y-by
        if 0<=k<32:
            l=L[k]+bx; r=351-L[k]+bx
            if l<=x<=r:
                d=min(x-l,r-x); dy=min(k,31-k)
                if d==0 or dy==0: return 15
                if d<=2 or dy<=1: return 5
                if k>=27 or d<=4: return 3
                h=(x*7+y*13)&15
                if h==0: return 14
                if ((x*5+y*3)&31)==7: return 9
                return 12
    return None
def desenha():
    img=[[0]*240 for _ in range(112)]
    for y in range(112):
        for x in range(240):
            b=base(x,y); img[y][x]=floresta(x,y) if b is None else b
    return img
if __name__=='__main__':
    cor=lambda c:((c&31)<<3,(c>>5&31)<<3,(c>>10&31)<<3)
    pal=[cor(c) for c in struct.unpack('<16H',P[:32])]
    d=desenha(); im=Image.new('RGB',(240,160),(40,80,72))
    for y in range(112):
        for x in range(240): im.putpixel((x,y),pal[d[y][x]])
    im.resize((720,480),Image.NEAREST).save('cac/modelo.png')
