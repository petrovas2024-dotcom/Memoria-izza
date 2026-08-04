import { getSupabaseAdmin } from "../../lib/supabase-server";

type Role = "admin" | "reception" | "technician";
type QuoteItem = { concept: string; quantity: number; unitPrice: number };
type QuoteBody = {
  folio: string; client: string; date: string; status: string; subtotal: number;
  tax: number; discount: number; total: number; validity: string; items: QuoteItem[];
};

const statusToDb: Record<string, string> = {
  Borrador: "draft", Enviada: "sent", Aprobada: "approved", Rechazada: "rejected",
};
const statusToEs: Record<string, string> = {
  draft: "Borrador", sent: "Enviada", approved: "Aprobada", rejected: "Rechazada",
};

async function session(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) throw new Error("UNAUTHORIZED");
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active) throw new Error("FORBIDDEN");
  const role = profile.data.role as Role;
  if (!["admin", "reception"].includes(role)) throw new Error("FORBIDDEN");
  return { db, userId: auth.data.user.id };
}

export async function POST(request: Request) {
  try {
    const context = await session(request);
    const body = await request.json() as QuoteBody;
    if (!body.folio || !body.client || !body.items?.length) {
      return Response.json({ error: "La cotización está incompleta" }, { status: 400 });
    }

    const clients = await context.db.from("clients").select("id,full_name,company");
    if (clients.error) throw clients.error;
    const client = (clients.data || []).find(row => row.company === body.client || row.full_name === body.client);
    if (!client) return Response.json({ error: "No se encontró el cliente seleccionado" }, { status: 400 });

    const saved = await context.db.from("quotes").upsert({
      folio: body.folio,
      client_id: client.id,
      quote_date: body.date,
      status: statusToDb[body.status] || "draft",
      subtotal: Number(body.subtotal || 0),
      tax: Number(body.tax || 0),
      discount: Number(body.discount || 0),
      total: Number(body.total || 0),
      validity: body.validity || "15 días",
      created_by: context.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "folio" }).select("id,folio,quote_date,status,subtotal,tax,discount,total,validity").single();
    if (saved.error) throw saved.error;

    const removed = await context.db.from("quote_items").delete().eq("quote_id", saved.data.id);
    if (removed.error) throw removed.error;
    const inserted = await context.db.from("quote_items").insert(body.items.map((item, position) => ({
      quote_id: saved.data.id,
      position: position + 1,
      quantity: Number(item.quantity),
      unit: "servicio",
      concept: item.concept.trim(),
      unit_price: Number(item.unitPrice),
    }))).select("id,concept,quantity,unit_price,amount,position");
    if (inserted.error) throw inserted.error;

    return Response.json({
      quote: {
        id: 0,
        folio: saved.data.folio,
        client: client.company || client.full_name,
        date: saved.data.quote_date,
        type: "Servicio general",
        status: statusToEs[saved.data.status] || "Borrador",
        subtotal: Number(saved.data.subtotal),
        tax: Number(saved.data.tax),
        discount: Number(saved.data.discount),
        total: Number(saved.data.total),
        validity: saved.data.validity || "15 días",
        items: (inserted.data || []).sort((a, b) => a.position - b.position).map(item => ({
          id: item.id,
          concept: item.concept,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          amount: Number(item.amount),
        })),
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    console.error("quotes.POST failed", error);
    return Response.json(
      { error: unauthorized ? "No autorizado" : forbidden ? "No tienes permiso para modificar cotizaciones" : "No se pudo guardar la cotización en Supabase" },
      { status: unauthorized ? 401 : forbidden ? 403 : 500 },
    );
  }
}
