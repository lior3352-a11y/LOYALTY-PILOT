import { neon } from '@neondatabase/serverless';
import { createAdminHandler } from '../lib/system-admin.mjs';
export default createAdminHandler({
  site: 'israel',
  connect: () => {
    const url = process.env.ISRAEL_DATABASE_DATABASE_URL || process.env.ISRAEL_DATABASE_URL;
    if (!url || url === process.env.DATABASE_URL) throw new Error('Dedicated Israel database not configured');
    return neon(url);
  }
});
