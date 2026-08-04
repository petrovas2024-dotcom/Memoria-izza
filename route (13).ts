import { getSupabaseAdmin } from "../../../lib/supabase-server";

type Role = "admin" | "reception" | "technician";

async function session(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) throw new Error("UNAUTHORIZED");
  const profile = await db.from("users").select("role,active,full_name").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active) throw new Error("FORBIDDEN");
  const role = profile.data.role as Role;
  if (!["admin", "reception"].includes(role)) throw new Error("FORBIDDEN");
  return { db, userId: auth.data.user.id, userName: profile.data.full_name || auth.data.user.email || "Usuario IZZA" };
}

async function quoteByFolio(context: Awaited<ReturnType<typeof session>>, folio: string) {
  const quote = await context.db.from("quotes").select("*").eq("folio", folio).single();
  if (quote.error) throw new Error("NOT_FOUND");
  return quote.data;
}

type QuoteRecord = { id: string; folio: string; status: string; appointment_id?: string | null; client_id: string; observations?: string | null; total?: number; advance?: number };

async function recordApproval(context: Awaited<ReturnType<typeof session>>, quote: QuoteRecord) {
  if (quote.status !== "approved") {
    const approved = await context.db.from("quotes").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", quote.id).select("*").single();
    if (approved.error) throw approved.error;
    quote = approved.data;
  }
  const existingAudit = await context.db.from("audit_log").select("id").eq("entity", "quotes").eq("entity_id", quote.id).eq("action", "quote_approved").maybeSingle();
  if (existingAudit.error) throw existingAudit.error;
  if (!existingAudit.data) {
    const audit = await context.db.from("audit_log").insert({ user_id: context.userId, action: "quote_approved", entity: "quotes", entity_id: quote.id, metadata: { folio: quote.folio, approved_at: new Date().toISOString(), approved_by_name: context.userName } });
    if (audit.error) throw audit.error;
  }
  return quote;
}

async function createOrder(context: Awaited<ReturnType<typeof session>>, quote: QuoteRecord) {
  const existing = await context.db.from("work_orders").select("*").eq("quote_id", quote.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { created: false, order: existing.data };

  const items = await context.db.from("quote_items").select("concept,quantity,unit,position").eq("quote_id", quote.id).order("position");
  if (items.error) throw items.error;
  const appointment = quote.appointment_id
    ? await context.db.from("appointments").select("technician_id,starts_at,notes").eq("id", quote.appointment_id).maybeSingle()
    : { data: null, error: null };
  if (appointment.error) throw appointment.error;

  const order = await context.db.from("work_orders").insert({
    folio: `ORD-${String(quote.folio).replace(/^COT-/, "")}`, quote_id: quote.id, appointment_id: quote.appointment_id || null,
    client_id: quote.client_id, technician_id: appointment.data?.technician_id || null, scheduled_at: appointment.data?.starts_at || null,
    work_performed: (items.data || []).map(item => `${Number(item.quantity)} ${item.unit} · ${item.concept}`).join("\n") || "Servicio cotizado",
    recommendations: quote.observations || appointment.data?.notes || null, materials: [], status: "assigned",
    total: Number(quote.total || 0), advance: Number(quote.advance || 0),
  }).select("*").single();
  if (order.error) {
    const concurrent = await context.db.from("work_orders").select("*").eq("quote_id", quote.id).maybeSingle();
    if (concurrent.data) return { created: false, order: concurrent.data };
    throw order.error;
  }
  const audit = await context.db.from("audit_log").insert({ user_id: context.userId, action: "quote_converted_to_order", entity: "work_orders", entity_id: order.data.id, metadata: { quote_id: quote.id, quote_folio: quote.folio, order_folio: order.data.folio } });
  if (audit.error) console.error("work order audit failed", audit.error);
  return { created: true, order: order.data };
}

export async function POST(request: Request) {
  try {
    const context = await session(request);
    const body = await request.json() as { folio?: string; action?: "approve" | "convert" | "reject" };
    if (!body.folio || !body.action) return Response.json({ error: "Indica la cotización y la acción" }, { status: 400 });
    let quote = await quoteByFolio(context, body.folio);
    if (body.action === "reject") {
      if (quote.status === "approved") return Response.json({ error: "Una cotización aprobada no puede rechazarse" }, { status: 409 });
      const rejected = await context.db.from("quotes").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", quote.id).select("folio").single();
      if (rejected.error) throw rejected.error;
      await context.db.from("audit_log").insert({ user_id: context.userId, action: "quote_rejected", entity: "quotes", entity_id: quote.id, metadata: { folio: quote.folio, rejected_at: new Date().toISOString(), rejected_by_name: context.userName } });
      return Response.json({ status: "Rechazada", folio: quote.folio }, { headers: { "cache-control": "no-store" } });
    }
    quote = await recordApproval(context, quote);
    const result = await createOrder(context, quote);
    return Response.json({ status: "Aprobada", folio: quote.folio, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("quotes workflow failed", error);
    return Response.json({ error: message === "UNAUTHORIZED" ? "No autorizado" : message === "FORBIDDEN" ? "No tienes permiso para esta acción" : message === "NOT_FOUND" ? "Cotización no encontrada" : "No se pudo completar el flujo de la cotización" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "NOT_FOUND" ? 404 : 500 });
  }
}
