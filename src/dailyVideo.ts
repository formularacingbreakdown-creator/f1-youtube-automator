import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { generateVoiceover } from "./voiceover.js";
import { assembleVideo } from "./videoAssembler.js";
import { uploadToYouTube } from "./youtubeUploader.js";
import { generateThumbnail } from "./thumbnailGenerator.js";
import { getAvoidList, saveEntry } from "./history.js";
import type { ScriptOutput } from "./types.js";

const BASE_URL = "https://api.jolpi.ca/ergast/f1";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const OUTPUT_DIR = "output";

type ContentType = "daily-stat" | "head-to-head" | "on-this-day" | "best-ever";

const CONTENT_TYPES: ContentType[] = ["daily-stat", "head-to-head", "on-this-day", "best-ever"];

const LEGENDARY_DRIVERS = [
  ["Michael Schumacher", "Ayrton Senna"],
  ["Lewis Hamilton", "Michael Schumacher"],
  ["Ayrton Senna", "Alain Prost"],
  ["Lewis Hamilton", "Max Verstappen"],
  ["Sebastian Vettel", "Fernando Alonso"],
  ["Jim Clark", "Juan Manuel Fangio"],
  ["Niki Lauda", "James Hunt"],
  ["Mika Häkkinen", "Michael Schumacher"],
  ["Alain Prost", "Nigel Mansell"],
  ["Max Verstappen", "Charles Leclerc"],
];

const BEST_EVER_TOPICS = [
  "most dominant single race victory in F1 history (largest winning margin)",
  "greatest comeback drive from furthest back on the grid",
  "most consecutive race wins by a single driver",
  "fastest pit stops in F1 history",
  "most poles in a single season",
  "closest championship battles decided by fewest points",
  "most overtakes in a single race",
  "longest winning streaks by constructors",
];

async function fetchWithRetry<T>(url: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<T>(url, { timeout: 15000 });
      return response.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`  Attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`);
      if (attempt === MAX_RETRIES) throw error;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("Unreachable");
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Use today's date to seed a deterministic-ish pick so reruns on the same day get the same type
function getTodaysContentType(): ContentType {
  const today = new Date();
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  );
  return CONTENT_TYPES[dayOfYear % CONTENT_TYPES.length];
}

// ── Data fetchers ──

async function fetchDailyStatData(): Promise<string> {
  // Pick a random season and fetch its champion + stats
  const season = 1950 + Math.floor(Math.random() * 75); // 1950–2024
  console.log(`[Data] Fetching stats for ${season} season...`);

  const [standingsResp, raceResp] = await Promise.all([
    fetchWithRetry<any>(`${BASE_URL}/${season}/driverStandings.json`).catch(() => null),
    fetchWithRetry<any>(`${BASE_URL}/${season}/results/1.json?limit=100`).catch(() => null),
  ]);

  const standings = standingsResp?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;
  const wins = raceResp?.MRData?.RaceTable?.Races;

  let context = `Season: ${season}\n`;

  if (standings && standings.length > 0) {
    const champ = standings[0];
    context += `Champion: ${champ.Driver.givenName} ${champ.Driver.familyName} (${champ.Constructors?.[0]?.name || "unknown"}) — ${champ.points} pts, ${champ.wins} wins\n`;
    context += `Runner-up: ${standings[1]?.Driver?.givenName} ${standings[1]?.Driver?.familyName} — ${standings[1]?.points} pts\n`;
    const gap = parseFloat(champ.points) - parseFloat(standings[1]?.points || "0");
    context += `Championship margin: ${gap} points\n`;
  }

  if (wins && wins.length > 0) {
    context += `Total race wins that season: ${wins.length}\n`;
    const winners = wins.map((r: any) => `${r.Results[0].Driver.givenName} ${r.Results[0].Driver.familyName} at ${r.raceName}`);
    context += `Winners: ${winners.join(", ")}\n`;
  }

  return context;
}

async function fetchHeadToHeadData(): Promise<string> {
  const [driver1, driver2] = pickRandom(LEGENDARY_DRIVERS);
  console.log(`[Data] Fetching head-to-head: ${driver1} vs ${driver2}...`);

  // Fetch career stats for both
  async function getDriverStats(name: string) {
    const lastName = name.split(" ").pop()!.toLowerCase();
    const searchResp = await fetchWithRetry<any>(`${BASE_URL}/drivers/${lastName}.json`).catch(() => null);
    const standingsResp = await fetchWithRetry<any>(`${BASE_URL}/drivers/${lastName}/driverStandings.json?limit=100`).catch(() => null);
    const winsResp = await fetchWithRetry<any>(`${BASE_URL}/drivers/${lastName}/results/1.json?limit=200`).catch(() => null);

    const standings = standingsResp?.MRData?.StandingsTable?.StandingsLists || [];
    const championships = standings.filter((s: any) => s.DriverStandings?.[0]?.position === "1").length;
    const totalWins = parseInt(winsResp?.MRData?.total || "0");
    const seasons = standings.length;

    return { name, championships, totalWins, seasons };
  }

  const [stats1, stats2] = await Promise.all([getDriverStats(driver1), getDriverStats(driver2)]);

  return `HEAD TO HEAD COMPARISON:

Driver 1: ${stats1.name}
- Championships: ${stats1.championships}
- Race wins: ${stats1.totalWins}
- Seasons: ${stats1.seasons}

Driver 2: ${stats2.name}
- Championships: ${stats2.championships}
- Race wins: ${stats2.totalWins}
- Seasons: ${stats2.seasons}`;
}

async function fetchOnThisDayData(): Promise<string> {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  console.log(`[Data] Searching for F1 races on ${month}-${day}...`);

  // Search through recent decades for races on today's date
  const matchingRaces: string[] = [];

  for (let year = 2024; year >= 1950; year -= 3) {
    try {
      const resp = await fetchWithRetry<any>(`${BASE_URL}/${year}/results.json?limit=100`);
      const races = resp.MRData?.RaceTable?.Races || [];
      for (const race of races) {
        const raceDate = race.date; // "YYYY-MM-DD"
        if (raceDate && raceDate.endsWith(`-${month}-${day}`)) {
          const winner = race.Results?.[0];
          if (winner) {
            matchingRaces.push(
              `${race.season} ${race.raceName}: Won by ${winner.Driver.givenName} ${winner.Driver.familyName} (${winner.Constructor.name})${winner.Time?.time ? ` in ${winner.Time.time}` : ""} — Grid: P${winner.grid}, Status: ${winner.status}`
            );
          }
        }
      }
    } catch {
      // Skip years that fail
    }
    if (matchingRaces.length >= 3) break;
  }

  if (matchingRaces.length === 0) {
    // Fallback: find races close to today's date (±2 days)
    console.log("[Data] No exact date match, searching nearby dates...");
    try {
      const resp = await fetchWithRetry<any>(`${BASE_URL}/2023/results.json?limit=100`);
      const races = resp.MRData?.RaceTable?.Races || [];
      for (const race of races.slice(0, 3)) {
        const winner = race.Results?.[0];
        if (winner) {
          matchingRaces.push(
            `${race.season} ${race.raceName} (${race.date}): Won by ${winner.Driver.givenName} ${winner.Driver.familyName} (${winner.Constructor.name})`
          );
        }
      }
    } catch {}
  }

  return `ON THIS DAY IN F1 — ${month}/${day}:

${matchingRaces.length > 0 ? matchingRaces.join("\n\n") : "No races found on this exact date. Use the closest notable F1 historical moment around late March."}

Today's date: ${today.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
}

async function fetchBestEverData(): Promise<string> {
  const topic = pickRandom(BEST_EVER_TOPICS);
  console.log(`[Data] Fetching data for best-ever topic: "${topic}"...`);

  // Fetch a spread of recent championship data for context
  const stats: string[] = [];

  // Get all-time win leaders
  const winsResp = await fetchWithRetry<any>(`${BASE_URL}/drivers.json?limit=30&offset=0`).catch(() => null);

  // Get a few notable season stats
  for (const year of [2023, 2013, 2004, 1992, 1988]) {
    try {
      const resp = await fetchWithRetry<any>(`${BASE_URL}/${year}/driverStandings.json`);
      const champ = resp.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.[0];
      if (champ) {
        stats.push(`${year} champion: ${champ.Driver.givenName} ${champ.Driver.familyName} — ${champ.wins} wins, ${champ.points} pts`);
      }
    } catch {}
  }

  // Get some all-time records
  const allTimeResp = await fetchWithRetry<any>(`${BASE_URL}/driverStandings/1.json?limit=100`).catch(() => null);
  const champions = allTimeResp?.MRData?.StandingsTable?.StandingsLists || [];
  const champCount: Record<string, number> = {};
  for (const season of champions) {
    const driver = season.DriverStandings?.[0]?.Driver;
    if (driver) {
      const name = `${driver.givenName} ${driver.familyName}`;
      champCount[name] = (champCount[name] || 0) + 1;
    }
  }
  const topChamps = Object.entries(champCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}: ${count} titles`)
    .join("\n");

  return `BEST EVER TOPIC: ${topic}

ALL-TIME CHAMPIONSHIP LEADERS:
${topChamps}

NOTABLE DOMINANT SEASONS:
${stats.join("\n")}

Use this data plus your knowledge of F1 history to create the "best ever" ranking for: ${topic}`;
}

// ── Script generation ──

async function generateDailyScript(contentType: ContentType, data: string): Promise<ScriptOutput> {
  console.log(`[Script] Generating ${contentType} script...`);

  const client = new Anthropic();

  const contentInstructions: Record<ContentType, string> = {
    "daily-stat": `Create a "Daily F1 Stat" video. Pick the SINGLE most fascinating stat from the data and build the entire script around it. Open with the number itself — e.g. "7. That's how many championships..." Make the viewer understand why this stat is incredible.`,
    "head-to-head": `Create a "Head to Head" driver comparison video. Compare their careers stat by stat, give your verdict on who was greater, and explain WHY. Be controversial — pick a side. Open with a provocative statement like "One of these drivers is overrated."`,
    "on-this-day": `Create an "On This Day in F1" video. Tell the story of what happened on this date in F1 history. Make it dramatic — set the scene, build tension, deliver the payoff. If multiple events, pick the most dramatic one. Open with the year and a vivid scene-setting line.`,
    "best-ever": `Create a "Best Ever" ranking video. Give a definitive top 3 ranking with evidence. Be bold and opinionated. Open with your #1 pick immediately to hook viewers — don't build up to it.`,
  };

  const prompt = `You are creating a YouTube Shorts script for an F1 history/stats channel.

CONTENT TYPE: ${contentType}
${contentInstructions[contentType]}

DATA:
${data}

Generate a JSON object (no markdown fences, just raw JSON):

{
  "title": "Max 70 characters. MUST start with a number or surprising fact.",
  "description": "2-3 sentences about the content. No hashtags — they are added automatically.",
  "tags": ["5 SEO tags"],
  "script": "A 50-60 second spoken-word script (130-150 words). MUST open with a number, stat, or bold claim in the very first sentence. No stage directions. Short punchy sentences. End with a question to drive comments."
}

Rules:
- First sentence MUST contain a specific number or shocking fact
- Every sentence should be short and punchy — this is a YouTube Short
- Be opinionated and take strong stances
- Use real data from above — don't make up stats
- End with a question that provokes debate in comments
- NO "like and subscribe" — just end with the question${getAvoidList(`daily-${contentType}`)}`;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const parsed: ScriptOutput = JSON.parse(text);

      if (!parsed.title || !parsed.description || !parsed.tags || !parsed.script) {
        throw new Error("Response missing required fields");
      }

      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError!;
}

// ── Main pipeline ──

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const contentType = getTodaysContentType();
  console.log("=== F1 Daily Video Generator ===");
  console.log(`Content type: ${contentType}`);
  console.log(`Date: ${new Date().toLocaleDateString()}\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1: Fetch historical data
  console.log("--- Step 1: Fetching F1 Historical Data ---");
  const dataFetchers: Record<ContentType, () => Promise<string>> = {
    "daily-stat": fetchDailyStatData,
    "head-to-head": fetchHeadToHeadData,
    "on-this-day": fetchOnThisDayData,
    "best-ever": fetchBestEverData,
  };

  const data = await dataFetchers[contentType]();

  // Step 2: Generate script
  console.log("\n--- Step 2: Generating Script ---");
  const scriptOutput = await generateDailyScript(contentType, data);

  console.log(`\nTitle: "${scriptOutput.title}"`);
  console.log(`Description: ${scriptOutput.description}`);
  console.log(`Tags: ${scriptOutput.tags.join(", ")}`);
  console.log(`\nScript:\n${scriptOutput.script}`);

  // Save script
  const scriptPath = path.join(OUTPUT_DIR, `script_daily_${contentType}.json`);
  fs.writeFileSync(scriptPath, JSON.stringify(scriptOutput, null, 2));

  if (dryRun) {
    console.log("\nDry run complete.");
    return;
  }

  // Step 3: Generate voiceover
  console.log("\n--- Step 3: Generating Voiceover ---");
  const { durationSeconds } = await generateVoiceover(scriptOutput.script);
  const voiceoverPath = path.join(OUTPUT_DIR, "voiceover.mp3");
  console.log(`Voiceover duration: ${durationSeconds.toFixed(1)}s`);

  // Step 4: Assemble video
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputFilename = `daily_${contentType}_${timestamp}.mp4`;
  console.log("\n--- Step 4: Assembling Video ---");
  const videoPath = await assembleVideo(voiceoverPath, outputFilename);

  // Step 5: Generate thumbnail
  console.log("\n--- Step 5: Generating Thumbnail ---");
  const thumbnailPath = await generateThumbnail(scriptOutput.title);

  // Step 6: Upload to YouTube as public Short
  console.log("\n--- Step 6: Uploading to YouTube ---");
  const videoUrl = await uploadToYouTube(videoPath, scriptOutput, thumbnailPath);

  // Save to history
  saveEntry({
    date: new Date().toISOString(),
    mode: `daily-${contentType}`,
    title: scriptOutput.title,
    description: scriptOutput.description,
    tags: scriptOutput.tags,
    topicKey: `daily-${contentType}-${timestamp}`,
    youtubeUrl: videoUrl,
    videoFile: outputFilename,
  });

  console.log(`\n=== Daily Video Complete ===`);
  console.log(`Video: ${videoPath}`);
  console.log(`YouTube: ${videoUrl}`);
}

main().catch((error) => {
  console.error("\nFailed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
