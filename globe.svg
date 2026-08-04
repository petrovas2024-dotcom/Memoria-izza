import { getSupabaseAdmin } from "../../../lib/supabase-server";

const esc = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const id = url.searchParams.get("id") || "";
  const db = getSupabaseAdmin();
  const auth = await db.auth.getUser(token);
  if (!auth.data.user) return Response.json({ error: "No autorizado" }, { status: 401 });
  const quote = await db.from("material_quotes").select("*,material_quote_items(*)").eq("id", id).single();
  if (quote.error) return Response.json({ error: "Cotización no encontrada" }, { status: 404 });
  const profile = await db.from("users").select("role,active").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data.active) return Response.json({ error: "Acceso denegado" }, { status: 403 });
  if (profile.data.role === "technician") {
    const technician = await db.from("technicians").select("id").eq("user_id", auth.data.user.id).single();
    if (technician.error || technician.data.id !== quote.data.technician_id) {
      return Response.json({ error: "Esta cotización no corresponde a tus órdenes" }, { status: 403 });
    }
  }
  const selected = (quote.data.material_quote_items || []).filter((item: { selected:boolean })=>item.selected);
  const materialCost = selected.reduce((sum:number,item:{quantity:number;unit_price:number})=>sum+Number(item.quantity)*Number(item.unit_price),0);
  const markup = materialCost * Number(quote.data.markup_percent || 0) / 100;
  const taxable = Math.max(0, materialCost + markup + Number(quote.data.shipping || 0) + Number(quote.data.additional_charges || 0) - Number(quote.data.discount || 0));
  const tax = quote.data.apply_tax ? taxable * Number(quote.data.tax_rate || 16) / 100 : 0;
  const total = taxable + tax + Number(quote.data.labor || 0);
  const lines = [
    "IZZA SERVICIOS DE MANTENIMIENTO", `Cotizacion de materiales ${quote.data.folio}`,
    `Fecha: ${String(quote.data.updated_at).slice(0,10)}`, "",
    ...selected.map((item: { name:string;quantity:number;unit:string;unit_price:number })=>`${item.name}  ${item.quantity} ${item.unit}  $${Number(item.unit_price).toFixed(2)}`),
    "", `Costo real: $${materialCost.toFixed(2)}`, `Adicional (${Number(quote.data.markup_percent)}%): $${markup.toFixed(2)}`,
    `IVA: $${tax.toFixed(2)}`, `Mano de obra: $${Number(quote.data.labor).toFixed(2)}`,
    `TOTAL GENERAL: $${total.toFixed(2)}`, "Precios sujetos a disponibilidad del proveedor.",
  ];
  const content = lines.map((line,index)=>`BT /F1 ${index<2?16:10} Tf 48 ${760-index*24} Td (${esc(line)}) Tj ET`).join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n"; const offsets=[0];
  for(const object of objects){ offsets.push(pdf.length); pdf+=object+"\n"; }
  const xref=pdf.length; pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Response(pdf,{headers:{"content-type":"application/pdf","content-disposition":`inline; filename="${quote.data.folio}.pdf"`}});
}
