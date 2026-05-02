import type { ScoreRequest, ScoreResponse, Verdict } from "./types.js";

const DOWN_STATUSES = new Set(["down", "unhealthy", "offline"]);

function roundSubscore(value: number): number {
  return Number(value.toFixed(4));
}

function getVerdict(score: number): { verdict: Verdict; execution_advice: string } {
  if (score >= 90) {
    return {
      verdict: "primary_route",
      execution_advice: "Auto-execute. Service is highly reliable."
    };
  }

  if (score >= 75) {
    return {
      verdict: "secondary_route",
      execution_advice: "Route allowed. Log and monitor."
    };
  }

  if (score >= 60) {
    return {
      verdict: "human_review",
      execution_advice: "Ask before routing. Reliability is uncertain."
    };
  }

  return {
    verdict: "blacklisted",
    execution_advice: "Do not route. Risk is too high."
  };
}

export function calculateTrustScore(input: ScoreRequest): ScoreResponse {
  const normalizedStatus = input.current_status.trim().toLowerCase();

  if (DOWN_STATUSES.has(normalizedStatus)) {
    return {
      service_id: input.service_id,
      trust_score: 0,
      verdict: "blacklisted",
      execution_advice: "Do not route. Service is currently unavailable.",
      subscores: {
        status_gate: 0,
        uptime: input.uptime_30d,
        latency: 0,
        failure: 0,
        data_freshness: 0,
        verification_freshness: 0,
        confidence: 0
      },
      inputs_received: input
    };
  }

  const latencyScore = Math.max(0, 1 - input.avg_latency_ms / 2000);
  const failureScore = Math.max(0, 1 - input.failure_rate);
  const dataFreshnessScore = Math.max(0, 1 - input.data_age_seconds / 86400);
  const verificationFreshnessScore = Math.max(
    0,
    1 - input.verification_age_seconds / 86400
  );

  const baseScore =
    100 *
    (0.4 * input.uptime_30d +
      0.2 * latencyScore +
      0.2 * failureScore +
      0.1 * dataFreshnessScore +
      0.1 * verificationFreshnessScore);

  const confidence = Math.min(
    1,
    Math.log(1 + input.sample_size) / Math.log(1001)
  );

  const finalScore = Math.round(baseScore * (0.7 + 0.3 * confidence));
  const verdictResult = getVerdict(finalScore);

  return {
    service_id: input.service_id,
    trust_score: finalScore,
    verdict: verdictResult.verdict,
    execution_advice: verdictResult.execution_advice,
    subscores: {
      status_gate: 1,
      uptime: roundSubscore(input.uptime_30d),
      latency: roundSubscore(latencyScore),
      failure: roundSubscore(failureScore),
      data_freshness: roundSubscore(dataFreshnessScore),
      verification_freshness: roundSubscore(verificationFreshnessScore),
      confidence: roundSubscore(confidence)
    },
    inputs_received: input
  };
}

export function validateScoreRequest(body: unknown): string[] {
  const errors: string[] = [];
  const input = body as Partial<ScoreRequest>;

  if (!input || typeof input !== "object") {
    return ["Request body must be a JSON object."];
  }

  if (typeof input.service_id !== "string" || input.service_id.trim() === "") {
    errors.push("service_id is required and must be a non-empty string.");
  }

  if (
    typeof input.current_status !== "string" ||
    input.current_status.trim() === ""
  ) {
    errors.push("current_status is required and must be a non-empty string.");
  }

  validateNumberRange(errors, input.uptime_30d, "uptime_30d", 0, 1);
  validateMinimum(errors, input.avg_latency_ms, "avg_latency_ms", 0);
  validateNumberRange(errors, input.failure_rate, "failure_rate", 0, 1);
  validateMinimum(errors, input.data_age_seconds, "data_age_seconds", 0);
  validateMinimum(
    errors,
    input.verification_age_seconds,
    "verification_age_seconds",
    0
  );
  validateMinimum(errors, input.sample_size, "sample_size", 0);

  return errors;
}

function validateNumberRange(
  errors: string[],
  value: unknown,
  field: string,
  min: number,
  max: number
): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${field} is required and must be a number.`);
    return;
  }

  if (value < min || value > max) {
    errors.push(`${field} must be between ${min} and ${max}.`);
  }
}

function validateMinimum(
  errors: string[],
  value: unknown,
  field: string,
  min: number
): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${field} is required and must be a number.`);
    return;
  }

  if (value < min) {
    errors.push(`${field} must be ${min} or greater.`);
  }
}
