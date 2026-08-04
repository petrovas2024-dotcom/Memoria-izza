import { getSupabaseAdmin } from "../../../lib/supabase-server";

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "No autorizado" }, { status: 401 });
    const db = getSupabaseAdmin();
    const auth = await db.auth.getUser(token);
    if (!auth.data.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
    const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
    if (profile.error || !profile.data.active || !["admin", "reception"].includes(profile.data.role)) {
      return Response.json({ error: "No tienes permiso para crear la cotización formal" }, { status: 403 });
    }

    const { id } = await request.json();
    const source = await db.from("material_quotes").select("*,material_quote_items(*)").eq("id", id).single();
    if (source.error) return Response.json({ error: "Cotización de materiales no encontrada" }, { status: 404 });
    const selected = (source.data.material_quote_items || []).filter((item: { selected: boolean }) => item.selected);
    if (!selected.length) return Response.json({ error: "Selecciona al menos una alternativa" }, { status: 400 });

    const materialCost = selected.reduce((sum: number, item: { quantity: number; unit_price: number }) =>
      sum + Number(item.quantity) * Number(item.unit_price), 0);
    const markup = materialCost * Number(source.data.markup_percent || 0) / 100;
    const shipping = Number(source.data.shipping || 0);
    const charges = Number(source.data.additional_charges || 0);
    const discount = Number(source.data.discount || 0);
    const labor = Number(source.data.labor || 0);
    const taxable = Math.max(0, materialCost + markup + shipping + charges - discount);
    const tax = source.data.apply_tax ? taxable * Number(source.data.tax_rate || 16) / 100 : 0;
    const subtotal = materialCost + markup + shipping + charges + labor;
    const total = Math.max(0, subtotal + tax - discount);
    const folio = `COT-MAT-${String(source.data.folio).replace(/^MAT-/, "")}`;

    const quote = await db.from("quotes").upsert({
      folio, client_id: source.data.client_id, quote_date: new Date().toISOString().slice(0, 10),
      status: "draft", subtotal, tax, discount, total, validity: "15 días",
      created_by: auth.data.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: "folio" }).select("id,folio,quote_date,status,subtotal,tax,discount,total,validity").single();
    if (quote.error) throw quote.error;
    const removed = await db.from("quote_items").delete().eq("quote_id", quote.data.id);
    if (removed.error) throw removed.error;

    const markupFactor = 1 + Number(source.data.markup_percent || 0) / 100;
    const items = selected.map((item: { name: string; description?: string; brand?: string; model?: string; quantity: number; unit: string; unit_price: number }, position: number) => ({
      quote_id: quote.data.id, position: position + 1, quantity: Number(item.quantity), unit: item.unit,
      concept: [item.name, item.brand, item.model, item.description].filter(Boolean).join(" · "),
      unit_price: Number(item.unit_price) * markupFactor,
    }));
    if (shipping) items.push({ quote_id: quote.data.id, position: items.length + 1, quantity: 1, unit: "servicio", concept: "Envío / traslado", unit_price: shipping });
    if (charges) items.push({ quote_id: quote.data.id, position: items.length + 1, quantity: 1, unit: "servicio", concept: "Cargos adicionales", unit_price: charges });
    if (labor) items.push({ quote_id: quote.data.id, position: items.length + 1, quantity: 1, unit: "servicio", concept: "Mano de obra", unit_price: labor });
    const inserted = await db.from("quote_items").insert(items).select("id,concept,quantity,unit_price,amount,position");
    if (inserted.error) throw inserted.error;
    const client = await db.from("clients").select("full_name,company").eq("id", source.data.client_id).single();

    return Response.json({ quote: {
      id: 0, folio: quote.data.folio, client: client.data?.company || client.data?.full_name || "Cliente",
      date: quote.data.quote_date, type: "Materiales y mano de obra", status: "Borrador",
      subtotal: Number(quote.data.subtotal), tax: Number(quote.data.tax), discount: Number(quote.data.discount),
      total: Number(quote.data.total), validity: quote.data.validity || "15 días",
      items: (inserted.data || []).map(item => ({
        id: item.id, concept: item.concept, quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price), amount: Number(item.amount),
      })),
    }}, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("material quote conversion failed", error);
    return Response.json({ error: "No se pudo crear la cotización formal" }, { status: 500 });
  }
}
