# F1 YouTube Automator

Automatically generates and uploads F1 YouTube Shorts — race breakdowns, championship analysis, predictions, and daily historical content. Pulls live data from the Jolpica F1 API, writes scripts with Claude, generates voiceovers with ElevenLabs, assembles vertical video with FFmpeg + Wikimedia Commons images, and uploads directly to YouTube.

## Video Modes

| Mode | Command | Description |
|---|---|---|
| Race Breakdown | `npx tsx src/index.ts --mode race` | Strategic analysis of the latest race — pit stops, position changes, why the result happened |
| Championship Math | `npx tsx src/index.ts --mode championship` | Points gaps, what each top 5 driver needs, mathematical scenarios |
| Race Prediction | `npx tsx src/index.ts --mode prediction` | Predicts next race winner using historical circuit data + current form |
| Daily Video | `npx tsx src/dailyVideo.ts` | Rotates daily: F1 stats, head-to-head comparisons, "on this day", best-ever rankings |

## Prerequisites

- **Node.js 18+**
- **FFmpeg** installed and on PATH
  - Windows: `winget install FFmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

## API Keys

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) |
| `ELEVENLABS_VOICE_ID` | [elevenlabs.io/voices](https://elevenlabs.io/app/voice-library) — pick a voice, copy its ID |
| `YOUTUBE_CLIENT_ID` | Google Cloud Console (see YouTube setup below) |
| `YOUTUBE_CLIENT_SECRET` | Google Cloud Console (see YouTube setup below) |
| `YOUTUBE_REFRESH_TOKEN` | Generated via helper script (see below) |

## YouTube OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/dashboard)
2. Create a project and enable **YouTube Data API v3**
3. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
4. Application type: **Web application**
5. Add `http://localhost:3000` as an **Authorized redirect URI**
6. Copy Client ID and Client Secret into `.env`
7. Run the token helper:

```bash
npx tsx src/auth/getYouTubeToken.ts
```

8. Open the URL it prints, authorize, and paste the refresh token into `.env`

## Usage

### Install dependencies

```bash
npm install
```

### Run a specific mode

```bash
npx tsx src/index.ts --mode race           # Race breakdown
npx tsx src/index.ts --mode championship   # Championship math
npx tsx src/index.ts --mode prediction     # Next race prediction
npx tsx src/dailyVideo.ts                  # Daily content
```

### Dry run (generate script only, no video/upload)

```bash
npx tsx src/index.ts --mode race --dry-run
npx tsx src/dailyVideo.ts --dry-run
```

### Skip upload (generate video locally)

```bash
npx tsx src/index.ts --mode race --no-upload
```

## How It Works

1. **Fetch F1 Data** — Race results, standings, pit stops, lap times, and historical data from the [Jolpica F1 API](https://api.jolpi.ca/ergast/f1/)
2. **Generate Script** — Claude writes an engaging, opinionated script with a strong opening hook
3. **Generate Voiceover** — ElevenLabs text-to-speech converts the script to audio
4. **Assemble Video** — Downloads F1 images from Wikimedia Commons, applies Ken Burns animations, mixes with voiceover (1080x1920 vertical)
5. **Generate Thumbnail** — Creates a thumbnail with bold text overlay on an F1 background image
6. **Upload to YouTube** — Publishes as a public YouTube Short with title, description, tags, and thumbnail

## Content Deduplication

All uploaded videos are tracked in `output/history.json`. When generating new scripts, Claude receives a list of previous titles to avoid repeating topics.

## Scheduling

### Local (Windows Task Scheduler)

Run `scheduler/setup.bat` as Administrator to schedule videos at 9 AM, 3 PM, and 8 PM daily.

Logs are saved to `scheduler/log.txt`.

### Cloud (Railway)

The included `railway.toml` and `scheduler/cron.mjs` run the daily pipeline 3 times per day at 9:00, 15:00, and 20:00 UTC.

1. Push this repo to GitHub
2. Connect the repo to [Railway](https://railway.app)
3. Add your environment variables in the Railway dashboard
4. Deploy — the scheduler starts automatically

## Output

Generated files are saved to `output/`:
- `voiceover_*.mp3` — AI voiceovers (reused for same topic)
- `script_*.json` — Generated scripts (reused for same topic)
- `thumbnail.jpg` — Latest thumbnail
- `*.mp4` — Video files
- `history.json` — Upload history for deduplication
