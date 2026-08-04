import { getSupabaseAdmin } from "../../lib/supabase-server";

async function requireOfficeUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("UNAUTHORIZED");
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active || !["admin", "reception"].includes(profile.data.role)) {
    throw new Error("FORBIDDEN");
  }
  return db;
}

export async function GET(request: Request) {
  try {
    const db = await requireOfficeUser(request);
    const demoRemoval = await db
      .from("technicians")
      .delete()
      .eq("name", "Carlos Mendoza")
      .is("user_id", null);
    if (demoRemoval.error) throw demoRemoval.error;
    const profiles = await db.from("users").select("id").eq("role", "technician").eq("active", true);
    if (profiles.error) throw profiles.error;
    const userIds = (profiles.data || []).map(profile => profile.id);
    if (!userIds.length) {
      return Response.json({ technicians: [] }, { headers: { "cache-control": "no-store, max-age=0" } });
    }
    const [technicians, appointments, orders] = await Promise.all([
      db.from("technicians").select("id,user_id,name,phone,specialty,active").in("user_id", userIds).eq("active", true).order("name"),
      db.from("appointments").select("technician_id,starts_at"),
      db.from("work_orders").select("technician_id,status"),
    ]);
    if (technicians.error || appointments.error || orders.error) {
      throw technicians.error || appointments.error || orders.error;
    }
    const today = new Date().toISOString().slice(0, 10);
    return Response.json({
      technicians: (technicians.data || []).map(row => ({
        id: row.id,
        name: row.name,
        specialty: Array.isArray(row.specialty) && row.specialty.length ? row.specialty.join(" · ") : "Mantenimiento general",
        phone: row.phone,
        today: (appointments.data || []).filter(item => item.technician_id === row.id && String(item.starts_at).slice(0, 10) === today).length,
        done: (orders.data || []).filter(item => item.technician_id === row.id && item.status === "completed").length,
        active: true,
      })),
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return Response.json({ error: "Acceso denegado" }, { status: 403 });
    }
    console.error("Technician catalog failed", error);
    return Response.json({ error: "No se pudo consultar el catálogo de técnicos" }, { status: 500 });
  }
}
