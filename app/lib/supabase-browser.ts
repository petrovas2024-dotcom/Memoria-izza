import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; console.log("SUPABASE ENV:", { hasUrl: !!url, hasKey: !!publishableKey, urlStart: url?.slice(0, 8), keyStart: publishableKey?.slice(0, 15) });

// Never let a missing or malformed production variable crash the React bundle
// before the login/error screen has a chance to render.
export const supabase = (() => {
  if (!url || !publishableKey) return null;
  try {
    return createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    return null;
  }
})();

export async function authenticatedFetch(url: string, options: RequestInit = {}) {
  if (!supabase) throw new Error("Supabase no estÃ¡ configurado");
  let { data } = await supabase.auth.getSession();
  if (!data.session) ({ data } = await supabase.auth.refreshSession());
  if (!data.session?.access_token) throw new Error("Tu sesiÃ³n terminÃ³. Ingresa nuevamente.");
  return fetch(url, {
    ...options,
    cache: options.cache || "no-store",
    headers: { ...(options.headers || {}), authorization: `Bearer ${data.session.access_token}` },
  });
}
