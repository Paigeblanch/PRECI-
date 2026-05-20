import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions";
import type { NextFunction, Request, Response } from "express";
import type { Network } from "@x402/core/types";
import { log } from "./logger.js";
import { SignJWT } from "jose";
import { randomBytes, createPrivateKey } from "crypto";

const WALLET = process.env.WALLET_ADDRESS ?? "";
const X402_ENABLED = process.env.X402_ENABLED !== "false";
const NETWORK = "eip155:8453" as Network; // Base mainnet
const FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const CDP_KEY_NAME = process.env.CDP_API_KEY_NAME ?? "";
const CDP_KEY_SECRET = process.env.CDP_API_KEY_SECRET ?? "";

async function signCDPJwt(uri: string): Promise<string> {
  const privateKey = createPrivateKey(CDP_KEY_SECRET.replace(/\\n/g, "\n"));
  const nonce = randomBytes(16).toString("hex");
  const jwt = await new SignJWT({ uris: [uri] })
    .setProtectedHeader({ alg: "ES256", kid: CDP_KEY_NAME, nonce })
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000))
    .setExpirationTime("2m")
    .setIssuer(CDP_KEY_NAME)
    .setAudience(["cdp_service"])
    .sign(privateKey);
  return `Bearer ${jwt}`;
}

function passthrough(_req: Request, _res: Response, next: NextFunction) {
  return next();
}

function buildMiddleware() {
  const facilitator = new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
    createAuthHeaders: async () => {
      const [verifyToken, settleToken, supportedToken] = await Promise.all([
        signCDPJwt(`${FACILITATOR_URL}/verify`),
        signCDPJwt(`${FACILITATOR_URL}/settle`),
        signCDPJwt(`${FACILITATOR_URL}/supported`)
      ]);
      return {
        verify:    { Authorization: verifyToken },
        settle:    { Authorization: settleToken },
        supported: { Authorization: supportedToken }
      };
    }
  });

  const server = new x402ResourceServer(facilitator)
    .register(NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension)
    .onAfterSettle(async (ctx) => {
      const payload = ctx.paymentPayload as Record<string, unknown>;
      const reqs = ctx.requirements as Record<string, unknown>;
      await log({
        ts: new Date().toISOString(),
        event: "payment_settled",
        amount_usdc: reqs["amount"] ?? null,
        network: reqs["network"] ?? null,
        tx_hash: (payload["payload"] as any)?.transaction_hash ?? payload["transaction_hash"] ?? null,
        payer: (payload["payload"] as any)?.from ?? payload["from"] ?? null,
        resource: reqs["resource"] ?? null
      });
    });

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
            service_id: { type: "string", description: "Optional stable identifier for this service" }
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
              maxItems: 10
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
              ranked: { type: "array" },
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
              subscores: { type: "object" }
            }
          }
        }
      })
    }
  };

  return paymentMiddleware(routes, server);
}

export const x402 = X402_ENABLED ? buildMiddleware() : passthrough;
