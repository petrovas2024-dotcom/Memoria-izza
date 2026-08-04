import { getSupabaseAdmin } from "../../../lib/supabase-server";

type AppRole = "admin" | "reception" | "technician";
const OWNER_EMAIL = "petrovas2024@gmail.com";
const DEMO_TECHNICIAN_NAME = "Carlos Mendoza";

async function removeUnlinkedDemoTechnicians(db: ReturnType<typeof getSupabaseAdmin>) {
  const demos = await db
    .from("technicians")
    .select("id,name,user_id")
    .eq("name", DEMO_TECHNICIAN_NAME)
    .is("user_id", null);
  if (demos.error) throw demos.error;
  const ids = (demos.data || []).map(row => row.id);
  if (!ids.length) return;
  const removed = await db.from("technicians").delete().in("id", ids).is("user_id", null);
  if (removed.error) throw removed.error;
}

async function requireAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: Response.json({ error: "No se recibió la sesión autenticada de Supabase" }, { status: 401 }) };
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) {
    return { error: Response.json({ error: "La sesión de Supabase terminó. Vuelve a ingresar para continuar." }, { status: 401 }) };
  }
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active || profile.data.role !== "admin") {
    return { error: Response.json({ error: "Solo el Administrador puede gestionar usuarios" }, { status: 403 }) };
  }
  return { db, actorId: auth.data.user.id };
}

async function ensureTechnician(
  db: ReturnType<typeof getSupabaseAdmin>,
  id: string,
  fullName: string,
  phone: string,
  active: boolean,
  technicianId?: string,
) {
  if (technicianId) {
    const existing = await db.from("technicians").select("id,user_id").eq("id", technicianId).single();
    if (existing.error) throw existing.error;
    if (existing.data.user_id && existing.data.user_id !== id) {
      throw new Error("La ficha técnica seleccionada ya está vinculada a otro usuario");
    }
    const linked = await db.from("technicians").update({
      user_id: id, name: fullName, phone: phone || "Pendiente", active,
    }).eq("id", technicianId);
    if (linked.error) throw linked.error;
    return;
  }
  const result = await db.from("technicians").upsert({
    user_id: id, name: fullName, phone: phone || "Pendiente", active,
  }, { onConflict: "user_id" });
  if (result.error) throw result.error;
}

export async function GET(request: Request) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  await removeUnlinkedDemoTechnicians(context.db);
  const [{ data: authUsers, error: authError }, profiles, technicians] = await Promise.all([
    context.db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    context.db.from("users").select("id,full_name,phone,role,active,created_at").order("created_at"),
    context.db.from("technicians").select("id,user_id,name,phone,specialty,active"),
  ]);
  if (authError || profiles.error || technicians.error) {
    return Response.json({ error: authError?.message || profiles.error?.message || technicians.error?.message }, { status: 500 });
  }
  const profileById = new Map((profiles.data || []).map(profile => [profile.id, profile]));
  const technicianByUser = new Map((technicians.data || []).filter(row => row.user_id).map(row => [row.user_id, row]));
  return Response.json({
    users: (authUsers.users || []).map(auth => {
      const profile = profileById.get(auth.id);
      return {
        id: auth.id,
        email: auth.email || "",
        full_name: profile?.full_name || auth.user_metadata?.full_name || auth.email || "Usuario sin perfil",
        phone: profile?.phone || auth.user_metadata?.phone || null,
        role: profile?.role || auth.app_metadata?.role || null,
        active: profile?.active ?? false,
        created_at: profile?.created_at || auth.created_at,
        last_sign_in_at: auth.last_sign_in_at || null,
        email_confirmed: Boolean(auth.email_confirmed_at),
        technician: technicianByUser.get(auth.id) || null,
        profile_configured: Boolean(profile),
        protected: auth.email?.toLowerCase() === OWNER_EMAIL,
      };
    }),
    technician_catalog: (technicians.data || [])
      .filter(row => !row.user_id)
      .map(row => ({ id: row.id, name: row.name, phone: row.phone, active: row.active })),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  let createdId = "";
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const confirmPassword = String(body.confirm_password || "");
    const fullName = String(body.full_name || "").trim();
    const phone = String(body.phone || "").trim();
    const role = body.role as AppRole;
    const active = body.active !== false;
    const technicianId = role === "technician" ? String(body.technician_id || "") : "";
    const specialty = String(body.specialty || "").trim();
    if (!email || !email.includes("@") || password.length < 8 || !fullName || !["admin", "reception", "technician"].includes(role)) {
      return Response.json({ error: "Completa nombre, correo, rol y una contraseña de al menos 8 caracteres" }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return Response.json({ error: "Las contraseñas no coinciden" }, { status: 400 });
    }
    const created = await context.db.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: fullName, phone },
      app_metadata: { role },
    });
    if (created.error || !created.data.user) throw created.error || new Error("No se creó el usuario");
    const id = created.data.user.id;
    createdId = id;
    const profile = await context.db.from("users").upsert({
      id, full_name: fullName, phone: phone || null, role, active,
    }).select("id").single();
    if (profile.error) {
      await context.db.auth.admin.deleteUser(id);
      throw profile.error;
    }
    if (role === "technician") {
      await ensureTechnician(context.db, id, fullName, phone, active, technicianId);
      if (specialty) {
        const technician = await context.db.from("technicians").update({ specialty: [specialty] }).eq("user_id", id);
        if (technician.error) throw technician.error;
      }
    }
    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    if (createdId) {
      await context.db.from("technicians").delete().eq("user_id", createdId);
      await context.db.from("users").delete().eq("id", createdId);
      await context.db.auth.admin.deleteUser(createdId);
    }
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo crear el usuario" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  try {
    const body = await request.json();
    const id = String(body.id || "");
    if (!id) return Response.json({ error: "Usuario no válido" }, { status: 400 });
    const current = await context.db.auth.admin.getUserById(id);
    if (current.error || !current.data.user) throw current.error || new Error("Usuario no encontrado");
    const protectedOwner = current.data.user.email?.toLowerCase() === OWNER_EMAIL;
    const role: AppRole = protectedOwner ? "admin" : body.role;
    const active = protectedOwner ? true : Boolean(body.active);
    const fullName = String(body.full_name || "").trim();
    const phone = String(body.phone || "").trim();
    if (!fullName || !["admin", "reception", "technician"].includes(role)) {
      return Response.json({ error: "Nombre o rol no válido" }, { status: 400 });
    }
    const authUpdate: { email?: string; password?: string; user_metadata: Record<string, string>; app_metadata: Record<string, string> } = {
      user_metadata: { full_name: fullName, phone },
      app_metadata: { role },
    };
    const email = String(body.email || "").trim().toLowerCase();
    if (email && email !== current.data.user.email) authUpdate.email = email;
    const password = String(body.password || "");
    if (password) {
      if (password.length < 8) return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
      authUpdate.password = password;
    }
    const authResult = await context.db.auth.admin.updateUserById(id, authUpdate);
    if (authResult.error) throw authResult.error;
    const profile = await context.db.from("users").update({ full_name: fullName, phone: phone || null, role, active }).eq("id", id);
    if (profile.error) throw profile.error;
    const technicianId = role === "technician" ? String(body.technician_id || "") : "";
    if (role === "technician") await ensureTechnician(context.db, id, fullName, phone, active, technicianId);
    else await context.db.from("technicians").update({ active: false }).eq("user_id", id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el usuario" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    const current = await context.db.auth.admin.getUserById(id);
    if (current.error || !current.data.user) throw current.error || new Error("Usuario no encontrado");
    if (current.data.user.email?.toLowerCase() === OWNER_EMAIL || id === context.actorId) {
      return Response.json({ error: "La cuenta propietaria no se puede eliminar" }, { status: 409 });
    }
    const result = await context.db.auth.admin.deleteUser(id);
    if (result.error) throw result.error;
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el usuario" }, { status: 400 });
  }
}
