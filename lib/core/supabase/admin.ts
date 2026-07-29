import { createClient } from '@supabase/supabase-js'
// Use the BOM-cleaned keys from env (cleanKey strips a leading UTF-8 BOM / 0xFEFF).
// Reading process.env.SUPABASE_SERVICE_ROLE_KEY raw here caused a ByteString header
// error ("character 65279") when the Vercel env value carried a BOM.
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from './env'

export function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
