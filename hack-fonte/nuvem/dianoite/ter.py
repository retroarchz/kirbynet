import collections,json
from PIL import Image
def le(t):return Image.frombytes('RGBA',(240,160),open('tr_%d_720.raw'%t,'rb').read()).convert('RGB')
def c15(c):return (c[0]>>3)|((c[1]>>3)<<5)|((c[2]>>3)<<10)
SKY=[(0,44,50,110),(122,2,236,40)]
GND=[(112,54,150,84),(200,54,238,84)]
res={}
for t in (0,1,2,4,5,6,9):
    im=le(t);P=im.load()
    ceu=collections.Counter();ch=collections.Counter()
    for x0,y0,x1,y1 in SKY:
        for y in range(y0,y1):
            for x in range(x0,x1):ceu[P[x,y]]+=1
    for x0,y0,x1,y1 in GND:
        for y in range(y0,y1):
            for x in range(x0,x1):ch[P[x,y]]+=1
    sk=[c for c,n in ceu.most_common(10) if n>=6]
    gr=[c for c,n in ch.most_common(10) if c not in sk and n>=3]
    print(t,'ceu',['%02x%02x%02x:%d'%(c+(ceu[c],)) for c in sk]);print('  chao',['%02x%02x%02x:%d'%(c+(ch[c],)) for c in gr])
    res[t]={'ceu':[list(c) for c in sk],'chao':[list(c) for c in gr]}
json.dump(res,open('ter.json','w'))
