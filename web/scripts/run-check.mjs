// Runs one check and, when it fails, reports the end of its output as a GitHub annotation,
// so the reason is visible on the pull request without opening the full log.
// Usage: node scripts/run-check.mjs <command> [args…]
import {spawn} from 'node:child_process';
const [command,...args]=process.argv.slice(2);
if(!command){console.error('Usage: node scripts/run-check.mjs <command> [args…]');process.exit(2);}
const name=[command==='node'?'':command,...args].filter(Boolean).join(' ');
const output=[];
const child=spawn(command,args,{stdio:['inherit','pipe','pipe'],env:process.env});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{(stream===child.stdout?process.stdout:process.stderr).write(chunk);output.push(chunk.toString());});
child.on('close',code=>{
 if(code!==0&&process.env.GITHUB_ACTIONS){
  // Strip colour codes; keep the last 60 lines; escape for workflow commands.
  const tail=output.join('').replace(/\x1b\[[0-9;]*m/g,'').split('\n').filter(line=>line.trim()).slice(-60).join('\n');
  const escape=text=>text.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
  console.log(`::error title=${escape(name).replace(/[:,]/g,' ')} failed::${escape(tail||'No output')}`);
 }
 process.exit(code??1);
});
