module.exports=W=>{
  const m=W.players[0].g.ram(0);let a=m.r32(0x03000004);
  const hex=a=>a.toString(16),seen=new Set();
  for(let n=0;n<100&&!seen.has(a)&&a>=0x02000000&&a<0x0201C000;n++){
    seen.add(a);console.log('BLOCK',hex(a),'flag',m.r16(a),'size',hex(m.r32(a+4)),'prev',hex(m.r32(a+8)),'next',hex(m.r32(a+12)));
    a=m.r32(a+12);
  }
  for(const addr of [0x0202352C,0x02023538,0x02023570,0x02023574])console.log('PTR',hex(addr),hex(m.r32(addr)));
};
