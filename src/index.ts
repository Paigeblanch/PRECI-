import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { calculateTrustScore, validateScoreRequest } from "./scoring.js";
import type { ScoreRequest } from "./types.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const x402ReceivingWalletAddress = process.env.X402_RECEIVING_WALLET_ADDRESS;
const x402Network = process.env.X402_NETWORK || "base-sepolia";
const x402Price = process.env.X402_PRICE || "0.01";

const x402NetworkIds: Record<string, string> = {
  base: "eip155:8453",
  "base-mainnet": "eip155:8453",
  "base-sepolia": "eip155:84532"
};

const paymentNetwork = (x402NetworkIds[x402Network] || x402Network) as `${string}:${string}`;
const paymentPrice = x402Price.startsWith("$") ? x402Price : `$${x402Price}`;

if (!x402ReceivingWalletAddress) {
  throw new Error("X402_RECEIVING_WALLET_ADDRESS is required to start PRECI.");
}

const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator"
});

const x402Server = new x402ResourceServer(facilitatorClient).register(
  paymentNetwork,
  new ExactEvmScheme()
);

app.use(cors());
app.use(express.json());

app.use(
  paymentMiddleware(
    {
      "POST /score": {
        accepts: {
          scheme: "exact",
          price: paymentPrice,
          network: paymentNetwork,
          payTo: x402ReceivingWalletAddress
        },
        description: "Calculate a PRECI real-time API trust score",
        mimeType: "application/json"
      }
    },
    x402Server
  )
);

app.get("/", (_req, res) => {
  res.json({
    name: "PRECI",
    description: "Real-time API service trust score for agents",
    version: "0.1.0",
    endpoints: {
      health: "GET /health",
      score: "POST /score"
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "PRECI",
    status: "healthy"
  });
});

app.post("/score", (req, res) => {
  const errors = validateScoreRequest(req.body);

  if (errors.length > 0) {
    return res.status(400).json({
      error: "Invalid score request.",
      details: errors
    });
  }

  const result = calculateTrustScore(req.body as ScoreRequest);
  return res.json(result);
});

app.listen(port, () => {
  console.log(`PRECI API running at http://localhost:${port}`);
});
