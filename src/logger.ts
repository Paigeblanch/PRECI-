import { appendFile } from "fs/promises";

const LOG_PATH = process.env.LOG_PATH ?? "./preci.log";

export interface ScoreLogEntry {
  ts: string;
  endpoint: "score/url" | "score/report";
  service_id: string;
  url?: string;
  trust_score: number;
  verdict: string;
  confidence: number;
  latency_ms?: number;
  caller_ip: string;
}

export interface CompareLogEntry {
  ts: string;
  endpoint: "compare";
  candidate_count: number;
  recommendation: string;
  top_score: number;
  top_verdict: string;
  caller_ip: string;
}

type LogEntry = ScoreLogEntry | CompareLogEntry;

export async function log(entry: LogEntry): Promise<void> {
  try {
    await appendFile(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // logging must never crash the request
  }
}
