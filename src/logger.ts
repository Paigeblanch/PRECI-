import { appendFile, readFile } from "fs/promises";

export const LOG_PATH = process.env.LOG_PATH ?? "./preci.log";

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

export interface PaymentLogEntry {
  ts: string;
  event: "payment_settled";
  amount_usdc: string | number;
  network: string;
  tx_hash: string | null;
  payer: string | null;
  resource: string | null;
}

type LogEntry = ScoreLogEntry | CompareLogEntry | PaymentLogEntry | Record<string, unknown>;

export async function log(entry: LogEntry): Promise<void> {
  try {
    await appendFile(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // logging must never crash the request
  }
}

export async function readPaymentLogs(): Promise<PaymentLogEntry[]> {
  try {
    const raw = await readFile(LOG_PATH, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter((e): e is PaymentLogEntry => e?.event === "payment_settled")
      .reverse();
  } catch {
    return [];
  }
}
