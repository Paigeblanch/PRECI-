export type ServiceStatus = string;

export interface ScoreRequest {
  service_id: string;
  current_status: ServiceStatus;
  uptime_30d: number;
  avg_latency_ms: number;
  failure_rate: number;
  data_age_seconds: number;
  verification_age_seconds: number;
  sample_size: number;
}

export type Verdict =
  | "primary_route"
  | "secondary_route"
  | "human_review"
  | "blacklisted";

export interface ScoreSubscores {
  status_gate: 0 | 1;
  uptime: number;
  latency: number;
  failure: number;
  data_freshness: number;
  verification_freshness: number;
  confidence: number;
}

export interface ScoreResponse {
  service_id: string;
  trust_score: number;
  verdict: Verdict;
  execution_advice: string;
  subscores: ScoreSubscores;
  inputs_received: ScoreRequest;
}
