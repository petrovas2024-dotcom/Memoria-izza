import { getSupabaseAdmin } from "../../../lib/supabase-server";

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "No autorizado" }, { status: 401 });
  const db = getSupabaseAdmin();
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || !auth.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  let profile = await db.from("users").select("id,full_name,role,active").eq("id", auth.user.id).maybeSingle();
  if (!profile.data && auth.user.email?.toLowerCase() === "petrovas2024@gmail.com") {
    profile = await db.from("users").insert({
      id: auth.user.id, full_name: auth.user.user_metadata?.full_name || "Petrova Espino",
      role: "admin", active: true,
    }).select("id,full_name,role,active").single();
  }
  if (profile.error || !profile.data || !profile.data.active) {
    return Response.json({ error: "Tu cuenta no tiene un perfil activo en IZZA Smart" }, { status: 403 });
  }
  return Response.json({ profile: profile.data });
}
