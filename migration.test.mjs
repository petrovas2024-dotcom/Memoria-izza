import { getSupabaseAdmin } from "../../../lib/supabase-server";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "No autorizado" }, { status: 401 });
  const db = getSupabaseAdmin();
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const profile = await db.from("users").select("role,active").eq("id", auth.user.id).single();
  if (profile.error || !profile.data.active || profile.data.role !== "technician") return Response.json({ error: "Acceso denegado" }, { status: 403 });
  const technician = await db.from("technicians").select("id").eq("user_id", auth.user.id).single();
  if (technician.error) return Response.json({ error: "Técnico no relacionado" }, { status: 403 });

  const form = await request.formData();
  const folio = String(form.get("folio") || "");
  const category = String(form.get("category") || "");
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (!folio || !["before", "after"].includes(category) || !files.length) return Response.json({ error: "Evidencia incompleta" }, { status: 400 });
  const order = await db.from("work_orders").select("id,technician_id").eq("folio", folio).single();
  if (order.error || order.data.technician_id !== technician.data.id) return Response.json({ error: "Orden no autorizada" }, { status: 403 });

  await db.storage.createBucket("work-order-photos", { public: false }).catch(() => undefined);
  for (const file of files) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${order.data.id}/${category}/${crypto.randomUUID()}-${safe}`;
    const uploaded = await db.storage.from("work-order-photos").upload(path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) return Response.json({ error: "No se pudo subir una fotografía" }, { status: 500 });
    const saved = await db.from("work_order_photos").insert({ work_order_id: order.data.id, category, storage_path: path, uploaded_by: auth.user.id });
    if (saved.error) return Response.json({ error: "No se pudo registrar la fotografía" }, { status: 500 });
  }
  return Response.json({ uploaded: files.length });
}
