// Team Hype — a lead-gen wedge that turns a fan's favorite team into a
// shareable AI hype song, then pushes them to Digital Drift (to generate the
// track) and AIBeatSync (to make the video). Lyrics are generated here via
// Anthropic (fetch-based, no SDK) with a template fallback so it always works.

import { Router } from "express";

export const teamHypeRouter = Router();

interface HypeRequest {
  team: string;
  sport?: string;
  city?: string;
}

function buildPrompt(req: HypeRequest): string {
  return [
    `Write an original, high-energy hype anthem for fans of the ${req.team}${req.sport ? ` (${req.sport})` : ""}.`,
    "It should feel like a stadium walkout / game-day pump-up track — bold, chant-able, and full of team pride.",
    "Do NOT use any real copyrighted lyrics, official slogans, trademarks, player names, or logos. Keep it original and generic enough to be safe.",
    "Structure it with section tags on their own lines: [Intro], [Verse], [Chorus], [Verse], [Bridge], [Chorus], [Outro].",
    "Make the chorus a repeatable crowd chant. Return ONLY the lyrics with section tags.",
  ].join(" ");
}

async function viaAnthropic(req: HypeRequest, key: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.HYPE_ANTHROPIC_MODEL ?? "claude-sonnet-5",
      max_tokens: 1200,
      messages: [{ role: "user", content: buildPrompt(req) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = data.content?.map((b) => b.text ?? "").join("").trim();
  if (!text) throw new Error("Empty lyrics");
  return text;
}

function templateHype(req: HypeRequest): string {
  const team = req.team.trim() || "our team";
  const T = team.toUpperCase();
  return `[Intro]
Lights up — it's game day

[Verse]
Roll in with the colors flying high
Feel the whole arena start to rise
Nothing in the world gonna hold us back
Lock it in, we're ready to attack

[Chorus]
Let's go ${T}! (Let's go!)
Turn it up, feel the whole crowd blow
Let's go ${T}! (Let's go!)
Hands up high, watch 'em steal the show

[Verse]
Heartbeat pounding like a drumline war
This is what we came here for
Every play we're taking flight
Own the moment, own the night

[Bridge]
Louder now, let 'em hear the sound
${team} pride, we don't back down

[Chorus]
Let's go ${T}! (Let's go!)
Turn it up, feel the whole crowd blow
Let's go ${T}! (Let's go!)
Hands up high, watch 'em steal the show

[Outro]
${T}... 'til the final horn`;
}

teamHypeRouter.post("/api/team-hype", async (req, res) => {
  const { team, sport, city } = (req.body ?? {}) as HypeRequest;
  if (!team || team.trim().length < 2) {
    res.status(400).json({ error: "Pick a team first." });
    return;
  }
  const style =
    sport?.toLowerCase().includes("basket") || sport?.toLowerCase() === "nba"
      ? "Hard-hitting hip-hop / trap anthem, booming 808s, chant hooks"
      : "Epic stadium rock-rap hype, big drums, chant hooks";

  const key = process.env.ANTHROPIC_API_KEY;
  let lyrics: string;
  let source = "template";
  try {
    if (key) {
      lyrics = await viaAnthropic({ team, sport, city }, key);
      source = "anthropic";
    } else {
      lyrics = templateHype({ team, sport, city });
    }
  } catch {
    lyrics = templateHype({ team, sport, city });
  }

  res.json({ team, sport: sport ?? null, style, lyrics, source, title: `${team} Hype Anthem` });
});
