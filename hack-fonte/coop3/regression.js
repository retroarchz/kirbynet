// Replay Claude's two-player regression against qc9 to isolate the new change.
const fs=require('fs'),path=require('path'),Module=require('module');
const old=process.env.COOP3_BASE||'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad';
const filename=path.join(old,'qz/regressao.js');
let code=fs.readFileSync(filename,'utf8');
code=code.replace('A = await roda(null)', 'A = await roda(process.env.BASELINE)');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(code,filename);
