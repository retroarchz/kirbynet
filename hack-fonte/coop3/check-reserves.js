// Invoke the ROM's real HasNoMonsToSwitch through a one-shot callback.
// Test RAM is restored after each case; original save files are never written.
module.exports=W=>{
  const m=W.players[0].g.ram(0),start=0x0203FF00,orig=0x0203FF90,args=0x0203FF94,result=0x0203FFA0;
  const words=[],lits=[],branches=[],labels={};
  const h=x=>words.push(x),ldr=(reg,value)=>{lits.push({i:words.length,reg,value});h(0);};
  const w32=(a,v)=>{m.w16(a,v&65535);m.w16(a+2,v>>>16);};
  h(0xB510);ldr(4,0x03002660);ldr(1,orig);h(0x6808);h(0x6020);ldr(1,args);h(0x7808);h(0x2106);h(0x2206);ldr(3,0x080519D1);
  branches.push(words.length);h(0);h(0);ldr(1,result);h(0x6008);h(0xBC10);h(0xBC08);h(0x4718);
  labels.call=start+words.length*2;h(0x4718);
  if(words.length&1)h(0x46C0);
  for(const fix of lits){const at=start+words.length*2;words[fix.i]=0x4800|(fix.reg<<8)|((at-((start+fix.i*2+4)&~3))>>2);h(fix.value&65535);h(fix.value>>>16);}
  for(const i of branches){const off=labels.call-(start+2*i+4);words[i]=0xF000|((off>>12)&2047);words[i+1]=0xF800|((off>>1)&2047);}
  words.forEach((v,i)=>m.w16(start+2*i,v));
  const call=b=>{w32(orig,m.r32(0x03002660));m.w8(args,b);w32(result,0xFFFFFFFF);w32(0x03002660,start|1);W.step([]);return m.r32(result);};
  const saved=Array.from({length:6},(_,i)=>{const p=0x020235CC+i*0x68;return [m.r8(p+0x22),m.r8(p+0x23),m.r8(p+0x24),m.r16(p+0x5A)];});
  const hp=(i,h)=>{const p=0x020235CC+i*0x68;m.w8(p+0x22,(m.r8(p+0x22)&63)|((h>>>10)<<6));m.w8(p+0x23,h&255);m.w8(p+0x24,(m.r8(p+0x24)&252)|((h>>>8)&3));m.w16(p+0x5A,h);};
  for(const b of [0,2,4]){
    for(let i=0;i<6;i++)hp(i,i===b||i===b+1?0:10);
    const noReserve=call(b);
    hp(b+1,10);
    const reserve=call(b);
    console.log('PLAYER',b/2+1,'no healthy mon:',noReserve,'healthy reserve:',reserve);
    if(noReserve!==1||reserve!==0)throw Error('Own-pair reservation check failed');
  }
  for(let i=0;i<6;i++){const p=0x020235CC+i*0x68;const s=saved[i];m.w8(p+0x22,s[0]);m.w8(p+0x23,s[1]);m.w8(p+0x24,s[2]);m.w16(p+0x5A,s[3]);}
  console.log('PASS all three native reserve checks');
};
