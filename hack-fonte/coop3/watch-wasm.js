// Diagnostic copy only: trap writes that corrupt the battler controller table.
const fs = require('fs');
const wabtFactory = require('C:/Users/Sandro/AppData/Local/Temp/coop3-debug-tools/node_modules/wabt');
(async () => {
  const wabt = await wabtFactory();
  const mod = wabt.readWasm(fs.readFileSync(process.argv[2]), { readDebugNames: true });
  mod.generateNames(); mod.applyNames();
  let wat = mod.toText({ foldExprs: false, inlineExport: false });
  fs.writeFileSync(process.argv[3] + '.original.wat', wat);
  let count = 0;
  // Two scratch locals per function, inserted after its existing declarations.
  wat = wat.replace(/  \(func ([\s\S]*?)(?=\n  \((?:func|table|memory|global|export|elem|data)|\n\)$)/g, (whole) => {
    let lines = whole.split('\n');
    if (lines[0].endsWith('))')) return whole;
    let first = 1;
    while (first < lines.length && /^    \(local /.test(lines[first])) first++;
    lines.splice(first, 0, '    (local $watch_a i32) (local $watch_v i32) (local $watch_n i32) (local $watch_v64 i64)');
    const body = lines.join('\n').replace(/^([ \t]*)(memory\.copy|memory\.fill)(\)?)$/gm, (_, s, op, close) => {
      return `${s}local.set $watch_n\n${s}local.set $watch_v\n${s}local.set $watch_a\n${s}local.get $watch_a\n${s}local.get $watch_v\n${s}local.get $watch_n\n${s}call $watch_check\n${s}local.get $watch_a\n${s}local.get $watch_v\n${s}local.get $watch_n\n${s}${op}${close}`;
    });
    return body.replace(/^([ \t]*)(i32\.store(?:8|16)?|i64\.store)([^\n]*)$/gm, (_, space, op, args) => {
      count++;
      const off = +(args.match(/offset=(\d+)/)?.[1] || 0);
      const wide = op === 'i64.store';
      const val = wide ? '$watch_v64' : '$watch_v';
      const size = wide ? 8 : op === 'i32.store' ? 4 : op === 'i32.store16' ? 2 : 1;
      const close = args.endsWith(')') ? ')' : '';
      if (close) args = args.slice(0, -1);
      return `${space}local.set ${val}\n${space}local.set $watch_a\n${space}local.get $watch_a\n${space}i32.const ${off}\n${space}i32.add\n${space}local.get ${val}\n${wide?`${space}i32.wrap_i64\n`:''}${space}i32.const ${size}\n${space}call $watch_check\n${space}local.get $watch_a\n${space}local.get ${val}\n${space}${op}${args}${close}`;
    });
  });
  const injection = `
  (global $watch_start (export "watch_start") (mut i32) (i32.const 0))
  (global $watch_length (export "watch_length") (mut i32) (i32.const 24))
  (global $watch_addr (export "watch_addr") (mut i32) (i32.const 0))
  (global $watch_value (export "watch_value") (mut i32) (i32.const 0))
  (global $watch_pc (export "watch_pc") (mut i32) (i32.const 0))
  (func $watch_check (param $a i32) (param $v i32) (param $n i32)
    global.get $watch_pc
    local.get $a
    i32.eq
    if
      local.get $v
      i32.const 532
      i32.eq
      local.get $v
      i32.const 536
      i32.eq
      i32.or
      if
        global.get $watch_pc
        i32.const 56
        i32.sub
        i32.load
        i32.const 50364416
        i32.ge_u
        global.get $watch_pc
        i32.const 56
        i32.sub
        i32.load
        i32.const 67108864
        i32.lt_u
        i32.and
        if
          local.get $a
          global.set $watch_addr
          global.get $watch_pc
          i32.const 56
          i32.sub
          i32.load
          global.set $watch_value
          unreachable
        end
      end
      local.get $v
      i32.const 4
      i32.lt_u
      local.get $v
      i32.const 134217728
      i32.ge_u
      local.get $v
      i32.const 134218308
      i32.lt_u
      i32.and
      i32.or
      if
        local.get $a
        global.set $watch_addr
        local.get $v
        global.set $watch_value
        unreachable
      end
    end
    global.get $watch_start
    if
      local.get $a
      local.get $n
      i32.add
      global.get $watch_start
      i32.gt_u
      local.get $a
      global.get $watch_start
      global.get $watch_length
      i32.add
      i32.lt_u
      i32.and
      if
        local.get $v
        i32.const 24
        i32.shr_u
        i32.const 8
        i32.ne
        local.get $n
        i32.const 4
        i32.ne
        i32.or
        if
          local.get $a
          global.set $watch_addr
          local.get $v
          global.set $watch_value
          unreachable
        end
      end
    end)
`;
  wat = wat.replace(/\)\s*$/, injection + ')');
  fs.writeFileSync(process.argv[3] + '.wat', wat);
  const instrumented = wabt.parseWat('watch.wat', wat);
  const binary = instrumented.toBinary({ write_debug_names: true });
  fs.writeFileSync(process.argv[3], Buffer.from(binary.buffer));
  console.log('Instrumented stores:', count);
})().catch(e => { console.error(String(e).slice(0, 6000)); process.exitCode = 1; });
