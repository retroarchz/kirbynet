# folha "Salto Giratório" do usuário (giro_folha.png) -> giro.bin: 16 quadros 16x32 (4 bits) na paleta do 657
# (fileira 1 = quadros 0-7, fileira 2 = 8-15) e giro_previa.png. uso: python giro.py
import numpy as np, struct, sys, os
AQUI = os.path.dirname(os.path.abspath(__file__))
from PIL import Image
SITE=os.path.join(AQUI, '..', '..', '..') + '/'
R=open(SITE+'roms/PokemonQuetzalCoop3Teste.gba','rb').read()
P=[((c&31)*8,((c>>5)&31)*8,((c>>10)&31)*8) for c in struct.unpack_from('<16H',R,0xF549D4)]
u32=lambda o: struct.unpack_from('<I',R,o)[0]
def ler(a,w=16,h=32):
    g=np.zeros((h,w),int); tw=w//8
    for ty in range(h//8):
        for tx in range(tw):
            o=a-0x08000000+(ty*tw+tx)*32
            for y in range(8):
                for x in range(4):
                    b=R[o+y*4+x]; g[ty*8+y,tx*8+x*2]=b&15; g[ty*8+y,tx*8+x*2+1]=b>>4
    return g
img0=ler(u32(u32(u32(0x090EC814-0x08000000+4*657)-0x08000000+28)-0x08000000))
ys,xs=np.nonzero(img0); print('657 caixa x',xs.min(),xs.max(),'y',ys.min(),ys.max())
im=np.array(Image.open(os.path.join(AQUI, 'giro_folha.png')).convert('RGB')).astype(int)
fg=im.sum(axis=2)>60
LIN=[(40,315),(397,667)]
COL=[[(39,245),(316,511),(579,777),(851,1055),(1119,1326),(1400,1602),(1665,1877),(1932,2144)],
     [(26,243),(302,505),(579,776),(850,1055),(1114,1313),(1387,1589),(1652,1865),(1916,2116)]]
# caixa de cada quadro
def caixa(y0,y1,x0,x1):
    f=fg[y0:y1+1,x0:x1+1]; yy=np.nonzero(f.any(axis=1))[0]; xx=np.nonzero(f.any(axis=0))[0]
    return y0+yy.min(), y0+yy.max(), x0+xx.min(), x0+xx.max()
# escala: o quadro parado (1º de cada fileira) fica com a altura do 657 menos o contorno
h0=ys.max()-ys.min()+1
pal=np.array(P[1:15])
def perto(c): return 2+int(((pal[1:]-c)**2).sum(axis=1).argmin())   # 1 (preto) fica só para o contorno
quadros=[]
for r,(y0,y1) in enumerate(LIN):
    by0,by1,_,_=caixa(y0,y1,*COL[r][0])
    S=(by1-by0+1)/(h0-2); base=by1   # pé do quadro parado -> y 29
    print('fileira',r,'escala',round(S,2))
    for (x0,x1) in COL[r]:
        _,_,cx0,cx1=caixa(y0,y1,x0,x1); cx=(cx0+cx1+1)/2
        g=np.zeros((32,16),int)
        for ty in range(32):
            for tx in range(16):
                sy0=base+1-(30-ty)*S; sx0=cx+(tx-8)*S
                Y0,Y1,X0,X1=int(round(sy0)),int(round(sy0+S)),int(round(sx0)),int(round(sx0+S))
                Y0,Y1,X0,X1=max(Y0,y0),min(Y1,y1+1),max(X0,x0),min(X1,x1+1)
                if Y1<=Y0 or X1<=X0: continue
                f=fg[Y0:Y1,X0:X1]
                if f.size==0 or f.mean()<0.5: continue
                m=im[Y0:Y1,X0:X1][f]; g[ty,tx]=perto(np.median(m,axis=0))
        # contorno preto (índice 1) em volta, como os quadros do jogo
        o=g.copy()
        for y in range(32):
            for x in range(16):
                if g[y,x]==0 and any(0<=y+dy<32 and 0<=x+dx<16 and g[y+dy,x+dx]>1 for dy,dx in ((0,1),(0,-1),(1,0),(-1,0))): o[y,x]=1
        quadros.append(o)
b=bytearray()
for g in quadros:
    for ty in range(4):
        for tx in range(2):
            for y in range(8):
                for x in range(4): b.append(g[ty*8+y,tx*8+x*2] | g[ty*8+y,tx*8+x*2+1] << 4)
open(os.path.join(AQUI,'giro.bin'),'wb').write(b)
Z=6; out=Image.new('RGB',(9*16*Z,2*32*Z),(60,60,90))
def pinta(g,ox,oy):
    for y in range(32):
        for x in range(16):
            if g[y,x]: 
                for yy in range(Z):
                    for xx in range(Z): out.putpixel((ox+x*Z+xx,oy+y*Z+yy),P[g[y,x]])
pinta(img0,0,0)
for i,g in enumerate(quadros): pinta(g,((i%8)+1)*16*Z,(i//8)*32*Z)
out.save(os.path.join(AQUI,'giro_previa.png')); print('ok')
