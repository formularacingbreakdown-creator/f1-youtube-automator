import { google } from "googleapis";
import fs from "node:fs";
import type { ScriptOutput } from "./types.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const SHORTS_HASHTAGS = "#F1 #Formula1 #F1Shorts #RacingData #Shorts";

function getAuthClient() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, or YOUTUBE_REFRESH_TOKEN");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function buildDescription(description: string): string {
  const cleaned = description.replace(/#\w+/g, "").trimEnd();
  return `${cleaned}\n\n${SHORTS_HASHTAGS}`;
}

export async function uploadToYouTube(
  videoPath: string,
  scriptOutput: ScriptOutput,
  thumbnailPath?: string
): Promise<string> {
  console.log("[YouTube] Preparing upload as public YouTube Short...");

  const auth = getAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  const description = buildDescription(scriptOutput.description);

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await youtube.videos.insert({
        part: ["snippet", "status"],
        notifySubscribers: true,
        requestBody: {
          snippet: {
            title: scriptOutput.title,
            description,
            tags: [...scriptOutput.tags, "Shorts", "F1 Shorts", "Formula 1"],
            categoryId: "17", // Sports
          },
          status: {
            privacyStatus: "public",
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: fs.createReadStream(videoPath),
        },
      });

      const videoId = response.data.id!;
      const videoUrl = `https://youtube.com/shorts/${videoId}`;

      console.log(`[YouTube] Upload complete!`);
      console.log(`[YouTube] Short URL: ${videoUrl}`);
      console.log(`[YouTube] Status: PUBLIC`);

      // Set custom thumbnail if provided
      if (thumbnailPath && fs.existsSync(thumbnailPath)) {
        await setThumbnail(youtube, videoId, thumbnailPath);
      }

      return videoUrl;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  Upload attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError!;
}

async function setThumbnail(youtube: any, videoId: string, thumbnailPath: string): Promise<void> {
  console.log("[YouTube] Setting custom thumbnail...");
  try {
    await youtube.thumbnails.set({
      videoId,
      media: {
        mimeType: "image/jpeg",
        body: fs.createReadStream(thumbnailPath),
      },
    });
    console.log("[YouTube] Thumbnail set successfully!");
  } catch (error) {
    // Thumbnail upload requires a verified account — warn but don't fail the pipeline
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[YouTube] Could not set thumbnail (account may need verification): ${msg}`);
    console.warn("[YouTube] Video uploaded successfully — thumbnail can be set manually in YouTube Studio.");
  }
}
