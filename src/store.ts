import type { ScoreResultDetail } from "./types.js";

const scores = new Map<string, ScoreResultDetail>();

export function storeScore(serviceId: string, score: ScoreResultDetail): void {
  scores.set(serviceId, score);
}

export function getScore(serviceId: string): ScoreResultDetail | undefined {
  return scores.get(serviceId);
}
