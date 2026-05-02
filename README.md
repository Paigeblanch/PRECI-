# PRECI

PRECI is a real-time API trust scoring service for agents.

Agents can send service health data to PRECI and receive:

- a trust score
- a verdict
- routing advice
- scoring subscores

This first version is intentionally simple: Node.js, TypeScript, Express, no database, no auth, no payments, and no frontend.

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

The API will run at:

```text
http://localhost:3000
```

## Build

```bash
npm run build
```

## Start built version

```bash
npm start
```

## Endpoints

### GET /

Returns basic service information.

### GET /health

Returns a simple health check.

### POST /score

Calculates a real-time trust score for an API service.

## Example request

```json
{
  "service_id": "weather-api",
  "current_status": "healthy",
  "uptime_30d": 0.99,
  "avg_latency_ms": 120,
  "failure_rate": 0.02,
  "data_age_seconds": 300,
  "verification_age_seconds": 600,
  "sample_size": 1000
}
```

## Test /score with curl

From the project root, run:

```bash
curl -X POST http://localhost:3000/score \
  -H "Content-Type: application/json" \
  --data @test/sample-request.json
```

For Windows PowerShell, run:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:3000/score `
  -ContentType "application/json" `
  -InFile test/sample-request.json
```

## Example response

```json
{
  "service_id": "weather-api",
  "trust_score": 98,
  "verdict": "primary_route",
  "execution_advice": "Auto-execute. Service is highly reliable.",
  "subscores": {
    "status_gate": 1,
    "uptime": 0.99,
    "latency": 0.94,
    "failure": 0.98,
    "data_freshness": 0.9965,
    "verification_freshness": 0.9931,
    "confidence": 1
  },
  "inputs_received": {
    "service_id": "weather-api",
    "current_status": "healthy",
    "uptime_30d": 0.99,
    "avg_latency_ms": 120,
    "failure_rate": 0.02,
    "data_age_seconds": 300,
    "verification_age_seconds": 600,
    "sample_size": 1000
  }
}
```

## Scoring formula

If `current_status` is `down`, `unhealthy`, or `offline`, PRECI immediately returns:

- `trust_score`: `0`
- `verdict`: `blacklisted`
- `execution_advice`: `Do not route. Service is currently unavailable.`

Otherwise, PRECI calculates subscores:

```text
latency_score = max(0, 1 - avg_latency_ms / 2000)
failure_score = max(0, 1 - failure_rate)
data_freshness_score = max(0, 1 - data_age_seconds / 86400)
verification_freshness_score = max(0, 1 - verification_age_seconds / 86400)
```

Then it calculates:

```text
base_score = 100 * (
  0.40 * uptime_30d +
  0.20 * latency_score +
  0.20 * failure_score +
  0.10 * data_freshness_score +
  0.10 * verification_freshness_score
)
```

Confidence is based on sample size:

```text
confidence = min(1, log(1 + sample_size) / log(1001))
```

Final score:

```text
final_score = base_score * (0.7 + 0.3 * confidence)
```

The final score is rounded to the nearest whole number.

## Verdict bands

| Score | Verdict | Routing advice |
|---:|---|---|
| 90-100 | primary_route | Auto-execute. Service is highly reliable. |
| 75-89 | secondary_route | Route allowed. Log and monitor. |
| 60-74 | human_review | Ask before routing. Reliability is uncertain. |
| Below 60 | blacklisted | Do not route. Risk is too high. |
