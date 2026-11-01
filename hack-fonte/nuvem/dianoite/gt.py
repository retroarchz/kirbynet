import json
J=json.load(open('ter.json'))
h=lambda s:[int(s[i:i+2],16) for i in (0,2,4)]
R=lambda *a:[h(x) for x in a]
CEU_T=R('ffd2a0','fbc893','f5b583','ee9f75','e68a6c','d9746a')
CEU_N=R('2b3558','28325a','232c52','1e2748','1a213f','161c36')
CH={0:(R('d8bb62','bda24e','a08a40','7d6f34','5f5a2c'),R('5a8a52','4a734a','395a3c','274430','183418')),
1:(R('b3a24c','93883e','776f32','5b5a2a','454722'),R('4f7c48','3f6640','2f5034','203e28','14301a')),
2:(R('f0c476','dca85e','c28a4a','a06c3a','7e5430'),R('8c7a56','75664a','5e523e','483f32','342e28')),
4:(R('8fb0b8','6c96a8','517c96','3f6484','324f6e'),R('3f6fc0','2d57a8','21448e','183472','122858')),
5:(R('8fb0b8','6c96a8','517c96','3f6484','324f6e'),R('3f6fc0','2d57a8','21448e','183472','122858')),
6:(None,R('7c7288','665e74','524c60','3f3a4c','2e2b3a')),
9:(R('dcc07c','c4a765','a68c50','84703f','675832'),R('66825a','54704c','425a40','304634','203424'))}
GR_N=CH[0][1]
lum=lambda c:.3*c[0]+.59*c[1]+.11*c[2]
c15=lambda c:(c[0]>>3)|((c[1]>>3)<<5)|((c[2]>>3)<<10)
def rampa(r,f):
    x=f*(len(r)-1);a=int(x);b=min(a+1,len(r)-1);t=x-a
    return [round(r[a][k]*(1-t)+r[b][k]*t) for k in range(3)]
T={}
for t,d in J.items():
    t=int(t);ceu=d['ceu'][:6];chao=d['ceu'][6:]+d['chao']
    tab={}
    ord_=sorted(ceu,key=lum,reverse=True)
    for i,c in enumerate(ord_):tab[c15(c)]=[CEU_T[i] if t!=6 else None,CEU_N[i]]
    if t==5:
        v=[c for c in chao if c[1]>c[2]+8];a=[c for c in chao if c not in v]
        gr=[(c,CH[0]) for c in v];ag=[(c,CH[4]) for c in a]
        for lst in (v,a):
            r=CH[0] if lst is v else CH[4]
            ss=sorted(lst,key=lum,reverse=True)
            for i,c in enumerate(ss):
                f=.55*i/max(1,len(ss)-1);tab[c15(c)]=[rampa(r[0],f),rampa(GR_N if lst is v else r[1],f*(1.45 if lst is v else 1))]
    else:
        ss=sorted(chao,key=lum,reverse=True)
        for i,c in enumerate(ss):
            f=.55*i/max(1,len(ss)-1);tab[c15(c)]=[rampa(CH[t][0],f) if CH[t][0] else None,rampa(CH[t][1],f*(1 if t==4 else 1.45))]
    T[t]=tab
json.dump(T,open('terr_tab.json','w'),separators=(',',':'))
s=open(r'C:\Users\Sandro\Downloads\kirbynet-site-retroarchz\dianoite.js',encoding='utf8',newline='').read()
def tr(k,n):
    global s
    assert s.count(k)==1,k
    s=s.replace(k,n)
if 'const TERRENOS' in s:
    a=s.index('  const TERRENOS = ');b=s.index('\n',a);s=s[:a]+'  const TERRENOS = '+json.dumps(T,separators=(',',':'))+';'+s[b:]
else:
    tr("  function create(ram, modo, min) {\n","  // Cada terreno com céu e chão desenhados à parte: degradê do céu e tons do material, por cor exata [tarde, noite]\n  const TERRENOS = "+json.dumps(T,separators=(',',':'))+";\n  function create(ram, modo, min) {\n")
    tr("        if (bat) { t = luz(p, TARDE_LUZ); v = luz(p, NOITE_LUZ); }  // batalha: céu e chão sob a mesma luz\n","""        if (bat) {
          t = luz(p, TARDE_LUZ); v = luz(p, NOITE_LUZ);
          const e = (TERRENOS[terreno] || {})[c & 0x7FFF];
          if (e) { if (e[0]) t = e[0]; v = e[1]; }
        }
""")
    tr("    const cache = new Map(); let passo = -1;\n","    const cache = new Map(); let passo = -1, terreno = -1;\n")
    tr("      if (SEM_CEU.has(ram.r8(A.terreno)) || (!a && !n)) return;\n","      const te = ram.r8(A.terreno);\n      if (SEM_CEU.has(te) || (!a && !n)) return;\n      if (te !== terreno) { terreno = te; cache.clear(); fundo.fill(0); }\n")
open(r'C:\Users\Sandro\Downloads\kirbynet-site-retroarchz\dianoite.js','w',encoding='utf8',newline='').write(s)
