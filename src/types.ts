export type ServiceStatus = string;

export interface ScoreRequest {
  service_id: string;
  current_status: ServiceStatus;
  uptime_30d: number;
  avg_latency_ms: number;
  failure_rate: number;
  sample_size: number;
}

export interface UrlProbeRequest {
  url: string;
  service_id?: string;
}

export type Verdict =
  | "trusted"
  | "verified"
  | "provisional"
  | "inactive";

export interface ScoreSubscores {
  reachability: number;
  speed: number;
  reliability: number;
  security: number;
  data_quality: number;
  confidence: number;
}

export interface ScoreResult {
  service_id: string;
  trust_score: number;
  verdict: Verdict;
  execution_advice: string;
  confidence_warning?: string;
}

export interface ScoreResultDetail extends ScoreResult {
  subscores: ScoreSubscores;
  inputs_received: ScoreRequest;
  probed_at: string;
}

export interface CompareRequest {
  candidates: string[];
}

export interface CompareCandidate {
  url: string;
  trust_score: number;
  verdict: Verdict;
  subscores: ScoreSubscores;
}

export interface CompareResponse {
  recommendation: string;
  reason: string;
  ranked: CompareCandidate[];
  compared_at: string;
}
