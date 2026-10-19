import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export function supportDatabaseUrl(req, env) {
  const host = String(req.headers.host || '').toLowerCase();
  if (host.includes('loyaltyapp.company') || host.startsWith('loyalty-il-')) {
    const dedicated = env.ISRAEL_DATABASE_DATABASE_URL || env.ISRAEL_DATABASE_URL;
    if (!dedicated || dedicated === env.DATABASE_URL) return undefined;
    return dedicated;
  }
  return env.DATABASE_URL;
}

function limit(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 10000) : fallback;
}

// One durable counter per scope and time bucket. PostgreSQL serializes concurrent
// ON CONFLICT updates; a reservation is never refunded after a provider failure.
export function createSupportLimiter({ env = process.env, getSql } = {}) {
  const schemaReady = new Map();
  const database = getSql || (async (url) => {
    if (!url) throw new Error('No support limit store');
    const { neon } = await import('@neondatabase/serverless');
    return neon(url, { fetchOptions: { signal: AbortSignal.timeout(3000) } });
  });
  return async function reserve(req) {
    const databaseUrl = supportDatabaseUrl(req, env);
    const secret = env.LOYALTY_SUPPORT_RATE_SECRET || databaseUrl;
    // Trust forwarded IPs only on Vercel, which overwrites this header.
    const ip = env.VERCEL === '1'
      ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      : req.socket?.remoteAddress;
    if (!secret || !isIP(ip || '')) return { allowed: false, unavailable: true };
    const sql = await database(databaseUrl);
    const databaseKey = databaseUrl || "injected-test-database";
    if (!schemaReady.has(databaseKey)) schemaReady.set(databaseKey, sql`CREATE TABLE IF NOT EXISTS loyalty_support_limits (
      scope TEXT PRIMARY KEY, bucket BIGINT NOT NULL, used INTEGER NOT NULL
    )`.catch(error => { schemaReady.delete(databaseKey); throw error; }));
    await schemaReady.get(databaseKey);
    const identity = createHmac('sha256', secret).update(ip).digest('hex');
    const scopes = [
      [`minute:${identity}`, 60, limit(env.LOYALTY_SUPPORT_PER_MINUTE, 5)],
      [`day:${identity}`, 86400, limit(env.LOYALTY_SUPPORT_PER_DAY, 20)],
      ['global:day', 86400, limit(env.LOYALTY_SUPPORT_DAILY_REQUESTS, 100)]
    ];
    for (const [scope, seconds, maximum] of scopes) {
      if (maximum === 0) return { allowed: false, retryAfter: seconds };
      // Database time keeps limits consistent across all instances and regions.
      const rows = await sql`INSERT INTO loyalty_support_limits (scope, bucket, used)
        VALUES (${scope}, floor(extract(epoch from now()) / ${seconds})::bigint, 1)
        ON CONFLICT (scope) DO UPDATE SET
          used = CASE WHEN loyalty_support_limits.bucket = EXCLUDED.bucket
            THEN loyalty_support_limits.used + 1 ELSE 1 END,
          bucket = EXCLUDED.bucket
        WHERE loyalty_support_limits.bucket < EXCLUDED.bucket
          OR (loyalty_support_limits.bucket = EXCLUDED.bucket
            AND loyalty_support_limits.used < ${maximum})
        RETURNING used`;
      if (!rows.length) return { allowed: false, retryAfter: seconds };
    }
    return { allowed: true };
  };
}

const reserve = createSupportLimiter();
export async function reserveSupportBudget(req) {
  try { return await reserve(req); }
  catch { return { allowed: false, unavailable: true }; }
}
