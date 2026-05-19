# PRECI

**Real-time API trust scoring for AI agents.**

PRECI probes any API endpoint live and returns a trust score, verdict, and routing recommendation — purpose-built for agents that need to decide which service to call.

**Base URL:** `https://preci.fly.dev`

---

## Why PRECI

AI agents call external APIs constantly. When a service goes down, responds slowly, or returns malformed data, it breaks the whole chain. PRECI gives agents a single call to answer: *is this safe to route to right now?*

- **Active probing** — PRECI hits the endpoint itself. No stale data, no self-reported stats.
- **Agent-native verdicts** — `trusted`, `verified`, `provisional`, or `inactive`. Direct routing signals, not raw numbers to interpret.
- **Parallel comparison** — Submit multiple candidates, get back a ranked list with a plain-English recommendation.
- **x402 payments** — Pay per call in USDC on Base. No API keys, no accounts, no rate limit tiers.

---

## Endpoints

### `GET /`
Returns service info and pricing. Free.

### `GET /health`
Health check. Free.

---

### `POST /score/url` — 0.005 USDC

Probe a URL and get a live trust score.

**Request**
```json
{
  "url": "https://api.example.com/v1/data",
  "service_id": "example-api"
}
```

`service_id` is optional — defaults to the hostname if omitted.

**Response**
```json
{
  "service_id": "api.example.com",
  "trust_score": 91,
  "verdict": "trusted",
  "execution_advice": "Auto-route. Service is highly reliable.",
  "probed_at": "2026-05-19T10:00:00.000Z"
}
```

---

### `POST /compare` — 0.010 USDC

Submit 2–10 URLs. PRECI probes all in parallel and returns a ranked list with a routing recommendation.

**Request**
```json
{
  "candidates": [
    "https://api-primary.example.com/v1",
    "https://api-backup.example.com/v1",
    "https://api-fallback.example.com/v1"
  ]
}
```

**Response**
```json
{
  "recommendation": "https://api-primary.example.com/v1",
  "reason": "Trust score 94/100, 210ms response time, valid SSL, returns valid JSON, 12 points ahead of nearest alternative.",
  "ranked": [
    {
      "url": "https://api-primary.example.com/v1",
      "trust_score": 94,
      "verdict": "trusted"
    },
    {
      "url": "https://api-backup.example.com/v1",
      "trust_score": 82,
      "verdict": "verified"
    },
    {
      "url": "https://api-fallback.example.com/v1",
      "trust_score": 61,
      "verdict": "provisional"
    }
  ],
  "compared_at": "2026-05-19T10:00:00.000Z"
}
```

---

### `GET /score/:id/detail` — 0.003 USDC

Retrieve the full scoring breakdown for a previously probed service, including all five subscores.

**Response**
```json
{
  "service_id": "api.example.com",
  "trust_score": 91,
  "verdict": "trusted",
  "subscores": {
    "reachability": 1.0,
    "speed": 0.93,
    "reliability": 0.89,
    "security": 1.0,
    "data_quality": 1.0,
    "confidence": 0.48
  }
}
```

---

## Scoring

Trust score is a 0–100 composite across five dimensions:

| Dimension | Weight | What it measures |
|---|---|---|
| Reachability | 30% | HTTP status code — 2xx full, 3xx partial, 4xx/5xx penalized |
| Speed | 25% | Response latency, ceiling at 3000ms |
| Reliability | 25% | Uptime × (1 − failure rate) |
| Security | 10% | SSL certificate validity and days remaining |
| Data Quality | 10% | Whether the response is valid JSON |

**Verdicts**

| Verdict | Score | Confidence | Meaning |
|---|---|---|---|
| `trusted` | ≥ 90 | ≥ 50 samples | Auto-route |
| `verified` | ≥ 75 | ≥ 5 samples | Route with logging |
| `provisional` | ≥ 60 | any | Proceed with caution |
| `inactive` | < 60 | any | Do not route |

Confidence gates the verdict — a high-scoring service with fewer than 5 samples is capped at `provisional` until enough history is collected.

---

## Payment

PRECI uses the [x402 protocol](https://x402.org). Every paid request requires an `X-Payment` header containing a signed USDC transaction on Base mainnet.

If the header is missing, the API returns HTTP `402` with the payment details your agent needs to construct one:

```json
{
  "error": "Payment Required",
  "payment": {
    "scheme": "exact",
    "price": "$0.005",
    "network": "eip155:8453",
    "payTo": "0xCCe325657c513fa4Ac418eec0AFc4eA02adD088E"
  }
}
```

PRECI is listed on the [x402 Bazaar](https://x402.org/bazaar) — x402-compatible agents can discover and call it automatically.

---

## Running Locally

```bash
git clone https://github.com/Paigeblanch/PRECI.git
cd PRECI
npm install
cp .env.example .env   # set your wallet address
npm run dev
```

Set `X402_ENABLED=false` in `.env` to disable payment gates during development.

---

## Deploying

```bash
fly deploy --local-only
```

Requires [Fly.io CLI](https://fly.io/docs/flyctl/install/) and Docker Desktop running locally.
