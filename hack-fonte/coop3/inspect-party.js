module.exports=W=>{
  W.shot('party-before.png');
  for(const [name,plan] of [['b',[[1,'B'],[90]]],['b2',[[1,'B'],[30]]],['down',[[1,'R'],[20]]],['a',[[1,'A'],[40]]],['a2',[[1,'A'],[200]]],['a3',[[1,'A'],[400]]]]){
    W.play(plan);W.shot('party-'+name+'.png');
    console.log(name,W.f,W.players.map(p=>{let m=p.g.ram(0);return [m.r32(0x03002664).toString(16),m.r32(0x02023040).toString(16),m.r32(0x0203FA00).toString(16)];}));
  }
};
