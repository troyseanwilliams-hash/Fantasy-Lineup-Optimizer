// ============================================================
// 2026 Fantasy Football Draft Rankings — EliteLineup AI
// Based on consensus expert rankings: FantasyPros ECR, ESPN,
// Yahoo Sports, and top analyst aggregate data.
// Updated daily via the news-adjustment engine.
// ============================================================

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
export type Upside = "elite" | "high" | "medium" | "low";
export type RiskLevel = "high" | "medium" | "low";
export type ScoringFormat = "ppr" | "half" | "standard";

export interface DraftPlayer {
  id: number;
  rank: number;           // Overall consensus rank
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
  reasoning: string;
  strengths: string[];
  concerns: string[];
  tags: string[];
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
// Consensus locks across every major analyst platform.

export const NFL_DRAFT_RANKINGS_2026: DraftPlayer[] = [

  p(1,"RB1","Bijan Robinson","ATL","RB",1,1.2,1,
    342,318,286,"elite","low",23,12,
    "Robinson is the consensus #1 overall pick in 2026 — the most complete running back in the NFL. Atlanta's offensive identity runs entirely through him: 300+ carries, 80+ receptions, elite red-zone volume, and a top-5 offensive line creating lanes. He's posted back-to-back dominant seasons as a true three-down workhorse with elite contact balance, pass-catching ability, and goal-line dominance. In PPR formats his floor is virtually unmatched — a week-to-week RB1 from September through January with no realistic downside scenario.",
    ["Unanimous RB1 across all major analyst platforms","Three-down bellcow — 300+ carries and 80+ receptions","Top-5 OL in run blocking","Consistent red-zone touches and TDs","Age 23 — prime years ahead"],
    ["Atlanta run-first tendencies can limit ceiling weeks","Occasional soft-tissue soreness to monitor"],
    ["workhorse","bellcow","target-hog","safe-pick"]),

  p(2,"RB2","Jahmyr Gibbs","DET","RB",1,2.0,2,
    330,312,280,"elite","low",23,5,
    "Gibbs is the consensus #2 overall pick — the lead back in the most explosive offense in football. Detroit's top-3 scoring attack generates 20+ touches per game for him, and his 70+ target receiving role gives him an elite PPR ceiling that very few backs can match. David Montgomery's diminishing role has left Gibbs as the unquestioned starter. At 23, he's entering his prime in the best possible offensive environment. His burst, contact balance, and pass-catching ability make him a true every-down workhorse.",
    ["Detroit offense consistently top-3 in scoring","Elite receiving role — 70+ targets","Young at 23 — prime window","20+ touches per game guaranteed","Best offensive environment for an RB in the NFL"],
    ["Montgomery still exists as red-zone vulture","Lions can run clock in blowouts, reducing ceiling"],
    ["workhorse","target-hog","young-stud","safe-pick"]),

  p(3,"RB3","Ashton Jeanty","LV","RB",1,3.2,3,
    325,300,268,"elite","low",21,9,
    "Jeanty put together one of the most dominant college football seasons in history at Boise State and translated that explosiveness immediately to the NFL. Las Vegas committed to making him their offensive cornerstone with a full three-down workload. His combination of elite burst, contact balance, and pass-catching ability is generational — a true 300-touch ceiling back at just 21 years old. The highest upside pick in the entire draft class.",
    ["Three-down workhorse role — 300+ touches","Elite contact balance and burst","Pass-catching ability adds PPR ceiling","Age 21 — best years clearly ahead","Las Vegas built offense around him"],
    ["Las Vegas offense still developing around supporting cast","Defensive focus as the clear #1 option"],
    ["workhorse","bellcow","young-stud","ceiling-play","target-hog"]),

  p(4,"WR1","Ja'Marr Chase","CIN","WR",1,4.0,4,
    335,320,290,"elite","low",25,7,
    "Chase is the WR1 in every scoring format — the clear top receiver in fantasy football. His connection with Joe Burrow is the most efficient QB-WR partnership in football: 120+ receptions, double-digit TDs in three straight seasons, elite 50/50 ball dominance. Cincinnati's offense consistently generates top-3 pass attempts and Air Yards. His ball-tracking, route running, and after-catch explosiveness make him immune to any single defensive scheme. A weekly must-start.",
    ["10+ TDs every season","120+ receptions — elite PPR floor","Best QB-WR duo in football with Burrow","Cincinnati top-3 pass volume annually","Contested catch dominant — 50/50 ball king"],
    ["Burrow injury history is correlation risk","Bengals can be run-heavy when leading big"],
    ["td-machine","target-hog","safe-pick","ceiling-play"]),

  p(5,"WR2","CeeDee Lamb","DAL","WR",1,5.0,5,
    322,308,278,"elite","low",25,7,
    "Lamb is the WR2 in fantasy football and arguably the most naturally gifted receiver in the game. Dallas's entire offensive scheme flows through him — 30%+ target share, 130+ receptions, full route tree inside and outside. Dak Prescott's efficiency and quick release are tailor-made for Lamb's YAC ability. Back-to-back WR1 seasons make him a realistic pick-5 value in any format. No real weaknesses on film or in fantasy production.",
    ["30%+ target share — highest in NFL","130+ receptions in consecutive seasons","Full route tree — inside slot and boundary","Red-zone priority target","Elite YAC ability"],
    ["Bracket coverage can limit ceiling","No legitimate #2 receiver to draw attention away"],
    ["target-hog","elite-floor","safe-pick","route-technician"]),

  // ─── TIER 2: ELITE (Picks 6–15) ──────────────────────────────────────────

  p(6,"RB4","Saquon Barkley","PHI","RB",2,6.1,6,
    315,296,265,"elite","low",29,5,
    "Barkley's move to Philadelphia unlocked his best NFL seasons — he became the workhorse back in a top-5 offense with one of the league's best offensive lines. His combination of vision, elusiveness, and pass-catching (75+ receptions) makes him a PPR monster. He enters 2026 as the RB4 in consensus with a proven role in a system that maximizes his skills. The Eagles commit to running through Barkley in all game scripts.",
    ["75+ receptions guaranteed — elite PPR floor","Philadelphia OL is top-3 in run blocking","Goal-line priority in elite scoring offense","Played all 17 games — proven durability","Best version of himself in Philly's scheme"],
    ["Age 29 — entering late prime","Eagles can be pass-heavy in certain game scripts"],
    ["bellcow","ppr-specialist","safe-pick","workhorse"]),

  p(7,"WR3","Justin Jefferson","MIN","WR",2,7.0,7,
    315,300,270,"elite","low",26,6,
    "Jefferson is the premier technical receiver in the NFL. Post-extension, Minnesota rebuilt their offensive infrastructure around him — he's the centerpiece of their passing attack with 130+ targets guaranteed. His route running is technically elite, creating separation through precision cuts rather than raw speed, which gives him longevity as a top receiver regardless of age. A true WR1 in all formats with a floor that rarely dips below 15 fantasy points.",
    ["Elite separation rate — top-3 in NFL","Minnesota offense is built around him","130+ targets per season guaranteed","1,400+ yards upside every year","Age 26 — peak athletic window"],
    ["Minnesota QB situation has uncertainty","Injury history — missed games in 2024"],
    ["target-hog","safe-pick","elite-floor","route-technician"]),

  p(8,"WR4","Tyreek Hill","MIA","WR",2,8.0,8,
    305,292,262,"elite","low",32,10,
    "Hill continues to defy age with elite separation and yards-after-catch production. Miami's offense is constructed around his speed, posting 9–11 targets per game. He's delivered three consecutive 1,700+ yard seasons and remains the best vertical separator in the NFL. At 32, there's a legitimate age cliff question — but there's been zero performance decline through 2025. In a PPR format, his volume and big-play ability make him a true WR1.",
    ["Unmatched separation speed — still top-3","Miami targets him 9–11 times per game","Three straight 1,700+ yard seasons","Elite YAC — big-play machine","Miami's fast-paced offense maximizes his ceiling"],
    ["Age 32 — cliff risk is real","Tua injury history creates correlation risk","Jaylen Waddle limits red-zone volume"],
    ["speed-merchant","target-hog","age-concern","consistent-elite"]),

  p(9,"RB5","Breece Hall","NYJ","RB",2,9.3,9,
    300,284,254,"elite","medium",23,12,
    "Hall is the Jets' offensive cornerstone — a rare combination of burst, vision, and pass-catching that gives him every-down value. New York's continued investment in their offensive infrastructure supports a 20+ touch workload for Hall, and his 60+ reception ceiling makes him a PPR monster. The ACL recovery is now a distant memory; Hall has played through back-to-back full seasons with elite volume. At 23, he's one of the highest-ceiling players in the draft.",
    ["Elite burst post-ACL — full recovery confirmed","60+ receptions add massive PPR ceiling","Jets' offensive centerpiece — 20+ touches","Young at 23 — prime window","Goal-line role secured"],
    ["Jets offense still developing","ACL history — conditioning monitored"],
    ["workhorse","target-hog","young-stud","ppr-specialist"]),

  p(10,"WR5","Puka Nacua","LAR","WR",2,10.2,10,
    292,278,249,"high","low",24,6,
    "Nacua's emergence as the Rams' #1 receiver is no longer a surprise — he's built back-to-back dominant seasons in McVay's elite system. His 120+ target pace and YAC ability generate consistent WR1 production, and the addition of Davante Adams creates favorable coverage looks for him. At 24 in one of the best offensive schemes in football, Nacua's floor is elite and his ceiling is top-5 WR.",
    ["120+ targets in McVay's elite scheme","Consistent WR1 production — two seasons of proof","Strong hands and YAC — not just a scheme product","Davante Adams draws coverage attention","Age 24 — ascending"],
    ["Stafford age 38 risk","Adams presence could shift target distribution"],
    ["target-hog","scheme-product","young-stud","consistent"]),

  p(11,"RB6","De'Von Achane","MIA","RB",2,11.4,11,
    285,268,238,"elite","medium",23,10,
    "Achane is the most explosive back in fantasy football — his yards-per-carry and receiving efficiency are unmatched in the league. Miami feeds him in a fast-paced, high-scoring offense, and when he's the clear lead back (18+ carries), he's capable of winning your week single-handedly. The workload concern is legitimate — Miami still has depth at the position — but Achane's efficiency makes him a top-12 pick regardless. His PPR ceiling is top-5 overall.",
    ["Fastest back in NFL — elite yards per touch","Explosive receiver out of backfield","Miami's high-scoring offense maximizes ceiling","Elite YPC (6.0+) — every touch is a big-play threat","Age 23 — prime athletic window"],
    ["Timeshare risk — Miami has RB depth","Limited goal-line role","Injury risk from explosive playing style"],
    ["speed-merchant","ceiling-play","workload-risk","ppr-specialist"]),

  p(12,"WR6","Drake London","ATL","WR",2,12.0,12,
    282,268,240,"high","low",24,12,
    "London has become one of the most dangerous receivers in the NFC. His elite size (6'4\") and contested-catch ability give Atlanta their most reliable red-zone target, and the symbiotic relationship with Bijan Robinson's run game ensures London sees single coverage weekly. He posted 1,400+ yards and 12+ TDs in 2025 and is entering his prime. Atlanta commits to him in key moments, and his continued route-tree development makes him a legitimate WR1 in all formats.",
    ["Elite size — contested catch dominant","Red-zone priority target — 12+ TDs","Atlanta offense feeds him in key situations","Bijan Robinson draws linebacker attention","Age 24 — ceiling still rising"],
    ["Atlanta's run-first tendencies limit volume ceiling","Bye week 12 is late-season"],
    ["red-zone-threat","target-hog","young-stud","size-speed"]),

  p(13,"QB1","Lamar Jackson","BAL","QB",2,13.2,13,
    375,355,375,"elite","medium",29,14,
    "Jackson is the QB1 in fantasy football by rushing floor. His 1,200+ rushing yard seasons with 10+ rushing TDs generate a weekly points floor no pocket passer can match. Baltimore's offense is entirely built around his dual-threat skill set, and he's a legitimate MVP-caliber player in 2026. The risk is contact-based injury, but Jackson has shown durability improvement. When he plays all 17 games, he wins the QB1 crown outright.",
    ["1,200+ rushing yards and 10+ rushing TDs annually","Baltimore offense fully optimized for him","Weekly must-start regardless of matchup","40+ fantasy point ceiling weeks","Consistent 4,500+ passing yards"],
    ["Rushing style creates injury exposure","Baltimore's passing game conservative in cold weather","Bye week 14 — late season"],
    ["dual-threat","rushing-floor","injury-risk","ceiling-play"]),

  p(14,"WR7","Amon-Ra St. Brown","DET","WR",2,14.0,14,
    288,274,246,"high","low",26,5,
    "St. Brown is the most reliable PPR floor in the WR position. Detroit's offense channels 130+ targets his way annually, and his slot efficiency — precise routes, elite YAC, and rapport with Jared Goff — generates double-digit fantasy points as his floor. He doesn't have elite downfield speed but doesn't need it: consistent production in a top-3 offense makes him a borderline WR1 every single week.",
    ["130+ targets in consecutive seasons","Elite PPR floor — 15+ points expected weekly","Detroit offense is prolific and pass-heavy","Goff quick-release is perfect for his style","Consistent regardless of matchup"],
    ["Limited red-zone role — not a TD monster","Speed limits ceiling against press coverage","Game scripts can reduce volume in blowouts"],
    ["ppr-specialist","slot-monster","safe-pick","floor-player"]),

  p(15,"QB2","Josh Allen","BUF","QB",2,15.5,15,
    372,352,372,"elite","low",30,12,
    "Allen is the multi-year QB1 floor in fantasy. His rushing volume — 500+ yards and 10+ TDs annually — creates a fantasy floor no other quarterback can touch. Buffalo's offense is pass-heavy with elite receivers, and Allen's mobility extends every play. In 2-QB leagues he's the first QB off the board; in 1-QB he's worth a round 2 investment. He rarely has truly bad fantasy weeks, and his ceiling (45+ points) is the highest at the position.",
    ["500+ rushing yards and 10+ rushing TDs every year","Most consistent fantasy QB floor","Buffalo offense pass-heavy with quality weapons","Clutch game-script — always throwing late","Elite red-zone efficiency — running QB TDs"],
    ["Rushing volume creates injury exposure","Worth debating vs. Lamar for QB1 spot","Buffalo WR corps still finding depth"],
    ["dual-threat","safe-pick","rushing-floor","early-qb"]),

  // ─── TIER 3: STRONG STARTERS (Picks 16–30) ───────────────────────────────

  p(16,"QB3","Jordan Love","GB","QB",3,16.0,16,
    358,338,358,"elite","low",27,5,
    "Love has emerged as a bonafide fantasy QB1 after his first full season as starter. His dual-threat ability — 600+ rushing yards with 8+ TDs — combined with a pass-heavy scheme and elite weapons in Christian Watson, Jayden Reed, and Tucker Kraft makes him a weekly point machine. Green Bay consistently generates high-volume passing games, and Love's efficient decision-making limits his floor. He's the QB3 in consensus and worth targeting ahead of later single-QB runs.",
    ["600+ rushing yards — dual-threat floor","Elite weapons: Watson, Reed, Kraft, Wicks","Green Bay pass-heavy offense — high volume","Efficient decision-making — limited turnovers","Age 27 — peak athletic window"],
    ["Less established injury track record","Green Bay still building run game balance"],
    ["dual-threat","rushing-floor","young-stud","ascending"]),

  p(17,"TE1","Sam LaPorta","DET","TE",3,17.0,17,
    218,207,192,"elite","low",24,5,
    "LaPorta is the consensus TE1 heading into 2026. Detroit's offense funnels 120+ targets his way as the primary mismatch weapon — Gibbs draws linebacker coverage, St. Brown draws slot defenders, and LaPorta runs freely against safeties and linebackers. His advanced route-running for a Year 3 TE and continued improvement in blocking keep him on the field all three downs. Drafting LaPorta in the second round locks in positional advantage at TE for the entire season.",
    ["Positional scarcity advantage over the field","120+ targets — elite for TE position","Detroit creates favorable mismatches for him","Age 24 — ascending every season","Must-start regardless of matchup"],
    ["TE has positional drop-off behind him","Detroit might add another weapon"],
    ["elite-te","positional-scarcity","target-hog","young-stud"]),

  p(18,"WR8","Davante Adams","LAR","WR",3,18.5,18,
    275,262,236,"high","low",33,6,
    "Adams' move to Los Angeles paired him with the perfect system — McVay's WR-friendly scheme and Matthew Stafford's quick release maximize his elite route-running. He remains the best pure route runner in football at any age, generating separation through technique rather than speed. His reunion with Puka Nacua creates a dangerous 1-2 punch that defenses struggle to contain. Adams enters 2026 as a legitimate WR2 in all formats and a value pick in rounds 3–4.",
    ["Best pure route runner in football","McVay scheme is WR-friendly — 130+ targets","Stafford quick release matches his style","Nacua draws coverage — Adams benefits","Still technically elite despite age 33"],
    ["Age 33 — physical decline could accelerate","Nacua could split target share heavily"],
    ["route-technician","target-hog","veteran","scheme-product"]),

  p(19,"WR9","Rashee Rice","KC","WR",3,19.0,19,
    272,258,232,"high","medium",25,11,
    "Rice has established himself as Kansas City's clear #1 receiver and one of the best slot receivers in the AFC. Mahomes targets him in critical moments, and Rice's route-running IQ is exceptional for a player entering just his third NFL season. When healthy, he's a 120+ target receiver with top-15 WR ceiling. The health caveat is real — he missed time in 2024 — but a full-season Rice is a WR1 in all formats.",
    ["Mahomes' primary target — 120+ targets when healthy","Elite slot route-running for Year 3","Kansas City offense generates consistent volume","Young at 25 — ascending player","Red-zone opportunities through the slot"],
    ["Injury history — missed games in 2024","Travis Hunter/other WRs compete for targets","Health is the key variable — monitor camp"],
    ["target-hog","young-stud","health-dependent","slot-monster"]),

  p(20,"WR10","Jaylen Waddle","MIA","WR",3,20.2,20,
    268,254,228,"high","low",27,10,
    "Waddle is the PPR specialist in Miami's lightning-fast offense. While Hill draws the deep coverage, Waddle feasts underneath with elite YAC ability — he regularly turns short targets into 10+ yard gains. His 100+ reception upside and consistent 10+ point floor make him a reliable WR2 in all formats. In PPR leagues specifically, his value rivals WR1 territory based on pure target volume and efficiency.",
    ["100+ reception upside — PPR monster","Miami's fast-paced offense generates volume","YAC ability — elite after-catch yards","Hill draws coverage — Waddle benefits","Consistent floor regardless of matchup"],
    ["Limited red-zone volume — Hill gets TDs","Tua injury history creates correlation risk"],
    ["ppr-specialist","target-hog","yac-monster","consistent"]),

  p(21,"RB7","Travis Etienne Jr.","JAX","RB",3,21.0,21,
    268,253,225,"high","low",27,7,
    "Etienne has matured into one of the most well-rounded running backs in fantasy. Jacksonville commits to a heavy workload (20+ touches) and his receiving ability (60+ receptions) gives him elite PPR value. He's durable, explosive, and operates as the clear bellcow with no meaningful backfield competition. Jacksonville's investment in their offensive line further elevates his floor. A true WR-lite RB in PPR formats.",
    ["Clear bellcow — 20+ touches per game","60+ reception upside — elite PPR value","Jacksonville offensive line investment","Durable — played all 17 games","Age 27 — prime years"],
    ["Jacksonville pass game inconsistency limits ceiling","Limited big-play breakout rate vs. top backs"],
    ["bellcow","ppr-specialist","workhorse","safe-pick"]),

  p(22,"RB8","Jonathan Taylor","IND","RB",3,22.5,22,
    265,250,222,"high","medium",27,14,
    "Taylor at full health is top-5 RB talent — Indianapolis built their offensive identity around his run-first ability and he delivers 20-25 carries per game when available. His pass-catching (50+ receptions viable) adds PPR value. The discount from his injury history creates legitimate value in rounds 3–4 where he's being drafted. When healthy, he's an RB1 who can carry teams. The risk is real but so is the ceiling.",
    ["Best pure runner when healthy — elite YPC","Indianapolis commits 20-25 carries per game","50+ receptions viable — PPR value","Goal-line priority in Indy offense","Discount ADP creates value"],
    ["Injury history — missed 10+ games in 2024","Indianapolis OL inconsistency","Richardson injury risk limits pass-volume ceiling"],
    ["bellcow","injury-risk","workhorse","boom-bust"]),

  p(23,"RB9","James Cook","BUF","RB",3,23.0,23,
    262,248,220,"high","low",26,12,
    "Cook has emerged as a high-end RB2 in one of the NFL's premier offenses. Buffalo's pass-heavy scheme gives him 50+ receptions and Josh Allen's efficiency creates consistent positive game scripts where Cook gets the ball late. His explosiveness and receiving ability make him a PPR threat, and the Bills' commitment to him as the lead back is clear. A reliable 3rd-round pick who rarely disappoints.",
    ["Buffalo offense is consistently high-scoring","50+ receptions in pass-heavy scheme","Josh Allen creates favorable game scripts","Explosive burst — elite YPC","Full lead back role confirmed"],
    ["Buffalo can become pass-only late in games","Limited goal-line volume vs. Allen sneaks"],
    ["ppr-specialist","bellcow","consistent","young-stud"]),

  p(24,"WR11","Malik Nabers","NYG","WR",3,24.2,24,
    258,244,218,"elite","medium",22,11,
    "Nabers burst onto the NFL scene with one of the best receiving seasons ever by a rookie, and his sophomore campaign is expected to cement his status as a genuine WR1. New York has built their passing game around his YAC ability and elite separation, and Daniel Jones' accuracy — when healthy — is a solid match for his style. At 22, his ceiling is top-5 WR within two seasons. A round 2–3 value pick.",
    ["Generational rookie season — immediate WR1","Elite YAC ability — creates yards after catch","Giants build offense around him","Age 22 — best years clearly ahead","Separation ability is top-5 in NFL"],
    ["Giants QB situation creates uncertainty","Offensive line must improve for deeper routes","Second-year regression risk minimal but real"],
    ["young-stud","ceiling-play","yac-monster","ascending"]),

  p(25,"WR12","Tee Higgins","NE","WR",3,25.0,25,
    255,241,215,"high","low",26,14,
    "Higgins' move to New England alongside AJ Brown creates one of the most dynamic receiving duos in the AFC. The Patriots' commitment to building a legitimate passing offense around their new weapons means Higgins sees favorable single coverage every week. He's a true 1,200-yard receiver with 10+ TD upside when paired with a functional QB. AJ Brown's presence gives him the space to operate underneath and over the middle. A top-25 value in rounds 3–4.",
    ["AJ Brown draws coverage — Higgins benefits","Elite hands and route running","1,200+ yard potential in full season","New England committed to building passing offense","Age 26 — entering prime"],
    ["New England QB situation still developing","Bye week 14 is late in the season","Health — missed time in prior seasons"],
    ["target-hog","young-stud","health-dependent","consistent"]),

  p(26,"QB4","Joe Burrow","CIN","QB",3,26.0,26,
    352,332,352,"high","low",29,7,
    "Burrow is the most efficient passer in fantasy when healthy, with Ja'Marr Chase as his primary weapon and a top-10 receiving corps. His 4,800+ passing yard upside and 40+ TD ceiling make him a legitimate early QB investment in 2-QB formats. In 1-QB leagues, he's a round 3 value with upside to finish as the QB1. His arm talent and football IQ ensure consistently high-floor production every week he plays.",
    ["Elite efficiency — highest passer rating when healthy","Ja'Marr Chase creates uncoverable looks","4,800+ yard ceiling — top-3 passer","Cincinnati top-5 in pass attempts","Age 29 — peak years"],
    ["Injury history — missed games in multiple seasons","Health is the primary variable","Bengals defense forces comeback attempts"],
    ["elite-floor","safe-pick","injury-risk","ceiling-play"]),

  p(27,"RB10","Brian Robinson Jr.","WAS","RB",3,27.0,27,
    252,238,210,"high","low",26,14,
    "Robinson is the workhorse back in Washington's run-heavy scheme. With Jayden Daniels orchestrating a balanced offense, Robinson sees 20+ carries per game and has emerged as a goal-line monster (12+ TDs). His physical style and durability give him a reliable floor, and Washington's improving offensive line makes his efficiency more consistent. A top-3 RB value in rounds 3–4.",
    ["Washington's clear workhorse — 20+ carries","12+ TD upside — goal-line monster","Jayden Daniels creates favorable run lanes","Physical style — built for 17-game season","Age 26 — prime years"],
    ["Limited pass-catching role — 30 receptions max","Washington offense still developing consistency"],
    ["bellcow","workhorse","td-machine","safe-pick"]),

  p(28,"RB11","Kyren Williams","LAR","RB",3,28.5,28,
    250,235,208,"high","medium",25,6,
    "Williams is the bellcow RB in McVay's historically RB-friendly system. His 60+ reception pace and McVay's scheme — which generates more RB opportunity in the passing game than any coordinator in football — make him a legitimate PPR RB1. The injury history is the primary concern, but when healthy over a full season he's produced top-10 RB numbers. A round 3 value with WR-like passing game involvement.",
    ["McVay scheme historically elite for RBs","60+ reception ceiling — PPR monster","Full bellcow role in Los Angeles","Young at 25 with ceiling still rising","Runs in top-5 offense"],
    ["Injury history — missed multiple games","Stafford's age creates correlation risk","Scheme-reliant — health of OL matters"],
    ["bellcow","ppr-specialist","scheme-product","injury-risk"]),

  p(29,"WR13","Chris Olave","NO","WR",3,29.0,29,
    248,234,208,"high","medium",25,12,
    "Olave is the most talented receiver in New Orleans and a legitimate WR2 in all formats when healthy. His route-running precision generates consistent separation, and New Orleans feeds him 100+ targets per season. The health concern is real — he missed time in 2024 — but a full-season Olave is worth the investment. In the right matchup, he's a WR1 weekly.",
    ["100+ target pace — elite for WR position","Elite route running and separation ability","New Orleans' clear #1 receiver","Age 25 — ascending player","Ceiling to be top-10 WR weekly"],
    ["Injury history — concussion concerns","New Orleans offense inconsistent in game scripts","QB situation creates variance"],
    ["target-hog","health-dependent","young-stud","route-technician"]),

  p(30,"TE2","David Njoku","CLE","TE",3,30.0,30,
    205,194,178,"high","low",28,10,
    "Njoku is a top-3 TE who doesn't get enough respect. Cleveland's offense funnels targets his way consistently, and his athleticism — elite for the position — creates mismatches weekly. He's the rare TE who can be relied upon as a weekly starter without worrying about an off week. His 90+ target pace and consistent 8+ point floor make him the second-best non-LaPorta TE in the draft. A round 4–5 value in 1-TE leagues.",
    ["90+ targets — elite consistency for TE","Elite athleticism creates weekly mismatches","Cleveland's primary receiving option","Reliable floor — rarely has bad games","Age 28 — prime years"],
    ["Cleveland's offense can be conservative","QB efficiency limits ceiling weeks","Limited TD upside vs. goal-line role"],
    ["elite-te","positional-scarcity","consistent","floor-player"]),

  // ─── TIER 4: QUALITY STARTERS (Picks 31–50) ──────────────────────────────

  p(31,"WR14","Marvin Harrison Jr.","ARI","WR",4,32.0,31,
    245,231,205,"elite","medium",23,5,
    "Harrison entered the NFL as the most technically polished receiver prospect in a generation and has validated it with two elite NFL seasons. Arizona has built their passing attack around him, and his route running — generational coming out of Ohio State — translates seamlessly. At 23, his ceiling is a top-5 overall receiver. McBride's presence creates favorable single coverage for Harrison over the middle and boundary. A round 3–4 value with WR1 upside.",
    ["Generational route running — elite technique","Arizona builds offense around him","Elite hands — sub-1% drop rate","Age 23 — ceiling to be WR1 within two seasons","Single coverage weekly with McBride at TE"],
    ["Arizona OL must protect for consistent passing","Cards offense still finding full offensive identity","Young — building NFL rapport with new QBs"],
    ["elite-upside","young-stud","route-technician","ceiling-play"]),

  p(32,"WR15","Rome Odunze","CHI","WR",4,33.0,32,
    240,226,200,"elite","medium",23,7,
    "Odunze is the prized piece in Chicago's explosive new receiving corps. With Luther Burden III and Colston Loveland alongside him, Odunze's natural traits — elite athleticism, body control, and catch radius — are maximized in Caleb Williams' system. The Bears' investment in all three pass-catchers reflects their commitment to a modern, high-volume passing offense. Odunze's ADP is rising rapidly, and early adopters get the best value. Legitimate WR1 upside in the right game scripts.",
    ["Chicago invested heavily in their passing game","Elite athleticism and catch radius","Caleb Williams unlocks a high-ceiling offense","23 years old — ascending","Odunze/Burden/Loveland trio is unique"],
    ["Chicago's offense still young and developing","Caleb Williams must make Year 3 leap","Target share division with Burden and Loveland"],
    ["young-stud","ceiling-play","ascending","team-upside"]),

  p(33,"WR16","Luther Burden III","CHI","WR",4,34.0,33,
    235,222,196,"elite","high",21,7,
    "Burden is the most exciting rookie receiver in the 2026 class and immediately slots into a featured role in Chicago's new-look offense. His explosiveness after the catch and elite short-area quickness give Caleb Williams a security blanket who turns five-yard completions into 20-yard gains. At 21, his ceiling is one of the highest in the class. Monitor training camp usage — if he's the slot starter from Day 1, his value skyrockets.",
    ["Elite explosiveness and YAC — instant impact","Chicago's slot role is high-volume","Caleb Williams favors quick slot targets","Age 21 — generational upside ceiling","Bears committed to building around young trio"],
    ["Rookie adjustment curve","Target competition with Odunze and Loveland","Must-monitor training camp reports"],
    ["rookie","young-stud","ceiling-play","ascending","yac-monster"]),

  p(34,"TE3","Colston Loveland","CHI","TE",4,35.0,34,
    198,187,172,"elite","high",22,7,
    "Loveland is the most coveted rookie TE since Kyle Pitts. His combination of size, athleticism, and receiving polish from Michigan gives Chicago a genuine mismatch weapon that changes how defenses game-plan them. The Bears' system will use him as a moveable chess piece — inline, in the slot, split wide — creating nightmare matchups. At 22, he could be TE1 within a season. The highest-ceiling TE in this draft class.",
    ["Generational TE prospect — elite athlete","Chicago's mismatch weapon in 3 alignments","Age 22 — best years clearly ahead","Caleb Williams connection already forming","Top TE ceiling in 2026 class"],
    ["Rookie TE learning curve in NFL","Target competition with Odunze and Burden","Must play significant snaps from Day 1"],
    ["rookie","elite-te","young-stud","ceiling-play","athletic-freak"]),

  p(35,"QB5","Patrick Mahomes","KC","QB",4,36.0,35,
    342,322,342,"high","low",30,11,
    "Mahomes remains among the elite QBs in football — consistent 4,500+ passing yards and 38+ TDs with an evolving weapons group. Travis Hunter's emergence and a rebuilt WR corps give him new passing options, and Kansas City's scheme ensures he's always in favorable game scripts. His value has normalized from the early days, but in 2-QB leagues he's a slam dunk and in 1-QB formats he's a round 6–8 value.",
    ["Consistent 4,500+ yards and 38+ TDs","Never posts truly bad fantasy seasons","Travis Hunter creates elite matchup issues","KC offense always in high-scoring game scripts","Elite decision-making — limits wasted possessions"],
    ["Kelce decline limits short-area magic","WR corps still establishing full trust","Late-round value only in 1-QB formats"],
    ["consistent","safe-pick","td-dependent","veteran"]),

  p(36,"WR17","Garrett Wilson","NYJ","WR",4,37.0,36,
    245,231,205,"high","low",25,12,
    "Wilson is the most talented receiver in terms of pure athleticism and route-running to not yet have a franchise QB. That's changing — New York's continued QB investment has dramatically elevated his situation. Even in suboptimal environments he's delivered 95-100 target seasons. With a competent QB in 2026, his ceiling is immediate top-10 WR. At 25, he's entering his prime and remains one of the best values in rounds 4–5.",
    ["Elite athleticism and route-running IQ","New York committed to finding their QB","100+ target upside in any offense","Age 25 — entering prime athletic window","Underrated due to past QB situation"],
    ["QB situation creates variance floor","Jets offense historically disappointing","Must have functional QB to reach ceiling"],
    ["ceiling-play","talent-first","scheme-dependent","young-stud"]),

  p(37,"RB12","Zach Charbonnet","SEA","RB",4,38.0,37,
    242,228,202,"high","low",25,5,
    "Charbonnet has cemented his lead-back role in Seattle after earning every opportunity. The Seahawks committed to a run-heavy identity and Charbonnet's combination of power and receiving ability (50+ receptions) gives him a balanced workload. He's not flashy but he's consistently one of the better volume backs in football — 18-20 touches per game, reliable floor, and occasional ceiling weeks when Seattle goes run-first. A round 4 value.",
    ["Seattle committed to running game","50+ reception upside — PPR value","Lead-back role secured with full workload","Age 25 — prime years","Seattle's improving OL creates lanes"],
    ["Seattle can be pass-heavy in certain game scripts","Limited explosive ceiling vs. elite backs"],
    ["bellcow","ppr-specialist","consistent","workhorse"]),

  p(38,"RB13","Alvin Kamara","NO","RB",4,39.0,38,
    238,224,198,"high","low",31,12,
    "Kamara remains a PPR machine in New Orleans despite age 31. His receiving ability — 80+ receptions per season — is among the highest in the RB position, and the Saints feed him targets consistently. His rushing production has declined slightly from peak but he's still the clear lead back with goal-line opportunities. In PPR formats specifically, Kamara is a legitimate RB2 with a floor that rarely disappoints.",
    ["80+ receptions — elite PPR floor","New Orleans feeds him as the clear lead back","Goal-line TD opportunities","Consistent — never has bad seasons","PPR monster regardless of rushing production"],
    ["Age 31 — rushing production declining","Limited big-play ceiling vs. younger backs","New Orleans offense rebuilding in spots"],
    ["ppr-specialist","veteran","floor-player","workhorse"]),

  p(39,"RB14","Tony Pollard","TEN","RB",4,40.0,39,
    235,221,195,"high","medium",28,5,
    "Pollard is the lead back in Tennessee's evolving run-heavy scheme. The Titans commit to their ground game and Pollard's receiving ability (45+ receptions) gives him PPR value others in the backfield can't match. He's not a flashy top-10 RB but he's a reliable 20+ touch back with consistent floor production and enough ceiling to win weeks when Tennessee games open up. A mid-round value in all formats.",
    ["Tennessee commits to the running game","45+ reception upside — PPR value","Clear lead-back role with full workload","Age 28 — prime production years","Consistent 18+ touch floor"],
    ["Tennessee offense has ceiling constraints in passing game","Limited explosive ceiling"],
    ["bellcow","floor-player","consistent","ppr-specialist"]),

  p(40,"QB6","Jayden Daniels","WAS","QB",4,41.0,40,
    335,315,335,"elite","medium",25,14,
    "Daniels is the most exciting young QB in fantasy football after his remarkable debut. His dual-threat ability — 700+ rushing yards, 8+ TDs — combined with an efficient downfield passing game makes him a weekly points machine. Washington's offensive infrastructure has been rebuilt around him, and Brian Robinson's workload keeps defenses honest enough for Daniels to operate in play-action. His ceiling is top-3 QB within two seasons. A massive round 4–5 QB value.",
    ["700+ rushing yards — elite dual-threat floor","Washington offense built around him","Young at 25 — ascending rapidly","Efficient decision-making for a dual-threat QB","Ceiling to be top-3 QB fantasy within 2 seasons"],
    ["Injury risk — takes too many sacks","Washington still building OL depth","Bye week 14 — late in season"],
    ["dual-threat","rushing-floor","young-stud","ascending","ceiling-play"]),

  p(41,"WR18","AJ Brown","NE","WR",4,42.0,41,
    232,218,192,"high","low",28,14,
    "Brown's trade to New England reunites him with a franchise committed to building a top-tier passing offense around their new receivers. His combination with Tee Higgins gives the Patriots the most dangerous 1-2 WR punch in the AFC East. Brown is a physical mismatch monster — 6'1\", 225 lbs with elite route running and YAC — who generates catches through contested situations. His volume should improve significantly in a scheme built for him.",
    ["New England's #1 WR in a rebuilt passing offense","Physical mismatch — 6'1\" with elite YAC","Tee Higgins creates favorable looks","Age 28 — prime years","Elite in contested-catch situations"],
    ["New England QB situation creating uncertainty","Bye week 14 — late in season","Higgins shares target load"],
    ["target-hog","size-speed","young-stud","red-zone-threat"]),

  p(42,"TE4","Brock Bowers","LV","TE",4,43.0,42,
    195,184,168,"elite","medium",22,9,
    "Bowers is the highest-ceiling TE in the 2026 draft outside of LaPorta. His first NFL season immediately confirmed his generational athleticism — he was a target hog in Las Vegas from Day 1 despite a thin surrounding offense. With Ashton Jeanty demanding defensive attention, Bowers will see favorable coverage all season. At 22, he could be the TE1 within two seasons. A round 4–5 TE value with top-3 long-term upside.",
    ["Exceptional receiving talent — generational TE athleticism","Elite separation from TE position","Jeanty draws coverage — Bowers benefits","Age 22 — best years clearly ahead","Las Vegas builds offense around him"],
    ["Las Vegas offense still developing around young core","QB uncertainty creates efficiency variance","Injury risk — plays through contact"],
    ["elite-te","positional-scarcity","young-stud","ceiling-play"]),

  p(43,"RB15","Rico Dowdle","DAL","RB",4,44.0,43,
    228,214,188,"high","medium",27,7,
    "Dowdle has secured the full lead-back role in Dallas after proving his worth with back-to-back efficient seasons. Dallas's offensive line — one of the best in football — creates lanes for him consistently, and CeeDee Lamb's target dominance means opposing defenses are often playing lighter boxes. His receiving ability (40+ receptions) gives him PPR value. A reliable mid-round RB2 with RB1 ceiling weeks.",
    ["Dallas OL is top-3 in run blocking","CeeDee Lamb means lighter run boxes","40+ reception upside — PPR value","Full lead-back role confirmed","Age 27 — prime production years"],
    ["Dallas may not have elite passing game support","Limited ceiling vs. top-12 backs"],
    ["bellcow","consistent","ppr-specialist","floor-player"]),

  p(44,"RB16","TreVeyon Henderson","NE","RB",4,45.0,44,
    222,208,182,"high","medium",23,14,
    "Henderson is the most exciting young back in New England's rebuilt backfield. His explosiveness — elite burst and YAC after contact — in a Patriots offense investing in their offense makes him a dynasty-league gem. In redraft, he's a round 4–5 RB2 with RB1 upside if he takes the full workhorse role. Monitor training camp: if the Patriots commit to him as the starter, his ADP rockets.",
    ["Elite explosiveness — top burst metrics","New England rebuilding offense around young core","Age 23 — huge ceiling and runway","Dynasty-tier talent in redraft value","Patriots committed to running game"],
    ["Must secure clear lead role in NE backfield","New England QB situation creates game script risk","Bye week 14"],
    ["young-stud","ceiling-play","ascending","monitor-situation"]),

  p(45,"WR19","Tank Dell","HOU","WR",4,46.0,45,
    220,206,180,"high","medium",25,14,
    "Dell has emerged as a dangerous deep threat in Houston's high-powered offense. CJ Stroud's arm and Dell's elite speed create a vertical pairing that generates chunk plays in every game. When healthy, he's a 90+ target receiver with 1,100+ yard potential. The injury concern is legitimate — he missed significant time in 2024 — but a full-season Dell is a WR2 with WR1 ceiling weeks.",
    ["CJ Stroud deep ball creates big-play upside","Elite speed — fastest deep threat in AFC","Houston's high-scoring offense generates volume","90+ target potential when healthy","Age 25 — ascending"],
    ["Injury history — missed significant time in 2024","Health is the primary variable","Stefon Diggs competition for targets"],
    ["speed-merchant","ceiling-play","health-dependent","vertical-threat"]),

  p(46,"WR20","Deebo Samuel","SF","WR",4,47.0,46,
    218,204,178,"high","medium",30,9,
    "Samuel is the ultimate multi-purpose weapon in Kyle Shanahan's run-pass option system. His role as a receiver-runner gives him unique floor — he can get his yards as a rusher even in games where the passing volume is low. San Francisco's offense maximizes his skillset, and when healthy he's a 90+ target receiver with 8-10 carries. A round 5 value with WR2 floor in PPR.",
    ["Unique receiver-runner role — carries add floor","Shanahan system maximizes his versatility","90+ targets plus 8-10 carries per game","San Francisco's prolific offense","Age 30 but physical style has held up"],
    ["Age 30 — usage could be managed","Injury history from physical style","Purdy/SF offense can be conservative"],
    ["all-purpose","floor-player","scheme-product","veteran"]),

  p(47,"WR21","Brian Thomas Jr.","JAX","WR",4,47.5,47,
    215,201,175,"high","low",23,7,
    "Thomas has delivered on his first-round billing with back-to-back explosive seasons. His 4.33 speed and strong hands give him a ceiling no one in the WR2/3 range can match. Jacksonville targeted him aggressively from Day 1, and with the passing game developing around him, Thomas has ascended to the clear #1 target. Trevor Lawrence's development makes his ceiling unlimited. The best deep-ball threat in the early rounds.",
    ["4.33 speed — best vertical threat in draft class","Jacksonville's clear #1 receiver","Lawrence improving raises ceiling further","Red-zone height advantage at 6'2\"","Age 23 — ascending"],
    ["Lawrence inconsistency limits floor","Jacksonville OL must improve","Weather games can reduce volume"],
    ["speed-merchant","ceiling-play","young-stud","vertical-threat"]),

  p(48,"WR22","George Pickens","PIT","WR",4,48.5,48,
    212,198,172,"high","medium",23,9,
    "Pickens is now in Pittsburgh's primary receiving role with a fresh quarterback situation that gives him a clean slate. His elite hands — consistently among the best contested-catch receivers in the league — and 6'3\" frame make him a weekly red-zone threat. His 2024 YPR led all WRs with 90+ targets. At 23 in his own system, his ceiling is legitimate WR1. The boom-bust nature is real but manageable at his ADP.",
    ["Elite hands — top contested-catch receiver","Big-play ability — highest YPR in class","Pittsburgh is his offense now","Age 23 — physically imposing and ascending","DK Metcalf presence opens space for him"],
    ["QB situation creates boom-bust tendency","Pittsburgh's offense limits overall passing volume","Character concerns have been noted"],
    ["boom-bust","ceiling-play","young-stud","big-play","red-zone-threat"]),

  p(49,"RB17","Josh Jacobs","GB","RB",4,49.0,49,
    208,194,168,"high","medium",28,5,
    "Jacobs found his best offensive environment in Green Bay. Jordan Love's passing keeps defenses from loading the box, and Jacobs' combination of power and receiving ability (50+ receptions) makes him a volume-dependent RB2. When Green Bay establishes the run — which they've committed to — Jacobs can post 20-23 touches. A reliable round 5–6 RB2 with occasional RB1 ceiling weeks.",
    ["Green Bay's offensive infrastructure is elite","Jordan Love creates favorable run boxes","50+ receptions — PPR value","Experienced workhorse — durability proven","Age 28 — prime years"],
    ["Volume-dependent — scheme-reliant ceiling","Green Bay may not establish run consistently"],
    ["bellcow","ppr-specialist","consistent","floor-player"]),

  p(50,"TE5","Trey McBride","ARI","TE",4,50.0,50,
    192,181,165,"high","low",25,5,
    "McBride quietly became one of the top receiving tight ends in football through two consecutive 100+ target seasons. Arizona's TE-friendly scheme naturally funnels targets to him, and with Colston Loveland rising to TE1, McBride becomes the best value at TE2. His consistent 85+ reception floor makes him a reliable starter in all formats. A round 6 value in leagues drafting TEs late.",
    ["100+ target pace — elite for TE","Arizona's scheme is TE-friendly","Consistent 900+ receiving yards","Young at 25 — prime years ahead","Loveland's rise makes McBride the value TE2"],
    ["Harrison Jr. limits red-zone opportunities","Arizona's OL inconsistency affects game scripts"],
    ["elite-te","target-hog","young-stud","safe-pick","floor-player"]),

  // ─── TIER 5: FLEX / STREAMER (Picks 51–60) ───────────────────────────────

  p(51,"TE6","Jake Ferguson","DAL","TE",5,51.0,51,
    188,177,162,"high","low",26,7,
    "Ferguson is the primary receiving TE in Dallas's offense and benefits enormously from CeeDee Lamb drawing all defensive attention. He posted 70+ receptions in 2025 and enters 2026 as a consistent TE2 with 10+ TD upside. Prescott targets him in the red zone specifically, and his athleticism creates favorable matchups against every linebacker class.",
    ["CeeDee Lamb draws coverage — Ferguson benefits","70+ reception ceiling in Dallas scheme","Red-zone TD volume — 10+ upside","Age 26 — prime years","Consistent floor in high-scoring offense"],
    ["Lamb dominates targets — Ferguson is #2","Dallas OL inconsistency"],
    ["floor-player","consistent","td-dependent","positional-scarcity"]),

  p(52,"QB7","Baker Mayfield","TB","QB",5,49.0,52,
    330,310,330,"high","low",31,11,
    "Mayfield has revitalized his career in Tampa Bay with back-to-back strong seasons. His quick release and Mike Evans/Keon Coleman/Jalen McMillan receiving corps generate consistent passing volume. He's a value QB in rounds 5–7 who regularly scores 22-28 fantasy points. In 2-QB formats, he's an early target.",
    ["Tampa Bay has elite receiving weapons","Consistent 4,200+ yards and 30+ TDs","Quick release creates high floor","Age 31 — prime passing years","Tampa Bay's scheme maximizes QB efficiency"],
    ["Limited rushing contribution","Tampa Bay's defense forces comfortable games"],
    ["consistent","floor-player","veteran","safe-pick"]),

  p(53,"WR23","Keon Coleman","BUF","WR",5,51.0,53,
    208,194,168,"high","medium",23,12,
    "Coleman has emerged as Buffalo's big-play downfield threat. His combination of size (6'4\") and athleticism makes him a red-zone monster — Josh Allen throws the back-shoulder fade to him for TDs at an elite rate. In PPR leagues he's a WR3/flex with TD-dependent ceiling, and in scoring-heavy formats his upside is genuine WR2. At 23, he's early in his development.",
    ["Josh Allen throws to him in the red zone","Elite size — contested catch dominant","Back-shoulder fade TD machine","Age 23 — ascending player","Buffalo offense consistently high-scoring"],
    ["Limited route tree — reliant on TDs","Stefon Diggs departure helped but Waddle-type volume elsewhere"],
    ["red-zone-threat","ceiling-play","td-dependent","young-stud"]),

  p(54,"RB18","Isiah Pacheco","KC","RB",5,52.0,54,
    205,192,166,"high","medium",27,11,
    "Pacheco is Kansas City's lead back when healthy, operating in the NFL's most efficient offense. Mahomes' threat creates lighter run boxes, and Pacheco's power-back style generates consistent yardage and TDs. His receiving role (35+ receptions) gives him PPR value. The injury history is the main concern, but a healthy Pacheco in Kansas City's offense is a legitimate RB2.",
    ["Kansas City's offense is consistently elite","Mahomes creates lighter run boxes","Power back — reliable short-yardage TDs","35+ receptions — PPR contribution","Age 27 — prime years"],
    ["Injury history — missed games in 2024","Zamir White provides real competition","KC can be pass-first in some game scripts"],
    ["bellcow","injury-risk","td-dependent","floor-player"]),

  p(55,"WR24","DK Metcalf","PIT","WR",5,55.0,55,
    202,188,162,"high","medium",28,9,
    "Metcalf's move to Pittsburgh brings his imposing physical tools to an offense with George Pickens already installed. The two-receiver set creates favorable looks for both, and Metcalf's 6'4\" frame and 4.33 speed make him a downfield threat in every game. Pittsburgh's investment in their passing game gives him 90+ target potential. His ceiling weeks — when the deep ball connects — are among the highest in the WR2–3 tier.",
    ["Elite size and speed — 6'4\" and 4.33","Pittsburgh's passing offense is improving","Pickens draws attention — Metcalf benefits","Deep-ball ceiling is elite in any offense","Age 28 — peak years"],
    ["Pittsburgh's volume may limit overall targets","Pickens competes for similar target type","Injury history from physical style"],
    ["speed-merchant","ceiling-play","big-play","size-speed"]),

  p(56,"WR25","Michael Pittman Jr.","IND","WR",5,54.0,56,
    198,184,158,"medium","medium",27,14,
    "Pittman is the possession receiver anchor in Indianapolis. His hands, route running, and football IQ generate consistent 90+ target seasons regardless of QB. Anthony Richardson's improved accuracy unlocks his ceiling further. He's a reliable WR2/3 floor who rarely has truly bad weeks.",
    ["Consistent targets in any Indy offense","Elite hands — sub-2% drop rate","Anthony Richardson accuracy improving","Age 27 — prime years","Reliable 90+ target floor"],
    ["Richardson accuracy limits ceiling","Indianapolis offense still developing","Limited big-play ability"],
    ["floor-player","consistent","safe-pick"]),

  p(57,"QB8","Anthony Richardson","IND","QB",5,57.0,57,
    315,295,315,"elite","high",23,14,
    "Richardson has the highest ceiling of any QB not named Jackson or Allen — his rushing ability is genuinely elite (700+ rushing yards, 10 TDs potential). The problem has been injuries and accuracy. If he plays 15+ games and builds on accuracy improvements, he's a top-5 fantasy QB. The variance is massive — he's either a week-winner or a game-losing liability. A round 6–8 QB1B in 1-QB formats.",
    ["700+ rushing yard ceiling — elite for QB","Massive arm — deep ball is exceptional","Indianapolis commits offense to him","Age 23 — highest physical ceiling at position","When on: 40+ point weeks"],
    ["Injury history — missed significant time","Accuracy issues persist — must improve","Boom-bust weekly — can't rely on as sole QB"],
    ["dual-threat","boom-bust","injury-risk","ceiling-play"]),

  p(58,"TE7","Kyle Pitts","ATL","TE",5,27.0,58,
    185,175,160,"elite","medium",25,12,
    "Pitts is finally rounding into the player his 4th-overall draft pedigree projected. Atlanta's balanced offense — Bijan Robinson forcing run commitments, Drake London drawing coverage — creates leverage positions for Pitts against lighter defenders. His 6'6\", 245 lbs frame with 4.44 speed is still generational, and if targets reach 100+, his ceiling rivals the top TEs. A boom-or-bust TE with legitimate upside to be TE1 overall.",
    ["Generational athletic profile — 6'6\" and 4.44 speed","Atlanta offense creates coverage leverage","Age 25 — ascending player","Elite receiving ability when given opportunity","Bijan draws linebackers out of the picture"],
    ["Target count — 75-85 targets isn't elite TE1","Atlanta feeds Robinson first in all game scripts","Injury history creates risk"],
    ["elite-upside","boom-bust","athletic-freak","ceiling-play"]),

  p(59,"QB9","Jalen Hurts","PHI","QB",5,57.5,59,
    342,322,342,"high","medium",27,5,
    "Hurts remains a top-5 fantasy QB thanks to his rushing contribution — 500+ yards and 10+ TDs annually on the ground. Philadelphia's OL is the best in football, and the additions of AJ Brown (departed) replacement receivers keep the passing game functional. In 2-QB leagues he's an early target; in 1-QB he's a round 5–6 value. His floor never dips because of the legs.",
    ["500+ rushing yards annually — unmatched floor","Philadelphia OL is best in football","Consistent QB1 floor even in bad passing days","Red-zone rushing TDs — 10+ per year","Age 27 — prime passing window"],
    ["AJ Brown departure requires WR adjustment","Passing accuracy limitations cap ceiling","Injury risk with rushing volume"],
    ["dual-threat","rushing-floor","safe-pick","injury-risk"]),

  p(60,"TE8","Travis Kelce","KC","TE",5,45.0,60,
    178,168,153,"medium","medium",36,11,
    "Kelce at 36 is no longer the slam-dunk pick of years past, but he retains one thing no other TE can replicate: the Mahomes connection. He'll still see 85-90 targets and post respectable TE1 numbers in the right week, but the explosive ceiling weeks are rarer. In a deep TE class, there's a reasonable argument he falls to TE6-7 in value. Buy the floor, not the ceiling — and only draft him if TEs ahead are gone.",
    ["Mahomes targets him in critical moments","Elite football IQ — route precision still sharp","Red-zone familiarity and TD opportunities","Kansas City offense creates favorable game scripts","Floor is real — won't have a completely empty week"],
    ["Age 36 — statistical decline is real and ongoing","Snap count managed late in season","Travis Hunter limits his target share"],
    ["veteran","floor-player","age-concern","td-dependent"]),

  // ─── TIER 6: DEEP STASH (Picks 61–75) ────────────────────────────────────

  p(61,"RB19","Gus Edwards","CAR","RB",6,53.0,61,
    195,183,162,"high","medium",29,11,
    "Edwards is the workhorse back in Carolina's rebuilding offense — a physical, downhill runner who consistently earns 18-20 carries per game when given the opportunity. Carolina's commitment to the running game means he has floor, and his goal-line role gives him TD upside. A late-round RB2 value.",
    ["Carolina's lead back in a run-heavy scheme","Physical runner — reliable short yardage","Goal-line TD opportunities","18-20 carries per game upside","Age 29 — proven durability"],
    ["Carolina's offense limits overall ceiling","Limited pass-catching role","Offense still rebuilding around him"],
    ["bellcow","workhorse","td-dependent","floor-player"]),

  p(62,"WR26","Xavier Worthy","KC","WR",6,61.0,62,
    185,173,152,"high","medium",22,11,
    "Worthy's 4.21 speed is the fastest in football, and Mahomes throws deep with elite accuracy. He's established himself as Kansas City's primary vertical threat, with big-play potential every time he touches the ball. His target volume (70-80) limits his floor, but his TD ceiling — especially in red zone speed-corner routes — is elite.",
    ["Fastest player in NFL — 4.21 speed","Mahomes throws to him deep — elite accuracy","Kansas City red-zone speed routes","Age 22 — ascending player","Big-play machine on every route"],
    ["Limited target volume — TD-dependent","Rashee Rice limits overall passing share","Inconsistent game-to-game production"],
    ["speed-merchant","td-dependent","ceiling-play","young-stud"]),

  p(63,"TE9","Evan Engram","JAX","TE",6,62.0,63,
    175,164,149,"high","medium",30,7,
    "Engram has been one of the most consistent target-share TEs in the league — Jacksonville funnels 90+ targets his way as the primary receiving weapon in the short-middle area. His athleticism creates weekly mismatches, and Trevor Lawrence's improved accuracy has elevated their connection. A solid TE2 with upside in favorable matchups.",
    ["90+ targets — consistent TE2 floor","Lawrence-Engram connection is genuine","Jacksonville's clear TE1 role","Elite athleticism creates mismatches","Consistent regardless of matchup"],
    ["Age 30 — physical decline possible","Jacksonville's inconsistent offense","Lawrence variance creates weekly risk"],
    ["floor-player","consistent","elite-te"]),

  p(64,"WR27","Mike Evans","TB","WR",6,63.0,64,
    182,170,149,"high","medium",33,11,
    "Evans is Tampa Bay's red-zone monster and has delivered 1,000+ yards for an NFL-record consecutive number of seasons. At 33, the ceiling has narrowed but the floor remains real — Baker Mayfield looks to him in the end zone at an elite rate. In scoring-heavy formats, Evans is a reliable WR3/flex with 10+ TD upside.",
    ["Consecutive 1,000-yard seasons — NFL record","Tampa Bay red-zone priority target","Baker Mayfield looks to him first near goal line","Consistent veteran production","10+ TD upside annually"],
    ["Age 33 — approaching decline","Limited deep-route ability slowing","Keon Coleman emerging for chunk plays"],
    ["veteran","consistent","red-zone-threat","td-dependent"]),

  p(65,"WR28","Jaxon Smith-Njigba","SEA","WR",6,80.0,65,
    178,166,146,"high","medium",23,5,
    "JSN has taken over as Seattle's clear #1 receiver with DK Metcalf's departure. His PPR-friendly slot-heavy role generates consistent target volume, and his YAC ability and route running are top-25 in the league. At 23, he's entering his best seasons. Monitor his target share in training camp.",
    ["Seattle's clear #1 receiver post-Metcalf","Elite slot route running","Age 23 — ascending player","80+ reception ceiling in pass-heavy scheme","Consistent YAC ability"],
    ["Seattle's QB situation creates variance","Limited big-play ceiling from the slot"],
    ["young-stud","ppr-specialist","ascending","slot-monster"]),

  p(66,"RB20","Christian McCaffrey","SF","RB",6,70.0,66,
    178,166,146,"elite","high",30,9,
    "CMC's 2023 historic season feels distant after back-to-back injury-shortened campaigns. San Francisco remains cautious with his workload, and at 30 he's entering the back nine of his career. When healthy, no player at any position is more complete — but healthy is the key word. His ADP has dropped to where the value is genuine, but only if you believe in the medical staff's optimism. A high-risk, high-reward selection in rounds 6–8.",
    ["Peak potential is still top-3 at any position","San Francisco's scheme tailor-made for his skills","Elijah Mitchell provides clear handcuff","Elite pass protection — all three downs"],
    ["Age 30 — back-to-back injury-shortened seasons","San Francisco being cautious with workload","Mitchell could take over if health regresses"],
    ["elite-upside","injury-risk","all-purpose","age-concern"]),

  p(67,"QB10","Quentin Johnston AKA CJ Stroud","HOU","QB",6,68.0,67,
    318,298,318,"high","medium",24,14,
    "Stroud is an elite young passer with one of the league's best receiving corps. His 4,500+ yard upside and 35+ TD ceiling make him a value QB in rounds 6–8 of 1-QB leagues. Tank Dell and Stefon Diggs give him weapons, and Houston's pass-heavy identity means consistent volume.",
    ["Elite arm talent — one of best young QBs","Tank Dell and Diggs as top weapons","Houston consistently pass-heavy","4,500+ yard ceiling","Age 24 — ascending"],
    ["Houston's defense means comeback situations","Limited rushing contribution for floor","Diggs injury history creates downside"],
    ["consistent","ascending","young-stud","safe-pick"]),

  p(68,"WR29","Quentin Johnston","LAC","WR",6,58.0,68,
    172,160,140,"high","medium",23,5,
    "Johnston has developed into a legitimate starting WR in Los Angeles with elite athleticism and improving route running. The Chargers built their passing game around his vertical ability, and his 6'4\" frame makes him a red-zone target. He's a WR2/3 with ceiling weeks when Harbaugh's offense unlocks the deep ball.",
    ["Elite athleticism — 6'4\" and elite speed","LA Chargers committed to him as their WR1","Vertical threat in play-action offense","Age 23 — still developing","Red-zone target due to size"],
    ["Still developing route tree complexity","LA Chargers offense consistency varies","Limited proven track record at the NFL level"],
    ["young-stud","ceiling-play","ascending","vertical-threat"]),

  p(69,"RB21","Chuba Hubbard","CAR","RB",6,65.0,69,
    168,157,138,"high","medium",26,11,
    "Hubbard has quietly become a reliable RB2 in Carolina. His receiving ability (45+ receptions) and consistent 15-18 carries give him PPR floor in a rebuilding offense. If Gus Edwards misses time, Hubbard becomes an immediate RB2. A late-round handcuff with starter upside.",
    ["Immediate starter if Edwards misses time","Carolina commits to running game","45+ receptions — PPR value","Age 26 — proven NFL performer","Reliable floor in any scenario"],
    ["Edwards limits his role","Carolina offense still developing","Limited big-play explosiveness"],
    ["handcuff","floor-player","ppr-specialist","ceiling-play"]),

  p(70,"RB22","Javonte Williams","DEN","RB",6,72.0,70,
    162,151,133,"high","medium",25,9,
    "Williams has recovered from his ACL and reclaimed the starting role in Denver. His receiving ability and explosive burst make him a top-20 back when healthy and given a full workload. Denver's commitment to the ground game and a young offensive line developing around him create floor. A sleeper RB2 in rounds 7–9.",
    ["Full recovery from ACL — back to elite form","Denver commits to the running game","Explosive burst — best after-contact gain","40+ reception upside","Age 25 — entering prime"],
    ["Samaje Perine provides veteran backup","Denver's offense finding itself","Must sustain health for 17 games"],
    ["young-stud","ascending","ceiling-play","injury-risk"]),

  p(71,"WR30","Rashid Shaheed","NO","WR",6,73.0,71,
    158,147,128,"high","medium",25,12,
    "Shaheed is New Orleans' most explosive big-play weapon. His sub-4.4 speed and route-running crispness generate 15+ yards per reception, and when he's the primary target in a game, he can put up WR1 numbers. His inconsistent target share makes him a boom-bust WR3/flex, but the ceiling weeks are legitimate.",
    ["Sub-4.4 speed — explosive big-play threat","New Orleans feeds him in specific game plans","15+ YPR when targeted","Age 25 — ascending player","Ceiling weeks are legitimate WR1 output"],
    ["Inconsistent target share week-to-week","New Orleans offense still rebuilding","TD-dependent in many weeks"],
    ["speed-merchant","boom-bust","ceiling-play","sleeper"]),

  p(72,"TE10","Isaiah Likely","BAL","TE",6,75.0,72,
    155,145,130,"high","medium",25,14,
    "Likely has taken over as Baltimore's primary receiving TE after Freiermuth's departure and Mark Andrews' reduced role. His athleticism is exceptional for the position — he's a receiver-first TE who generates consistent YAC. Lamar Jackson's play-action game creates favorable matchups for him weekly. A TE2 with TE1 upside if Andrews' role declines further.",
    ["Baltimore's TE1 receiving role","Lamar Jackson play-action creates easy looks","Elite athleticism for TE position","Age 25 — ascending","25+ point ceiling weeks when featured"],
    ["Bye week 14 — late season","Andrews still on roster — split possible","Baltimore can be run-heavy"],
    ["young-stud","ceiling-play","ascending","positional-scarcity"]),

  p(73,"WR31","Jordan Addison","MIN","WR",6,77.0,73,
    152,142,124,"high","low",24,6,
    "Addison has emerged as a legitimate WR2 in Minnesota's offense alongside Justin Jefferson. JJ's double-team attention creates consistent single coverage for Addison, and his route running — elite from USC — translates perfectly. His 85+ reception ceiling in a pass-heavy offense makes him a reliable WR3 with WR2 weeks when JJ draws extra coverage.",
    ["Single coverage weekly with JJ drawing doubles","Minnesota feeds him in scoring situations","85+ reception upside","Rising trajectory — improving annually","Age 24 — ascending"],
    ["JJ injury risk could disrupt target distribution","Minnesota offense can be inconsistent"],
    ["scheme-product","young-stud","floor-player","consistent"]),

  p(74,"TE11","Tucker Kraft","GB","TE",6,78.0,74,
    148,139,124,"high","medium",25,5,
    "Kraft has developed into a legitimate TE1 weapon in Jordan Love's offense. Green Bay's scheme creates favorable TE matchups, and Kraft's athleticism — rare for an inline blocker — allows him to stay on the field all three downs and generate targets. He's a consistent TE2 with top-10 upside in the right matchup.",
    ["Jordan Love creates favorable TE situations","Elite athleticism for inline TE","Green Bay TE target volume is real","Age 25 — ascending","Consistent TE2 floor"],
    ["Inconsistent use in early down vs. passing down","Green Bay WRs limit target share"],
    ["young-stud","ceiling-play","positional-scarcity","ascending"]),

  p(75,"RB23","Tyjae Spears","TEN","RB",6,79.0,75,
    145,136,119,"high","medium",24,5,
    "Spears is the pass-catching complement to Tony Pollard in Tennessee. His 50+ reception upside and big-play ability make him a PPR sleeper with standalone value. If Pollard misses time, Spears becomes an immediate starter with RB2 potential. A round 7–9 sleeper with legitimate upside.",
    ["Tony Pollard handcuff with standalone PPR value","50+ reception upside","Elite big-play burst","Age 24 — ascending","Tennessee commits to two-back system"],
    ["Pollard limits his role as starter","Tennessee passing game inconsistency","Limited rushing ceiling"],
    ["handcuff","ppr-specialist","sleeper","young-stud"]),

  // ─── TIER 7: SPECULATIVE / SLEEPERS (Picks 76–100) ───────────────────────

  p(76,"QB11","Caleb Williams","CHI","QB",7,64.0,76,
    295,275,295,"elite","medium",24,7,
    "Williams enters Year 3 with the most weapons of any young QB in the league — Odunze, Burden, Loveland, and D'Andre Swift. If he makes the expected Year 3 leap, he could be a top-5 fantasy QB. His rushing ability gives him a floor, and his arm talent is elite. A speculative QB1B in the back half of drafts.",
    ["Chicago surrounded him with elite weapons","Year 3 leap anticipated — massive upside","Elite arm talent and mobility","Rushing ability gives floor","Odunze/Burden/Loveland trio is best WR/TE trio in draft"],
    ["Still inconsistent — too many mistakes in Years 1-2","Must cut turnovers to reach ceiling","Chicago offense is young and still developing"],
    ["young-stud","ascending","boom-bust","ceiling-play"]),

  p(77,"RB24","Kendre Miller","NO","RB",7,77.0,77,
    118,110,97,"high","medium",23,12,
    "Miller is the explosive complement in New Orleans' backfield and could push for the lead role. His burst and receiving ability give him every-down potential if Kamara's usage is managed. A dynasty-league gem who provides redraft value as a boom-bust flex.",
    ["Clear lead back if Kamara is managed","Explosive burst — elite college production","Young at 23 — huge ceiling","New Orleans feeds backs in passing game"],
    ["Kamara limits his role as long as healthy","New Orleans offense rebuilding","Unproven as full-season starter"],
    ["young-stud","sleeper","ceiling-play","handcuff"]),

  p(78,"WR32","Jayden Reed","GB","WR",7,79.0,78,
    115,106,94,"high","medium",24,5,
    "Reed is a shifty slot receiver who creates yards after catch in Jordan Love's offense. His PPR upside is real — 60+ receptions in the slot — and in the right matchup he's a WR3 starter. A consistent late-round value.",
    ["Jordan Love's slot favorite","60+ reception upside","YAC ability — big plays after catch","Age 24 — ascending","Green Bay passes frequently"],
    ["Inconsistent target share week-to-week","Wicks and Watson exist as competition"],
    ["ppr-specialist","slot-monster","sleeper"]),

  p(79,"WR33","Adonai Mitchell","IND","WR",7,81.0,79,
    108,100,88,"high","medium",22,14,
    "Mitchell is Indianapolis' deep-threat WR developing alongside Pittman and Richardson. His athleticism and 4.35 speed give him big-play upside in a Colts offense that needs vertical weapons. A dynasty gem with redraft sleeper status.",
    ["Elite speed — 4.35 seconds","Indianapolis' vertical threat","Anthony Richardson arm unlocks his ceiling","Age 22 — early development curve","Breakout potential if Richardson improves"],
    ["Must secure consistent role in passing game","Richardson accuracy limits consistent output","Indianapolis WR depth competes for snaps"],
    ["young-stud","sleeper","speed-merchant","ceiling-play"]),

  p(80,"RB25","D'Andre Swift","CHI","RB",7,97.0,80,
    105,97,86,"medium","medium",26,7,
    "Swift's role in Chicago has diminished with the team's focus on their passing attack. He's a PPR contributor when healthy but no longer has the clear bellcow role he once had. A late-round RB4/handcuff in deeper leagues.",
    ["Chicago passes frequently — Swift catches passes","35+ reception potential in the right game plan","Age 26 — serviceable years remaining"],
    ["Role diminished — no longer a workhorse back","Chicago's run game deprioritized","Limited ceiling in current situation"],
    ["ppr-specialist","floor-player","monitor-situation"]),

  p(81,"WR34","Christian Watson","GB","WR",7,82.0,81,
    102,94,83,"elite","high",26,5,
    "Watson's speed (4.36) and athleticism make him a downfield threat in Love's offense, but injuries have been chronic. When healthy he's a legitimate big-play WR with TD upside. A late-round dart with boom-bust ceiling.",
    ["Elite speed — 4.36 40 time","Jordan Love throws deep frequently","TD upside in big-play role","Age 26 — physical prime"],
    ["Injury history — multiple hamstring issues","Inconsistent target share week-to-week"],
    ["speed-merchant","injury-risk","boom-bust","ceiling-play"]),

  p(82,"RB26","Najee Harris","PIT","RB",7,70.5,82,
    98,91,80,"medium","low",27,9,
    "Harris is Pittsburgh's volume back who gets his 15-17 carries but rarely does anything explosive with them. He's a reliable RB4 in deeper leagues — the carries are real, the ceiling is not. Useful in best-ball formats for floor.",
    ["Pittsburgh commits carries to him","Reliable volume for floor","Consistent — rarely misses games"],
    ["Limited explosiveness — low YPC","Pittsburgh offense limits ceiling","DK Metcalf/Pickens limit game scripts"],
    ["floor-player","consistent","workhorse"]),

  p(83,"RB27","Jerome Ford","CLE","RB",7,89.0,83,
    85,79,70,"medium","medium",25,10,
    "Ford is Nick Chubb's primary handcuff. In a Chubb injury scenario, Ford becomes an immediate RB2 in Cleveland's committed running offense. A must-own handcuff if you draft Chubb.",
    ["Immediate Chubb replacement","Cleveland commits to running game","Young and capable — shown ability"],
    ["Chubb limits his role as starter","Limited ceiling unless starter"],
    ["handcuff","sleeper","boom-bust"]),

  p(84,"DST1","San Francisco 49ers","SF","DST",7,75.0,84,
    145,145,145,"high","low",0,9,
    "The 49ers defense remains elite — top-3 in sacks, turnovers, and points allowed. A set-and-forget DST with playoff matchup upside.",
    ["Elite defensive talent","Top-3 in sacks and turnovers","Favorable second-half schedule"],
    ["Injuries could disrupt secondary"],
    ["safe-pick","consistent","elite-floor"]),

  p(85,"WR35","Terry McLaurin","WAS","WR",7,96.0,85,
    88,81,70,"medium","medium",29,14,
    "McLaurin is a reliable veteran WR2 in Washington's rebuilt passing game. Daniels' arm and the team's commitment to the passing game give him 85-90 targets and consistent production. A solid WR4/bye-week fill-in.",
    ["Washington's veteran WR anchor","Jayden Daniels improves his ceiling","Consistent 85-90 target floor","Age 29 — productive years remaining"],
    ["Bye week 14","Limited ceiling in run-first offense","Nabers-type upside not present"],
    ["veteran","consistent","floor-player"]),

  p(86,"QB12","Brock Purdy","SF","QB",7,68.0,86,
    310,290,310,"medium","low",26,9,
    "Purdy remains an elite system QB in Kyle Shanahan's scheme. His efficiency numbers are top-5, and San Francisco's receiving weapons give him consistent production. A round 7–9 QB in 1-QB leagues with QB1 floor.",
    ["Shanahan scheme maximizes efficiency","Elite receiving weapons — Deebo, Kittle, etc.","Consistent top-10 QB floor","Age 26 — in his prime"],
    ["System-dependent — outside SF his value craters","Rushing contribution is minimal","Injury risk in mid-rounds"],
    ["consistent","floor-player","scheme-product","safe-pick"]),

  p(87,"TE12","Dawson Knox","BUF","TE",7,90.0,87,
    88,81,72,"medium","medium",28,12,
    "Knox benefits from Josh Allen's red-zone targets and Buffalo's high-scoring offense. His ceiling weeks — when Allen finds him for a TD or two — are legitimate fantasy winners. A consistent TE2 with TD-dependent upside.",
    ["Josh Allen red-zone targets","Buffalo scores consistently","Reliable TE2 in any lineup"],
    ["Inconsistent target share","Keon Coleman takes some red-zone looks","Age 28"],
    ["floor-player","td-dependent","streaming"]),

  p(88,"DST2","Philadelphia Eagles","PHI","DST",7,87.0,88,
    134,134,134,"high","low",0,5,
    "The Eagles defense is among the most consistent in the NFC. Their pass rush and secondary create weekly streaming value with generated turnovers and sacks.",
    ["Top-5 pass rush","Consistent turnover generation","Favorable NFC schedule"],
    ["NFC East schedule can be brutal"],
    ["consistent","safe-pick"]),

  p(89,"TE13","Jonnu Smith","MIA","TE",7,94.0,89,
    82,76,67,"medium","medium",29,10,
    "Smith is the veteran receiving TE in Miami's system. Tua feeds him in critical moments, and his athleticism makes him a matchup weapon in favorable situations. A streaming TE3 with occasional ceiling weeks.",
    ["Miami offense creates favorable TE matchups","Tua targets him in key situations","Age 29 — productive veteran"],
    ["Waddle and Hill dominate targets","Limited floor in most weeks"],
    ["streaming","veteran","floor-player"]),

  p(90,"QB13","Drake Maye","NE","QB",7,99.0,90,
    248,228,248,"elite","medium",24,14,
    "Maye is New England's QB of the future. Surrounded by AJ Brown and Tee Higgins, his Year 2 development could unlock a top-10 QB season. His dual-threat ability gives him a floor. A round 10+ speculative QB with massive ceiling.",
    ["Elite weapons — AJ Brown and Tee Higgins","Elite arm and athleticism","Year 2 expected improvement","New England committed to him","Rushing ability provides floor"],
    ["Rookie year inconsistency to overcome","Patriots offense still installing","Bye week 14"],
    ["young-stud","ascending","boom-bust","dual-threat"]),

  p(91,"DST3","Buffalo Bills","BUF","DST",7,91.0,91,
    128,128,128,"high","low",0,12,
    "Buffalo's defense is rebuilt and capable of elite production. Their pass rush and secondary are among the best in the AFC.",
    ["Consistent sack generation","Allen offense limits negative game scripts","Turnover-prone opponents"],
    ["Occasional run defense lapses"],
    ["consistent","safe-pick"]),

  p(92,"K1","Harrison Butker","KC","K",7,92.0,92,
    155,155,155,"high","low",0,11,
    "Butker is the consensus top kicker in fantasy — Kansas City's dominant red-zone offense creates the most field goal and PAT opportunities in the NFL. Elite accuracy (95%+ FG rate) makes him the safest K1.",
    ["KC offense generates kicking opportunities","Elite accuracy — 95%+ FG rate","Consistent PATs in high-scoring offense"],
    ["KC's scoring pace creates high expectations"],
    ["consistent","safe-pick","elite-floor"]),

  p(93,"WR36","Dontayvion Wicks","GB","WR",7,76.5,93,
    82,75,66,"high","medium",24,5,
    "Wicks has developed into a legitimate WR2 in Green Bay alongside Jordan Love. His red-zone ability and big-play potential make him a boom-bust WR4/flex with ceiling weeks when Love targets him down the seam.",
    ["Love feeds red-zone targets to him","Green Bay passes frequently","Young — developing","Age 24 — ascending"],
    ["Inconsistent target share","Reed and Watson competition"],
    ["young-stud","boom-bust","ceiling-play"]),

  p(94,"RB28","Rachaad White","TB","RB",7,81.0,94,
    78,72,63,"medium","medium",26,11,
    "White is Tampa Bay's pass-catching back. His receiving role (50+ receptions) makes him viable in PPR formats despite a limited rushing role behind Gus Edwards and others. A PPR-only streaming option.",
    ["Tampa Bay passes frequently","50+ reception upside","Mayfield targets him in passing game"],
    ["Limited rushing ceiling","Red-zone role unclear","Tampa Bay WRs dominate targets"],
    ["ppr-specialist","consistent","floor-player"]),

  p(95,"DST4","Dallas Cowboys","DAL","DST",7,83.0,95,
    138,138,138,"medium","low",0,7,
    "Dallas has one of the most talented defensive units in the NFC. Micah Parsons leads a pass rush that generates sacks and turnovers weekly.",
    ["Micah Parsons is elite","Top-5 pass rush","Generates turnovers consistently"],
    ["Injuries to secondary possible"],
    ["safe-pick","consistent"]),

  p(96,"K2","Justin Tucker","BAL","K",7,96.0,96,
    148,148,148,"high","low",0,14,
    "Tucker — when healthy — is the most accurate kicker in NFL history. Baltimore's scoring and his record-setting range make him a top-3 kicker option, though the bye week 14 limits late-season value.",
    ["Most accurate kicker ever","Baltimore scores regularly","Elite range — makes 60-yarders"],
    ["Age and recent injury history","Bye week 14 — late in season"],
    ["consistent","veteran"]),

  p(97,"DST5","Baltimore Ravens","BAL","DST",7,95.0,97,
    122,122,122,"high","low",0,14,
    "Baltimore's defense remains elite under their defensive scheme. Their ability to generate turnovers and sacks makes them a weekly streaming option.",
    ["Elite turnover generation","Consistent sack production","Lamar offense limits negative scripts"],
    ["Bye week 14 — late","Occasional run-defense lapses"],
    ["consistent","safe-pick"]),

  p(98,"RB29","Austin Ekeler","FA","RB",7,97.5,98,
    68,63,55,"medium","high",30,8,
    "Ekeler is a veteran looking for a landing spot. If he signs somewhere with a role, his pass-catching ability (60+ receptions) gives him immediate PPR value. Monitor his signing — the right situation makes him a round 10+ starter.",
    ["Elite pass-catcher for RB","Works in any scheme","Instant PPR value if he signs"],
    ["No confirmed landing spot","Age 30","Must sign before he has value"],
    ["monitor-situation","ppr-specialist","veteran"]),

  p(99,"QB14","Jared Goff","DET","QB",7,100.0,99,
    328,308,328,"medium","low",32,5,
    "Goff has delivered back-to-back top-8 QB seasons in Detroit's prolific offense. He doesn't have rushing contribution but his efficiency — 4,500+ yards and 30+ TDs — and the weapons around him make him a consistent late-round QB value.",
    ["Detroit offense is consistently top-3 in scoring","Gibbs, St. Brown, LaPorta create easy throws","Consistent 30+ TDs annually","Efficient — limits turnovers","Age 32 — peak passing years"],
    ["No rushing contribution","Detroit game scripts can run-heavy when leading big"],
    ["consistent","floor-player","safe-pick","veteran"]),

  p(100,"DST6","Kansas City Chiefs","KC","DST",7,100.0,100,
    118,118,118,"medium","low",0,11,
    "The Chiefs defense is consistently above-average with strong pass-rush talent. In the right matchup, they're a weekly streaming option with KC's offense limiting negative game scripts.",
    ["Consistent sack generation","KC offense limits negative scripts","Elite coaching scheme"],
    ["Aging defenders in secondary","Opponents game-plan for their scheme"],
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
  4:  "Fill your weakest position. If no TE in rounds 1-3, consider LaPorta or Njoku tier. Late QBs have value.",
  5:  "Flex and depth. Quality RB2/WR2 who can start. Handcuffs for your workhorse backs.",
  6:  "Target upside: sleepers and high-ceiling depth. Don't settle for floor-only players here.",
  7:  "Handcuffs — protect your key RBs. Injury risks at low ADP become buy-low targets.",
  8:  "Streaming DST and K. Elite defenses go fast. Top kickers in best offenses are safe.",
  9:  "Rookie upside picks, late TEs, emerging receivers. Swing for potential.",
  10: "Best available anywhere. Roster builds here, season wins here.",
  11: "Pure speculation — boom or bust. Target high upside.",
  12: "Lottery tickets. Best possible ADP value, highest ceiling possible.",
};
