import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const OUTPUT_DIR = "output";
const WIDTH = 1080;
const HEIGHT = 1920;

async function fetchWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError!;
}

async function fetchBackgroundImage(): Promise<string> {
  const queries = [
    "Formula One car close",
    "F1 racing speed",
    "Formula 1 Grand Prix",
    "F1 car front wing",
    "Formula One race start",
  ];
  const query = queries[Math.floor(Math.random() * queries.length)];

  const searchResp = await fetchWithRetry(() =>
    axios.get("https://commons.wikimedia.org/w/api.php", {
      params: {
        action: "query",
        generator: "search",
        gsrsearch: `${query} filetype:bitmap`,
        gsrnamespace: 6,
        gsrlimit: 10,
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
  if (!pages) throw new Error("No thumbnail background images found");

  const valid: string[] = [];
  for (const page of Object.values(pages) as any[]) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const mime: string = info.mime || "";
    if (!mime.startsWith("image/jpeg") && !mime.startsWith("image/png")) continue;
    const url: string = info.thumburl || info.url;
    if (url) valid.push(url);
  }

  if (valid.length === 0) throw new Error("No valid thumbnail images found");
  return valid[Math.floor(Math.random() * valid.length)];
}

function buildThumbnail(bgImagePath: string, outputPath: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Split title into lines of ~20 chars for vertical format
    const words = title.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > 18 && current.length > 0) {
        lines.push(current.trim());
        current = word;
      } else {
        current = (current + " " + word).trim();
      }
    }
    if (current) lines.push(current.trim());

    // Take first 3 lines max
    const displayLines = lines.slice(0, 3);

    // Escape special FFmpeg characters
    const escapeText = (t: string) =>
      t.replace(/\\/g, "\\\\\\\\")
       .replace(/'/g, "\u2019")
       .replace(/:/g, "\\:")
       .replace(/%/g, "%%");

    // Build drawtext filters — bold white text with black outline, stacked vertically
    const textFilters: string[] = [];
    const lineHeight = 100;
    const startY = Math.round(HEIGHT / 2 - (displayLines.length * lineHeight) / 2);

    for (let i = 0; i < displayLines.length; i++) {
      const y = startY + i * lineHeight;
      const text = escapeText(displayLines[i]);
      textFilters.push(
        `drawtext=text='${text}':fontsize=80:fontcolor=white:borderw=5:bordercolor=black:x=(w-text_w)/2:y=${y}:fontfile=/Windows/Fonts/arialbd.ttf`
      );
    }

    // Add a red F1-style bar at the top
    const filters = [
      `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
      `colorbalance=rs=0.15:gs=-0.05:bs=-0.1`, // Slight red/warm tint
      `eq=brightness=-0.1:contrast=1.3`, // Darken + increase contrast for text readability
      ...textFilters,
      // Red bar at top
      `drawbox=x=0:y=0:w=${WIDTH}:h=8:color=red:t=fill`,
      // Red bar at bottom
      `drawbox=x=0:y=${HEIGHT - 8}:w=${WIDTH}:h=8:color=red:t=fill`,
    ];

    ffmpeg()
      .input(bgImagePath)
      .videoFilters(filters.join(","))
      .outputOptions(["-frames:v", "1", "-q:v", "1"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

export async function generateThumbnail(title: string): Promise<string> {
  console.log("[Thumbnail] Generating thumbnail...");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const bgPath = path.join(OUTPUT_DIR, "thumb_bg.jpg");
  const outputPath = path.join(OUTPUT_DIR, "thumbnail.jpg");

  // Download a background image
  console.log("[Thumbnail] Fetching background image...");
  const imageUrl = await fetchBackgroundImage();
  const response = await fetchWithRetry(() =>
    axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: { "User-Agent": "F1YouTubeAutomator/1.0 (educational project; Node.js)" },
    })
  );
  fs.writeFileSync(bgPath, Buffer.from(response.data));

  // Build thumbnail with text overlay
  console.log("[Thumbnail] Adding text overlay...");
  await buildThumbnail(bgPath, outputPath, title.toUpperCase());

  // Clean up background
  fs.unlinkSync(bgPath);

  console.log(`[Thumbnail] Saved to ${outputPath}`);
  return outputPath;
}
