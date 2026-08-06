import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Falta SUPABASE_URL"); if (!secret) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}


