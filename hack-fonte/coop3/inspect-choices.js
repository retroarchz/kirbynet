module.exports=W=>{
  W.players.forEach((p,j)=>{const m=p.g.ram(0),res=m.r32(0x02023538),buf=res+0x24+2*j*0x200;
    console.log('P',j+1,'cmd',m.r8(buf),'ctrl',m.r32(0x0203FA00+8*j).toString(16),'action cursor',m.r8(0x0203FA38+2*j),'move cursor',m.r8(0x0203FA40+2*j),'exec',m.r32(0x02023040).toString(16),'payload',Array.from({length:32},(_,i)=>m.r8(buf+i)));
  });W.shot('choices.png');
};
