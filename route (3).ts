import { getSupabaseAdmin } from "../../lib/supabase-server";

type PropertyPayload = { id?: string; clientId: number; name: string; address: string; references?: string; neighborhood?: string; city?: string; postalCode?: string; latitude?: string; longitude?: string; mapsUrl?: string; notes?: string };

async function context(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) throw new Error("UNAUTHORIZED");
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active || !["admin", "reception"].includes(profile.data.role)) throw new Error("FORBIDDEN");
  return db;
}

async function clientUuid(db: ReturnType<typeof getSupabaseAdmin>, localId: number) {
  const clients = await db.from("clients").select("id").order("created_at");
  if (clients.error) throw clients.error;
  return clients.data?.[localId - 1]?.id as string | undefined;
}

export async function GET(request: Request) {
  try {
    const db = await context(request);
    const localId = Number(new URL(request.url).searchParams.get("clientId"));
    const clientId = await clientUuid(db, localId);
    if (!clientId) return Response.json({ property: null, photos: [] });
    const property = await db.from("properties").select("*").eq("client_id", clientId).order("created_at").limit(1).maybeSingle();
    if (property.error) throw property.error;
    if (!property.data) return Response.json({ property: null, photos: [] });
    const photos = await db.from("property_photos").select("id,property_id,category,description,user_name,content_type,created_at").eq("property_id", property.data.id).order("created_at", { ascending: false });
    if (photos.error) throw photos.error;
    return Response.json({ property: property.data, photos: photos.data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message === "UNAUTHORIZED" ? "No autorizado" : message === "FORBIDDEN" ? "Acceso denegado" : "No se pudo consultar la propiedad" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const db = await context(request);
    const data = await request.json() as PropertyPayload;
    const clientId = await clientUuid(db, Number(data.clientId));
    if (!clientId || !data.address?.trim()) return Response.json({ error: "Cliente o dirección no válidos" }, { status: 400 });
    const values = { client_id: clientId, name: data.name?.trim() || "Domicilio principal", address: data.address.trim(), references: data.references?.trim() || null, neighborhood: data.neighborhood?.trim() || null, city: data.city?.trim() || "Tijuana", postal_code: data.postalCode?.trim() || null, latitude: data.latitude ? Number(data.latitude) : null, longitude: data.longitude ? Number(data.longitude) : null, maps_url: data.mapsUrl?.trim() || null, notes: data.notes?.trim() || null, updated_at: new Date().toISOString() };
    const existing = await db.from("properties").select("id").eq("client_id", clientId).order("created_at").limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    const saved = existing.data ? await db.from("properties").update(values).eq("id", existing.data.id).select("id").single() : await db.from("properties").insert(values).select("id").single();
    if (saved.error) throw saved.error;
    return Response.json({ id: saved.data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message === "UNAUTHORIZED" ? "No autorizado" : message === "FORBIDDEN" ? "Acceso denegado" : "No se pudo guardar la propiedad" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}
