import fs from "node:fs";
import path from "node:path";

const HISTORY_PATH = path.join("output", "history.json");

export interface HistoryEntry {
  date: string;
  mode: string;
  title: string;
  description: string;
  tags: string[];
  topicKey: string;
  youtubeUrl?: string;
  videoFile: string;
}

export function loadHistory(): HistoryEntry[] {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function saveEntry(entry: HistoryEntry): void {
  const history = loadHistory();
  history.push(entry);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`[History] Saved entry: "${entry.title}"`);
}

/**
 * Returns a summary of past topics/titles for the given mode.
 * Used by script generators to avoid duplicate content.
 */
export function getPastTopics(mode: string): string[] {
  const history = loadHistory();
  return history
    .filter((e) => e.mode === mode)
    .map((e) => e.title);
}

/**
 * Check if a specific topic key has already been posted.
 */
export function hasBeenPosted(topicKey: string): boolean {
  return loadHistory().some((e) => e.topicKey === topicKey);
}

/**
 * Build a prompt-friendly summary of what's been posted before for a given mode.
 * Returns empty string if no history.
 */
export function getAvoidList(mode: string): string {
  const past = getPastTopics(mode);
  if (past.length === 0) return "";
  return `\n\nIMPORTANT — Do NOT repeat these topics, they have already been covered:\n${past.map((t) => `- ${t}`).join("\n")}`;
}
