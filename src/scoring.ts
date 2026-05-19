import { probeUrl, serviceIdFromUrl } from "./probe.js";
import type {
  CompareCandidate,
  CompareRequest,
  CompareResponse,
  ScoreRequest,
  ScoreResultDetail,
  UrlProbeRequest,
  Verdict
} from "./types.js";

// --- Dimension calculators ---

// 2xx = fully reachable, 3xx = reachable but redirecting, 4xx = up but not useful, 5xx/error = down
function reachabilityFromHttpStatus(httpStatus: number): number {
  if (httpStatus >= 500) return 0.0;
  if (httpStatus >= 400) return 0.1;
  if (httpStatus >= 300) return 0.85;
  return 1.0;
}

function reachabilityFromStatus(status: string): number {
  const s = status.trim().toLowerCase();
  if (s === "down" || s === "offline") return 0.0;
  if (s === "unhealthy") return 0.1;
  return 1.0;
}

// Ceiling at 3000ms — above that, an agent chain will time out waiting
function computeSpeed(latencyMs: number): number {
  return Math.max(0, 1 - latencyMs / 3000);
}

// Both uptime and failure rate must be high — they compound, not average
function computeReliability(uptime30d: number, failureRate: number): number {
  return uptime30d * (1 - failureRate);
}

// SSL decay: 0 if expired, linear to 0.75 at 30 days, linear to 1.0 at 90 days, 1.0 above 90
// HTTP (no SSL) = 0.5 — it works but agents shouldn't trust unencrypted services
function computeSecurity(sslDaysRemaining: number | undefined, isHttps: boolean): number {
  if (!isHttps) return 0.5;
  if (sslDaysRemaining === undefined) return 0.75;
  if (sslDaysRemaining <= 0) return 0.0;
  if (sslDaysRemaining >= 90) return 1.0;
  if (sslDaysRemaining >= 30) return 0.75 + 0.25 * ((sslDaysRemaining - 30) / 60);
  return 0.75 * (sslDaysRemaining / 30);
}

// Agents need parseable responses — non-JSON isn't usable in most pipelines
function computeDataQuality(returnsJson: boolean | undefined): number {
  if (returnsJson === undefined) return 0.75;
  return returnsJson ? 1.0 : 0.4;
}

// Saturates at 100 samples — enough history to trust the score
function computeConfidence(sampleSize: number): number {
  return Math.min(1, Math.log(1 + sampleSize) / Math.log(101));
}

// --- Verdict ---

// Confidence gates the maximum achievable verdict independently of the score.
// A high score with low confidence still can't auto-execute — we don't have enough history.
function getVerdict(score: number, confidence: number): { verdict: Verdict; execution_advice: string } {
  const scoreBand = (): { verdict: Verdict; execution_advice: string } => {
    if (score >= 90) return { verdict: "trusted",     execution_advice: "Auto-route. Service is highly reliable." };
    if (score >= 75) return { verdict: "verified",    execution_advice: "Route allowed. Log and monitor." };
    if (score >= 60) return { verdict: "provisional", execution_advice: "Proceed with caution. Reliability is uncertain." };
    return              { verdict: "inactive",        execution_advice: "Do not route. Risk is too high." };
  };

  const { verdict, execution_advice } = scoreBand();

  // < 5 samples: cap at provisional
  if (confidence < 0.3 && (verdict === "trusted" || verdict === "verified")) {
    return { verdict: "provisional", execution_advice: "Proceed with caution. Score is based on limited samples." };
  }

  // 5–49 samples: cap at verified
  if (confidence < 0.7 && verdict === "trusted") {
    return { verdict: "verified", execution_advice: "Route allowed. Collect more samples before auto-routing." };
  }

  return { verdict, execution_advice };
}

function getConfidenceWarning(sampleSize: number, confidence: number): string | undefined {
  if (sampleSize === 0) return "No historical data. Score reflects a live snapshot only.";
  if (confidence < 0.3)  return `${sampleSize} sample${sampleSize === 1 ? "" : "s"} — verdict capped at provisional until more data is collected.`;
  if (confidence < 0.7)  return `${sampleSize} samples — verdict capped at verified. Collect 50+ samples to unlock trusted.`;
  return undefined;
}

// --- Core score builder ---

function buildScore(
  input: ScoreRequest,
  reachability: number,
  security: number,
  dataQuality: number
): ScoreResultDetail {
  const speed = computeSpeed(input.avg_latency_ms);
  const reliability = computeReliability(input.uptime_30d, input.failure_rate);
  const confidence = computeConfidence(input.sample_size);

  const trustScore = Math.round(
    100 * (
      0.30 * reachability +
      0.25 * speed +
      0.25 * reliability +
      0.10 * security +
      0.10 * dataQuality
    )
  );

  const { verdict, execution_advice } = getVerdict(trustScore, confidence);

  return {
    service_id: input.service_id,
    trust_score: trustScore,
    verdict,
    execution_advice,
    confidence_warning: getConfidenceWarning(input.sample_size, confidence),
    subscores: {
      reachability:  Number(reachability.toFixed(4)),
      speed:         Number(speed.toFixed(4)),
      reliability:   Number(reliability.toFixed(4)),
      security:      Number(security.toFixed(4)),
      data_quality:  Number(dataQuality.toFixed(4)),
      confidence:    Number(confidence.toFixed(4))
    },
    inputs_received: input,
    probed_at: new Date().toISOString()
  };
}

// --- Public API ---

export function calculateTrustScore(input: ScoreRequest): ScoreResultDetail {
  const reachability = reachabilityFromStatus(input.current_status);

  // Hard gate: if the service is explicitly down, return immediately
  if (reachability === 0) {
    const confidence = computeConfidence(input.sample_size);
    return {
      service_id: input.service_id,
      trust_score: 0,
      verdict: "inactive",
      execution_advice: "Do not route. Service is currently unavailable.",

      confidence_warning: getConfidenceWarning(input.sample_size, confidence),
      subscores: { reachability: 0, speed: 0, reliability: 0, security: 0, data_quality: 0, confidence: Number(confidence.toFixed(4)) },
      inputs_received: input,
      probed_at: new Date().toISOString()
    };
  }

  // Self-reported mode has no SSL or JSON data — give benefit of the doubt
  return buildScore(input, reachability, 1.0, 1.0);
}

export async function calculateTrustScoreFromUrl(
  request: UrlProbeRequest
): Promise<ScoreResultDetail> {
  const probe = await probeUrl(request.url);
  const serviceId = request.service_id ?? serviceIdFromUrl(request.url);
  const isHttps = request.url.startsWith("https://");

  const reachability = probe.http_status !== undefined
    ? reachabilityFromHttpStatus(probe.http_status)
    : (probe.status === "down" ? 0.0 : 0.5);

  const security    = computeSecurity(probe.ssl_days_remaining, isHttps);
  const dataQuality = computeDataQuality(probe.returns_json);

  // Uptime and failure are point-in-time estimates for a single probe
  const uptimeEstimate   = reachability;
  const failureEstimate  = probe.returns_json ? 0.0 : 0.2;

  const scoreRequest: ScoreRequest = {
    service_id:    serviceId,
    current_status: probe.status,
    uptime_30d:    uptimeEstimate,
    avg_latency_ms: probe.latency_ms,
    failure_rate:  failureEstimate,
    sample_size:   1
  };

  return buildScore(scoreRequest, reachability, security, dataQuality);
}

// --- Validation ---

export function validateScoreRequest(body: unknown): string[] {
  const errors: string[] = [];
  const input = body as Partial<ScoreRequest>;

  if (!input || typeof input !== "object") return ["Request body must be a JSON object."];

  if (typeof input.service_id !== "string" || input.service_id.trim() === "") {
    errors.push("service_id is required and must be a non-empty string.");
  }
  if (typeof input.current_status !== "string" || input.current_status.trim() === "") {
    errors.push("current_status is required and must be a non-empty string.");
  }

  validateRange(errors, input.uptime_30d,    "uptime_30d",    0, 1);
  validateMin  (errors, input.avg_latency_ms, "avg_latency_ms", 0);
  validateRange(errors, input.failure_rate,   "failure_rate",   0, 1);
  validateMin  (errors, input.sample_size,    "sample_size",    0);

  return errors;
}

export function validateUrlProbeRequest(body: unknown): string[] {
  const errors: string[] = [];
  const input = body as Partial<UrlProbeRequest>;

  if (!input || typeof input !== "object") return ["Request body must be a JSON object."];

  if (typeof input.url !== "string" || input.url.trim() === "") {
    errors.push("url is required and must be a non-empty string.");
    return errors;
  }

  try {
    const parsed = new URL(input.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push("url must use http or https protocol.");
    }
  } catch {
    errors.push("url must be a valid URL.");
  }

  if (input.service_id !== undefined &&
      (typeof input.service_id !== "string" || input.service_id.trim() === "")) {
    errors.push("service_id must be a non-empty string if provided.");
  }

  return errors;
}

export async function calculateComparison(request: CompareRequest): Promise<CompareResponse> {
  const results = await Promise.all(
    request.candidates.map((url) => calculateTrustScoreFromUrl({ url }))
  );

  const ranked: CompareCandidate[] = results
    .map((r, i) => ({
      url: request.candidates[i],
      trust_score: r.trust_score,
      verdict: r.verdict,
      subscores: r.subscores
    }))
    .sort((a, b) => b.trust_score - a.trust_score);

  const winner = ranked[0];
  const reason = buildReason(winner, ranked);

  return {
    recommendation: winner.url,
    reason,
    ranked,
    compared_at: new Date().toISOString()
  };
}

function buildReason(winner: CompareCandidate, ranked: CompareCandidate[]): string {
  if (winner.verdict === "inactive") {
    return `No candidates meet the minimum reliability threshold. Best available is ${winner.url} at ${winner.trust_score}/100 — manual verification recommended before routing to any of these services.`;
  }

  const parts: string[] = [`Trust score ${winner.trust_score}/100`];

  const latencyMs = Math.round((1 - winner.subscores.speed) * 3000);
  if (latencyMs < 1000) parts.push(`${latencyMs}ms response time`);

  if (winner.subscores.security >= 0.95) parts.push("valid SSL");
  if (winner.subscores.data_quality >= 0.95) parts.push("returns valid JSON");

  const runnerUp = ranked[1];
  if (runnerUp) {
    const gap = winner.trust_score - runnerUp.trust_score;
    if (gap > 0) parts.push(`${gap} points ahead of nearest alternative`);
  }

  const prefix = winner.verdict === "provisional"
    ? "Best available, though no candidates are ready for auto-routing. "
    : "";

  return prefix + parts.join(", ") + ".";
}

export function validateCompareRequest(body: unknown): string[] {
  const errors: string[] = [];
  const input = body as Partial<CompareRequest>;

  if (!input || typeof input !== "object") return ["Request body must be a JSON object."];

  if (!Array.isArray(input.candidates)) {
    return ["candidates is required and must be an array of URLs."];
  }

  if (input.candidates.length < 2) {
    errors.push("candidates must contain at least 2 URLs.");
  }

  if (input.candidates.length > 10) {
    errors.push("candidates must contain at most 10 URLs.");
  }

  input.candidates.forEach((url, i) => {
    if (typeof url !== "string" || url.trim() === "") {
      errors.push(`candidates[${i}] must be a non-empty string.`);
      return;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push(`candidates[${i}] must use http or https protocol.`);
      }
    } catch {
      errors.push(`candidates[${i}] is not a valid URL.`);
    }
  });

  return errors;
}

function validateRange(errors: string[], value: unknown, field: string, min: number, max: number): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${field} is required and must be a number.`); return;
  }
  if (value < min || value > max) errors.push(`${field} must be between ${min} and ${max}.`);
}

function validateMin(errors: string[], value: unknown, field: string, min: number): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${field} is required and must be a number.`); return;
  }
  if (value < min) errors.push(`${field} must be ${min} or greater.`);
}
