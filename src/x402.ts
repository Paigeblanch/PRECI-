import type { NextFunction, Request, Response } from "express";
import { log } from "./logger.js";

const WALLET = (process.env.WALLET_ADDRESS ?? "").toLowerCase();
const X402_ENABLED = process.env.X402_ENABLED !== "false";
const BASE_RPC = "https://mainnet.base.org";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Prices in USDC atomic units (6 decimals)
const PRICES: Record<string, { usdc: number; label: string }> = {
  "POST /score/url":       { usdc: 0.005, label: "PRECI live URL probe" },
  "POST /compare":         { usdc: 0.010, label: "PRECI multi-candidate comparison" },
  "GET /score/:id/detail": { usdc: 0.003, label: "PRECI score detail" }
};

function matchRoute(method: string, path: string): string | null {
  if (method === "POST" && path === "/score/url")   return "POST /score/url";
  if (method === "POST" && path === "/compare")      return "POST /compare";
  if (method === "GET"  && /^\/score\/[^/]+\/detail$/.test(path)) return "GET /score/:id/detail";
  return null;
}

function paymentRequired(res: Response, route: string) {
  const { usdc, label } = PRICES[route];
  const payment = {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: String(Math.round(usdc * 1_000_000)),
    asset: USDC,
    payTo: process.env.WALLET_ADDRESS ?? "",
    description: label
  };
  res.setHeader("X-Payment-Required", JSON.stringify(payment));
  return res.status(402).json({
    error: "Payment Required",
    message: `This endpoint costs $${usdc} USDC on Base. Include payment proof in the X-Payment header.`,
    payment
  });
}

async function verifyPayment(txHash: string, minUsdc: number): Promise<boolean> {
  const minAtoms = BigInt(Math.round(minUsdc * 1_000_000));
  try {
    const resp = await fetch(BASE_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash]
      }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await resp.json() as any;
    const receipt = data?.result;
    if (!receipt || receipt.status !== "0x1") return false;

    // Look for a USDC Transfer to our wallet
    const walletPadded = "0x000000000000000000000000" + WALLET.slice(2);
    for (const log of receipt.logs ?? []) {
      if (
        log.address?.toLowerCase() === USDC &&
        log.topics?.[0] === TRANSFER_TOPIC &&
        log.topics?.[2]?.toLowerCase() === walletPadded
      ) {
        const amount = BigInt(log.data);
        if (amount >= minAtoms) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function x402(req: Request, res: Response, next: NextFunction) {
  if (!X402_ENABLED) return next();

  const route = matchRoute(req.method, req.path);
  if (!route) return next();

  const headerRaw = Array.isArray(req.headers["x-payment"])
    ? req.headers["x-payment"][0]
    : req.headers["x-payment"];

  if (!headerRaw) return paymentRequired(res, route);

  let txHash: string;
  try {
    const parsed = JSON.parse(headerRaw);
    txHash = parsed?.transaction_hash ?? parsed?.payload?.transaction_hash;
    if (!txHash) return res.status(402).json({ error: "X-Payment must include transaction_hash." });
  } catch {
    return res.status(400).json({ error: "X-Payment must be valid JSON." });
  }

  const { usdc } = PRICES[route];

  verifyPayment(txHash, usdc).then(valid => {
    if (!valid) {
      return res.status(402).json({ error: "Payment not verified. Transaction not found or insufficient amount." });
    }
    log({
      ts: new Date().toISOString(),
      event: "payment_settled",
      amount_usdc: usdc,
      network: "eip155:8453",
      tx_hash: txHash,
      payer: null,
      resource: route
    });
    res.setHeader("X-Payment-Response", JSON.stringify({ status: "confirmed", amount: usdc, currency: "USDC" }));
    next();
  }).catch(() => {
    res.status(500).json({ error: "Payment verification failed. Try again." });
  });
}
