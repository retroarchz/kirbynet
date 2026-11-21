def lz77_comp(data):
    """LZ77 do GBA (tipo 0x10), ótimo por programação dinâmica; distância >= 2 (seguro para VRAM também)."""
    n=len(data)
    INF=1<<60
    cost=[INF]*(n+1); cost[n]=0; choice=[None]*(n+1)
    # custo em bits: literal 9, cópia 17
    from collections import defaultdict
    pos=defaultdict(list)
    matches=[None]*n
    for i in range(n):
        best=[]
        if i+3<=n:
            key=data[i:i+3]
            for j in reversed(pos[key]):
                d=i-j
                if d>4096: break
                if d<2: continue
                L=0
                while L<18 and i+L<n and data[j+L]==data[i+L]: L+=1
                best.append((L,d))
        matches[i]=best
        if i>=2: pos[data[i-2:i+1]].append(i-2) if False else None
        if i+3<=n: pos[data[i:i+3]].append(i)
    for i in range(n-1,-1,-1):
        c=9+cost[i+1]; ch=None
        bl={}
        for L,d in matches[i]:
            for l in range(3,L+1):
                if l not in bl: bl[l]=d
        for l,d in bl.items():
            v=17+cost[i+l]
            if v<c: c=v; ch=(l,d)
        cost[i]=c; choice[i]=ch
    out=bytearray([0x10,n&255,n>>8&255,n>>16&255])
    i=0
    while i<n:
        flag_at=len(out); out.append(0); f=0
        for b in range(8):
            if i>=n: break
            ch=choice[i]
            if ch:
                l,d=ch; v=((l-3)<<12)|(d-1); out+=bytes([v>>8,v&255]); f|=0x80>>b; i+=l
            else:
                out.append(data[i]); i+=1
        out[flag_at]=f
    while len(out)%4: out.append(0)
    return bytes(out)
def lz77_dec(r,a=0):
    n=r[a+1]|r[a+2]<<8|r[a+3]<<16; out=bytearray(); i=a+4
    while len(out)<n:
        f=r[i]; i+=1
        for b in range(8):
            if len(out)>=n: break
            if f&(0x80>>b):
                x=r[i]<<8|r[i+1]; i+=2; l=(x>>12)+3; d=(x&0xFFF)+1
                for _ in range(l): out.append(out[-d])
            else: out.append(r[i]); i+=1
    return bytes(out)
def tiles4(idx,w,h):
    out=bytearray()
    for ty in range(h//8):
        for tx in range(w//8):
            for y in range(8):
                for x in range(0,8,2):
                    a=idx[(ty*8+y)*w+tx*8+x]; b=idx[(ty*8+y)*w+tx*8+x+1]; out.append(a|b<<4)
    return bytes(out)
