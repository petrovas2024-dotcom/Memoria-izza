import { getSupabaseAdmin } from "../../lib/supabase-server";

type Role = "admin" | "reception" | "technician";

async function session(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) throw new Error("UNAUTHORIZED");
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active) throw new Error("FORBIDDEN");
  const technician = profile.data.role === "technician"
    ? await db.from("technicians").select("id").eq("user_id", auth.data.user.id).single()
    : { data: null };
  return { db, userId: auth.data.user.id, role: profile.data.role as Role, technicianId: technician.data?.id || null };
}

async function readQuotes(context: Awaited<ReturnType<typeof session>>) {
  let query = context.db.from("material_quotes").select("*, material_quote_items(*)").order("updated_at", { ascending: false });
  if (context.role === "technician") query = query.eq("technician_id", context.technicianId);
  const result = await query;
  if (result.error) throw result.error;
  const orders = await context.db.from("work_orders").select("id,folio,client_id,technician_id");
  const clients = await context.db.from("clients").select("id,full_name");
  const technicians = await context.db.from("technicians").select("id,name");
  const orderMap = new Map((orders.data || []).map(row => [row.id, row]));
  const clientMap = new Map((clients.data || []).map(row => [row.id, row.full_name]));
  const techMap = new Map((technicians.data || []).map(row => [row.id, row.name]));
  return (result.data || []).map(row => {
    const order = orderMap.get(row.work_order_id);
    return {
      id: row.id, folio: row.folio, work_order_folio: order?.folio || "", client: clientMap.get(row.client_id) || "Cliente",
      technician: techMap.get(row.technician_id) || "Sin asignar", status: row.status, apply_tax: row.apply_tax,
      tax_rate: Number(row.tax_rate), discount: Number(row.discount), shipping: Number(row.shipping),
      additional_charges: Number(row.additional_charges), markup_percent: Number(row.markup_percent),
      labor: Number(row.labor), notes: row.notes || "", updated_at: row.updated_at,
      items: (row.material_quote_items || []).sort((a: { position:number },b: { position:number })=>a.position-b.position).map((item: Record<string, unknown>) => ({
        id:item.id, group_key:item.group_key, name:item.name, description:item.description||"", brand:item.brand||"", model:item.model||"",
        unit:item.unit, quantity:Number(item.quantity), unit_price:Number(item.unit_price), supplier:item.supplier||"",
        product_url:item.product_url||"", image_url:item.image_url||"", notes:item.notes||"", availability:item.availability||"",
        consulted_at:item.consulted_at, selected:item.selected,
      })),
    };
  });
}

export async function GET(request: Request) {
  try { const context = await session(request); return Response.json({ quotes: await readQuotes(context) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error && error.message === "UNAUTHORIZED" ? "No autorizado" : "No se pudieron consultar las cotizaciones de materiales" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 500 }); }
}

export async function POST(request: Request) {
  try {
    const context = await session(request);
    const body = await request.json();
    const order = await context.db.from("work_orders").select("id,client_id,technician_id").eq("folio", body.work_order_folio).single();
    if (order.error) return Response.json({ error: "La orden no existe" }, { status: 404 });
    if (context.role === "technician" && order.data.technician_id !== context.technicianId) throw new Error("FORBIDDEN");
    if (context.role !== "admin" && ["approved","rejected"].includes(body.status)) throw new Error("FORBIDDEN");
    const existing = body.id
      ? await context.db.from("material_quotes").select("id,markup_percent").eq("id", body.id).maybeSingle()
      : await context.db.from("material_quotes").select("id,markup_percent").eq("work_order_id", order.data.id).maybeSingle();
    const values = {
      work_order_id: order.data.id, client_id: order.data.client_id, technician_id: order.data.technician_id,
      status: body.status || "draft", apply_tax: !!body.apply_tax, tax_rate: Number(body.tax_rate || 16),
      discount: Number(body.discount || 0), shipping: Number(body.shipping || 0),
      additional_charges: Number(body.additional_charges || 0),
      markup_percent: context.role === "admin" ? Number(body.markup_percent || 0) : Number(existing.data?.markup_percent || 0),
      labor: Number(body.labor || 0), notes: body.notes || "", updated_at: new Date().toISOString(),
      created_by: context.userId,
    };
    const saved = existing.data
      ? await context.db.from("material_quotes").update(values).eq("id", existing.data.id).select("id").single()
      : await context.db.from("material_quotes").insert({ ...values, folio: `MAT-${Date.now().toString().slice(-8)}` }).select("id").single();
    if (saved.error) throw saved.error;
    const removed = await context.db.from("material_quote_items").delete().eq("material_quote_id", saved.data.id);
    if (removed.error) throw removed.error;
    if (body.items?.length) {
      const inserted = await context.db.from("material_quote_items").insert(body.items.map((item: Record<string, unknown>, position:number)=>({
        material_quote_id:saved.data.id, position:position+1, group_key:item.group_key, name:item.name,
        description:item.description||null, brand:item.brand||null, model:item.model||null, unit:item.unit||"pieza",
        quantity:Number(item.quantity||0), unit_price:Number(item.unit_price||0), supplier:item.supplier||null,
        product_url:item.product_url||null, image_url:item.image_url||null, notes:item.notes||null,
        availability:item.availability||null, consulted_at:item.consulted_at||new Date().toISOString().slice(0,10),
        selected:item.selected !== false,
      })));
      if (inserted.error) throw inserted.error;
    }
    const selectedItems = (body.items || []).filter((item: Record<string, unknown>) => item.selected !== false);
    const materialCost = selectedItems.reduce((sum: number, item: Record<string, unknown>) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
    const markup = materialCost * Number(values.markup_percent || 0) / 100;
    const taxable = Math.max(0, materialCost + markup + values.shipping + values.additional_charges - values.discount);
    const tax = values.apply_tax ? taxable * values.tax_rate / 100 : 0;
    const materialsTotal = Math.max(0, materialCost + markup + values.shipping + values.additional_charges + tax - values.discount + values.labor);
    const currentOrder = await context.db.from("work_orders").select("total,materials").eq("id", order.data.id).single();
    if (currentOrder.error) throw currentOrder.error;
    const previousSummary = Array.isArray(currentOrder.data.materials)
      ? currentOrder.data.materials.find((item: Record<string, unknown>) => item?.kind === "material_quote_summary")
      : null;
    const baseQuoteTotal = Number(previousSummary?.base_quote_total ?? currentOrder.data.total ?? 0);
    const updatedOrder = await context.db.from("work_orders").update({
      materials: [{ kind: "material_quote_summary", material_quote_id: saved.data.id, base_quote_total: baseQuoteTotal, material_cost: materialCost, materials_total: materialsTotal, final_total: baseQuoteTotal + materialsTotal, updated_at: new Date().toISOString(), items: selectedItems }],
      total: baseQuoteTotal + materialsTotal, updated_at: new Date().toISOString(),
    }).eq("id", order.data.id);
    if (updatedOrder.error) throw updatedOrder.error;
    const quotes = await readQuotes(context);
    return Response.json({ quote: quotes.find(row=>row.id===saved.data.id) });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    console.error("material-quotes.POST failed", error);
    return Response.json({ error: forbidden ? "No tienes permiso para modificar esta cotización" : "No se pudo guardar en Supabase" }, { status: forbidden ? 403 : 500 });
  }
}
