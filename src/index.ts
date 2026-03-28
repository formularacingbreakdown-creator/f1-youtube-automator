import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fetchRaceData } from "./f1Data.js";
import { generateScript } from "./scriptWriter.js";
import { generateVoiceover } from "./voiceover.js";
import { assembleVideo } from "./videoAssembler.js";
import { uploadToYouTube } from "./youtubeUploader.js";
import { generateThumbnail } from "./thumbnailGenerator.js";
import { saveEntry } from "./history.js";
import type { VideoMode, RaceData, ScriptOutput } from "./types.js";

const dryRun = process.argv.includes("--dry-run");
const noUpload = process.argv.includes("--no-upload");

const modeArg = process.argv.find((a) => a.startsWith("--mode"))
  ? process.argv[process.argv.indexOf("--mode") + 1] ||
    process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1]
  : undefined;

const VALID_MODES: VideoMode[] = ["race", "championship", "prediction"];
const mode: VideoMode = VALID_MODES.includes(modeArg as VideoMode) ? (modeArg as VideoMode) : "race";

const MODE_LABELS: Record<VideoMode, string> = {
  race: "RACE BREAKDOWN",
  championship: "CHAMPIONSHIP MATH",
  prediction: "RACE PREDICTION",
};

const OUTPUT_DIR = "output";

/**
 * Build a topic key that identifies the content.
 * Same mode + same topic = same audio.
 * e.g. "race_round2", "championship_round2", "prediction_suzuka"
 */
function getTopicKey(mode: VideoMode, raceData: RaceData): string {
  if (mode === "prediction" && raceData.upcomingRace) {
    return `${mode}_${raceData.upcomingRace.circuit.circuitId}`;
  }
  return `${mode}_round${raceData.race.round}`;
}

function getVoiceoverPath(topicKey: string): string {
  return path.join(OUTPUT_DIR, `voiceover_${topicKey}.mp3`);
}

function getScriptPath(topicKey: string): string {
  return path.join(OUTPUT_DIR, `script_${topicKey}.json`);
}

async function main() {
  console.log("=== F1 YouTube Automator ===");
  console.log(`Mode: ${MODE_LABELS[mode]}`);
  console.log(dryRun ? "Pipeline: DRY RUN (steps 1-2 only)" : noUpload ? "Pipeline: NO UPLOAD (steps 1-4)" : "Pipeline: FULL");
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1: Fetch F1 data
  console.log("--- Step 1: Fetching F1 Data ---");
  const raceData = await fetchRaceData(mode);
  const topicKey = getTopicKey(mode, raceData);
  console.log(`[Topic] ${topicKey}`);

  // Step 2: Generate or reuse script
  const scriptPath = getScriptPath(topicKey);
  let scriptOutput: ScriptOutput;

  if (fs.existsSync(scriptPath)) {
    console.log(`\n--- Step 2: Reusing existing script for "${topicKey}" ---`);
    scriptOutput = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    console.log(`[Script] Title: "${scriptOutput.title}"`);
  } else {
    console.log(`\n--- Step 2: Generating ${MODE_LABELS[mode]} Script ---`);
    scriptOutput = await generateScript(raceData, mode);
    fs.writeFileSync(scriptPath, JSON.stringify(scriptOutput, null, 2));
    console.log(`[Script] Saved to ${scriptPath}`);
  }

  if (dryRun) {
    console.log("\n========== DRY RUN OUTPUT ==========");
    console.log(`\nTitle: ${scriptOutput.title}`);
    console.log(`\nDescription:\n${scriptOutput.description}`);
    console.log(`\nTags: ${scriptOutput.tags.join(", ")}`);
    console.log(`\nScript:\n${scriptOutput.script}`);
    console.log("\n====================================");
    console.log("\nDry run complete. No video produced, no upload attempted.");
    return;
  }

  // Step 3: Generate or reuse voiceover
  const voiceoverPath = getVoiceoverPath(topicKey);

  if (fs.existsSync(voiceoverPath)) {
    console.log(`\n--- Step 3: Reusing existing voiceover for "${topicKey}" ---`);
    console.log(`[Voiceover] ${voiceoverPath}`);
  } else {
    console.log("\n--- Step 3: Generating Voiceover ---");
    const { filePath, durationSeconds } = await generateVoiceover(scriptOutput.script);
    // Move to topic-specific path
    fs.renameSync(filePath, voiceoverPath);
    console.log(`Voiceover duration: ${durationSeconds.toFixed(1)}s`);
    console.log(`[Voiceover] Saved to ${voiceoverPath}`);
  }

  // Step 4: Assemble video (always new visuals)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputFilename = `${topicKey}_${timestamp}.mp4`;
  console.log("\n--- Step 4: Assembling Video (new visuals, same audio) ---");
  const videoPath = await assembleVideo(voiceoverPath, outputFilename);

  if (noUpload) {
    console.log(`\n=== Pipeline Complete (no upload) ===`);
    console.log(`Video saved to: ${videoPath}`);
    return;
  }

  // Step 5: Generate thumbnail
  console.log("\n--- Step 5: Generating Thumbnail ---");
  const thumbnailPath = await generateThumbnail(scriptOutput.title);

  // Step 6: Upload to YouTube
  console.log("\n--- Step 6: Uploading to YouTube ---");
  const videoUrl = await uploadToYouTube(videoPath, scriptOutput, thumbnailPath);

  // Save to history
  saveEntry({
    date: new Date().toISOString(),
    mode,
    title: scriptOutput.title,
    description: scriptOutput.description,
    tags: scriptOutput.tags,
    topicKey,
    youtubeUrl: videoUrl,
    videoFile: outputFilename,
  });

  console.log("\n=== Pipeline Complete ===");
  console.log(`Video URL: ${videoUrl}`);
}

main().catch((error) => {
  console.error("\nPipeline failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
