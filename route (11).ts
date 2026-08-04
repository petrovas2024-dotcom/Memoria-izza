import { getSupabaseAdmin } from "../../../lib/supabase-server";

const esc = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const folio = url.searchParams.get("folio") || "";
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) return Response.json({ error: "No autorizado" }, { status: 401 });
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active || !["admin", "reception"].includes(profile.data.role)) return Response.json({ error: "Acceso denegado" }, { status: 403 });
  const quote = await db.from("quotes").select("*,clients(full_name,company),quote_items(concept,quantity,unit,unit_price,amount,position)").eq("folio", folio).single();
  if (quote.error) return Response.json({ error: "Cotización no encontrada" }, { status: 404 });
  const client = quote.data.clients?.company || quote.data.clients?.full_name || "Cliente";
  const items = (quote.data.quote_items || []).sort((a: {position:number}, b: {position:number}) => a.position-b.position);
  const lines = [
    "IZZA SERVICIOS DE MANTENIMIENTO", `Cotizacion ${quote.data.folio}`, `Cliente: ${client}`,
    `Fecha: ${quote.data.quote_date}`, `Vigencia: ${quote.data.validity || "15 dias"}`, "",
    ...items.map((item: {concept:string;quantity:number;unit:string;unit_price:number;amount:number}) => `${item.concept} | ${Number(item.quantity)} ${item.unit} x $${Number(item.unit_price).toFixed(2)} = $${Number(item.amount).toFixed(2)}`),
    "", `Subtotal: $${Number(quote.data.subtotal).toFixed(2)}`, `IVA: $${Number(quote.data.tax).toFixed(2)}`,
    `Descuento: $${Number(quote.data.discount).toFixed(2)}`, `TOTAL: $${Number(quote.data.total).toFixed(2)}`,
    "Soluciones confiables, resultados que duran.",
  ];
  const content = lines.slice(0, 28).map((line,index)=>`BT /F1 ${index<2?16:10} Tf 42 ${760-index*24} Td (${esc(line)}) Tj ET`).join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n"; const offsets=[0];
  for (const object of objects) { offsets.push(pdf.length); pdf += object+"\n"; }
  const xref=pdf.length; pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Response(pdf,{headers:{"content-type":"application/pdf","content-disposition":`attachment; filename="${quote.data.folio}.pdf"`,"cache-control":"no-store"}});
}
