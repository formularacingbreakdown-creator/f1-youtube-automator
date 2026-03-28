import { execSync } from "node:child_process";
import http from "node:http";

// Schedule: 9 AM, 3 PM, 8 PM UTC (adjust for your timezone)
const SCHEDULE_HOURS = [9, 15, 20];

const alreadyRan = new Set();

function getDateKey(hour) {
  const now = new Date();
  return `${now.toISOString().slice(0, 10)}-${hour}`;
}

function runDailyVideo() {
  console.log(`[${new Date().toISOString()}] Running daily video pipeline...`);
  try {
    execSync("npx tsx src/dailyVideo.ts", {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 600_000, // 10 minute timeout
    });
    console.log(`[${new Date().toISOString()}] Pipeline complete.`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Pipeline failed:`, error.message);
  }
}

function checkSchedule() {
  const now = new Date();
  const currentHour = now.getUTCHours();

  for (const hour of SCHEDULE_HOURS) {
    const key = getDateKey(hour);
    if (currentHour === hour && !alreadyRan.has(key)) {
      alreadyRan.add(key);
      runDailyVideo();
    }
  }

  // Clean up old keys at midnight
  if (currentHour === 0) {
    alreadyRan.clear();
  }
}

// Check every minute
setInterval(checkSchedule, 60_000);
checkSchedule();

// Health check endpoint for Railway
const server = http.createServer((req, res) => {
  const history = alreadyRan.size;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "running",
    schedule: SCHEDULE_HOURS.map((h) => `${h}:00 UTC`),
    runsToday: history,
    uptime: process.uptime(),
  }));
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`[Scheduler] Running. Videos scheduled at ${SCHEDULE_HOURS.map((h) => `${h}:00`).join(", ")} UTC`);
  console.log(`[Scheduler] Health check on port ${process.env.PORT || 3000}`);
});
