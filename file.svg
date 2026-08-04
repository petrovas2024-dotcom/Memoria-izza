import { getSupabaseAdmin } from "../../../lib/supabase-server";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "No autorizado" }, { status: 401 });
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const folio = String(form.get("work_order_folio") || "").replace(/[^a-zA-Z0-9-]/g, "");
  if (!(file instanceof File) || !folio || file.size > 8_000_000 || !file.type.startsWith("image/")) {
    return Response.json({ error: "Usa una imagen de hasta 8 MB" }, { status: 400 });
  }
  const order = await db.from("work_orders").select("id,technician_id").eq("folio", folio).single();
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (order.error || profile.error || !profile.data.active) return Response.json({ error: "Acceso denegado" }, { status: 403 });
  if (profile.data.role === "technician") {
    const technician = await db.from("technicians").select("id").eq("user_id", auth.data.user.id).single();
    if (technician.error || technician.data.id !== order.data.technician_id) return Response.json({ error: "Orden no autorizada" }, { status: 403 });
  }
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
  const path = `${order.data.id}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await db.storage.from("material-products").upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) return Response.json({ error: "No se pudo subir la imagen" }, { status: 500 });
  const signed = await db.storage.from("material-products").createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signed.error) return Response.json({ error: "No se pudo abrir la imagen" }, { status: 500 });
  return Response.json({ url: signed.data.signedUrl });
}
