# PRECI

PRECI is a real-time API trust scoring service for agents.

Agents can send service health data to PRECI and receive:

- a trust score
- a verdict
- routing advice
- scoring subscores

This first version is intentionally simple: Node.js, TypeScript, Express, x402 payment gating for scoring, no database, no auth, and no frontend.

## Install

```bash
npm install
```

## Run locally

Create a local `.env` file:

```env
PORT=3000
X402_RECEIVING_WALLET_ADDRESS=0xYourWalletAddress
X402_NETWORK=base-sepolia
X402_PRICE=0.01
```

Then run:

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

This endpoint is protected by x402. Requests without a valid x402 payment receive HTTP 402 Payment Required with x402 payment requirements. `GET /` and `GET /health` remain free.

## x402 configuration

PRECI uses the official x402 Express seller middleware packages:

- `@x402/express`
- `@x402/evm`
- `@x402/core`

Environment variables:

| Variable | Meaning | Default |
|---|---|---|
| `X402_RECEIVING_WALLET_ADDRESS` | Wallet address that receives payments for `POST /score`. Required. | None |
| `X402_NETWORK` | Payment network. Use `base-sepolia` for testnet. You can also pass a CAIP-2 id such as `eip155:84532`. | `base-sepolia` |
| `X402_PRICE` | Price per `POST /score` call in USDC dollars. Use a plain number like `0.01`; PRECI adds the `$` required by x402. | `0.01` |

`base-sepolia` is mapped to `eip155:84532` for the x402 middleware.

## Railway variables

In Railway:

1. Open the PRECI service.
2. Go to **Variables**.
3. Add:

```env
X402_RECEIVING_WALLET_ADDRESS=0xYourWalletAddress
X402_NETWORK=base-sepolia
X402_PRICE=0.01
```

Railway normally sets `PORT` automatically. Do not commit real private keys or wallet secrets.

## Test an unpaid request

Start PRECI:

```bash
npm run dev
```

Then call the paid endpoint without payment:

```bash
curl -i -X POST http://localhost:3000/score \
  -H "Content-Type: application/json" \
  --data @test/sample-request.json
```

Expected result: HTTP 402 Payment Required with x402 payment requirements. Free endpoints should still return 200:

```bash
curl -i http://localhost:3000/
curl -i http://localhost:3000/health
```

## Test a paid request

Use the official x402 buyer helper packages to create and retry a paid request:

```bash
npm install @x402/fetch @x402/evm viem
```

Create a buyer script with a funded Base Sepolia wallet private key in `EVM_PRIVATE_KEY`, then use the x402 fetch wrapper:

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const response = await fetchWithPayment("http://localhost:3000/score", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    service_id: "weather-api",
    current_status: "healthy",
    uptime_30d: 0.99,
    avg_latency_ms: 120,
    failure_rate: 0.02,
    data_age_seconds: 300,
    verification_age_seconds: 600,
    sample_size: 1000
  })
});

console.log(response.status, await response.json());
```

For testnet, fund the buyer wallet with Base Sepolia ETH for gas and testnet USDC.

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
