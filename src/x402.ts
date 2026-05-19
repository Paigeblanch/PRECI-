import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions";
import type { NextFunction, Request, Response } from "express";
import type { Network } from "@x402/core/types";

const WALLET = process.env.WALLET_ADDRESS ?? "";
const X402_ENABLED = process.env.X402_ENABLED !== "false";
const NETWORK = "eip155:8453" as Network; // Base mainnet
const FACILITATOR_URL = "https://x402.org/facilitator";

function passthrough(_req: Request, _res: Response, next: NextFunction) {
  return next();
}

function buildMiddleware() {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

  const server = new x402ResourceServer(facilitator)
    .register(NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  const routes = {
    "POST /score/url": {
      accepts: { scheme: "exact", price: "$0.005", network: NETWORK, payTo: WALLET },
      description: "Real-time trust score for any API URL. PRECI probes live, measures latency, checks SSL and JSON validity.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        bodyType: "json" as const,
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The API endpoint URL to probe and score" },
            service_id: { type: "string", description: "Optional stable identifier for this service" },
            sample_count: { type: "integer", description: "Number of past observations for reliability scoring" }
          },
          required: ["url"]
        },
        output: {
          schema: {
            type: "object",
            properties: {
              service_id: { type: "string" },
              trust_score: { type: "integer", description: "0–100 composite trust score" },
              verdict: { type: "string", enum: ["trusted", "verified", "provisional", "inactive"] },
              probed_at: { type: "string", format: "date-time" }
            }
          }
        }
      })
    },

    "POST /compare": {
      accepts: { scheme: "exact", price: "$0.010", network: NETWORK, payTo: WALLET },
      description: "Submit 2–10 API URLs. PRECI probes all in parallel and returns a ranked list with a plain-English routing recommendation.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        bodyType: "json" as const,
        inputSchema: {
          type: "object",
          properties: {
            candidates: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: 10,
              description: "Array of 2–10 API endpoint URLs to compare"
            }
          },
          required: ["candidates"]
        },
        output: {
          schema: {
            type: "object",
            properties: {
              recommendation: { type: "string" },
              reason: { type: "string" },
              ranked: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    trust_score: { type: "integer" },
                    verdict: { type: "string" }
                  }
                }
              },
              compared_at: { type: "string", format: "date-time" }
            }
          }
        }
      })
    },

    "GET /score/:id/detail": {
      accepts: { scheme: "exact", price: "$0.003", network: NETWORK, payTo: WALLET },
      description: "Full scoring breakdown with all five subscores for a previously probed service.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        pathParamsSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The service_id from a prior /score/url response" }
          },
          required: ["id"]
        },
        output: {
          schema: {
            type: "object",
            properties: {
              service_id: { type: "string" },
              trust_score: { type: "integer" },
              verdict: { type: "string" },
              subscores: {
                type: "object",
                properties: {
                  reachability: { type: "number" },
                  speed: { type: "number" },
                  reliability: { type: "number" },
                  security: { type: "number" },
                  data_quality: { type: "number" },
                  confidence: { type: "number" }
                }
              }
            }
          }
        }
      })
    }
  };

  return paymentMiddleware(routes, server);
}

export const x402 = X402_ENABLED ? buildMiddleware() : passthrough;
