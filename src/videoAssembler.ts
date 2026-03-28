import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const OUTPUT_DIR = "output";
const IMAGES_DIR = path.join(OUTPUT_DIR, "images");
const CLIPS_DIR = path.join(OUTPUT_DIR, "clips");

const FPS = 30;
const CLIP_DURATION = 18;
const WIDTH = 1080;   // YouTube Shorts vertical
const HEIGHT = 1920;
const IMAGES_PER_VIDEO = 5;

// Large pool of F1-related queries — 5 are randomly picked each run
const QUERY_POOL = [
  "Formula One car 2024",
  "Formula One car 2023",
  "Formula 1 race start",
  "F1 Grand Prix podium",
  "Formula One pit stop crew",
  "Formula 1 racing circuit aerial",
  "Formula One helmet driver",
  "F1 car rear wing",
  "Formula 1 Monaco Grand Prix",
  "Formula One steering wheel cockpit",
  "F1 tire change pit",
  "Formula One race night",
  "Formula 1 grid walk",
  "F1 overtake racing",
  "Formula One trophy celebration",
  "Formula 1 garage mechanics",
  "F1 safety car",
  "Formula One rain race wet",
  "Formula 1 paddock",
  "F1 car speed blur",
  "Formula One Ferrari racing",
  "Mercedes Formula One car",
  "Red Bull F1 racing",
  "McLaren Formula 1",
  "Formula One flag checkered",
];

// Ken Burns effects tuned for vertical 9:16
const KEN_BURNS_EFFECTS = [
  `zoompan=z='min(zoom+0.001,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${CLIP_DURATION * FPS}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
  `zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='if(eq(on,1),0,min(y+0.8,ih-ih/zoom))':d=${CLIP_DURATION * FPS}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
  `zoompan=z='min(zoom+0.001,1.2)':x='iw/2-(iw/zoom/2)':y='0':d=${CLIP_DURATION * FPS}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
  `zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='if(eq(on,1),ih/8,max(y-0.8,0))':d=${CLIP_DURATION * FPS}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
  `zoompan=z='if(eq(on,1),1.2,max(zoom-0.0005,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${CLIP_DURATION * FPS}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function fetchWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
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

interface WikimediaResult {
  title: string;
  url: string;
}

async function searchWikimediaImage(query: string): Promise<WikimediaResult | null> {
  // Fetch more results and pick a random one for variety
  const searchResp = await fetchWithRetry(() =>
    axios.get("https://commons.wikimedia.org/w/api.php", {
      params: {
        action: "query",
        generator: "search",
        gsrsearch: `${query} filetype:bitmap`,
        gsrnamespace: 6,
        gsrlimit: 15,
        prop: "imageinfo",
        iiprop: "url|size|mime",
        iiurlwidth: 1920,
        format: "json",
        origin: "*",
      },
      timeout: 15000,
      headers: { "User-Agent": "F1YouTubeAutomator/1.0 (educational project; Node.js)" },
    })
  );

  const pages = searchResp.data?.query?.pages;
  if (!pages) return null;

  // Filter to valid image candidates
  const valid: WikimediaResult[] = [];
  for (const page of Object.values(pages) as any[]) {
    const info = page.imageinfo?.[0];
    if (!info) continue;

    const mime: string = info.mime || "";
    if (!mime.startsWith("image/jpeg") && !mime.startsWith("image/png")) continue;

    const url: string = info.thumburl || info.url;
    if (!url) continue;

    valid.push({ title: page.title, url });
  }

  if (valid.length === 0) return null;

  // Pick a random result instead of always the first
  return valid[Math.floor(Math.random() * valid.length)];
}

async function downloadImage(url: string, dest: string): Promise<void> {
  await fetchWithRetry(async () => {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: { "User-Agent": "F1YouTubeAutomator/1.0 (educational project; Node.js)" },
    });
    fs.writeFileSync(dest, Buffer.from(response.data));
  });
}

function cropImageToVertical(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .videoFilters(`scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`)
      .outputOptions(["-frames:v", "1", "-q:v", "2"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

function imageToClip(imagePath: string, clipPath: string, effectIndex: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const effect = KEN_BURNS_EFFECTS[effectIndex % KEN_BURNS_EFFECTS.length];

    ffmpeg()
      .input(imagePath)
      .loop(CLIP_DURATION)
      .inputOptions(["-framerate", String(FPS)])
      .videoFilters(effect)
      .outputOptions([
        "-c:v", "libx264",
        "-t", String(CLIP_DURATION),
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
      ])
      .output(clipPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

function concatAndMix(clips: string[], voiceoverPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const listPath = path.join(OUTPUT_DIR, "concat_list.txt");
    const listContent = clips.map((c) => `file '${path.resolve(c)}'`).join("\n");
    fs.writeFileSync(listPath, listContent);

    const totalDuration = clips.length * CLIP_DURATION;
    const fadeOutStart = Math.max(totalDuration - 2, 0);

    ffmpeg()
      .input(listPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .input(voiceoverPath)
      .outputOptions([
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-r", String(FPS),
        "-shortest",
        "-vf", `fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOutStart}:d=1.5`,
        "-movflags", "+faststart",
      ])
      .output(outputPath)
      .on("end", () => {
        fs.unlinkSync(listPath);
        resolve();
      })
      .on("error", reject)
      .run();
  });
}

export async function assembleVideo(voiceoverPath: string, outputFilename = "final_video.mp4"): Promise<string> {
  console.log("[Video] Starting vertical (1080x1920) video assembly for YouTube Shorts...");

  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(CLIPS_DIR, { recursive: true });

  // Pick random queries from the pool each run
  const queries = pickRandom(QUERY_POOL, IMAGES_PER_VIDEO);
  console.log(`[Video] Selected queries: ${queries.join(", ")}`);

  const clipPaths: string[] = [];
  const credits: string[] = [];

  // Shuffle Ken Burns effect order too
  const effectOrder = pickRandom([0, 1, 2, 3, 4], 5);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`[Video] Searching Wikimedia for "${query}"...`);

    const result = await searchWikimediaImage(query);
    if (!result) {
      console.warn(`[Video] No results for "${query}", skipping`);
      continue;
    }

    const ext = result.url.toLowerCase().includes(".png") ? "png" : "jpg";
    const imagePath = path.join(IMAGES_DIR, `image_${i}.${ext}`);
    const clipPath = path.join(CLIPS_DIR, `clip_${i}.mp4`);

    console.log(`[Video] Downloading: ${result.title}`);
    await downloadImage(result.url, imagePath);

    const croppedPath = path.join(IMAGES_DIR, `image_${i}_cropped.jpg`);
    console.log(`[Video] Cropping image ${i + 1} to 1080x1920...`);
    await cropImageToVertical(imagePath, croppedPath);

    console.log(`[Video] Animating image ${i + 1} with Ken Burns effect (vertical)...`);
    await imageToClip(croppedPath, clipPath, effectOrder[i]);

    clipPaths.push(clipPath);
    credits.push(result.title.replace("File:", ""));
  }

  if (clipPaths.length === 0) {
    throw new Error("No images could be downloaded from Wikimedia Commons");
  }

  const finalPath = path.join(OUTPUT_DIR, outputFilename);
  console.log(`[Video] Concatenating ${clipPaths.length} clips and mixing audio...`);
  await concatAndMix(clipPaths, voiceoverPath, finalPath);

  console.log(`[Video] Image credits (Wikimedia Commons): ${credits.join(" | ")}`);

  try { fs.rmSync(IMAGES_DIR, { recursive: true }); } catch {}
  try { fs.rmSync(CLIPS_DIR, { recursive: true }); } catch {}

  console.log(`[Video] Final video saved to ${finalPath} (1080x1920 vertical)`);
  return finalPath;
}
