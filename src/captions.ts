import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = "output";

// Use Arial Bold on Windows, DejaVu Sans Bold on Linux (Railway/Nixpacks)
const FONT_PATH = process.platform === "win32"
  ? "/Windows/Fonts/arialbd.ttf"
  : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Split a script into timed caption segments.
 * Estimates timing based on word count and total audio duration.
 * Groups words into chunks of 3-5 words for readable captions.
 */
export function generateCaptionSegments(script: string, totalDurationSeconds: number): CaptionSegment[] {
  const words = script.split(/\s+/).filter((w) => w.length > 0);
  const totalWords = words.length;
  const secondsPerWord = totalDurationSeconds / totalWords;

  const WORDS_PER_GROUP = 4;
  const segments: CaptionSegment[] = [];

  for (let i = 0; i < totalWords; i += WORDS_PER_GROUP) {
    const groupWords = words.slice(i, i + WORDS_PER_GROUP);
    const start = i * secondsPerWord;
    const end = Math.min((i + WORDS_PER_GROUP) * secondsPerWord, totalDurationSeconds);

    segments.push({
      start,
      end,
      text: groupWords.join(" "),
    });
  }

  return segments;
}

/**
 * Generate an SRT subtitle file from caption segments.
 */
export function generateSRT(segments: CaptionSegment[]): string {
  return segments
    .map((seg, i) => {
      const formatTime = (s: number) => {
        const hrs = String(Math.floor(s / 3600)).padStart(2, "0");
        const mins = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
        const secs = String(Math.floor(s % 60)).padStart(2, "0");
        const ms = String(Math.round((s % 1) * 1000)).padStart(3, "0");
        return `${hrs}:${mins}:${secs},${ms}`;
      };

      return `${i + 1}\n${formatTime(seg.start)} --> ${formatTime(seg.end)}\n${seg.text}\n`;
    })
    .join("\n");
}

/**
 * Build FFmpeg drawtext filter string for burned-in captions.
 * White bold text with dark semi-transparent background box, centered near bottom.
 */
export function buildCaptionFilter(segments: CaptionSegment[]): string {
  // Escape text for FFmpeg drawtext
  const escapeForFFmpeg = (text: string) =>
    text
      .replace(/\\/g, "\\\\\\\\")
      .replace(/'/g, "\u2019")
      .replace(/:/g, "\\:")
      .replace(/%/g, "%%")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");

  const filters = segments.map((seg) => {
    const escaped = escapeForFFmpeg(seg.text);
    return `drawtext=text='${escaped}':fontsize=52:fontcolor=white:fontfile=${FONT_PATH}:x=(w-text_w)/2:y=h-200:borderw=3:bordercolor=black:box=1:boxcolor=black@0.5:boxborderw=12:enable='between(t,${seg.start.toFixed(3)},${seg.end.toFixed(3)})'`;
  });

  return filters.join(",");
}

/**
 * Save SRT file and return the caption filter string for FFmpeg.
 */
export function prepareCaptions(
  script: string,
  durationSeconds: number
): { srtPath: string; captionFilter: string } {
  const segments = generateCaptionSegments(script, durationSeconds);

  // Save SRT for reference
  const srtPath = path.join(OUTPUT_DIR, "captions.srt");
  fs.writeFileSync(srtPath, generateSRT(segments));
  console.log(`[Captions] Generated ${segments.length} caption segments → ${srtPath}`);

  const captionFilter = buildCaptionFilter(segments);
  return { srtPath, captionFilter };
}
