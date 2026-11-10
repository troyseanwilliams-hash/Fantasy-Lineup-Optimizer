import { spawn } from "node:child_process";

/** HiGHS runs in a killable process; all returned values are audited by callers. */
export async function solveClassicModel(model: any, timeoutMs: number): Promise<{result?: any; timedOut: boolean}> {
  if(timeoutMs < 100) return {timedOut:true};
  const names=Object.keys(model.variables);
  const rows:Record<string,string[]>={};
  const objective:string[]=[];
  const term=(n:number,i:number)=>`${n<0?"-":"+"} ${Math.abs(n)} x${i}`;
  names.forEach((name,i)=>{
    const v=model.variables[name];
    if(v[model.optimize]) objective.push(term(v[model.optimize],i));
    for(const [key,value] of Object.entries(v)) if(key in model.constraints && value)
      (rows[key]??=[]).push(term(Number(value),i));
  });
  const lines=[model.opType==="min"?"Minimize":"Maximize",` obj: ${objective.join(" ") || "0 x0"}`,"Subject To"];
  let row=0;
  for(const [key,raw] of Object.entries(model.constraints)){
    const b=raw as any, expr=rows[key]?.join(" ")||"0 x0";
    if(b.equal!==undefined) lines.push(` c${row++}: ${expr} = ${b.equal}`);
    else {
      if(b.min!==undefined) lines.push(` c${row++}: ${expr} >= ${b.min}`);
      if(b.max!==undefined) lines.push(` c${row++}: ${expr} <= ${b.max}`);
    }
  }
  lines.push("Bounds",...names.map((_,i)=>` x${i} >= 0`),"Generals",
    names.flatMap((name,i)=>model.ints?.[name] ? [`x${i}`]:[]).join(" "),"End");
  const script=`let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",s=>input+=s);
process.stdin.on("end",async()=>{try{const p=JSON.parse(input);const h=await require("highs")();
const r=h.solve(p.lp,{output_flag:false,time_limit:p.seconds});
process.stdout.write(JSON.stringify(r));}catch(e){process.stderr.write(String(e));process.exitCode=1;}});`;
  return new Promise(resolve=>{
    const child=spawn(process.execPath,["-e",script],{stdio:["pipe","pipe","pipe"]});
    let output="",settled=false;
    const finish=(r:{result?:any;timedOut:boolean})=>{if(settled)return;settled=true;clearTimeout(timer);resolve(r);};
    const timer=setTimeout(()=>{child.kill("SIGKILL");finish({timedOut:true});},timeoutMs);
    child.stdout.on("data",s=>output+=s);child.stderr.on("data",()=>{});
    child.on("error",()=>finish({timedOut:false}));
    child.on("close",()=>{
      try{
        const r=JSON.parse(output);
        console.log(`[Classic MIP] ${names.length} variables: ${r.Status}`);
        const values:any={feasible:["Optimal","Time limit reached","Iteration limit reached"].includes(r.Status),isIntegral:true};
        names.forEach((name,i)=>{values[name]=r.Columns?.[`x${i}`]?.Primal ?? NaN;});
        finish({result:values,timedOut:r.Status==="Time limit reached"});
      }catch{finish({timedOut:false});}
    });
    child.stdin.end(JSON.stringify({lp:lines.join("\n"),seconds:Math.max(.01,(timeoutMs-250)/1000)}));
  });
}
