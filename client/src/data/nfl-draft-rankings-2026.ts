// ============================================================
// 2026 Fantasy Football Draft Rankings — EliteLineup AI
// Consensus-based seed rankings blended with our proprietary
// scoring model. Updated daily via the news-adjustment engine.
// ============================================================

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
export type Upside = "elite" | "high" | "medium" | "low";
export type RiskLevel = "high" | "medium" | "low";
export type ScoringFormat = "ppr" | "half" | "standard";

export interface DraftPlayer {
  id: number;
  rank: number;           // Our custom overall rank
  posRank: string;        // e.g. "RB1", "WR3"
  name: string;
  team: string;           // NFL team abbreviation
  position: Position;
  tier: number;           // 1 = transcendent, 2 = elite, ... 7 = speculative
  tierLabel: string;
  adp: number;            // Industry average draft position (consensus)
  analystRank: number;    // Consensus analyst rank (FantasyPros ECR)
  projPPR: number;        // Projected PPR season total pts
  projHalf: number;       // Half-PPR
  projStd: number;        // Standard
  upside: Upside;
  risk: RiskLevel;
  age: number;
  bye: number;
  reasoning: string;      // Full analytical paragraph
  strengths: string[];
  concerns: string[];
  tags: string[];         // "workhorse" | "handcuff" | "sleeper" | "injury-risk" | etc.
  isFree: boolean;        // rank <= 5 are free; rest require paid plan
}

const TIER_LABELS: Record<number, string> = {
  1: "Transcendent",
  2: "Elite",
  3: "Strong Starter",
  4: "Quality Starter",
  5: "Flex / Streamer",
  6: "Deep Stash",
  7: "Speculative",
};

function p(rank: number, posRank: string, name: string, team: string, pos: Position, tier: number, adp: number, analystRank: number, projPPR: number, projHalf: number, projStd: number, upside: Upside, risk: RiskLevel, age: number, bye: number, reasoning: string, strengths: string[], concerns: string[], tags: string[]): DraftPlayer {
  return {
    id: rank,
    rank,
    posRank,
    name,
    team,
    position: pos,
    tier,
    tierLabel: TIER_LABELS[tier] ?? "Speculative",
    adp,
    analystRank,
    projPPR,
    projHalf,
    projStd,
    upside,
    risk,
    age,
    bye,
    reasoning,
    strengths,
    concerns,
    tags,
    isFree: rank <= 5,
  };
}

// ─── TIER 1: TRANSCENDENT (Picks 1–5 · FREE) ─────────────────────────────────
// These five are universally agreed upon across every major analyst platform.

export const NFL_DRAFT_RANKINGS_2026: DraftPlayer[] = [

  p(1,"RB1","Bijan Robinson","ATL","RB",1,1.2,1,
    345,320,285,"elite","low",23,12,
    "Robinson enters 2026 as the consensus #1 overall pick after back-to-back dominant seasons. He runs as a true three-down workhorse in Arthur Smith's run-heavy scheme, consistently topping 300 carries while adding 80+ receptions out of the backfield. Atlanta's offensive line remains one of the league's best at creating lanes, and Robinson has shown elite contact balance, route-running ability, and goal-line dominance. His PPR floor is among the highest at the RB position — a week-to-week RB1 from September through January.",
    ["Three-down workhorse role","Elite pass-catcher — 80+ receptions","Top-5 OL in front of him","Consistent TD volume near goal line","Age 23 — prime athletic window"],
    ["Occasional ankle soreness","Atlanta's passing offense can limit ceiling weeks"],
    ["workhorse","bellcow","target-hog","safe-pick"]),

  p(2,"WR1","CeeDee Lamb","DAL","WR",1,2.1,2,
    340,325,295,"elite","low",25,7,
    "Lamb is the undisputed WR1 in professional football and in fantasy. His 2024–25 dominance — back-to-back 130+ catch, 1,700+ yard seasons with 15+ TDs — makes him the safest high-end WR1 in any format. Dallas's entire offensive identity runs through him with an elite snap count, route tree, and target share north of 30%. Dak Prescott keeps the passing game efficient, and Lamb's ability to line up everywhere gives him matchup immunity. He's a true pick-2 candidate depending on your draft position.",
    ["Massive target share (30%+)","Runs full route tree — slot and outside","Red-zone priority target","Consistent 130+ receptions","Elite YAC ability"],
    ["No real weaknesses — concerns are manufactured","Occasional double-team bracket coverage"],
    ["target-hog","elite-floor","td-dependent","safe-pick"]),

  p(3,"WR2","Ja'Marr Chase","CIN","WR",1,3.0,3,
    335,320,290,"elite","low",25,7,
    "Chase is the WR1 in every format where touchdowns are weighted heavily, and the WR2 in pure reception-heavy PPR leagues. His connection with Joe Burrow is among the best QB-WR duos in the league, and Chase has posted double-digit TDs in each of his last three seasons. Cincinnati's offense consistently ranks top-5 in pass attempts and Air Yards, and Chase sees 8–10 targets per game when healthy. He has the ball-tracking, route-running, and after-catch ability to function as the #1 receiver regardless of scheme.",
    ["10+ TD upside every season","Elite 50-50 ball winner","Connection with Burrow among best in NFL","Top-3 target share in a pass-heavy offense","Breakaway YAC ability"],
    ["Burrow injury history creates correlation risk","Bengals defense forces game scripts that may slow pace"],
    ["td-machine","target-hog","ceiling-play","safe-pick"]),

  p(4,"WR3","Justin Jefferson","MIN","WR",1,4.1,4,
    330,316,285,"elite","low",26,6,
    "Jefferson is the model of consistency among elite receivers. Even through his 2024 injury scare, he delivered top-3 WR seasons when available. The Vikings offense was reconstructed around JJ as its centerpiece, and the offensive line improvements give Sam Darnold or whoever Minnesota employs the time to throw. Jefferson's route running is technically elite — he creates separation through precision rather than raw speed, giving him longevity as a top receiver. A must-start WR1 from Week 1 through playoffs.",
    ["Elite separation rate — top-5 in NFL","Technically precise routes","Vikings offense built around him","130+ targets per season guaranteed","Consistent 1,400+ yards when healthy"],
    ["Injury history — missed games in 2024","Minnesota QB situation has uncertainty"],
    ["target-hog","safe-pick","elite-floor","route-technician"]),

  p(5,"RB2","Breece Hall","NYJ","RB",1,5.2,5,
    315,295,265,"elite","medium",23,12,
    "Hall has established himself as a franchise cornerstone in New York after his ACL return and the Jets' offensive retooling around him. He's a rare combination of burst, vision, and pass-catching ability that makes him viable in all three downs. The Jets have committed to making Hall the centerpiece of their offense, and he regularly sees 20+ touches per game. His receiving volume (60+ receptions) gives him a PPR ceiling few backs can match. At 23, he's entering his prime with multiple elite seasons ahead.",
    ["Elite burst and contact balance","60+ receptions add massive PPR value","Jets committed to him as the #1 option","Young — entering prime athletic window","Goal-line role secured"],
    ["ACL history — monitoring conditioning","Jets offense still developing around him","Limited backup quality if injured"],
    ["workhorse","target-hog","young-stud","ppr-specialist"]),

  // ─── TIER 2: ELITE (Picks 6–15 · PAID) ───────────────────────────────────

  p(6,"RB3","Christian McCaffrey","SF","RB",2,6.8,7,
    295,278,248,"elite","high",30,9,
    "When healthy, McCaffrey remains the most complete fantasy football player at any position. His 2023 historic season demonstrated his ceiling — over 2,200 scrimmage yards and 21 TDs. The risks are real: back-to-back injury-shortened seasons have dropped his ADP from top-2 to a discount. San Francisco's scheme maximizes his dual-threat value through route-running out of the backfield and jet sweeps. If you believe in the health (and the medical staff does), CMC at pick 6 may be the steal of your draft.",
    ["Peak potential is highest floor-to-ceiling ratio at any position","San Francisco offense is tailor-made for his skills","Route tree out of the backfield is elite","Elite pass protection — rarely comes off field"],
    ["Age 30 entering 2026","Back-to-back injury-shortened seasons","Elijah Mitchell lurking as handcuff"],
    ["elite-upside","injury-risk","all-purpose","age-concern"]),

  p(7,"WR4","Tyreek Hill","MIA","WR",2,7.5,8,
    310,296,268,"elite","low",32,10,
    "Hill continues to defy age with elite target share and separation ability. Miami's offense is built around his speed as a vertical threat and YAC monster. He's posted three consecutive 1,700+ yard seasons and remains the fastest route separator in the NFL. At 32, there's an age question but no performance decline — his snap counts remain high and Miami feeds him 9–11 targets per game. The Tua-Hill connection is one of the most efficient pass-catcher duos in the league.",
    ["Unmatched separation speed — still top-3","Miami targets him 9-11 times per game","Excellent at creating after-catch yardage","Three straight 1,700+ yard seasons"],
    ["Age 32 — cliff risk year-to-year","Tua's injury history creates correlation risk","Jaylen Waddle limits red-zone dominance"],
    ["speed-merchant","target-hog","age-concern","consistent-elite"]),

  p(8,"QB1","Josh Allen","BUF","QB",2,8.2,9,
    380,360,380,"elite","low",30,12,
    "Allen is the QB1 in fantasy football and has been for three consecutive seasons. His rushing volume (500+ yards, 10+ TDs annually) gives him a floor no other quarterback can match. Buffalo's offense is pass-heavy with a revamped receiving corps, and Allen's mobility makes every play an extended opportunity. He posts QB1 numbers in all formats but his value is maximized in PPR leagues where his rushing TDs count equally. Taking Allen at pick 8 gives you a QB1 locked in for all 17 regular season weeks.",
    ["500+ rushing yards and 10+ rushing TDs every season","Most consistent fantasy QB three years running","Buffalo offense is pass-heavy","Elite red-zone efficiency"],
    ["Worth questioning if you take him early vs. late","Injuries possible with rushing volume","Wide receiver group evolving"],
    ["dual-threat","safe-pick","rushing-floor","early-qb"]),

  p(9,"QB2","Lamar Jackson","BAL","QB",2,9.1,10,
    365,345,365,"elite","medium",29,14,
    "Jackson is the highest-ceiling fantasy QB when accounting for rushing yards. His 1,200+ rushing yard seasons with 10+ rushing TDs make him a weekly must-start who rarely has a negative game. Baltimore's offense is built specifically for his dual-threat skill set, and defensive coordinators still struggle to contain him. The primary risk is injury via contact — running QBs statistically see more bangs than pocket passers. But when Jackson plays all 17 games, he competes for the overall QB1 crown.",
    ["1,200+ rushing yards annually","Elite rushing TDs from QB position","Baltimore offense fully optimized for him","Consistent 40+ fantasy point ceiling weeks"],
    ["Rushing style creates injury exposure","Baltimore's passing game can be inconsistent in cold weather","Ravens often run-script limits passing ceiling"],
    ["dual-threat","rushing-floor","injury-risk","ceiling-play"]),

  p(10,"RB4","Jahmyr Gibbs","DET","RB",2,10.4,11,
    295,280,252,"elite","low",23,5,
    "Gibbs has emerged as the lead back in Detroit's prolific offense after earning the workhorse role outright. Detroit's offense — one of the most explosive in the NFL — gives him massive opportunity against the run. His receiving role (70+ targets) is elite for a running back, and his contact balance makes him dangerous on every touch. With David Montgomery's workload declining, Gibbs sees 18–22 carries plus receptions weekly. At 23, he's an ascending player in the perfect offensive environment.",
    ["Detroit offense is consistently top-3 in scoring","Elite receiving role — 70+ targets","Young at 23 with ceiling still rising","Sheds tackles — elite YAC ability"],
    ["David Montgomery exists as vulture at goal line","Lions may reduce carries if they lead big"],
    ["workhorse","target-hog","young-stud","td-risk"]),

  p(11,"RB5","De'Von Achane","MIA","RB",2,11.8,12,
    285,270,240,"elite","medium",23,10,
    "Achane's explosiveness makes him one of the most exciting backs in fantasy football — he broke rushing records in his rookie season and has only improved. The question is workload: Miami splits carries with Raheem Mostert/other backs and Achane's ceiling is capped in goal-line situations. But his yards-per-carry and receiving versatility make him a weekly home-run threat. When he's the clear lead back with 18+ carries, he can win your week single-handedly. In Miami's fast-paced offense, his upside is legitimate top-5 overall.",
    ["Blazing speed — fastest back in NFL","Explosive receiver out of backfield","Miami offense is fast-paced and high-scoring","Elite yards per touch (6.0+)"],
    ["Workload concerns — timeshare risk","Limited goal-line role","Injury risk with explosive style"],
    ["speed-merchant","ceiling-play","workload-risk","ppr-specialist"]),

  p(12,"WR5","Amon-Ra St. Brown","DET","WR",2,12.9,13,
    295,281,254,"high","low",26,5,
    "St. Brown is a slot machine — in the literal fantasy sense. Detroit's offense funnels targets his way at an elite rate (130+), and his PPR floor is among the highest at his position. He runs precise routes from the slot that generate consistent separation, and Jared Goff's quick release is a perfect match for his style. St. Brown doesn't have elite downfield speed but he doesn't need it: his yards after catch, route-running, and rapport with Goff make him a borderline WR1 every week.",
    ["130+ targets in consecutive seasons","Elite PPR floor — rarely scores under 10 pts","Detroit offense is prolific and pass-heavy","Goff targets him in key moments"],
    ["Limited red-zone and downfield targets","Speed limits ceiling in big-play games","Gibbs and Penei Sewell could limit game scripts"],
    ["ppr-specialist","slot-monster","safe-pick","floor-player"]),

  p(13,"TE1","Sam LaPorta","DET","TE",2,13.5,14,
    220,210,195,"elite","low",24,5,
    "LaPorta broke the tight end target record for a second-year player and has positioned himself as the new face of elite fantasy TE production. Detroit's offense naturally creates mismatches for him as defenses account for Gibbs, St. Brown, and now LaPorta — he sees consistent 8–10 targets per game in favorable matchups. His route-running is advanced for his age, and his blocking has improved enough that he stays on the field all three downs. LaPorta at pick 13 gives you a positional scarcity advantage for the rest of your draft.",
    ["Positional scarcity advantage over the field","120+ targets as the Detroit TE — elite","Detroit offense creates consistent matchups","Young at 24 — improving every year"],
    ["TE has limited back-end depth elsewhere","Detroit may add another weapon"],
    ["elite-te","positional-scarcity","target-hog","young-stud"]),

  p(14,"TE2","Brock Bowers","LV","TE",2,14.2,15,
    215,204,188,"elite","medium",22,6,
    "Bowers is the most talented receiving tight end since Gronkowski in terms of pure physical tools. His first NFL season confirmed the hype — he was immediately a target hog in Las Vegas despite an otherwise thin offense. As the Raiders' offensive pieces improve around him, his floor rises with them. More importantly: at 22 years old, Bowers is just entering his prime. His ceiling is the best at the TE position, and drafting him now means you're buying in before peak value. High-end TE1.",
    ["Exceptional receiving talent — generational athleticism","Elite separation from TE position","Las Vegas builds offense around him","Age 22 — best years ahead"],
    ["Raiders offense is still developing","QB uncertainty in Las Vegas creates risk","Injury concern — plays through contact"],
    ["elite-te","positional-scarcity","young-stud","ceiling-play"]),

  p(15,"WR6","Drake London","ATL","WR",2,15.0,16,
    288,272,245,"high","low",24,12,
    "London has blossomed into a true WR1 in Atlanta's offense alongside Bijan Robinson. Atlanta is a balanced attack but London's size (6'4\") and contested-catch ability make him the clear red-zone threat and third-down option. He posted 1,400+ yards and 12+ TDs in 2025 and has locked in a leadership role in the offense. At 24, he's continuing to add nuance to his route tree while his physical tools remain second to none. A legitimate top-12 WR entering 2026.",
    ["Elite size and contested catch ability","Red-zone target — 12+ TDs annually","Atlanta offense feeds him in key situations","Still developing — ceiling still rising"],
    ["Atlanta run-first tendencies limit volume","Bye week 12 is late-season timing concern"],
    ["red-zone-threat","target-hog","young-stud","size-speed"]),

  // ─── TIER 3: STRONG STARTERS (Picks 16–30) ───────────────────────────────

  p(16,"RB6","Jonathan Taylor","IND","RB",3,16.4,17,
    275,260,232,"high","medium",27,14,
    "Taylor at his peak is arguably the best pure runner in the NFL. Indianapolis has built their entire offensive identity around his ability to carry the team, and he's shown he can be the every-down back when given the opportunity. The key questions are health — he missed multiple games in 2024 — and whether Indy's offensive line can stay healthy enough to create lanes. When Taylor is at full strength, he puts up genuine bellcow numbers that make him a top-8 overall pick. At a discount in the mid-rounds, he's a steal.",
    ["Best pure runner when healthy","Indianapolis commits 20-25 carries per game to him","Excellent pass-catcher — 50+ receptions viable","Goal-line priority"],
    ["Injury history — missed 10+ games in 2024","Indianapolis OL injury concerns","Anthony Richardson injury risk creates pass-volume limits"],
    ["bellcow","injury-risk","workhorse","boom-bust"]),

  p(17,"TE3","Travis Kelce","KC","TE",3,17.1,18,
    208,197,180,"high","medium",37,11,
    "Kelce at 37 is defying Father Time, though the statistical decline is real and undeniable. He's no longer the easy pick-15 slam dunk of years past. What he retains is an elite football IQ, route precision, and the most reliable QB-TE chemistry in the game — Patrick Mahomes targets him in critical moments. He'll still see 90+ targets and post respectable TE1 numbers, but the home-run ceiling weeks are rarer. In a deep tight end class, there's a reasonable argument he falls to TE4-5 in value, but name recognition keeps him at TE3 in consensus. Buy the floor, not the ceiling.",
    ["Mahomes connection — targets in key moments","Elite football IQ — route running still sharp","Red-zone familiarity and TD opportunities","Kansas City offense creates favorable game scripts"],
    ["Age 37 — statistical decline is real","Snap count may be managed late in season","Travis Hunter / other WRs limiting his share"],
    ["veteran","floor-player","age-concern","td-dependent"]),

  p(18,"TE4","Trey McBride","ARI","TE",3,18.5,19,
    200,189,172,"high","low",25,5,
    "McBride quietly emerged as one of the top receiving tight ends in football. Arizona runs a TE-friendly scheme that consistently funnels targets his way, and he's shown the receiving ability to capitalize — 100+ targets, 85+ receptions, and 900+ yards in consecutive seasons. With the Cardinals building around their young receiving core, McBride is the anchor of the passing attack. At 25 with several peak seasons ahead, he's a legitimate positional cornerstone in both redraft and dynasty formats.",
    ["100+ target pace — elite for TE position","Arizona offensive scheme is TE-friendly","Young at 25 — prime years ahead","Consistent 900+ receiving yards"],
    ["Arizona offense's inconsistent line play","Marvin Harrison Jr. limits red-zone opportunities"],
    ["elite-te","target-hog","young-stud","safe-pick"]),

  p(19,"WR7","Puka Nacua","LAR","WR",3,19.2,20,
    268,254,228,"high","low",24,6,
    "Nacua's breakthrough was no fluke — he's built on it with consecutive dominant seasons as the Rams' primary receiver. His ability to create separation and yards after catch in Sean McVay's scheme makes him a consistent 100+ target guy. Los Angeles runs a pass-first system that generates volume even when the rushing game struggles, and Nacua's rapport with Matthew Stafford is genuine. He's a true WR2 with WR1 weeks in the right matchups.",
    ["120+ target pace — elite volume","McVay scheme generates consistent production","Strong hands and YAC — not just a scheme product","Stafford-Nacua connection is legitimate"],
    ["Stafford age 38+ risk","Cooper Kupp injuries could limit game scripts"],
    ["target-hog","scheme-product","young-stud","consistent"]),

  p(20,"WR8","Brian Thomas Jr.","JAX","WR",3,20.4,21,
    262,248,221,"high","low",23,7,
    "Thomas has delivered on his first-round billing with back-to-back explosive seasons. His blend of 4.33 speed and strong hands gives him a ceiling no one in the WR2/3 range can match. Jacksonville targeted him aggressively from the moment he entered the league, and with Christian Kirk's role diminishing, Thomas has ascended to the #1 target. Trevor Lawrence's development in Year 4 is a rising tide that benefits Thomas the most. He's the best deep-ball threat in the class.",
    ["4.33 speed — best vertical threat in draft class","Jacksonville's clear #1 receiver","Lawrence improving makes ceiling unlimited","Red-zone height advantage"],
    ["Lawrence inconsistency limits floor","Jacksonville's offensive line must improve","Weather games can cut into his volume"],
    ["speed-merchant","ceiling-play","young-stud","vertical-threat"]),

  p(21,"WR9","Marvin Harrison Jr.","ARI","WR",3,21.5,22,
    258,244,218,"elite","medium",23,5,
    "Harrison entered the NFL as arguably the most technically polished receiver prospect in a decade, and he's validated it with an elite first two NFL seasons. Arizona has built their passing attack around him, and his route running — which was considered generational coming out of Ohio State — translates seamlessly to the pros. McBride's presence helps him with single coverage. His ceiling is a top-5 overall receiver when the pieces fall into place around him. One of the best value picks in the second round.",
    ["Generational route running — elite technique","Arizona building offense around him","Elite hands — 1% drop rate","Ceiling to be WR1 within two seasons"],
    ["Arizona's OL limits clean pocket time","Cards offense takes time to find groove","Young — still building NFL rapport"],
    ["elite-upside","young-stud","route-technician","ceiling-play"]),

  p(22,"RB7","Kyren Williams","LAR","RB",3,22.0,23,
    265,250,222,"high","medium",25,6,
    "Williams is the bellcow RB in Los Angeles' offense after proving his worth through the injury absence of better-known backs. McVay's scheme is notoriously RB-friendly — no coordinator in football creates more RB opportunities in the passing game — and Williams has shown elite pass-catching ability (60+ receptions) and sufficient rushing production. He's one of the more underrated top-24 backs due to name recognition. His consistency is genuine.",
    ["McVay scheme is historically RB-friendly","60+ reception upside — elite PPR value","Bellcow role in Los Angeles offense","Young and ascending"],
    ["Salary-cap driven decisions could add competition","Stafford's late-career injury risk limits upside"],
    ["bellcow","ppr-specialist","scheme-product","underrated"]),

  p(23,"QB3","Jalen Hurts","PHI","QB",3,23.5,25,
    355,335,355,"high","medium",27,5,
    "Hurts is a borderline QB1 in all fantasy formats thanks to his rushing contribution. Philadelphia's offense is built around his dual-threat capability, and Nick Sirianni's system generates consistent scoring opportunities. The ceiling questions come from his passing accuracy — on days where throws aren't falling, the rushing volume sustains him. He's the QB3 in most consensus rankings but can outperform Josh Allen in weeks with a high floor rushing game.",
    ["500+ rushing yards annually","Philadelphia offense creates scoring opportunities","Consistent QB1 floor even in bad throwing games","Elite offensive line protects him"],
    ["Passing accuracy limitations cap ceiling","Dak Prescott and Allen are more reliable","Risk of injury with rushing volume"],
    ["dual-threat","rushing-floor","injury-risk","safe-pick"]),

  p(24,"WR10","Garrett Wilson","NYJ","WR",3,24.1,26,
    255,241,215,"high","low",25,12,
    "Wilson is the most talented receiver in terms of pure athleticism and route-running ability who hasn't had the quarterback to fully maximize his potential. That changes with New York's continued QB investment. Even in suboptimal situations, he's delivered 95+ target seasons, showing his floor is real. If the Jets land or develop a functional QB, Wilson's ceiling is immediate top-5 WR. In the meantime, he's a legitimate WR2 with WR1 upside.",
    ["Elite athleticism and route running","New York commits to him as #1 option","100+ target upside","Still ascending at 25"],
    ["QB situation remains uncertain","Jets offense has underperformed for years"],
    ["ceiling-play","talent-first","scheme-dependent","young-stud"]),

  p(25,"WR11","George Pickens","PIT","WR",3,25.0,27,
    252,238,212,"high","medium",23,9,
    "Pickens is a polarizing but legitimate top-20 WR. His talent is undeniable — elite hands, contested-catch ability, and the physicality to dominate when targeted. Pittsburgh has committed to building their offense around him post-Big Ben, and the new QB situation gives him an opportunity to be a true #1 receive. His 2024 YPR led all WRs over 90 targets. If you can stomach the week-to-week variance, Pickens' ceiling in a big-play role is among the highest in the draft.",
    ["Elite hands — one of best contested-catch receivers","Big-play ability — best YPR in class","Pittsburgh is his offense now","Young and physically imposing"],
    ["QB situation creates boom-bust tendency","Character concerns have lingered","Pittsburgh's offense limits passing volume"],
    ["boom-bust","ceiling-play","young-stud","big-play"]),

  p(26,"RB8","D'Andre Swift","CHI","RB",3,26.3,28,
    258,243,217,"high","low",26,7,
    "Swift found his home in Chicago and turned it into a breakout environment. The Bears' commitment to run the ball through their O-line — one of the best in football — gives Swift 18-22 touches per game. His pass-catching ability (55+ receptions) makes him viable in PPR, and he's durable enough to hold up over a 17-game season. Not flashy, but consistently delivers RB2 numbers with RB1 ceiling weeks when the scoring opens up.",
    ["Bears offensive line is top-5 in run blocking","Consistent 18-22 touch volume","55+ receptions add PPR value","Health — missed minimal games"],
    ["Limited upside on TD-only weeks","Chicago's passing offense can be inconsistent"],
    ["bellcow","ppr-specialist","consistent","safe-pick"]),

  p(27,"TE5","Kyle Pitts","ATL","TE",3,27.0,29,
    195,184,168,"elite","medium",25,12,
    "Pitts finally looks like he's unlocking his enormous potential. Atlanta's offense around Bijan Robinson and Drake London creates favorable matchups for Pitts — linebackers and safeties are stretched thin covering the run game and receivers, leaving Pitts in favorable leverage positions. His athletic profile remains generational — 6'6\", 245 lbs with 4.44 speed — and if targets increase to the 100+ range, his ceiling rivals the top TEs. A boom-or-bust pick with legitimate upside to be TE1 overall.",
    ["Generational athletic profile for TE","Atlanta offense creates coverage advantages","Young and ascending — age 25","Elite receiving ability when given opportunity"],
    ["Target concerns — 75-85 targets isn't quite elite","Atlanta feeds Robinson first","Injury history of his own"],
    ["elite-upside","boom-bust","athletic-freak","ceiling-play"]),

  p(28,"QB4","Patrick Mahomes","KC","QB",3,28.2,30,
    345,325,345,"high","low",30,11,
    "Mahomes remains a top-3 QB in reality but his fantasy value has normalized as Kansas City's offense evolved. He consistently delivers 4,500+ passing yards and 38+ TDs, but Travis Kelce's declining role and the emerging WR corps are transitional. Mahomes' floor is still elite — he never has bad seasons — but his ceiling weeks are slightly rarer than Allen and Jackson. In 2-QB leagues, he's a slam dunk. In 1-QB formats, he's a late-round value in rounds 8-10 depending on your strategy.",
    ["Consistent 4,500+ yards and 38+ TDs","Never posts truly bad fantasy seasons","KC offense generates red-zone opportunities","Elite decision-making keeps scoring chances alive"],
    ["Kelce decline limits short-area magic","WR corps still establishing trust","Late-round value only in 1-QB formats"],
    ["consistent","safe-pick","td-dependent","veteran"]),

  p(29,"WR12","Jordan Addison","MIN","WR",3,29.0,31,
    242,228,202,"high","low",24,6,
    "Addison has emerged as a legitimate WR2 in Minnesota's offense alongside Justin Jefferson. The two-receiver set forces defenses to choose, and Addison sees plenty of single coverage as a result. His route running, which was considered elite out of USC, translates exceptionally well to the NFL. He's posted 85+ receptions in consecutive seasons and is improving his red-zone involvement. A legitimate second-round pick with WR1 upside in Jefferson injury scenarios.",
    ["Single coverage every week with JJ drawing doubles","Minnesota feeds him in scoring situations","85+ reception upside","Rising trajectory — improving annually"],
    ["JJ injury risk could actually boost him (positive/negative)","Minnesota's offense can be inconsistent without JJ"],
    ["scheme-product","young-stud","floor-player","consistent"]),

  p(30,"RB9","Isiah Pacheco","KC","RB",3,30.1,32,
    245,230,205,"high","medium",26,11,
    "Pacheco has been Kansas City's every-down back for two seasons and has shown the receiving ability to be a legitimate PPR contributor. KC's offense consistently generates scoring opportunities, and Pacheco's role in third-down situations and goal-line packages is secure. His rushing style is physical and he's shown durability. In a committee attack, his ceiling is limited, but as the workhorse he's consistently pushed the boundary of RB2. The Chiefs passing game occasionally steals his TD opportunities.",
    ["Kansas City's established rushing starter","Goal-line role is secure","Strong pass protection keeps him on field","KC consistently reaches red zone"],
    ["Mahomes offense can limit rushing opportunities","Clyde Edwards-Helaire type competition possible","Must be workhorse to be RB1"],
    ["bellcow","workhorse","td-dependent","consistent"]),

  // ─── TIER 4: QUALITY STARTERS (Picks 31–55) ──────────────────────────────

  p(31,"WR13","Jaylen Waddle","MIA","WR",4,31.5,33,
    238,225,200,"high","low",27,10,
    "Waddle is Tyreek Hill's perfect complement — his route running from the slot and underneath creates openings that Hill exploits vertically. He's consistently a 90+ target receiver with 70+ receptions, and in PPR formats he's a reliable WR2. The risk is a Tua injury scenario where backup QBs don't utilize him as effectively. In a healthy passing game, Waddle's floor is among the best WR2s in the league.",
    ["Consistent 90+ targets","Elite slot receiver — PPR specialist","Tua connection is efficient","High floor in PPR formats"],
    ["Tua injury risk","Hill limits WR1 upside","Less than elite after-catch ability vs. true speedsters"],
    ["ppr-specialist","slot-monster","consistent","floor-player"]),

  p(32,"WR14","Chris Olave","NO","WR",4,32.5,34,
    232,218,194,"high","medium",24,12,
    "Olave is a silky route runner who has been penalized by New Orleans' historically poor QB situation. He's consistently the top target regardless of who plays behind center in NO, posting 90+ targets every season. His separation ability is genuine top-12 WR talent. If New Orleans improves at QB (draft pick, FA), Olave's ceiling jumps significantly. He's priced as a WR3 but has WR1 ability when the pieces around him improve.",
    ["Elite route running — consistent separation","No. 1 target in NO regardless of QB","Age 24 — ascending","90+ target floor every season"],
    ["NO QB situation has been a long-term anchor on upside","Dome games help; road/cold concerns"],
    ["underrated","ceiling-play","talent-first","young-stud"]),

  p(33,"RB10","Saquon Barkley","PHI","RB",4,33.5,35,
    240,226,202,"high","low",29,5,
    "Barkley in Philadelphia's offensive machine has been a revelation. The Eagles' dominant offensive line creates massive rushing lanes, and Barkley has returned to his 1,000+ yard rushing form while adding a receiving role in Nick Sirianni's system. He's shown he can handle a 20-carry workload with the receiving ability to push 60+ receptions. He's a legitimate RB1 in rounds 3–4 with the upside of an elite workhorse. Philadelphia's playoff-caliber offense makes him a must-start through January.",
    ["Philadelphia OL is best in football","Workhorse role — 20+ carries weekly","60+ receptions in PPR-friendly scheme","Eagles offense consistently reaches playoffs"],
    ["Age 29 — monitoring athleticism","Hurts rushing creates some TD competition","Philadelphia can be run-or-pass game-planned"],
    ["bellcow","veteran","workhorse","consistent"]),

  p(34,"QB5","CJ Stroud","HOU","QB",4,34.0,36,
    335,315,335,"high","low",24,14,
    "Stroud is emerging as a genuine franchise QB with fantasy upside that's still growing. Houston's offense improved dramatically with the surrounding talent, and Stroud's accuracy (69% completion rate) combined with elite supporting weapons creates consistent weekly production. In his third season, expect the connection with Stefon Diggs/Tank Dell to fully develop. He's a legitimate late-round QB1 who can be your starter in 1-QB leagues at a substantial ADP discount.",
    ["Elite accuracy — 69%+ completion rate","Houston's supporting cast is improving","Age 24 — prime development years","Consistent 4,000+ yards potential"],
    ["Houston's consistency depends on offensive health","Stroud's rushing limited — pure passer","Diggs health is a variable"],
    ["young-stud","safe-pick","consistent","ascending"]),

  p(35,"WR15","Tank Dell","HOU","WR",4,35.0,37,
    228,214,190,"high","medium",25,14,
    "Dell's explosion and route-running precision make him a legitimate threat in Houston's offense. His size (5'8\") creates concerns about durability, but his yards-per-route-run metrics rival the league's best. With Stefon Diggs' age becoming a factor and Nico Collins as a complementary piece, Dell has carved out 90+ target volume. At 25 and entering his prime, there's a genuine argument he becomes the #1 receiver in Houston within a season.",
    ["Elite separation metrics","Houston passes frequently","Young and ascending","Excellent YAC ability for his size"],
    ["Size creates durability questions","Injury history — missed games in 2024","Houston has multiple quality WRs"],
    ["speed-merchant","ceiling-play","young-stud","injury-risk"]),

  p(36,"TE6","David Njoku","CLE","TE",4,36.0,38,
    185,174,158,"high","low",29,10,
    "Njoku has quietly become a top-5 TE over the last two seasons. Cleveland builds their entire passing attack around him, with Njoku seeing 90-100 targets as the featured receiver. Deshaun Watson's return to health is a key variable, but Cleveland's commitment to Njoku as their offensive anchor is real. His blocking ability keeps him on the field all three downs, and his athletic ability after the catch creates scoring opportunities consistently.",
    ["90-100 target pace in Cleveland","Featured passing target — no WR competition of note","Strong blocker keeps him on field","Consistent double-digit fantasy scoring"],
    ["Deshaun Watson injury history creates risk","Cleveland's offensive scheme limits ceiling","Age 29 — limited long-term dynasty value"],
    ["elite-te","safe-pick","consistent","positional-scarcity"]),

  p(37,"RB11","Josh Jacobs","GB","RB",4,37.0,39,
    235,221,197,"high","low",28,5,
    "Jacobs found a perfect home in Green Bay's revitalized offense. The Packers commit to the running game in a way few franchises do, and Jacobs has thrived as the featured back with 20+ carries weekly. Jordan Love's passing game keeps defenses honest, opening lanes for Jacobs. His receiving role (45+ receptions) adds PPR value, and he's been remarkably durable across his career. At 28, he's in his prime years with genuine RB1 upside.",
    ["Green Bay commits to running game","20+ carries weekly — true workhorse","45+ receptions adds PPR value","Jordan Love passing game opens lanes"],
    ["Age 28 — approaching the RB cliff","Green Bay offense can be conservative","Limited receiving role vs. elite PPR backs"],
    ["bellcow","consistent","workhorse","safe-pick"]),

  p(38,"QB6","Jordan Love","GB","QB",4,38.0,40,
    328,308,328,"high","low",27,5,
    "Love is making a strong case to be the QB2 in fantasy football with back-to-back strong campaigns. Green Bay's offense is balanced but Love throws the ball frequently in decisive situations, and his receivers — Jayden Reed, Dontayvion Wicks, Christian Watson — are all capable of big games. He has a rushing contribution that gives him a floor most pocket passers can't match. A legitimate starter in 1-QB leagues from the back end of drafts.",
    ["Green Bay offense is balanced but pass-heavy late","Rushing contribution gives him a floor","25+ TD potential","Improving accuracy — ascending"],
    ["Conservative early-down scheme limits passing yards","Competing with Allen and Jackson makes him QB2-3"],
    ["young-stud","consistent","safe-pick","ascending"]),

  p(39,"WR16","Rashee Rice","KC","WR",4,39.5,41,
    222,208,184,"elite","high",24,11,
    "Rice's talent is undeniable — he posted elite metrics in the first half of the 2024 season before injury. If cleared and fully healthy, he slots in immediately as the Mahomes WR1 with 100+ target upside. The risk: his legal/health situation requires monitoring, and Kansas City may have contingency plans. If Rice is fully available and healthy for all 17 games, he's a top-15 WR. The boom scenario is massive; the bust scenario is severe.",
    ["Mahomes connection is immediately elite","100+ target upside","Elite separation and YAC ability","Young — full recovery possible"],
    ["Legal and health situation requires close monitoring","Kansas City has contingency plans in place","Missed significant time — conditioning concern"],
    ["boom-bust","injury-risk","ceiling-play","monitor-situation"]),

  p(40,"WR17","DJ Moore","CHI","WR",4,40.0,42,
    218,204,180,"high","low",28,7,
    "Moore has been the steady veteran presence in Chicago's young receiving corps. He consistently delivers 85+ receptions regardless of who's at QB, and his route running is among the best in the NFC. Chicago's investment in their offense and Caleb Williams' development means Moore's ceiling is rising. He's a reliable WR2/3 with an upside ceiling tied to Williams' growth as a passer.",
    ["Consistent 85+ receptions regardless of QB","Elite route running for his age","Williams development raises his ceiling","Chicago offense improving annually"],
    ["Age 28 — limited growth curve","Williams still developing — inconsistent accuracy","Chicago's offense is still establishing identity"],
    ["consistent","floor-player","veteran","safe-pick"]),

  p(41,"RB12","Travis Etienne Jr.","JAX","RB",4,41.0,43,
    228,214,190,"high","medium",27,7,
    "Etienne has been Jacksonville's best offensive player for three seasons. His rushing and receiving combination (1,000+ yards and 50+ receptions) makes him a true three-down back. The concern is Jacksonville's offensive line, which has been inconsistent, and Trevor Lawrence's injury history. When the Jaguars' offense is functioning, Etienne is a legitimate RB1 every week.",
    ["Three-down back — workhorse role","50+ receptions add significant PPR value","Elite burst and vision","1,000+ yard rusher in consecutive seasons"],
    ["Jacksonville's OL has been inconsistent","Lawrence injury history creates correlation risk","Jaguars organizational instability"],
    ["bellcow","ppr-specialist","consistent","boom-bust"]),

  p(42,"WR18","Stefon Diggs","HOU","WR",4,42.5,44,
    215,201,177,"high","high",32,14,
    "Diggs joined Houston and injected immediate energy into an already talented offense. His route-running is still elite — among the most technically precise in the NFL — and his rapport with CJ Stroud has developed quickly. The primary concern is age (32) and a significant injury in 2024. If Diggs is healthy and starts at full strength, he's a legitimate top-25 WR. The injury risk moves him down from his peak ranking but doesn't eliminate his value.",
    ["Elite technical route runner — still top-15 in precision","Houston feeds him in key situations","Stroud connection is efficient","Veteran leadership maximizes opportunities"],
    ["Age 32 — injury history now a factor","Missed significant time — conditioning questions","Tank Dell and Nico Collins limit share"],
    ["veteran","injury-risk","consistent","boom-bust"]),

  p(43,"TE7","Evan Engram","JAX","TE",4,43.0,45,
    180,169,154,"high","low",30,7,
    "Engram is the consummate PPR tight end — he catches everything thrown his way and runs excellent routes underneath. Jacksonville leans on him heavily, and his 100+ target pace makes him one of the safest TE floor options in the league. His ceiling is limited by Jacksonville's overall offensive inconsistency, but his floor is secure. An excellent TE2 to pair with an elite overall player in your draft.",
    ["100+ target pace — elite PPR floor","Elite hands — 1% drop rate","Jacksonville features him as safety valve","Consistent 75+ receptions per season"],
    ["Limited TD opportunities","Jacksonville offense is boom-bust","Age 30 — approaching decline"],
    ["ppr-specialist","floor-player","safe-pick","consistent"]),

  p(44,"RB13","Rhamondre Stevenson","NE","RB",4,44.0,46,
    220,207,184,"medium","low",26,14,
    "Stevenson is New England's workhorse back as the Patriots continue their post-Belichick rebuild. He sees 18-20 carries consistently, and his receiving role has improved to 45+ receptions. The ceiling is limited by New England's developing offense, but the floor is solid. At 26, he's a proven commodity who delivers reliable mid-round value.",
    ["Workhorse role — 18-20 carries weekly","Improving receiving game","Durable — played full seasons","New England commits to running game"],
    ["Patriots offense is rebuilding — limited ceiling","QB situation is uncertain"],
    ["bellcow","consistent","floor-player","safe-pick"]),

  p(45,"WR19","Zay Flowers","BAL","WR",4,45.0,47,
    212,198,175,"high","low",24,14,
    "Flowers has been excellent for Baltimore as their primary receiving threat in an offense built around Lamar Jackson's rushing. He sees 85+ targets, runs excellent routes, and is Lamar's most trusted downfield option. The ceiling is tied to Baltimore's willingness to throw, which fluctuates game to game. In positive game scripts, Flowers can be a top-20 WR. His youth and improvement trajectory are encouraging.",
    ["85+ targets in a Lamar Jackson offense","Young and ascending at 24","Baltimore's featured receiver","Excellent route running for his profile"],
    ["Baltimore run-first tendencies limit floor","Lamar's rushing scheme can compress passing windows","Devin Duvernay competition"],
    ["young-stud","consistent","scheme-dependent","ceiling-play"]),

  p(46,"RB14","Raheem Mostert","MIA","RB",4,46.5,48,
    205,192,170,"high","high",33,10,
    "Mostert's value is entirely tied to workload and health. When he's the lead back in Miami's explosive offense with Achane, he's a viable RB3. The problem: he's 33, has a significant injury history, and De'Von Achane can completely steal his role at any time. He's a streaming option most weeks and a buy-low candidate heading into the season.",
    ["Miami offense is explosive","High YPC when carrying the ball","Reliable receiving option when healthy"],
    ["Age 33 — significant health risk","Achane can replace his role entirely","Limited standalone value"],
    ["handcuff","injury-risk","boom-bust","streaming"]),

  p(47,"QB7","Trevor Lawrence","JAX","QB",4,47.0,49,
    318,298,318,"high","medium",26,7,
    "Lawrence is a perennial 'just about to break out' candidate who has delivered more inconsistency than his physical talent suggests. When Jacksonville's offense is rolling, he's a QB1. When it's not, he's a liability. In 2026, with new weapons and an improved offensive line, the expectation is Year 5 is his true breakout. He's worth the gamble as a late QB1/QB2 with genuine upside.",
    ["Elite physical tools","Jacksonville improving around him","Young — age 26 prime","High ceiling with full receiving corps"],
    ["Organizational and coaching inconsistency","Injury history limits floor","Still hasn't fully unlocked potential"],
    ["ceiling-play","boom-bust","young-stud","ascending"]),

  p(48,"WR20","Davante Adams","NYJ","WR",4,48.0,50,
    208,194,172,"medium","medium",33,12,
    "Adams continues to be an elite route runner in his 30s — a testament to technique over athleticism. The Jets have committed to building around him and Garrett Wilson, and Adams' ability to create separation and find the soft spot in any coverage remains top-10. The age and back concerns limit his upside, but his floor in a healthy, functioning offense is consistent WR2 production.",
    ["Elite technical route running — still top-8 in precision","Target share in Jets offense is guaranteed","Veteran savvy creates consistent separation","TD production near red zone"],
    ["Age 33 — monitoring snap counts","QB uncertainty in New York","Back concerns have lingered"],
    ["veteran","floor-player","route-technician","age-concern"]),

  p(49,"RB15","Joe Mixon","HOU","RB",4,49.0,51,
    200,187,166,"medium","medium",30,14,
    "Mixon has settled in as Houston's veteran lead back, bringing reliability in an explosive offense. He doesn't have the ceiling of his peak Bengals years, but Houston's OL creates lanes and his goal-line role is secure. A solid RB3 in most formats.",
    ["Houston offense generates scoring","Consistent 15+ carries weekly","Goal-line role secure","Veteran reliability"],
    ["Age 30 — approaching the RB cliff","Dameon Pierce competition","Limited upside ceiling"],
    ["consistent","floor-player","veteran","td-dependent"]),

  p(50,"WR21","Jaxon Smith-Njigba","SEA","WR",4,50.0,52,
    204,190,168,"high","low",23,5,
    "JSN has graduated from promising rookie to legitimate WR2 after a breakout sophomore campaign. His route-running precision from the slot rivals any young receiver in the league, and Seattle's revamped offense has embraced him as the featured weapon. At 23, his ceiling keeps rising. A legitimate second-receiver in your WR corps.",
    ["Elite route precision from slot","Seattle offense building around him","Young — ascending trajectory","100+ target pace"],
    ["DK Metcalf limits outside opportunities","Seahawks offense finding identity"],
    ["young-stud","slot-monster","ascending","consistent"]),

  // ─── TIER 5: FLEX / STREAMERS (Picks 51–75) ──────────────────────────────

  p(51,"RB16","Nick Chubb","CLE","RB",5,51.5,53,
    198,186,165,"high","high",30,10,
    "Chubb's return from catastrophic knee injury is one of the great comebacks in recent memory. When healthy, he's among the most powerful runners in football — a true bellcow who averages 5.0+ yards per carry. The risk profile is substantial given the ACL/patellar tendon combination, but Cleveland commits their offense to him when available. A high-risk, high-reward selection.",
    ["When healthy, top-8 RB ceiling","Cleveland commits to him as the feature back","5.0+ YPC elite efficiency","Goal-line monster"],
    ["Coming back from devastating knee injury","Age 30 on limited health","Cleveland's offense is inconsistent"],
    ["injury-risk","boom-bust","workhorse","bellcow"]),

  p(52,"TE8","Pat Freiermuth","PIT","TE",5,52.0,54,
    172,161,146,"medium","low",26,9,
    "Freiermuth has solidified as Pittsburgh's primary TE target, seeing consistent 70-80 target volume. He's not flashy but he's dependable — a quality TE2 who you can plug in each week and expect 10-12 PPR points. Pittsburgh's new offensive direction benefits him.",
    ["70-80 target pace — consistent TE2 floor","Pittsburgh features him as primary TE","Reliable hands","Young — 26 and ascending"],
    ["Pittsburgh's offense limits ceiling","Limited YAC ability","No elite speed"],
    ["floor-player","consistent","safe-pick","positional-value"]),

  p(53,"WR22","Christian Kirk","JAX","WR",5,53.0,55,
    196,182,160,"medium","low",28,7,
    "Kirk is a reliable slot receiver who quietly produces 75-85 receptions when healthy. Jacksonville's commitment to the passing game creates consistent volume for him, though Brian Thomas Jr.'s emergence has limited some of his ceiling. A quality WR3 who provides floor value.",
    ["Reliable 75-85 receptions","Slot receiver role is secure","PPR points accumulate weekly"],
    ["Brian Thomas Jr. limits ceiling","Age 28 — no growth trajectory","Limited TD volume"],
    ["ppr-specialist","floor-player","consistent","slot-monster"]),

  p(54,"QB8","Dak Prescott","DAL","QB",5,54.0,56,
    320,300,320,"medium","medium",33,7,
    "Prescott has the best supporting cast of any QB in football — CeeDee Lamb alone makes him viable. He consistently delivers 4,500+ yards and 35+ TDs and has been remarkably durable. At 33, there's a longevity question, but there's no immediate decline. A reliable late-round QB1 in 1-QB leagues.",
    ["CeeDee Lamb makes every throw easier","4,500+ yards and 35+ TDs consistently","Durable — rarely misses games","Dallas offense is pass-heavy"],
    ["Age 33 — monitoring long-term","Limited rushing contribution limits floor","Dallas defense creates some negative game scripts"],
    ["consistent","safe-pick","veteran","floor-player"]),

  p(55,"RB17","Aaron Jones","MIN","RB",5,55.0,57,
    190,178,158,"medium","medium",31,6,
    "Jones' role in Minnesota is as a complement to the overall offense rather than a true workhorse. He catches passes well and contributes near the goal line, but his age and limited role cap him as an RB3.",
    ["Pass-catching ability — 45+ receptions","Minnesota offense is productive","TD opportunities near goal line"],
    ["Age 31 — limited workload protection","Timeshare limits floor","Limited ceiling"],
    ["handcuff","ppr-specialist","veteran","floor-player"]),

  // ─── TIER 6: DEEP STASH (Picks 56–80) ────────────────────────────────────

  p(56,"WR23","Tee Higgins","CIN","WR",6,56.0,58,
    188,175,155,"high","medium",26,7,
    "Higgins is Ja'Marr Chase's complement and benefits enormously from the coverage Chase attracts. When healthy, he's a 90+ target WR2 in one of the most pass-heavy offenses in football. The injury concern is real — he's missed games in multiple seasons — but when available he's a consistent performer.",
    ["Ja'Marr Chase draws coverage","Cincinnati is pass-heavy","90+ target upside","Quality hands and route running"],
    ["Injury history is a concern","Ja'Marr Chase limits WR1 ceiling","Cincinnati can be boom-bust"],
    ["injury-risk","consistent","ceiling-play","complementary"]),

  p(57,"RB18","Dameon Pierce","HOU","RB",6,57.0,59,
    182,170,152,"medium","medium",25,14,
    "Pierce is Joe Mixon's primary competition in Houston. If Mixon misses time, Pierce becomes an immediate RB2. He has the workload capacity and Houston's explosive offense supports multiple backs.",
    ["Immediate starter if Mixon misses time","Houston offense is explosive","Young and capable"],
    ["Mixon limits his role","Limited upside with healthy Mixon","Unproven as primary starter"],
    ["handcuff","ceiling-play","boom-bust"]),

  p(58,"QB9","Anthony Richardson","IND","QB",6,58.0,60,
    308,288,308,"elite","high",23,14,
    "Richardson has the highest ceiling of any QB not named Jackson or Allen — his rushing ability is genuinely elite (700+ rushing yards, 10 TDs potential). The problem has been injuries and accuracy. If he plays 15+ games and builds on his accuracy improvements, he could be a top-5 QB. The variance is massive — he's either a week-winner or a disaster.",
    ["700+ rushing yard ceiling — elite for QB","Massive arm — deep ball is exceptional","Indianapolis commits to him","Age 23 — ceiling is highest at position"],
    ["Injury history — missed significant time","Accuracy issues persist","Learning curve continues"],
    ["dual-threat","boom-bust","injury-risk","ceiling-play"]),

  p(59,"WR24","Brandin Cooks","wherever","WR",6,59.5,61,
    178,166,147,"medium","medium",33,9,
    "Cooks' value depends entirely on landing spot. Historically, he's a 90-target receiver in any system due to his speed and route efficiency. In the right environment, he's a late-round WR2/3 steal.",
    ["Elite speed creates big-play ability","Consistent target accumulator","Works in any offensive system"],
    ["Age 33","Landing spot unknown","Limited upside in conservative offenses"],
    ["veteran","monitor-situation","sleeper","speed-merchant"]),

  p(60,"TE9","Dalton Kincaid","BUF","TE",6,60.0,62,
    168,157,142,"high","medium",25,12,
    "Kincaid has the talent to emerge as a legitimate TE1 in Josh Allen's offense. Buffalo's scheme creates favorable tight end matchups, and Kincaid's athleticism is among the best at his position. He's competing for a role that could make him a top-6 TE.",
    ["Josh Allen creates favorable TE situations","Elite athleticism for TE","Young — ascending","Buffalo TE target volume is real"],
    ["Stefon Diggs departure helps him","Competition for targets from WRs","Inconsistent use year-to-year"],
    ["young-stud","ceiling-play","positional-scarcity","ascending"]),

  // ─── TIER 7: SPECULATIVE / HANDCUFFS (Picks 61–100) ─────────────────────

  p(61,"RB19","Kyren Williams HC","LAR","RB",7,61.0,63,
    175,163,144,"medium","medium",27,6,
    "Williams is his own handcuff — but if you drafted him, add a backup. Blake Corum is the handcuff to own if Williams goes down.",
    ["Already own Williams? This slot is Blake Corum"],["Works only with Williams injury"],["handcuff"]),

  p(62,"WR25","Devin Duvernay","BAL","WR",7,62.0,64,
    170,158,140,"medium","medium",27,14,
    "Duvernay is the Zay Flowers handcuff. A Flowers injury makes Duvernay an immediate starter and deep sleeper.",
    ["Immediate Flowers replacement value","Baltimore feeds receivers"],["Flowers blocks path"],["handcuff","sleeper"]),

  p(63,"RB20","De'Sean Jackson (rookie)","TBD","RB",7,63.0,65,
    168,156,138,"elite","high",22,9,
    "Top RB from the 2026 NFL Draft. Landing spot determines value — monitor training camp reports closely.",
    ["Top athletic profile from college","Explosive burst metrics","Age 22 — immediate impact potential"],
    ["NFL adjustment curve","Landing spot TBD","Rookie bump may fade"],
    ["rookie","sleeper","ceiling-play","monitor-situation"]),

  p(64,"QB10","Caleb Williams","CHI","QB",7,64.0,66,
    295,275,295,"elite","medium",24,7,
    "Williams is entering his third NFL season and the expectations are enormous. Chicago's offense now has quality weapons around him, and if he's made the Year 3 leap many expect, he could be a top-5 QB. His rushing ability gives him a floor, and his arm is elite. A speculative QB1 in the back half of your draft.",
    ["Chicago has surrounded him with weapons","Year 3 leap anticipated","Elite arm talent","Rushing ability gives floor"],
    ["Still inconsistent — too many mistakes","Bears offense is still developing","Must cut turnovers to reach ceiling"],
    ["young-stud","ascending","boom-bust","ceiling-play"]),

  p(65,"WR26","Rashod Bateman","BAL","WR",7,65.0,67,
    162,150,133,"medium","high",25,14,
    "Bateman's talent has never matched his health. When on the field, he's a legitimate WR3 in Baltimore. The injury history makes him a late-round dart throw.",
    ["Baltimore feeds receivers","Legitimate talent when healthy"],["Persistent injury history","Zay Flowers takes priority"],
    ["sleeper","injury-risk","boom-bust"]),

  p(66,"RB21","Jaylen Warren","PIT","RB",7,66.0,68,
    158,148,130,"medium","medium",25,9,
    "Warren is Najee Harris's handcuff and a capable back in his own right. Pittsburgh's offense can generate carries for him, and he's shown he can handle a lead role.",
    ["Immediate Harris replacement","Pittsburgh runs the ball","Capable pass-catcher"],["Harris limits his role","Pittsburgh conservative offense"],
    ["handcuff","sleeper","consistent"]),

  p(67,"TE10","Tyler Higbee","LAR","TE",7,67.0,69,
    155,144,128,"medium","low",30,6,
    "Higbee is the veteran presence in LA's TE room. His role is secure but limited — he's a TE2/3 who provides reliable floor production without a ceiling.",
    ["Reliable veteran TE floor","McVay system is TE-friendly"],["Limited upside","Age 30"],["floor-player","veteran","safe-pick"]),

  p(68,"WR27","Kadarius Toney","KC","WR",7,68.0,70,
    150,139,123,"elite","high",27,11,
    "Toney's talent is legitimate and in Mahomes' offense the upside is enormous. But injuries and inconsistency have defined his career. A late-round dart with a high boom ceiling.",
    ["Mahomes makes every receiver viable","Elite athleticism"],["Injury history is severe","Inconsistency is career-defining"],
    ["sleeper","boom-bust","injury-risk","ceiling-play"]),

  p(69,"QB11","Geno Smith","SEA","QB",7,69.0,71,
    285,265,285,"medium","low",35,5,
    "Smith is a safe late-round QB streamer with a decent supporting cast in Seattle. Not a league-winner but a reliable QB2.",
    ["Seattle has quality receivers","Consistent accuracy","Safe floor production"],["Age 35 — approaching cliff","Limited rushing","Seahawks offense is average"],
    ["consistent","floor-player","veteran","safe-pick"]),

  p(70,"RB22","Najee Harris","PIT","RB",7,70.5,72,
    148,138,122,"medium","low",27,9,
    "Harris is the Pittsburgh starter but his value has declined. He's a volume-based RB who gets his 15-17 carries but rarely does anything explosive with them. A reliable RB4 in deeper leagues.",
    ["Pittsburgh commits carries to him","Reliable enough volume for floor"],["Limited explosiveness","Low YPC","Pittsburgh offense limits ceiling"],
    ["floor-player","consistent","workhorse"]),

  p(71,"WR28","Michael Pittman Jr.","IND","WR",7,71.0,73,
    142,132,116,"medium","medium",27,14,
    "Pittman is the possession receiver in Indianapolis. His role is secure but the offense around him needs to improve for his ceiling to rise. Anthony Richardson's accuracy is the key variable.",
    ["Consistent targets in Indy offense","Reliable hands — low drop rate"],["Offense still developing","Richardson accuracy limits upside"],
    ["floor-player","consistent"]),

  p(72,"TE11","Cade Otton","TB","TE",7,72.0,74,
    138,128,113,"medium","low",25,11,
    "Otton emerged as Tampa Bay's primary TE target, benefiting from Baker Mayfield's quick-release style. A quality TE2 who provides reliable production.",
    ["Tampa Bay passes frequently","Baker-Otton connection is real","75+ target upside"],["Limited athletic upside","Tampa Bay WRs limit ceiling"],
    ["floor-player","consistent","young-stud"]),

  p(73,"RB23","Tony Pollard","TEN","RB",7,73.0,75,
    135,126,111,"medium","medium",28,5,
    "Pollard is Tennessee's lead back in a run-heavy scheme that should give him volume. The ceiling is limited by the Titans' mediocre passing attack, but the carries are real.",
    ["Tennessee commits to running game","Reliable carries — 18+ per game"],["Limited pass-catching role","Tennessee offense has ceiling constraints"],
    ["bellcow","floor-player","consistent"]),

  p(74,"WR29","Van Jefferson","LAR","WR",7,74.5,76,
    128,118,104,"medium","medium",28,6,
    "Jefferson is Puka Nacua's handcuff in LA. If Nacua goes down, Jefferson becomes an immediate WR2 in McVay's system.",
    ["McVay system is WR-friendly","Immediate Nacua replacement value"],["Nacua limits his role"],
    ["handcuff","sleeper"]),

  p(75,"DST1","San Francisco 49ers","SF","DST",7,75.0,77,
    145,145,145,"high","low",0,9,
    "The 49ers defense remains elite — top-3 in sacks, turnovers, and points allowed. A set-and-forget DST with playoff matchup upside.",
    ["Elite defensive talent","Top-3 in sacks and turnovers","Favorable schedule second half"],["Injuries could disrupt"],
    ["safe-pick","consistent","elite-floor"]),

  // ─── TIER 7: SLEEPERS / PICKS 76–100 ─────────────────────────────────────

  p(76,"WR30","Dontayvion Wicks","GB","WR",7,76.5,78,
    122,112,99,"high","medium",24,5,
    "Wicks has developed into a legitimate WR2 in Green Bay alongside Jordan Love. His red-zone ability and big-play potential make him a boom-bust WR3/flex with ceiling weeks.",
    ["Love feeds red-zone targets to him","Green Bay passes frequently","Young — developing"],["Inconsistent target share","Christian Watson competition"],
    ["young-stud","boom-bust","ceiling-play"]),

  p(77,"RB24","Kendre Miller","NO","RB",7,77.0,79,
    118,110,97,"high","medium",23,12,
    "Miller is the lead back for New Orleans and has shown elite burst in limited opportunities. If the Saints' offense improves, he could be a top-20 RB.",
    ["Clear lead back role","Explosive burst","Young at 23"],["New Orleans offense is inconsistent","Chris Olave takes targets from his game"],
    ["young-stud","sleeper","ceiling-play"]),

  p(78,"QB12","Sam Howell","wherever","QB",7,78.0,80,
    275,255,275,"medium","medium",25,9,
    "Howell's value depends on his landing spot. He showed playmaking ability in Washington and has elite rushing tools. Monitor his situation.",
    ["Elite rushing ability","Playmaking arm talent"],["Landing spot TBD","Accuracy concerns"],
    ["sleeper","monitor-situation","dual-threat"]),

  p(79,"WR31","Jayden Reed","GB","WR",7,79.0,81,
    115,106,94,"high","medium",24,5,
    "Reed is a shifty slot receiver who creates yards after catch. Jordan Love targets him consistently, and his PPR upside is real in the right matchup.",
    ["Jordan Love's slot favorite","50+ reception upside","YAC ability"],["Inconsistent target share","Wicks and Watson exist"],
    ["ppr-specialist","slot-monster","sleeper"]),

  p(80,"TE12","Gerald Everett","wherever","TE",7,80.0,82,
    108,100,88,"medium","medium",30,8,
    "Everett is a veteran TE who fits into any offense as a reliable underneath target. Landing spot determines his value.",
    ["Reliable hands","Works in any system"],["Age 30","Landing spot TBD"],
    ["veteran","floor-player","monitor-situation"]),

  p(81,"RB25","Rachaad White","TB","RB",7,81.0,83,
    105,97,86,"medium","medium",26,11,
    "White emerged as Tampa Bay's pass-catching back after Fournette departed. His receiving role makes him viable in PPR formats.",
    ["Tampa Bay passes frequently","Pass-catching back — 50+ receptions","Mayfield targets him in passing game"],["Limited rushing ceiling","Red-zone role unclear"],
    ["ppr-specialist","consistent","floor-player"]),

  p(82,"WR32","Christian Watson","GB","WR",7,82.0,84,
    102,94,83,"elite","high",26,5,
    "Watson's speed and athleticism make him a downfield threat, but injuries have been chronic. When healthy, he's a legitimate big-play WR with TD upside.",
    ["Elite speed — 4.36 40 time","Jordan Love throws deep frequently","TD upside in big-play role"],["Injury history — multiple hamstring issues","Inconsistent target share"],
    ["speed-merchant","injury-risk","boom-bust","ceiling-play"]),

  p(83,"DST2","Dallas Cowboys","DAL","DST",7,83.0,85,
    138,138,138,"medium","low",0,7,
    "Dallas boasts one of the most talented defensive units in the NFC. Micah Parsons leads a pass rush that generates sacks and turnovers weekly.",
    ["Micah Parsons is elite","Top-5 pass rush","Generates turnovers"],["Injuries to secondary possible"],
    ["safe-pick","consistent"]),

  p(84,"RB26","Jaylen Samuels","TBD","RB",7,84.0,86,
    98,91,80,"medium","medium",28,9,
    "A veteran back who can contribute in the right situation. Monitor his roster status heading into camp.",
    ["Experienced pass-catcher","Reliable in limited role"],["No clear landing spot","Limited ceiling"],
    ["handcuff","floor-player","monitor-situation"]),

  p(85,"QB13","Daniel Jones","wherever","QB",7,85.0,87,
    265,245,265,"medium","high",28,8,
    "Jones has shown he can be a functional starter when healthy, but his injury history is alarming. In the right system, he provides QB2 value.",
    ["Athletic enough for rushing contribution","Can hit 4,000 yards in good environment"],["Injury history is severe","Landing spot unclear"],
    ["monitor-situation","boom-bust","injury-risk"]),

  p(86,"WR33","Mecole Hardman","KC","WR",7,86.0,88,
    92,85,75,"medium","medium",27,11,
    "Hardman is a gadget player who benefits from Mahomes' ability to find anyone. In the right game script, he contributes — but he's a TD-dependent streamer.",
    ["Mahomes can find anyone","Speed makes him a TD threat","Useful in PPR streaming"],["Limited consistent role","Target share is minimal"],
    ["streamer","boom-bust","td-dependent"]),

  p(87,"DST3","Philadelphia Eagles","PHI","DST",7,87.0,89,
    134,134,134,"high","low",0,5,
    "The Eagles defense is among the most consistent in the NFC. Their pass rush and secondary create weekly streaming value.",
    ["Top-5 pass rush","Consistent turnover generation","Plays in NFC East — challenging matchups create ceiling"],
    ["NFC East schedule can be brutal"],
    ["consistent","safe-pick"]),

  p(88,"TE13","Chigoziem Okonkwo","TEN","TE",7,88.0,90,
    88,81,72,"medium","medium",25,5,
    "Okonkwo has shown flashes of being a legitimate NFL tight end. Tennessee could feature him more heavily if they commit to the passing game.",
    ["Tennessee TE1 role","Young — developing","Flashed receiving ability"],["Tennessee offense limits upside","Limited proven track record"],
    ["sleeper","young-stud","floor-player"]),

  p(89,"RB27","Jerome Ford","CLE","RB",7,89.0,91,
    85,79,70,"medium","medium",25,10,
    "Ford is Nick Chubb's handcuff. In a Chubb injury scenario, Ford becomes an immediate RB2 in Cleveland's offense.",
    ["Immediate Chubb replacement","Cleveland commits to running game"],["Chubb limits his role","Limited upside unless starter"],
    ["handcuff","sleeper","boom-bust"]),

  p(90,"WR34","Julio Jones (comeback)","TBD","WR",7,90.5,92,
    80,74,65,"medium","high",37,9,
    "Speculative only. If Jones attempts a comeback, his landing spot and health determine everything. A dart throw only.",
    ["If healthy, legendary route running remains"],["Age 37","Hasn't played consistently"],
    ["monitor-situation","boom-bust","speculative"]),

  p(91,"DST4","Buffalo Bills","BUF","DST",7,91.0,93,
    128,128,128,"high","low",0,12,
    "Buffalo's defense is rebuilt and capable of elite production. Von Miller's presence remains impactful and the secondary is deep.",
    ["Consistent sack generation","Turnover-prone opponents","Josh Allen offense limits negative game scripts"],["Occasional weak spots in run defense"],
    ["consistent","safe-pick"]),

  p(92,"K1","Harrison Butker","KC","K",7,92.0,94,
    155,155,155,"high","low",0,11,
    "Butker is the consensus top kicker in fantasy — Kansas City's dominant red-zone offense creates the most field goal and PAT opportunities in the NFL.",
    ["KC offense generates kicking opportunities","Elite accuracy — 95%+ FG rate","Consistent extra points"],["KC's scoring might inflate expectations"],
    ["consistent","safe-pick","elite-floor"]),

  p(93,"QB14","Mac Jones","wherever","QB",7,93.0,95,
    255,235,255,"low","medium",28,8,
    "Jones is a capable game manager in the right system but unlikely to be a starter. Monitor his situation as a deep QB3.",
    ["Game manager ability","Understands West Coast offense"],["Limited arm talent","No rushing ability"],
    ["monitor-situation","floor-player","streamer"]),

  p(94,"WR35","Keenan Allen","wherever","WR",7,94.0,96,
    78,72,63,"medium","high",34,8,
    "Allen's elite route running is the only thing keeping him fantasy-relevant at 34. In the right offense, he can still post 70-80 receptions.",
    ["Elite technical route running","Target accumulator in right offense"],["Age 34 — significant health risk","Landing spot TBD"],
    ["veteran","injury-risk","monitor-situation"]),

  p(95,"DST5","Baltimore Ravens","BAL","DST",7,95.0,97,
    122,122,122,"high","low",0,14,
    "Baltimore's defense remains elite under Zach Orr. Their ability to generate turnovers and sacks makes them a weekly streaming option with bye-week planning.",
    ["Elite turnover generation","Consistent sack production","Lamar offense limits negative scripts"],["Bye week 14 — late","Occasional run-defense lapses"],
    ["consistent","safe-pick"]),

  p(96,"K2","Justin Tucker","BAL","K",7,96.0,98,
    148,148,148,"high","low",0,14,
    "Tucker — when healthy — is the most accurate kicker in NFL history. Baltimore's scoring and his range make him a top-3 kicker option.",
    ["Most accurate kicker ever","Baltimore scores regularly"],["Age and injury history"],
    ["consistent","veteran"]),

  p(97,"RB28","Austin Ekeler","wherever","RB",7,97.5,99,
    72,67,59,"medium","high",30,8,
    "Ekeler is a veteran looking for a landing spot. If he lands somewhere with a role, his pass-catching ability gives him PPR value.",
    ["Elite pass-catcher for RB","Works in any scheme"],["Age 30","No confirmed landing spot"],
    ["monitor-situation","ppr-specialist","veteran"]),

  p(98,"WR36","Mike Evans","TB","WR",7,98.0,100,
    68,63,55,"medium","medium",33,11,
    "Evans is Tampa Bay's red-zone monster and has delivered 1,000+ yards for an NFL-record consecutive number of seasons. At 33, the ceiling is limited but the floor is real.",
    ["Consecutive 1,000-yard seasons","Tampa Bay red-zone target","Reliable veteran hands"],["Age 33 — approaching decline","Rachaad White limits rushing scheme"],
    ["veteran","consistent","red-zone-threat"]),

  p(99,"QB15","Drake Maye","NE","QB",7,99.0,101,
    248,228,248,"elite","medium",24,14,
    "Maye is New England's QB of the future and could emerge as a fantasy option if he makes the Year 2 leap. His dual-threat ability gives him a high ceiling.",
    ["Elite arm and athleticism","Year 2 expected improvement","New England building around him"],["Inconsistent rookie year","Patriots offense still developing"],
    ["young-stud","ascending","boom-bust","dual-threat"]),

  p(100,"DST6","Kansas City Chiefs","KC","DST",7,100.0,102,
    118,118,118,"medium","low",0,11,
    "The Chiefs defense is consistently above-average with strong pass-rush talent. In the right matchup, they're a weekly streaming option.",
    ["Consistent sack generation","KC offense limits negative scripts","Elite coaching scheme"],["Aging defenders in secondary","Opponents game plan for their scheme"],
    ["consistent","safe-pick","streaming"]),
];

export const TIER_COLORS: Record<number, { bg: string; border: string; text: string; label: string }> = {
  1: { bg: "bg-amber-500/10",  border: "border-amber-500/30",  text: "text-amber-400",  label: "Tier 1 · Transcendent" },
  2: { bg: "bg-emerald-500/10",border: "border-emerald-500/30",text: "text-emerald-400",label: "Tier 2 · Elite" },
  3: { bg: "bg-blue-500/10",   border: "border-blue-500/30",   text: "text-blue-400",   label: "Tier 3 · Strong Starter" },
  4: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", label: "Tier 4 · Quality Starter" },
  5: { bg: "bg-slate-500/10",  border: "border-slate-500/30",  text: "text-slate-400",  label: "Tier 5 · Flex / Streamer" },
  6: { bg: "bg-rose-500/10",   border: "border-rose-500/30",   text: "text-rose-400",   label: "Tier 6 · Deep Stash" },
  7: { bg: "bg-slate-800/40",  border: "border-slate-700/30",  text: "text-slate-500",  label: "Tier 7 · Speculative" },
};

export const POSITION_COLORS: Record<string, string> = {
  QB:  "bg-red-500/20 text-red-400",
  RB:  "bg-green-500/20 text-green-400",
  WR:  "bg-blue-500/20 text-blue-400",
  TE:  "bg-purple-500/20 text-purple-400",
  K:   "bg-yellow-500/20 text-yellow-400",
  DST: "bg-orange-500/20 text-orange-400",
};

export const UPSIDE_COLORS: Record<string, string> = {
  elite:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  high:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  medium: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  low:    "bg-slate-600/40 text-slate-400 border-slate-600/30",
};

export const RISK_COLORS: Record<string, string> = {
  high:   "text-red-400",
  medium: "text-amber-400",
  low:    "text-emerald-400",
};

// Draft strategy by round for the recommendation engine
export const ROUND_STRATEGY: Record<number, string> = {
  1:  "Take the highest-ranked available player — position agnostic. RB and elite WR dominate Round 1.",
  2:  "Continue best-player-available. If you took WR in Round 1, consider a top RB now. Tier 2 players.",
  3:  "Begin position management. Strong starter RB or WR. Consider early QB/TE if elite tier is available.",
  4:  "Fill your weakest position. If no TE in rounds 1-3, consider Sam LaPorta tier. Late QBs have value.",
  5:  "Flex and depth. Quality RB2/WR2 who can start. Handcuffs for your workhorse backs.",
  6:  "Target upside: sleepers and high-ceiling depth. Don't settle for floor-only players here.",
  7:  "Handcuffs — protect your key RBs. Injury risks at low ADP become buy-low targets.",
  8:  "Streaming DST and K. Elite defenses go fast. Top kickers in best offenses are safe.",
  9:  "Rookie upside picks, late TEs, emerging receivers. Swing for potential.",
  10: "Best available anywhere. Roster builds here, season wins here.",
  11: "Pure speculation — boom or bust. Target high upside.",
  12: "Lottery tickets. Best possible ADP value, highest ceiling possible.",
};
