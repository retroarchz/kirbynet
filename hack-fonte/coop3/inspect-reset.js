module.exports = (W) => {
  const p=W.players[0], m=p.g.ram(0);
  for(let k=0;k<800;k++){
    W.step(k%40===0?['A','A','A']:[]);
    const cpu=m.cpu(), pc=cpu[15];
    if(k%20===0)console.log('AT',W.f,'pc',pc.toString(16),'lr',cpu[14].toString(16),'main',m.r32(0x03005504).toString(16),'script',m.r32(0x0202320C).toString(16),'action',m.r8(0x0202305A),m.r8(0x0202305B),'outcome',m.r8(0x020233A4));
    if(pc>=0x080003A4&&pc<=0x080003AA){
      console.log('RESET ENTRY',W.f,cpu.map(x=>x.toString(16)));
      console.log('STACK',Array.from({length:100},(_,i)=>m.r32(0x03007E00+4*i).toString(16)));
      W.shot('reset-entry.png');
      break;
    }
  }
};
