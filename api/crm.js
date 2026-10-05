import { neon } from '@neondatabase/serverless';
import { scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';

const sql = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
};

const verifyPassword = (password, stored) => {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
};

async function adminFromToken(db, token) {
  if (!token) return null;
  return (await db`
    SELECT u.id, u.email, u.role
    FROM loyalty_sessions s
    JOIN loyalty_users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW() AND u.role = 'admin'
  `).at(0) || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  try {
    const db = sql();
    const { action, token, email, password, q = '', limit = 200 } = req.body || {};

    if (action === 'login') {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const user = (await db`
        SELECT id, email, role, password_hash
        FROM loyalty_users
        WHERE email = ${normalizedEmail}
        LIMIT 1
      `).at(0);
      if (!user || user.role !== 'admin' || !verifyPassword(String(password || ''), user.password_hash)) {
        return res.status(401).json({ error: 'Invalid admin credentials' });
      }
      const sessionToken = randomUUID();
      await db`INSERT INTO loyalty_sessions(token, user_id, expires_at) VALUES(${sessionToken}, ${user.id}, NOW() + INTERVAL '30 days')`;
      return res.json({ access_token: sessionToken, email: user.email, role: user.role });
    }

    const admin = await adminFromToken(db, token);
    if (!admin) return res.status(403).json({ error: 'Admin access required' });

    if (action === 'customers') {
      const search = `%${String(q || '').trim().toLowerCase()}%`;
      const maxRows = Math.min(500, Math.max(1, Number(limit) || 200));
      const accountRows = await db`
        SELECT
          a.id AS account_id,
          a.first_name,
          a.last_name,
          a.phone,
          a.email,
          a.city,
          a.state,
          a.postal_code,
          a.created_at AS account_created_at,
          COUNT(DISTINCT c.business_id)::int AS business_count,
          COALESCE(SUM(w.balance), 0) AS total_balance,
          MAX(t.created_at) AS last_activity_at,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'business_id', b.id,
                'business_name', b.name,
                'balance', w.balance
              )
            ) FILTER (WHERE b.id IS NOT NULL),
            '[]'::json
          ) AS businesses
        FROM loyalty_customer_accounts a
        LEFT JOIN loyalty_customers c ON c.account_id = a.id
        LEFT JOIN loyalty_businesses b ON b.id = c.business_id
        LEFT JOIN loyalty_wallets w ON w.customer_id = c.id AND w.business_id = c.business_id
        LEFT JOIN loyalty_transactions t ON t.customer_id = c.id AND t.business_id = c.business_id
        WHERE ${String(q || '').trim() === ''} OR lower(a.first_name || ' ' || a.last_name || ' ' || a.email || ' ' || a.phone || ' ' || COALESCE(a.city, '')) LIKE ${search}
        GROUP BY a.id
        ORDER BY a.created_at DESC
        LIMIT ${maxRows}
      `;
      const legacyRows = await db`
        SELECT
          NULL AS account_id,
          c.name AS first_name,
          '' AS last_name,
          c.phone,
          NULL AS email,
          NULL AS city,
          NULL AS state,
          NULL AS postal_code,
          c.created_at AS account_created_at,
          1::int AS business_count,
          COALESCE(w.balance, 0) AS total_balance,
          MAX(t.created_at) AS last_activity_at,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'business_id', b.id,
                'business_name', b.name,
                'balance', w.balance
              )
            ) FILTER (WHERE b.id IS NOT NULL),
            '[]'::json
          ) AS businesses
        FROM loyalty_customers c
        LEFT JOIN loyalty_businesses b ON b.id = c.business_id
        LEFT JOIN loyalty_wallets w ON w.customer_id = c.id AND w.business_id = c.business_id
        LEFT JOIN loyalty_transactions t ON t.customer_id = c.id AND t.business_id = c.business_id
        WHERE c.account_id IS NULL
          AND (${String(q || '').trim() === ''} OR lower(c.name || ' ' || c.phone || ' ' || COALESCE(b.name, '')) LIKE ${search})
        GROUP BY c.id, w.balance
        ORDER BY c.created_at DESC
        LIMIT ${maxRows}
      `;
      const rows = [...accountRows, ...legacyRows]
        .sort((a, b) => new Date(b.account_created_at || 0) - new Date(a.account_created_at || 0))
        .slice(0, maxRows);
      return res.json({ customers: rows });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('[crm] API error:', error?.message || error);
    return res.status(500).json({ error: 'CRM operation failed' });
  }
}
