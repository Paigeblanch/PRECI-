import https from "https";

const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeResult {
  status: "healthy" | "unhealthy" | "down";
  latency_ms: number;
  http_status?: number;
  ssl_days_remaining?: number;
  returns_json: boolean;
  error?: string;
}

function statusFromHttpCode(code: number): "healthy" | "unhealthy" | "down" {
  if (code >= 500) return "down";
  if (code >= 400) return "unhealthy";
  return "healthy";
}

function checkSslExpiry(hostname: string): Promise<number | null> {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname, port: 443, method: "HEAD", path: "/", timeout: 5000 },
      (res) => {
        const cert = (res.socket as any).getPeerCertificate();
        if (!cert?.valid_to) return resolve(null);
        const daysRemaining = Math.floor(
          (new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000
        );
        resolve(daysRemaining);
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function fetchWithChecks(
  url: string
): Promise<{ status: "healthy" | "unhealthy" | "down"; latency_ms: number; http_status?: number; returns_json: boolean; error?: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "PRECI-probe/0.1" }
    });
    clearTimeout(timer);

    const latency_ms = Date.now() - start;
    const http_status = response.status;

    let returns_json = false;
    try {
      const text = await response.text();
      JSON.parse(text);
      returns_json = true;
    } catch {
      returns_json = false;
    }

    return { status: statusFromHttpCode(http_status), latency_ms, http_status, returns_json };
  } catch (err) {
    clearTimeout(timer);
    const latency_ms = Date.now() - start;
    const error = err instanceof Error ? err.message : "Probe failed";
    return { status: "down", latency_ms, returns_json: false, error };
  }
}

export async function probeUrl(url: string): Promise<ProbeResult> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";

  const [fetchResult, sslDays] = await Promise.all([
    fetchWithChecks(url),
    isHttps ? checkSslExpiry(parsed.hostname) : Promise.resolve(undefined)
  ]);

  return {
    ...fetchResult,
    ...(sslDays !== undefined && sslDays !== null ? { ssl_days_remaining: sslDays } : {})
  };
}

export function serviceIdFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
