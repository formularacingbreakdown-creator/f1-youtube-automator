import Anthropic from "@anthropic-ai/sdk";
import { getAvoidList } from "./history.js";
import type { VideoMode, RaceData, ScriptOutput } from "./types.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function buildRacePrompt(data: RaceData): string {
  const top10 = data.race.results
    .slice(0, 10)
    .map((r) => {
      const gained = parseInt(r.grid) - parseInt(r.position);
      const movement = gained > 0 ? `(+${gained} places)` : gained < 0 ? `(${gained} places)` : "(held position)";
      return `P${r.position}: ${r.driver.givenName} ${r.driver.familyName} (${r.constructor.name}) — Grid: P${r.grid} ${movement}${r.time?.time ? ` — ${r.time.time}` : ` — ${r.status}`}`;
    })
    .join("\n");

  const pitStopSummary = (data.pitStops || [])
    .map((p) => `${p.driverId}: Stop ${p.stop} on Lap ${p.lap} (${p.duration}s)`)
    .join("\n") || "No pit stop data available";

  // Summarize position changes from lap data
  let positionChanges = "No lap data available";
  if (data.lapTimings && data.lapTimings.length > 0) {
    const firstLap = data.lapTimings[0];
    const lastLap = data.lapTimings[data.lapTimings.length - 1];
    const changes: string[] = [];
    for (const endTiming of lastLap.timings.slice(0, 5)) {
      const startTiming = firstLap.timings.find((t) => t.driverId === endTiming.driverId);
      if (startTiming) {
        const diff = parseInt(startTiming.position) - parseInt(endTiming.position);
        if (Math.abs(diff) >= 2) {
          changes.push(`${endTiming.driverId}: P${startTiming.position} → P${endTiming.position} (${diff > 0 ? "+" : ""}${diff})`);
        }
      }
    }
    if (changes.length > 0) positionChanges = changes.join("\n");
  }

  return `You are an expert F1 strategist and commentator creating a YouTube Shorts script that breaks down WHY the race result happened — not just what happened.

**Race:** ${data.race.raceName} (Round ${data.race.round})
**Circuit:** ${data.race.circuit.circuitName}, ${data.race.circuit.location.locality}, ${data.race.circuit.location.country}
**Date:** ${data.race.date}

**Top 10 Results (with grid position changes):**
${top10}

**Pit Stop Data:**
${pitStopSummary}

**Key Position Changes (lap 1 vs final):**
${positionChanges}

Generate a JSON object (no markdown fences, just raw JSON):

{
  "title": "Max 70 chars. MUST start with a number or surprising fact. Focus on the strategic story.",
  "description": "2-3 sentences about the strategy story. No timestamps. No hashtags — they are added automatically.",
  "tags": ["5 SEO tags including F1 2026 strategy"],
  "script": "A 55-60 second spoken-word script (140-160 words). Explain WHY the result happened: pit stop timing, undercut/overcut attempts, tire strategy, position gains/losses, defensive driving. Be specific — cite lap numbers and position changes. Open with a bold strategic claim. End with a question about the strategy call."
}

Rules:
- Focus on strategy, not just results
- Cite specific pit stop laps and durations when available
- Explain undercuts, overcuts, and tire degradation
- Be opinionated about whether the right strategy calls were made
- Short punchy sentences for YouTube Shorts`;
}

function buildChampionshipPrompt(data: RaceData): string {
  const top5Drivers = data.driverStandings.slice(0, 5);
  const driverTable = top5Drivers
    .map((s, i) => {
      const gap = i > 0 ? ` (${parseFloat(s.points) - parseFloat(top5Drivers[0].points)} from P1)` : " (LEADER)";
      return `P${s.position}: ${s.driver.givenName} ${s.driver.familyName} — ${s.points} pts, ${s.wins} wins${gap}`;
    })
    .join("\n");

  // Calculate gaps between consecutive positions
  const gaps: string[] = [];
  for (let i = 0; i < top5Drivers.length - 1; i++) {
    const gap = parseFloat(top5Drivers[i].points) - parseFloat(top5Drivers[i + 1].points);
    gaps.push(`P${top5Drivers[i].position} to P${top5Drivers[i + 1].position}: ${gap} points`);
  }

  const constructorTop5 = data.constructorStandings
    .slice(0, 5)
    .map((s) => `P${s.position}: ${s.constructor.name} — ${s.points} pts`)
    .join("\n");

  const racesRemaining = data.totalRounds ? data.totalRounds - parseInt(data.race.round) : "unknown";
  const maxPointsPerRace = 26; // 25 for win + 1 for fastest lap

  return `You are an F1 championship analyst creating a YouTube Shorts script about the current championship mathematics.

**After Round ${data.race.round}/${data.totalRounds || "?"} (${data.race.raceName})**
**Races Remaining: ${racesRemaining}**
**Max points available per race: ${maxPointsPerRace}**

**Driver Championship Top 5:**
${driverTable}

**Gaps Between Positions:**
${gaps.join("\n")}

**Constructor Championship Top 5:**
${constructorTop5}

Generate a JSON object (no markdown fences, just raw JSON):

{
  "title": "Max 70 chars. MUST start with a number or surprising fact about the championship battle.",
  "description": "2-3 sentences about championship scenarios and what each driver needs. No timestamps. No hashtags — they are added automatically.",
  "tags": ["5 SEO tags including F1 2026 championship standings"],
  "script": "A 55-60 second spoken-word script (140-160 words). For each of the top 5 drivers, explain EXACTLY what they need from the next race to gain or protect their position. Use specific numbers — point gaps, how many wins needed, mathematical elimination scenarios. Cover the constructor battle briefly. End with your prediction on who will be champion."
}

Rules:
- Use specific numbers and math — this is about championship MATH
- Explain exact scenarios: "If X wins and Y finishes below P4, the gap becomes..."
- Cover all top 5 drivers, not just the leader
- Mention the constructor battle
- Be bold — make a championship prediction
- Short punchy sentences for YouTube Shorts`;
}

function buildPredictionPrompt(data: RaceData): string {
  const upcoming = data.upcomingRace;
  if (!upcoming) {
    return buildRacePrompt(data); // Fallback if no upcoming race
  }

  // Analyze historical winners at this circuit
  const history = data.circuitHistory || [];
  const winnerCount: Record<string, number> = {};
  const constructorCount: Record<string, number> = {};
  const podiumDrivers: Record<string, number> = {};

  for (const race of history) {
    for (const result of race.podium) {
      podiumDrivers[result.driver] = (podiumDrivers[result.driver] || 0) + 1;
      if (result.position === "1") {
        winnerCount[result.driver] = (winnerCount[result.driver] || 0) + 1;
        constructorCount[result.constructor] = (constructorCount[result.constructor] || 0) + 1;
      }
    }
  }

  const topWinners = Object.entries(winnerCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([driver, wins]) => `${driver}: ${wins} wins`)
    .join("\n") || "No historical winners found";

  const topConstructors = Object.entries(constructorCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([team, wins]) => `${team}: ${wins} wins`)
    .join("\n") || "No historical data";

  const historyDetail = history
    .slice(-5)
    .map((r) => `${r.season}: 1st ${r.podium[0]?.driver} (${r.podium[0]?.constructor}), 2nd ${r.podium[1]?.driver}, 3rd ${r.podium[2]?.driver}`)
    .join("\n") || "No recent race data";

  const currentTopDrivers = data.driverStandings
    .slice(0, 10)
    .map((s) => `${s.driver.givenName} ${s.driver.familyName} (${s.constructors[0]?.name}) — ${s.points} pts`)
    .join("\n");

  return `You are an F1 prediction analyst creating a YouTube Shorts script predicting who will win the upcoming race.

**Upcoming Race:** ${upcoming.raceName} (Round ${upcoming.round})
**Circuit:** ${upcoming.circuit.circuitName}, ${upcoming.circuit.location.locality}, ${upcoming.circuit.location.country}
**Date:** ${upcoming.date}

**Historical Winners at ${upcoming.circuit.circuitName}:**
${topWinners}

**Most Successful Constructors at This Circuit:**
${topConstructors}

**Last 5 Races at This Circuit:**
${historyDetail}

**Current 2026 Championship Standings (Top 10):**
${currentTopDrivers}

Generate a JSON object (no markdown fences, just raw JSON):

{
  "title": "Max 70 chars. MUST start with a number or surprising fact about the prediction.",
  "description": "2-3 sentences about your prediction and evidence. No timestamps. No hashtags — they are added automatically.",
  "tags": ["5 SEO tags including F1 2026 prediction and circuit name"],
  "script": "A 55-60 second spoken-word script (140-160 words). Predict who will win and WHY. Use historical circuit data to show which teams dominate here. Compare to current form — are the historically strong teams still competitive in 2026? Call out dark horse picks. Make a bold podium prediction (P1, P2, P3). End with 'Do you agree? Drop your prediction in the comments.'"
}

Rules:
- Lead with your bold prediction — don't build up to it
- Use historical data as evidence
- Compare historical dominance to 2026 current form
- Call out which teams suit this circuit's characteristics
- Predict the full podium, not just the winner
- Short punchy sentences for YouTube Shorts`;
}

export async function generateScript(raceData: RaceData, mode: VideoMode = "race"): Promise<ScriptOutput> {
  const modeLabels: Record<VideoMode, string> = {
    race: "RACE BREAKDOWN",
    championship: "CHAMPIONSHIP MATH",
    prediction: "RACE PREDICTION",
  };
  console.log(`[Script] Generating ${modeLabels[mode]} script with Claude...`);

  const client = new Anthropic();

  const promptBuilders: Record<VideoMode, (data: RaceData) => string> = {
    race: buildRacePrompt,
    championship: buildChampionshipPrompt,
    prediction: buildPredictionPrompt,
  };

  const prompt = promptBuilders[mode](raceData) + getAvoidList(mode);

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const parsed: ScriptOutput = JSON.parse(text);

      if (!parsed.title || !parsed.description || !parsed.tags || !parsed.script) {
        throw new Error("Response missing required fields");
      }

      console.log(`[Script] Generated title: "${parsed.title}"`);
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  Script generation attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError!;
}
