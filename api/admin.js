import { neon } from '@neondatabase/serverless';
import { createAdminHandler } from '../lib/system-admin.mjs';
export default createAdminHandler({
  site: 'us',
  connect: () => {
    if (!process.env.DATABASE_URL) throw new Error('US database not configured');
    return neon(process.env.DATABASE_URL);
  }
});
