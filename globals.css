import { getSupabaseAdmin } from "../../lib/supabase-server";

type ClientRow = { id: number; name: string; company: string; phone: string; email: string; address: string; balance: number; services: number };
type ServiceRow = { id: number; folio: string; client: string; phone: string; type: string; date: string; time: string; end: string; technician: string; status: string; priority: string; amount: number; balance: number; address: string };
type QuoteItemRow = { id: string; concept: string; quantity: number; unitPrice: number; amount: number };
type QuoteRow = { id: number; folio: string; client: string; date: string; type: string; status: string; subtotal: number; tax: number; discount: number; total: number; validity: string; items?: QuoteItemRow[] };
type OrderRow = { id: number; folio: string; client: string; service: string; technician: string; date: string; status: string; total: number; evidence: number };
type PaymentRow = { id: number; folio: string; client: string; date: string; amount: number; method: string; type: string };
type Payload = { clients?: ClientRow[]; services?: ServiceRow[]; quotes?: QuoteRow[]; orders?: OrderRow[]; payments?: PaymentRow[] };
type SessionProfile = { id: string; role: "admin" | "reception" | "technician"; technicianId: string | null };

async function requireProfile(request: Request): Promise<SessionProfile> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const db = getSupabaseAdmin();
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || !auth.user) throw new Error("UNAUTHORIZED");
  const profile = await db.from("users").select("role,active").eq("id", auth.user.id).single();
  if (profile.error || !profile.data.active) throw new Error("FORBIDDEN");
  const technician = profile.data.role === "technician"
    ? await db.from("technicians").select("id").eq("user_id", auth.user.id).maybeSingle()
    : { data: null };
  return { id: auth.user.id, role: profile.data.role, technicianId: technician.data?.id || null };
}

const serviceStatus: Record<string, string> = {
  Confirmado: "confirmed", "En camino": "on_the_way", "En proceso": "in_progress",
  "Pendiente de confirmar": "pending_confirmation", Terminado: "completed", Reprogramado: "rescheduled",
};
const serviceStatusEs: Record<string, string> = Object.fromEntries(Object.entries(serviceStatus).map(([key, value]) => [value, key]));
const priority: Record<string, string> = { Normal: "normal", Urgente: "urgent", Emergencia: "emergency" };
const priorityEs: Record<string, string> = Object.fromEntries(Object.entries(priority).map(([key, value]) => [value, key]));
const quoteStatus: Record<string, string> = { Borrador: "draft", Enviada: "sent", Aprobada: "approved", Rechazada: "rejected" };
const quoteStatusEs: Record<string, string> = Object.fromEntries(Object.entries(quoteStatus).map(([key, value]) => [value, key]));
const orderStatus: Record<string, string> = { Asignada: "assigned", "En proceso": "in_progress", Terminada: "completed" };
const orderStatusEs: Record<string, string> = { assigned: "Asignada", in_progress: "En proceso", completed: "Terminada" };
const paymentMethod: Record<string, string> = { Efectivo: "cash", Transferencia: "transfer", Tarjeta: "card", Depósito: "deposit" };
const paymentMethodEs: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta", deposit: "Depósito", other: "Otro" };
const paymentType: Record<string, string> = { Anticipo: "advance", Abono: "partial", Liquidación: "settlement" };
const paymentTypeEs: Record<string, string> = { advance: "Anticipo", partial: "Abono", settlement: "Liquidación" };

function cleanPhone(value = "") {
  return value.replace(/\D/g, "");
}

function dateTime(date: string, time = "09:00") {
  return new Date(`${date}T${time || "09:00"}:00-07:00`).toISOString();
}

async function readAll(session: SessionProfile) {
  const db = getSupabaseAdmin();
  const [clientsResult, techniciansResult, serviceTypesResult, appointmentsResult, quotesResult, quoteItemsResult, ordersResult, paymentsResult] = await Promise.all([
    db.from("clients").select("*").order("created_at"),
    db.from("technicians").select("*"),
    db.from("service_types").select("*"),
    db.from("appointments").select("*").order("starts_at", { ascending: false }),
    db.from("quotes").select("*").order("quote_date", { ascending: false }),
    db.from("quote_items").select("*").order("position"),
    db.from("work_orders").select("*").order("scheduled_at", { ascending: false }),
    db.from("payments").select("*").order("paid_at", { ascending: false }),
  ]);
  for (const result of [clientsResult, techniciansResult, serviceTypesResult, appointmentsResult, quotesResult, quoteItemsResult, ordersResult, paymentsResult]) {
    if (result.error) throw result.error;
  }

  const clients = clientsResult.data || [];
  const technicianProfiles = await db.from("users").select("id").eq("role", "technician").eq("active", true);
  if (technicianProfiles.error) throw technicianProfiles.error;
  const activeTechnicianUserIds = new Set((technicianProfiles.data || []).map(row => row.id));
  const allTechnicians = techniciansResult.data || [];
  const technicians = allTechnicians.filter(row => row.active && row.user_id && activeTechnicianUserIds.has(row.user_id));
  const serviceTypes = serviceTypesResult.data || [];
  const clientById = new Map(clients.map((row, index) => [row.id, { ...row, localId: index + 1 }]));
  const techById = new Map(allTechnicians.map(row => [row.id, row.name]));
  const typeById = new Map(serviceTypes.map(row => [row.id, row.name]));

  const visibleAppointments = session.role === "technician"
    ? (appointmentsResult.data || []).filter(row => row.technician_id === session.technicianId) : (appointmentsResult.data || []);
  const visibleOrders = session.role === "technician"
    ? (ordersResult.data || []).filter(row => row.technician_id === session.technicianId) : (ordersResult.data || []);
  return {
    technicians: session.role === "technician" ? [] : technicians.map(row => ({
      id: row.id,
      name: row.name,
      specialty: Array.isArray(row.specialty) && row.specialty.length ? row.specialty.join(" · ") : "Mantenimiento general",
      phone: row.phone,
      today: (visibleAppointments || []).filter(item => item.technician_id === row.id && String(item.starts_at).slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      done: (ordersResult.data || []).filter(item => item.technician_id === row.id && item.status === "completed").length,
      active: row.active,
    })),
    clients: clients.map((row, index) => ({
      id: index + 1, name: row.full_name, company: row.company || "Particular", phone: row.phone,
      email: row.email || "", address: row.address, balance: 0,
      services: (appointmentsResult.data || []).filter(item => item.client_id === row.id).length,
    })),
    services: visibleAppointments.map((row, index) => {
      const start = new Date(row.starts_at);
      const end = new Date(row.ends_at);
      const client = clientById.get(row.client_id);
      return {
        id: index + 1, folio: row.folio, client: client?.full_name || "Cliente", phone: client?.phone || "",
        type: typeById.get(row.service_type_id) || "Mantenimiento general",
        date: start.toLocaleDateString("en-CA", { timeZone: "America/Tijuana" }),
        time: start.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Tijuana" }),
        end: end.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Tijuana" }),
        technician: techById.get(row.technician_id) || "Sin asignar", status: serviceStatusEs[row.status] || "Pendiente de confirmar",
        priority: priorityEs[row.priority] || "Normal", amount: Number(row.estimated_amount), balance: Math.max(0, Number(row.estimated_amount) - Number(row.advance)), address: row.address,
      };
    }),
    quotes: session.role === "technician" ? [] : (quotesResult.data || []).map((row, index) => ({
      id: index + 1, folio: row.folio, client: clientById.get(row.client_id)?.company || clientById.get(row.client_id)?.full_name || "Cliente",
      date: row.quote_date, type: "Servicio general", status: quoteStatusEs[row.status] || "Borrador",
      subtotal: Number(row.subtotal), tax: Number(row.tax), discount: Number(row.discount),
      total: Number(row.total), validity: row.validity || "15 días",
      items: (quoteItemsResult.data || []).filter(item => item.quote_id === row.id).map(item => ({
        id: item.id, concept: item.concept, quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price), amount: Number(item.amount),
      })),
    })),
    orders: visibleOrders.map((row, index) => ({
      id: index + 1, folio: row.folio, client: clientById.get(row.client_id)?.full_name || "Cliente",
      service: row.work_performed || row.diagnosis || "Servicio general", technician: techById.get(row.technician_id) || "Sin asignar",
      date: row.scheduled_at ? String(row.scheduled_at).slice(0, 10) : "", status: orderStatusEs[row.status] || "Asignada",
      total: session.role === "technician" ? 0 : Number(row.total), evidence: 0,
      address: clientById.get(row.client_id)?.address || "",
      phone: clientById.get(row.client_id)?.phone || "",
      observations: row.recommendations || "",
    })),
    payments: session.role !== "admin" ? [] : (paymentsResult.data || []).map((row, index) => ({
      id: index + 1, folio: row.folio, client: clientById.get(row.client_id)?.full_name || "Cliente",
      date: String(row.paid_at).slice(0, 10), amount: Number(row.amount), method: paymentMethodEs[row.method] || "Otro",
      type: paymentTypeEs[row.payment_type] || "Abono",
    })),
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireProfile(request);
    return Response.json(
      { data: await readAll(session), connected: true },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return Response.json({ error: "No autorizado" }, { status: 401 });
    if (error instanceof Error && error.message === "FORBIDDEN") return Response.json({ error: "Acceso denegado" }, { status: 403 });
    console.error("Supabase sync GET failed", error);
    return Response.json({ error: "No se pudo leer Supabase" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireProfile(request);
    const body = await request.json() as Payload;
    const db = getSupabaseAdmin();
    if (session.role === "reception" && body.payments) throw new Error("FORBIDDEN");
    if (session.role === "technician") {
      if (body.clients || body.services || body.quotes || body.payments) throw new Error("FORBIDDEN");
      for (const row of body.orders || []) {
        const existing = await db.from("work_orders").select("id,technician_id").eq("folio", row.folio).single();
        if (existing.error || existing.data.technician_id !== session.technicianId) throw new Error("FORBIDDEN");
        const result = await db.from("work_orders").update({
          status: orderStatus[row.status] || "assigned",
          recommendations: (row as OrderRow & { observations?: string }).observations || null,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.data.id).eq("technician_id", session.technicianId);
        if (result.error) throw result.error;
      }
      return Response.json({ data: await readAll(session), connected: true });
    }
    const clientIds = new Map<string, string>();

    for (const client of body.clients || []) {
      const phone = cleanPhone(client.phone);
      const existing = await db.from("clients").select("id").eq("phone", phone).maybeSingle();
      if (existing.error) throw existing.error;
      const values = { full_name: client.name, company: client.company || null, phone, whatsapp: phone, email: client.email || null, address: client.address, city: "Tijuana, Baja California" };
      const saved = existing.data
        ? await db.from("clients").update(values).eq("id", existing.data.id).select("id").single()
        : await db.from("clients").insert(values).select("id").single();
      if (saved.error) throw saved.error;
      clientIds.set(client.name, saved.data.id);
      clientIds.set(client.company, saved.data.id);
    }

    const technicianIds = new Map<string, string>();
    const existingTechnicians = await db.from("technicians").select("id,name");
    if (existingTechnicians.error) throw existingTechnicians.error;
    for (const technician of existingTechnicians.data || []) technicianIds.set(technician.name, technician.id);

    const serviceTypeIds = new Map<string, string>();
    for (const name of [...new Set((body.services || []).map(row => row.type))].filter(Boolean)) {
      const normalized = name === "Boiler" ? "Boilers" : name === "Mantenimiento" ? "Mantenimiento general" : name;
      const result = await db.from("service_types").upsert({ name: normalized }, { onConflict: "name" }).select("id").single();
      if (result.error) throw result.error;
      serviceTypeIds.set(name, result.data.id);
    }

    for (const row of body.services || []) {
      const clientId = clientIds.get(row.client);
      if (!clientId) continue;
      const values = {
        folio: row.folio, client_id: clientId, technician_id: technicianIds.get(row.technician) || null,
        service_type_id: serviceTypeIds.get(row.type) || null, address: row.address,
        starts_at: dateTime(row.date, row.time), ends_at: dateTime(row.date, row.end === row.time ? String(Number(row.time.slice(0, 2)) + 1).padStart(2, "0") + row.time.slice(2) : row.end),
        priority: priority[row.priority] || "normal", status: serviceStatus[row.status] || "pending_confirmation",
        estimated_amount: row.amount || 0, advance: Math.max(0, (row.amount || 0) - (row.balance || 0)),
      };
      const result = await db.from("appointments").upsert(values, { onConflict: "folio" });
      if (result.error) throw result.error;
    }

    for (const row of body.quotes || []) {
      const clientId = clientIds.get(row.client) || clientIds.values().next().value;
      if (!clientId) continue;
      const result = await db.from("quotes").upsert({
        folio: row.folio, client_id: clientId, quote_date: row.date, status: quoteStatus[row.status] || "draft",
        subtotal: row.subtotal ?? row.total ?? 0, tax: row.tax || 0, discount: row.discount || 0,
        total: row.total ?? 0, validity: row.validity,
      }, { onConflict: "folio" }).select("id").single();
      if (result.error) throw result.error;
      if (row.items) {
        const removed = await db.from("quote_items").delete().eq("quote_id", result.data.id);
        if (removed.error) throw removed.error;
        if (row.items.length) {
          const inserted = await db.from("quote_items").insert(row.items.map((item, position) => ({
            quote_id: result.data.id, position: position + 1, quantity: item.quantity,
            unit: "servicio", concept: item.concept, unit_price: item.unitPrice,
          })));
          if (inserted.error) throw inserted.error;
        }
      }
    }

    for (const row of body.orders || []) {
      const clientId = clientIds.get(row.client) || clientIds.values().next().value;
      if (!clientId) continue;
      const result = await db.from("work_orders").upsert({
        folio: row.folio, client_id: clientId, technician_id: technicianIds.get(row.technician) || null,
        scheduled_at: row.date ? dateTime(row.date) : null, work_performed: row.service,
        status: orderStatus[row.status] || "assigned", total: row.total || 0,
      }, { onConflict: "folio" });
      if (result.error) throw result.error;
    }

    for (const row of body.payments || []) {
      const clientId = clientIds.get(row.client) || clientIds.values().next().value;
      if (!clientId) continue;
      const result = await db.from("payments").upsert({
        folio: row.folio, client_id: clientId, paid_at: dateTime(row.date),
        amount: row.amount || 0, method: paymentMethod[row.method] || "other",
        payment_type: paymentType[row.type] || "partial",
      }, { onConflict: "folio" });
      if (result.error) throw result.error;
    }

    return Response.json({ data: await readAll(session), connected: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return Response.json({ error: "No autorizado" }, { status: 401 });
    if (error instanceof Error && error.message === "FORBIDDEN") return Response.json({ error: "Acceso denegado" }, { status: 403 });
    console.error("Supabase sync POST failed", error);
    return Response.json({ error: "No se pudo sincronizar con Supabase" }, { status: 500 });
  }
}
