const fs=require('fs'),path=require('path'),v8=require('v8');
module.exports=(W,{runtime})=>{
  const menuFrame=W.players.map(()=>0);let lastMain, rounds=0;
  if(process.env.EXHAUST_P1){
    // Quetzal stores HP in packed BoxPokemon bytes as well as its party cache.
    W.players.forEach(p=>{const r=p.g.ram(0),a=0x020235CC+0x68;r.w8(a+0x22,r.r8(a+0x22)&63);r.w8(a+0x23,0);r.w8(a+0x24,r.r8(a+0x24)&252);r.w16(a+0x5A,0);});
    console.log('FIXTURE P1 reserve fainted');
  }
  const heapError=m=>{
    const root=m.r32(0x03000004),seen=new Set();let a=root;
    for(let i=0;i<2000;i++){
      if(seen.has(a))return a===root?null:'heap cycle';
      if(a<0x02000000||a>=0x0201C000||(a&3))return 'heap pointer '+a.toString(16);
      seen.add(a);
      if(m.r16(a)>1||m.r32(a+4)>0x1C000)return 'heap header '+a.toString(16);
      a=m.r32(a+12);
    }
    return 'heap block limit';
  };
  for(let k=0;k<+(process.env.FRAMES||30000);k++){
    const keys=W.players.map((p,j)=>{
      const m=p.g.ram(0),ctrl=m.r32(0x0203FA00+4*(2*j)),cb=m.r32(0x03002664);
      if(ctrl===0x08090A0D&&cb!==0x0803F431){
        const t=menuFrame[j]++;
        if(t===90){W.shot('party-'+j+'-'+W.f+'.png');console.log('PARTY MENU',W.f,j,'cb',cb.toString(16));}
        // P1's own reserve is the upper right slot; the lower left belongs to P2.
        if(t%180===100)return 'R';
        if(t%40===0&&t>110)return 'A';
        return '';
      }
      menuFrame[j]=0;
      const res=m.r32(0x02023538),buf=res+0x24+(2*j)*0x200;
      // Move input: choose a move with PP once the repeatedly tested move is exhausted.
      if(ctrl===0x0808E8ED&&k%20===0){
        const cursor=m.r8(0x0203FA40+2*j);
        const pp=Array.from({length:4},(_,i)=>m.r8(buf+12+i));
        const moves=Array.from({length:4},(_,i)=>m.r16(buf+4+2*i));
        let desired=pp[cursor]>0?cursor:pp.findIndex((p,i)=>p>0&&moves[i]);
        if(process.env.FINISH&&rounds>=+(process.env.FINISH)){
          for(let i=3;i>=0;i--)if(pp[i]>0&&moves[i]){desired=i;break;}
        }
        if(desired>=0&&cursor!==desired){
          if((cursor&1)!==(desired&1))return desired&1?'R':'L';
          return desired&2?'D':'U';
        }
      }
      return k%40===0?'A':'';
    });
    W.step(keys);
    const m=W.players[0].g.ram(0),main=m.r32(0x03005504);
    if(m.r32(0x03002664)===0x0803F431){const error=heapError(m);if(error)throw Error(error+' frame '+W.f);}
    if(main===0x08044CF9&&lastMain!==main){rounds++;console.log('CHOICE ROUND',rounds,'frame',W.f,'absent',m.r8(0x02023209).toString(16));W.shot('round-'+rounds+'.png');fs.writeFileSync(path.join(runtime,'round-'+rounds+'.snapshot'),v8.serialize(W.debugSnapshot()));}
    lastMain=main;
    if(k%1000===0){console.log('LONG',W.f,W.players.map(p=>{const r=p.g.ram(0);return [r.r32(0x03002664).toString(16),r.r32(0x03005504).toString(16),r.r32(0x02023040).toString(16),Array.from({length:5},(_,b)=>r.r16(0x0203F424+b*0x60+0x2A))];}));fs.writeFileSync(path.join(runtime,'long.snapshot'),v8.serialize(W.debugSnapshot()));}
    if((m.r32(0x0203FA00)>>>24)!==8){console.log('STOP controllers',W.f,m.cpu().map(x=>x.toString(16)));break;}
  }
  W.shot('long-end.png');
  fs.writeFileSync(path.join(runtime,'long-end.snapshot'),v8.serialize(W.debugSnapshot()));
  console.log('CHOICE ROUNDS OBSERVED',rounds);
};
