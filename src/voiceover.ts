import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const OUTPUT_DIR = "output";

export async function generateVoiceover(scriptText: string): Promise<{ filePath: string; durationSeconds: number }> {
  console.log("[Voiceover] Generating voiceover via ElevenLabs...");

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID environment variables");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, "voiceover.mp3");

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: scriptText,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
          },
        },
        {
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          responseType: "arraybuffer",
          timeout: 60000,
        }
      );

      fs.writeFileSync(outputPath, Buffer.from(response.data));
      console.log(`[Voiceover] Saved to ${outputPath}`);

      const durationSeconds = getAudioDuration(outputPath);
      console.log(`[Voiceover] Duration: ${durationSeconds.toFixed(1)}s`);

      return { filePath: outputPath, durationSeconds };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  Voiceover attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError!;
}

function getAudioDuration(filePath: string): number {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: "utf-8" }
    );
    return parseFloat(result.trim());
  } catch {
    console.warn("[Voiceover] Could not determine audio duration via ffprobe, estimating from file size");
    const stats = fs.statSync(filePath);
    // Rough estimate: ~16KB per second for MP3 at 128kbps
    return stats.size / 16000;
  }
}
