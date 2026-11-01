import json
from PIL import Image
AN={'73c6a5':'9f9e62','a5d6c6':'c9bd86','42b584':'7f8a4e','18a56b':'66783f','4a73ad':'5a5678','63a5de':'7a7aa0','bdcee7':'d9bfa8','dee7ef':'ecd3b6','ffffff':'ffe6c4',
'9cb5de':'a893a0','ce4252':'b8403e','ef9473':'df8f5e','84848c':'7f6f68','63637b':'5b4b62','424a6b':'3e3656','395200':'3a3a18','398c31':'5a5e2a','84c663':'8f8e3e',
'b5ff84':'b8ae58','399c5a':'6a7a42','9cffbd':'b6b47a','845a5a':'7a4a3c','634252':'5a3a3a','deb5a5':'e0a878','9c7373':'9a6650','bd948c':'c08a68','000000':'180c18'}
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
    o=lin(c);s=0;d=[0,0,0]
    ws=[]
    for a,r in RES:
        e=sum((u-v)**2 for u,v in zip(a,c));w=math.exp(-e/SIG)
        ws.append((w,r))
    t=sum(w for w,_ in ws)+1e-6
    f=min(1,t)                    # longe das âncoras vale só a matriz
    return [max(0,min(255,o[i]+f*sum(w*r[i] for w,r in ws)/t)) for i in range(3)]
json.dump({'M':M,'RES':RES,'SIG':SIG},open('tarde.json','w'))
