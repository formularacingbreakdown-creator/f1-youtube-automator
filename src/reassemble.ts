import "dotenv/config";
import { assembleVideo } from "./videoAssembler.js";

async function main() {
  const outputName = process.argv[2] || "final_video_reassembled.mp4";
  console.log(`[Reassemble] Building vertical TikTok video → ${outputName}`);
  const videoPath = await assembleVideo("output/voiceover.mp3", outputName);
  console.log(`\nDone! New video saved to: ${videoPath}`);
}

main().catch((error) => {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
