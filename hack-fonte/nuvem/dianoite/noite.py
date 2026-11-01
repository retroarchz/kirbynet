import json
from PIL import Image
AN={'73c6a5':'2a5a78','a5d6c6':'42709a','42b584':'185b70','18a56b':'0f4a5c','4a73ad':'152e81','63a5de':'2d4fa8','bdcee7':'6677c6','dee7ef':'8f9bd7','ffffff':'a8b8e4',
'9cb5de':'4f66b8','ce4252':'5d2441','ef9473':'8b3f58','84848c':'3a4660','63637b':'2a2c58','424a6b':'1c2340','395200':'1a351d','398c31':'275142','84c663':'2f6b5a',
'b5ff84':'4c8676','399c5a':'1f6a55','9cffbd':'43969e','845a5a':'43354e','634252':'2f263f','deb5a5':'8a7a94','000000':'080810','bd948c':'6a5a78','9c7373':'524560'}
h=lambda s:[int(s[i:i+2],16) for i in(0,2,4)]
PA=[(h(a),h(b)) for a,b in AN.items()]
def resolve(A,B):
    n=len(A);M=[r[:]+[b] for r,b in zip(A,B)]
    for i in range(n):
        p=max(range(i,n),key=lambda k:abs(M[k][i]));M[i],M[p]=M[p],M[i]
        for k in range(n):
            if k!=i:
                f=M[k][i]/M[i][i]
                for j in range(i,n+1):M[k][j]-=f*M[i][j]
    return [M[i][n]/M[i][i] for i in range(n)]
# matriz sem a janela, que é exceção
Q=[p for p in PA if p[0]!=h('63adef')]
XtX=[[0.]*4 for _ in range(4)];Xty=[[0.]*4 for _ in range(3)]
for a,b in Q:
    v=a+[255.]
    for p in range(4):
        for q in range(4):XtX[p][q]+=v[p]*v[q]
        for c in range(3):Xty[c][p]+=v[p]*b[c]
for p in range(4):XtX[p][p]+=1e-3
M=[resolve(XtX,Xty[c]) for c in range(3)]
lin=lambda c:[M[i][0]*c[0]+M[i][1]*c[1]+M[i][2]*c[2]+M[i][3]*255 for i in range(3)]
RES=[(a,[y-x for x,y in zip(lin(a),b)]) for a,b in PA]
SIG=2*34**2
import math
def noite(c):
    if sum((u-v)**2 for u,v in zip(c,(0x63,0xad,0xef)))<400:return [0xf4,0xdc,0x58]
    o=lin(c);s=0;d=[0,0,0]
    ws=[]
    for a,r in RES:
        e=sum((u-v)**2 for u,v in zip(a,c));w=math.exp(-e/SIG)
        ws.append((w,r))
    t=sum(w for w,_ in ws)+1e-6
    f=min(1,t)                    # longe das âncoras vale só a matriz
    return [max(0,min(255,o[i]+f*sum(w*r[i] for w,r in ws)/t)) for i in range(3)]
BOX=[(46,4,66,26),(13,64,33,90),(110,60,130,90),(14,130,34,152)]
FUNDO={tuple(h(x)) for x in('73c6a5','a5d6c6','42b584','18a56b')}
def sprite(c):
    n=noite(c);return [.5*.8*u+.5*v for u,v in zip(c,n)]
if __name__=='__main__':
    json.dump({'M':M,'RES':RES,'SIG':SIG},open('noite.json','w'))
    mk=Image.open(r'C:\Users\Sandro\Downloads\Vila Pokémon em Três Horários.png').convert('RGB')
    im=Image.open('cena.png').convert('RGB');r=Image.new('RGB',im.size);P=im.load();Q2=r.load();mp={}
    for y in range(160):
        for x in range(240):
            c=P[x,y];s=any(a<=x<e and b<=y<d for a,b,e,d in BOX) and c not in FUNDO
            k=(c,s)
            if k not in mp:mp[k]=tuple(int(v) for v in (sprite(c) if s else noite(c)))
            Q2[x,y]=mp[k]
    o=Image.new('RGB',(1450,480),(15,15,25));o.paste(r.resize((720,480),Image.NEAREST),(0,0))
    o.paste(mk.crop((450,489,1225,927)).resize((720,480),Image.LANCZOS),(730,0));o.save('noite_cmp.png')
