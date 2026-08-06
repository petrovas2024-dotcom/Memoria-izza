import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Supabase no estÃ¡ configurado");

  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

