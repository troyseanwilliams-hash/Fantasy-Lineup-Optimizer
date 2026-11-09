import { test, expect } from "@playwright/test";
import { csvText, readCsv } from "../../shared/nfl-gpp-csv";
import type { Download } from "@playwright/test";

const positions = ["QB","RB","RB","WR","WR","WR","TE","TE","K","DST"];
const salaries = [10000,8800,3800,9600,6400,3200,5600,2200,4400,4000];
const projections = [21,18,7,19,13,6,11,5,8,7];
const rows = ["AAA","BBB"].flatMap((team,t)=>positions.map((pos,i)=>
  [`${team} Player ${i}`,pos,team,salaries[i]*1.5,salaries[i],projections[i]+t,5+i,17+i]));
const sheet = csvText([["Player","Position","Team","CPT salary","FLEX salary","Projection","CPT ownership %","FLEX ownership %"],...rows]);
const official = csvText([["Position","Name","ID","Roster Position","Salary","TeamAbbrev"],
  ...rows.flatMap((r,i)=>[[r[1],r[0],1000+i,"FLEX",r[4],r[2]],[r[1],r[0],2000+i,"CPT",r[3],r[2]]])]);
const file = (name:string,text:string)=>({name,mimeType:"text/csv",buffer:Buffer.from(text)});
async function contents(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("No download stream");
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return Buffer.concat(parts).toString("utf8");
}
test.beforeEach(async ({page})=>{
  await page.route("**/api/**", async route=>{
    const path=new URL(route.request().url()).pathname;
    await route.fulfill({json:path==="/api/auth/user"?{id:"gpp-browser-test",firstName:"Test",tutorialDisabled:true}:
      path==="/api/subscription"?{tier:"pro"}:path==="/api/alerts"?{alerts:[],unreadCount:0}:[]});
  });
});
test("sheet build, official-template export, input invalidation and standing exclusions",async({page},info)=>{
  await page.goto("/nfl-gpp");
  await page.getByLabel("Showdown cheat sheet CSV",{exact:true}).setInputFiles(file("sheet.csv",sheet));
  await page.getByRole("button",{name:"Build 20 offline lineups"}).click();
  await expect(page.getByText("20 lineups. Ready for review.",{exact:true})).toBeVisible({timeout:30000});
  const reportDownload=page.waitForEvent("download");
  await page.getByRole("button",{name:"Report CSV",exact:true}).click();
  const report=readCsv(await contents(await reportDownload));
  expect(report).toHaveLength(21);
  expect(report.slice(1).every(r=>Number(r[7])<=50000 && Number(r[9])<=190)).toBeTruthy();
  await page.getByLabel("Official DraftKings template CSV").setInputFiles(file("official.csv",official));
  await expect(page.getByText("20 lineups. Ready for review.",{exact:true})).toBeVisible();
  const dkDownload=page.waitForEvent("download");
  await page.getByRole("button",{name:/DK upload/i}).click();
  const dk=readCsv(await contents(await dkDownload));
  expect(dk[0]).toEqual(["Entry ID","CPT","FLEX","FLEX","FLEX","FLEX","FLEX"]);
  expect(dk.slice(1).every(r=>Number(r[1])>=2000 && r.slice(2).every(id=>Number(id)>=1000&&Number(id)<2000))).toBeTruthy();
  await page.screenshot({path:`/tmp/nfl-gpp-${info.project.name}.png`});
  await page.getByLabel("Reproducible seed").fill("changed-seed");
  await expect(page.getByText("20 lineups. Ready for review.",{exact:true})).toHaveCount(0);
  await page.getByLabel("Shared workbench exclusion: AAA Player 5",{exact:true}).check();
  await page.reload();
  await page.getByLabel("Showdown cheat sheet CSV",{exact:true}).setInputFiles(file("sheet.csv",sheet));
  await expect(page.getByLabel("Shared workbench exclusion: AAA Player 5",{exact:true})).toBeChecked();
  await expect(page.getByLabel("AAA Player 5 flexMinimums",{exact:true})).toHaveValue("0");
});
test("Classic exposure audit requires approval and preserves entry metadata",async({page})=>{
  const pool = ["QB","RB","WR","TE","DST"].flatMap((pos,p)=>Array.from({length:20},(_,i)=>({
    name:`${pos} ${i}`,pos,id:String(10000+p*20+i),salary:pos==="DST"?3000:5000,team:i%2?"AAA":"BBB",
  })));
  const template=csvText([["Name","ID","Position","TeamAbbrev","Roster Position","Salary"],
    ...pool.map(p=>[p.name,p.id,p.pos,p.team,p.pos,p.salary])]);
  const base=["QB","RB","RB","WR","WR","WR","TE","TE","DST"].map((pos,i)=>pool.filter(p=>p.pos===pos)[i].id);
  const entries=csvText([["Entry ID","QB","RB","RB","WR","WR","WR","TE","FLEX","DST"],
    ...Array.from({length:20},(_,i)=>[9000+i,...base])]);
  await page.goto("/nfl-gpp?tab=classic");
  await page.getByLabel("Classic official salary CSV",{exact:true}).setInputFiles(file("classic-official.csv",template));
  await page.getByLabel("Classic final entry CSV",{exact:true}).setInputFiles(file("entries.csv",entries));
  await page.getByRole("button",{name:"Audit final entries",exact:true}).click();
  await expect(page.getByRole("button",{name:"Download revised CSV",exact:true})).toBeDisabled();
  await expect(page.getByText("Lineup 21",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:/Approve \d+ proposed swaps/}).click();
  const downloaded=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download revised CSV",exact:true}).click();
  const revised=readCsv(await contents(await downloaded));
  expect(revised).toHaveLength(21); expect(revised[1][0]).toBe("9000");
  const count=new Map<string,number>();
  for(const row of revised.slice(1)) for(const id of row.slice(1)) count.set(id,(count.get(id)||0)+1);
  for(const p of pool) expect(count.get(p.id)||0).toBeLessThanOrEqual(["QB","DST"].includes(p.pos)?4:5);
  // Approval cannot survive another upload.
  await page.getByLabel("Classic final entry CSV",{exact:true}).setInputFiles(file("small.csv",csvText([revised[0],revised[1],revised[2]])));
  await page.getByRole("button",{name:"Audit final entries",exact:true}).click();
  await expect(page.getByRole("button",{name:"Download revised CSV",exact:true})).toBeDisabled();
  await expect(page.getByText(/Unresolved violations: approval/)).toBeVisible();
});
