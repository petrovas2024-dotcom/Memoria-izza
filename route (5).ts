import { getSupabaseAdmin } from "../../lib/supabase-server";

const BUCKET = "property-photos";
const MAX_SIZE = 900 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

async function user(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) throw new Error("UNAUTHORIZED");
  const profile = await db.from("users").select("full_name,role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active || !["admin", "reception"].includes(profile.data.role)) throw new Error("FORBIDDEN");
  return { db, name: profile.data.full_name };
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Identificador no válido", { status: 400 });
  const db = getSupabaseAdmin();
  const photo = await db.from("property_photos").select("storage_path,content_type").eq("id", id).maybeSingle();
  if (photo.error || !photo.data) return new Response("No encontrada", { status: 404 });
  const object = await db.storage.from(BUCKET).download(photo.data.storage_path);
  if (object.error) return new Response("No encontrada", { status: 404 });
  return new Response(object.data, { headers: { "content-type": photo.data.content_type, "cache-control": "private, max-age=3600" } });
}

export async function POST(request: Request) {
  try {
    const { db, name } = await user(request);
    const form = await request.formData();
    const file = form.get("file");
    const propertyId = String(form.get("propertyId") || "");
    if (!(file instanceof File) || !propertyId || !ALLOWED.has(file.type) || file.size <= 0 || file.size > MAX_SIZE) return Response.json({ error: "Archivo no válido o mayor de 900 KB" }, { status: 400 });
    const exists = await db.from("properties").select("id").eq("id", propertyId).maybeSingle();
    if (!exists.data) return Response.json({ error: "Guarda la propiedad antes de subir fotos" }, { status: 404 });
    const path = `${propertyId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const upload = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;
    const saved = await db.from("property_photos").insert({ property_id: propertyId, category: String(form.get("category") || "Otra"), description: String(form.get("description") || "").trim(), user_name: name, storage_path: path, content_type: file.type }).select("id").single();
    if (saved.error) { await db.storage.from(BUCKET).remove([path]); throw saved.error; }
    return Response.json({ id: saved.data.id, url: `/api/property-photos?id=${saved.data.id}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message === "UNAUTHORIZED" ? "No autorizado" : message === "FORBIDDEN" ? "Acceso denegado" : "No se pudo guardar la fotografía" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { db } = await user(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Identificador no válido" }, { status: 400 });
    const photo = await db.from("property_photos").select("storage_path").eq("id", id).maybeSingle();
    if (!photo.data) return Response.json({ ok: true });
    await db.storage.from(BUCKET).remove([photo.data.storage_path]);
    const removed = await db.from("property_photos").delete().eq("id", id);
    if (removed.error) throw removed.error;
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message === "UNAUTHORIZED" ? "No autorizado" : message === "FORBIDDEN" ? "Acceso denegado" : "No se pudo eliminar la fotografía" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}
