import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import {
  calculateComparison,
  calculateTrustScoreFromUrl,
  validateCompareRequest,
  validateUrlProbeRequest
} from "./scoring.js";
import { log } from "./logger.js";
import { getScore, storeScore } from "./store.js";
import type { CompareRequest, UrlProbeRequest } from "./types.js";
import { x402 } from "./x402.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());
app.use(x402);

app.get("/", (_req, res) => {
  res.json({
    name: "PRECI",
    description: "Real-time API service trust score for agents",
    version: "0.3.0",
    pricing: {
      "POST /score/url":       "0.005 USDC",
      "POST /compare":         "0.010 USDC",
      "GET /score/:id/detail": "0.003 USDC"
    },
    payment: "x402 — include X-Payment header with USDC on Base mainnet"
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "PRECI", status: "healthy" });
});

app.post("/score/url", async (req, res) => {
  const errors = validateUrlProbeRequest(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: "Invalid request.", details: errors });
  }

  const detail = await calculateTrustScoreFromUrl(req.body as UrlProbeRequest);
  storeScore(detail.service_id, detail);

  log({
    ts: detail.probed_at,
    endpoint: "score/url",
    service_id: detail.service_id,
    url: (req.body as UrlProbeRequest).url,
    trust_score: detail.trust_score,
    verdict: detail.verdict,
    confidence: detail.subscores.confidence,
    latency_ms: Math.round((1 - detail.subscores.speed) * 3000),
    caller_ip: req.ip ?? "unknown"
  });

  const { subscores: _s, inputs_received: _i, ...slim } = detail;
  return res.json(slim);
});

app.post("/compare", async (req, res) => {
  const errors = validateCompareRequest(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: "Invalid compare request.", details: errors });
  }

  const result = await calculateComparison(req.body as CompareRequest);

  log({
    ts: result.compared_at,
    endpoint: "compare",
    candidate_count: result.ranked.length,
    recommendation: result.recommendation,
    top_score: result.ranked[0].trust_score,
    top_verdict: result.ranked[0].verdict,
    caller_ip: req.ip ?? "unknown"
  });

  return res.json(result);
});

app.get("/score/:id/detail", (req, res) => {
  const detail = getScore(req.params["id"] as string);
  if (!detail) {
    return res.status(404).json({
      error: `No score found for service '${req.params.id}'. Submit a score first.`
    });
  }
  return res.json(detail);
});

app.listen(port, () => {
  console.log(`PRECI API running at http://localhost:${port}`);
});
