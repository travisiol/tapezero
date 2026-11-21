// Minimal Solana JSON-RPC client (server-side only; the URL may contain a provider key).
export const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`${method} HTTP ${r.status}`);
  const j = (await r.json()) as { result?: T; error?: { code: number; message: string } };
  if (j.error) throw new Error(`${method} ${j.error.code} ${j.error.message}`);
  return j.result as T;
}

/** Token bucket: at most `rps` calls per second. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  private rps: number;
  constructor(rps: number) {
    this.rps = rps;
    this.tokens = rps;
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.rps, this.tokens + ((now - this.last) / 1000) * this.rps);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.tokens) / this.rps) * 1000)));
    }
  }
}
