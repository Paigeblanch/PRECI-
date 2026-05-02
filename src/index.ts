import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { calculateTrustScore, validateScoreRequest } from "./scoring.js";
import type { ScoreRequest } from "./types.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

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
