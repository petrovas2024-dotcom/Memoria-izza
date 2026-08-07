"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import PropertyProfile, { PropertyAgendaSummary } from "./components/PropertyProfile";
import {
  Bell, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock3,
  CreditCard, FileText, Home, MapPin, Menu, MessageCircle, Plus, Search,
  Settings, Users, Wrench, X, AlertTriangle, ArrowUpRight, Camera, Download,
  MoreHorizontal, Phone, UserRound, WalletCards, PackageSearch, ExternalLink,
  Trash2, Copy, Send, Percent, ShieldCheck, UserPlus, KeyRound
} from "lucide-react";
import { supabase } from "./lib/supabase-browser";

type View = "panel" | "agenda" | "clientes" | "cotizaciones" | "ordenes" | "materiales" | "pagos" | "tecnicos" | "usuarios" | "configuracion";
type ServiceStatus = "Confirmado" | "En camino" | "En proceso" | "Pendiente de confirmar" | "Terminado" | "Reprogramado";

type Client = { id: number; name: string; company: string; phone: string; email: string; address: string; balance: number; services: number; };
type Service = { id: number; folio: string; client: string; phone: string; type: string; date: string; time: string; end: string; technician: string; status: ServiceStatus; priority: "Normal" | "Urgente" | "Emergencia"; amount: number; balance: number; address: string; };
type QuoteItem = { id: string; concept: string; quantity: number; unitPrice: number; amount: number; };
type QuoteDraftItem = { id: string; concept: string; quantity: string; unitPrice: string; };
type Quote = { id: number; folio: string; client: string; date: string; type: string; status: "Borrador" | "Enviada" | "Aprobada" | "Rechazada"; subtotal: number; tax: number; discount: number; total: number; validity: string; items: QuoteItem[]; };
type WorkOrder = { id: number; folio: string; client: string; service: string; technician: string; date: string; status: "Asignada" | "En proceso" | "Terminada"; total: number; evidence: number; address?: string; phone?: string; observations?: string; };
type Payment = { id: number; folio: string; client: string; date: string; amount: number; method: string; type: string; };
type AppRole = "admin" | "reception" | "technician";
type Profile = { id: string; full_name: string; role: AppRole; active: boolean };
type SystemUser = {
  id: string; email: string; full_name: string; phone: string | null; role: AppRole | null; active: boolean;
  created_at: string; last_sign_in_at: string | null; email_confirmed: boolean; protected: boolean;
  profile_configured: boolean;
  technician: { id: string; specialty: string[]; active: boolean } | null;
};
type TechnicianCatalogOption = { id: string; name: string; phone: string | null; active: boolean };
const AUTH_TIMEOUT_MS = 10000;

async function withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getSupabaseAccessToken(forceRefresh = false): Promise<string> {
  if (!supabase) throw new Error("La conexión segura de Supabase no está disponible.");
  let result = forceRefresh
    ? await withTimeout(supabase.auth.refreshSession(), "Supabase tardó demasiado en renovar la sesión.")
    : await withTimeout(supabase.auth.getSession(), "Supabase tardó demasiado en recuperar la sesión.");
  const expiresAt = result.data.session?.expires_at || 0;
  if (!forceRefresh && result.data.session && expiresAt * 1000 <= Date.now() + 60_000) {
    result = await withTimeout(supabase.auth.refreshSession(), "Supabase tardó demasiado en renovar la sesión.");
  }
  if (result.error || !result.data.session?.access_token) {
    throw new Error("Tu sesión terminó. Cierra sesión e ingresa nuevamente.");
  }
  return result.data.session.access_token;
}

async function supabaseAuthenticatedFetch(url: string, options: RequestInit = {}) {
  const execute = async (forceRefresh: boolean) => {
    const token = await getSupabaseAccessToken(forceRefresh);
    return fetch(url, {
      ...options,
      cache: options.cache || "no-store",
      headers: {
        ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
        ...(options.headers || {}),
        authorization: `Bearer ${token}`,
      },
    });
  };
  let response = await execute(false);
  if (response.status === 401) response = await execute(true);
  return response;
}
type MaterialItem = {
  id?: string; group_key: string; name: string; description: string; brand: string; model: string;
  unit: string; quantity: number; unit_price: number; supplier: string; product_url: string;
  image_url?: string; notes: string; availability: string; consulted_at: string; selected: boolean;
};
type MaterialQuote = {
  id?: string; folio?: string; work_order_folio: string; client: string; technician: string; status: "draft" | "pending" | "approved" | "rejected";
  apply_tax: boolean; tax_rate: number; discount: number; shipping: number; additional_charges: number;
  markup_percent: number; labor: number; notes: string; items: MaterialItem[]; updated_at?: string;
};

const today = new Date().toISOString().slice(0, 10);
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const quoteItemId = () => `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const parseMoneyInput = (value: string) => {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  return normalized === "" ? Number.NaN : Number(normalized);
};

const serviceSchema = z.object({
  client: z.string().min(2, "Selecciona un cliente"),
  type: z.string().min(2, "Indica el tipo de servicio"),
  date: z.string().min(1, "Selecciona una fecha"),
  time: z.string().min(1, "Selecciona una hora"),
  technician: z.string().min(2, "Asigna un técnico"),
  priority: z.enum(["Normal", "Urgente", "Emergencia"]),
});
type ServiceForm = z.infer<typeof serviceSchema>;

const clientSchema = z.object({
  name: z.string().min(3, "Escribe el nombre completo"),
  company: z.string().min(2, "Indica empresa o Particular"),
  phone: z.string().min(10, "Escribe un teléfono válido"),
  email: z.string().email("Correo no válido"),
  address: z.string().min(5, "Escribe la dirección"),
});
type ClientForm = z.infer<typeof clientSchema>;

const navItems = [
  { id: "panel" as View, label: "Panel", icon: Home },
  { id: "agenda" as View, label: "Agenda", icon: CalendarDays },
  { id: "clientes" as View, label: "Clientes", icon: Users },
  { id: "cotizaciones" as View, label: "Cotizaciones", icon: FileText },
  { id: "ordenes" as View, label: "Ã“rdenes", icon: ClipboardList },
  { id: "materiales" as View, label: "Cotizador de materiales", icon: PackageSearch },
  { id: "pagos" as View, label: "Pagos", icon: CreditCard },
  { id: "tecnicos" as View, label: "Técnicos", icon: Wrench },
  { id: "usuarios" as View, label: "Usuarios y accesos", icon: ShieldCheck },
  { id: "configuracion" as View, label: "Configuración", icon: Settings },
];

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("Term") || status === "Aprobada" ? "green" : status.includes("proceso") || status === "Enviada" ? "blue" : status.includes("Pendiente") || status === "Urgente" ? "gold" : status === "Rechazada" ? "red" : "gray";
  return <span className={`badge badge-${tone}`}>{status}</span>;
}

function MetricCard({ label, value, note, icon: Icon, tone = "navy" }: { label: string; value: string; note: string; icon: typeof Home; tone?: string }) {
  return <article className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon size={20} /></div>
    <div><p>{label}</p><strong>{value}</strong><small>{note}</small></div>
  </article>;
}

export default function HomePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [accessToken, setAccessToken] = useState("");
  const [view, setView] = useState<View>("panel");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"service" | "client" | "quote" | "payment" | null>(null);
  const [toast, setToast] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianCard[]>([]);
  const [agendaMode, setAgendaMode] = useState("Lista");
  const [quoteClient, setQuoteClient] = useState("");
  const [quoteType, setQuoteType] = useState("Servicio general");
  const [quoteItems, setQuoteItems] = useState<QuoteDraftItem[]>([]);
  const [quoteTax, setQuoteTax] = useState(true);
  const [quoteDiscount, setQuoteDiscount] = useState(0);
  const [quoteManualTotal, setQuoteManualTotal] = useState(false);
  const [quoteTotalInput, setQuoteTotalInput] = useState("");
  const [editingQuoteId, setEditingQuoteId] = useState<number | null>(null);
  const [savingQuote, setSavingQuote] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [cloudStatus, setCloudStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [loaded, setLoaded] = useState(false);
  const [materialQuotes, setMaterialQuotes] = useState<MaterialQuote[]>([]);
  const [materialQuoteOpen, setMaterialQuoteOpen] = useState<MaterialQuote | null>(null);
  const [quoteWorkflowBusy, setQuoteWorkflowBusy] = useState("");

  const serviceForm = useForm<ServiceForm>({ resolver: zodResolver(serviceSchema), defaultValues: { date: today, time: "09:00", priority: "Normal" } });
  const clientForm = useForm<ClientForm>({ resolver: zodResolver(clientSchema), defaultValues: { company: "Particular" } });

  useEffect(() => {
    let active = true;
    setAuthReady(false);
    setAuthError("");
    if (!supabase) {
      setAuthError("La conexión segura de IZZA Smart no está disponible. La configuración de Supabase no se cargó correctamente.");
      setAuthReady(true);
      return;
    }
    withTimeout(
      supabase.auth.getSession(),
      "Supabase tardó demasiado en recuperar la sesión."
    ).then(async ({ data, error }) => {
      if (error) throw error;
      const token = data.session?.access_token || "";
      if (!active) return;
      setAccessToken(token);
      if (!token) return;
      const controller = new AbortController();
      const profileTimer = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
      const response = await fetch("/api/auth/profile", {
        headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      }).finally(() => window.clearTimeout(profileTimer));
      const result = await response.json().catch(() => ({}));
      if (response.status === 403) throw new Error("Perfil no configurado");
      if (!response.ok) throw new Error(result.error || "No fue posible consultar tu perfil.");
      if (!result.profile?.role || !result.profile?.active) throw new Error("Tu perfil de IZZA Smart no está activo o no tiene un rol válido.");
      if (!active) return;
      setProfile(result.profile);
      setAuthError("");
      if (result.profile.role === "reception") setView("agenda");
    }).catch(error => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : "No fue posible validar la sesión.");
    }).finally(() => { if (active) setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextToken = session?.access_token || "";
      setAccessToken(nextToken);
      if (event === "SIGNED_IN" && session) { setAuthAttempt(current => current + 1); return; }
      if (!session) {
        setProfile(null);
        setAuthError("");
        setAuthReady(true);
      }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [authAttempt]);

  useEffect(() => {
    if (!accessToken || !profile) return;
    const timer = window.setTimeout(() => {
      fetch("/api/sync", { headers: { authorization: `Bearer ${accessToken}` } }).then(async response => {
        if (!response.ok) throw new Error("sync");
        const result = await response.json();
        if (result.data) {
          setServices(result.data.services); setClients(result.data.clients); setQuotes(result.data.quotes);
          setPayments(result.data.payments); setOrders(result.data.orders);
          setTechnicians(result.data.technicians || []);
        }
        setCloudStatus("connected");
      }).catch(() => setCloudStatus("offline")).finally(() => setLoaded(true));
    }, 0);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => window.clearTimeout(timer);
  }, [accessToken, profile]);

  useEffect(() => {
    if (!loaded || !accessToken || !profile || profile.role === "technician") return;
    const timer = window.setTimeout(() => {
      fetch("/api/sync", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ services, clients, payments, orders }),
      }).then(async response => {
        if (!response.ok) throw new Error("sync");
        await response.json();
        setCloudStatus("connected");
      }).catch(() => setCloudStatus("offline"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [services, clients, payments, orders, loaded, accessToken, profile]);

  const notify = (message: string) => setToast(message);

  const loadTechnicians = async () => {
    if (!profile || profile.role === "technician") {
      setTechnicians([]);
      return;
    }
    try {
      const response = await supabaseAuthenticatedFetch("/api/technicians");
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo consultar el catálogo de técnicos");
      setTechnicians(result.technicians || []);
    } catch {
      setTechnicians([]);
      notify("No se pudo actualizar el catálogo de técnicos");
    }
  };

  useEffect(() => {
    if (!profile || profile.role === "technician") return;
    const refresh = () => { void loadTechnicians(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const poll = window.setInterval(refresh, 5_000);
    const channel = supabase?.channel("izza-technician-catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "technicians" }, refresh)
      .subscribe();
    window.addEventListener("izza:technicians-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("izza:technicians-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [profile]);

  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 2600); return () => clearTimeout(timer); } }, [toast]);

  const loadMaterialQuotes = async () => {
    if (!accessToken || !profile) return;
    try {
      const response = await fetch("/api/material-quotes", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMaterialQuotes(result.quotes || []);
    } catch { notify("No se pudieron consultar los materiales"); }
  };
  useEffect(() => { if (accessToken && profile) loadMaterialQuotes(); }, [accessToken, profile]);

  const openMaterialQuote = (order?: WorkOrder) => {
    const target = order || orders[0];
    if (!target) { notify("Primero crea o asigna una orden de servicio"); return; }
    const existing = materialQuotes.find(quote => quote.work_order_folio === target.folio);
    setMaterialQuoteOpen(existing || {
      work_order_folio: target.folio, client: target.client, technician: target.technician, status: "draft",
      apply_tax: false, tax_rate: 16, discount: 0, shipping: 0, additional_charges: 0,
      markup_percent: 0, labor: 0, notes: "", items: [emptyMaterialItem()],
    });
  };

  const filteredServices = useMemo(() => services.filter(s => `${s.client} ${s.phone} ${s.folio} ${s.type}`.toLowerCase().includes(query.toLowerCase())), [services, query]);
  const quoteSubtotal = quoteItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const quoteIva = quoteTax ? quoteSubtotal * .16 : 0;
  const calculatedQuoteTotal = Math.max(0, quoteSubtotal + quoteIva - quoteDiscount);
  const parsedQuoteTotal = parseMoneyInput(quoteTotalInput);
  const quoteTotal = quoteManualTotal
    ? Math.max(0, Number.isFinite(parsedQuoteTotal) ? parsedQuoteTotal : 0)
    : calculatedQuoteTotal;

  const navigate = (next: View) => {
    setView(next); setMobileOpen(false); setQuery(""); setSelectedClientId(null);
    if (next === "tecnicos") void loadTechnicians();
  };
  const openServiceForm = () => {
    void loadTechnicians();
    setModal("service");
  };
  const updateTechnician = (updated: TechnicianCard, previousName: string) => {
    const nextTechnicians = technicians.map(technician => technician.id === updated.id ? updated : technician);
    setTechnicians(nextTechnicians);
    setServices(current => current.map(service => service.technician === previousName ? {...service, technician: updated.name} : service));
    notify("Técnico actualizado; guardando en Supabase");
  };
  const assignOrder = (orderId: number, technician: string) => {
    setOrders(current => current.map(order => order.id === orderId ? { ...order, technician } : order));
    notify(technician === "Sin asignar" ? "Orden marcada sin técnico" : `Orden asignada a ${technician}`);
  };

  const createService = (data: ServiceForm) => {
    const selected = clients.find(c => c.name === data.client) || clients[0];
    if (!selected) { notify("Primero registra un cliente"); return; }
    const next: Service = { id: Math.max(0, ...services.map(s => s.id)) + 1, folio: `SRV-${1050 + services.length}`, client: data.client, phone: selected.phone.replace(/\s/g, ""), type: data.type, date: data.date, time: data.time, end: data.time, technician: data.technician, status: "Pendiente de confirmar", priority: data.priority, amount: 0, balance: 0, address: selected.address };
    setServices([next, ...services]); setModal(null); serviceForm.reset({ date: today, time: "09:00", priority: "Normal" }); notify("Servicio creado correctamente");
  };

  const createClient = (data: ClientForm) => {
    setClients([{ id: Math.max(0, ...clients.map(c => c.id)) + 1, ...data, balance: 0, services: 0 }, ...clients]); setModal(null); clientForm.reset({ company: "Particular" }); notify("Cliente registrado correctamente");
  };

  const resetQuoteForm = () => {
    setQuoteClient(clients[0]?.name || "");
    setQuoteType("Servicio general");
    setQuoteItems([{ id: quoteItemId(), concept: "", quantity: "1", unitPrice: "" }]);
    setQuoteTax(true); setQuoteDiscount(0); setQuoteManualTotal(false); setQuoteTotalInput(""); setEditingQuoteId(null);
  };

  const openNewQuote = () => {
    resetQuoteForm();
    setModal("quote");
  };

  const openEditQuote = (quote: Quote) => {
    setEditingQuoteId(quote.id); setQuoteClient(quote.client); setQuoteType(quote.type);
    setQuoteItems(quote.items?.length
      ? quote.items.map(item => ({ id: item.id, concept: item.concept, quantity: String(item.quantity), unitPrice: String(item.unitPrice) }))
      : [{ id: quoteItemId(), concept: quote.type, quantity: "1", unitPrice: String(quote.subtotal || quote.total) }]);
    setQuoteTax(quote.tax > 0); setQuoteDiscount(quote.discount || 0);
    const calculated = (quote.subtotal || 0) + (quote.tax || 0) - (quote.discount || 0);
    const hasManualTotal = Math.abs(calculated - quote.total) > .009;
    setQuoteManualTotal(hasManualTotal);
    setQuoteTotalInput(hasManualTotal ? String(quote.total) : "");
    setModal("quote");
  };

  const updateQuoteItem = (id: string, patch: Partial<QuoteDraftItem>) => {
    setQuoteItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const saveQuote = async () => {
    if (!quoteClient) { notify("Selecciona un cliente"); return; }
    if (!quoteItems.length || quoteItems.some(item => !item.concept.trim() || Number(item.quantity) <= 0 || item.unitPrice === "" || Number(item.unitPrice) < 0)) {
      notify("Completa concepto, cantidad y precio de cada partida"); return;
    }
    if (quoteManualTotal && (quoteTotalInput === "" || !Number.isFinite(parsedQuoteTotal) || parsedQuoteTotal < 0)) {
      notify("Escribe un total válido"); return;
    }
    const existing = quotes.find(quote => quote.id === editingQuoteId);
    const savedQuote: Quote = {
      id: existing?.id || Math.max(0, ...quotes.map(q => q.id)) + 1,
      folio: existing?.folio || `COT-${new Date().getFullYear()}-${String(83 + quotes.length).padStart(3, "0")}`,
      client: quoteClient, date: existing?.date || today, type: quoteType, status: existing?.status || "Borrador",
      subtotal: quoteSubtotal, tax: quoteIva, discount: quoteDiscount, total: quoteTotal, validity: existing?.validity || "15 días",
      items: quoteItems.map(item => {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        return { ...item, quantity, unitPrice, amount: quantity * unitPrice };
      }),
    };
    setSavingQuote(true);
    try {
      const response = await fetch("/api/quotes", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(savedQuote),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "save");
      setQuotes(current => existing
        ? current.map(quote => quote.folio === result.quote.folio ? { ...result.quote, id: quote.id } : quote)
        : [{ ...result.quote, id: savedQuote.id }, ...current]);
      setCloudStatus("connected"); setModal(null); resetQuoteForm();
      notify(existing ? "Cotización actualizada en Supabase" : "Cotización guardada en Supabase");
    } catch {
      setCloudStatus("offline");
      notify("No se pudo guardar. Revisa la conexión e intenta de nuevo");
    } finally {
      setSavingQuote(false);
    }
  };

  const refreshOperationalData = async () => {
    const response = await supabaseAuthenticatedFetch("/api/sync");
    const result = await response.json();
    if (!response.ok || !result.data) throw new Error(result.error || "No se pudieron actualizar los datos");
    setQuotes(result.data.quotes); setOrders(result.data.orders); setServices(result.data.services);
    setClients(result.data.clients); setPayments(result.data.payments); setTechnicians(result.data.technicians || []);
  };

  const runQuoteWorkflow = async (quote: Quote, action: "approve" | "convert" | "reject") => {
    setQuoteWorkflowBusy(`${quote.folio}:${action}`);
    try {
      const response = await supabaseAuthenticatedFetch("/api/quotes/workflow", {
        method: "POST", body: JSON.stringify({ folio: quote.folio, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo completar la acción");
      await refreshOperationalData();
      if (action !== "reject") setView("ordenes");
      if (action === "reject") notify(`Cotización ${quote.folio} rechazada y guardada en Supabase`);
      else if (action === "approve") notify(result.created
        ? `Cotización ${quote.folio} aprobada y orden creada correctamente`
        : `Cotización ${quote.folio} aprobada; su orden ya existía y no se duplicó`);
      else notify(result.created ? "Orden de servicio creada correctamente" : "Esta cotización ya tenía una orden; no se duplicó");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo completar la acción");
    } finally { setQuoteWorkflowBusy(""); }
  };

  const createPayment = () => {
    if (!clients[0]) { notify("Primero registra un cliente"); return; }
    setPayments([{ id: Math.max(0, ...payments.map(p => p.id)) + 1, folio: `PAG-${510 + payments.length}`, client: clients[0].name, date: today, amount: 1000, method: "Transferencia", type: "Abono" }, ...payments]);
    setModal(null); notify("Pago registrado correctamente");
  };

  if (!authReady) return <div className="auth-loading"><div><strong>IZZA SMART</strong><span>Preparando acceso seguroâ€¦</span></div></div>;
  if (authError) return <AuthErrorScreen message={authError} onRetry={() => {
    setAuthError(""); setAuthAttempt(current => current + 1);
  }} onLogout={async () => {
    if (supabase) await supabase.auth.signOut().catch(() => undefined);
    setProfile(null); setAccessToken(""); setAuthError("");
  }} />;
  if (!profile) return <LoginScreen onAuthenticated={(nextProfile, token) => { setProfile(nextProfile); setAccessToken(token); setAuthError(""); setAuthReady(true); }} />;
  if (profile.role === "technician") {
    return <TechnicianWorkspace profile={profile} orders={orders} accessToken={accessToken} setOrders={setOrders} onLogout={() => supabase?.auth.signOut()} notify={notify} toast={toast} materialQuoteOpen={materialQuoteOpen} openMaterials={openMaterialQuote} closeMaterials={() => setMaterialQuoteOpen(null)} onMaterialSaved={quote => setMaterialQuotes(current => [quote, ...current.filter(item => item.id !== quote.id && item.work_order_folio !== quote.work_order_folio)])} />;
  }

  const allowedNav = navItems.filter(item => profile.role === "admin" || !["panel", "pagos", "tecnicos", "configuracion"].includes(item.id));
  const roleLabel = profile.role === "admin" ? "Administrador" : "Recepción";
  const logout = async () => { if (supabase) await supabase.auth.signOut(); setProfile(null); setAccessToken(""); setAuthError(""); };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <button className="close-menu" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X /></button>
        <div className="brand">
          <Image src="/logo_izza.png" alt="IZZA Servicios de Mantenimiento" width={54} height={54} priority unoptimized />
          <div><strong>IZZA SMART</strong><span>Administración integral</span></div>
        </div>
        <nav>
          <p className="nav-label">OPERACIÃ“N</p>
          {allowedNav.filter(item => !["tecnicos", "usuarios", "configuracion"].includes(item.id)).map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={19}/><span>{label}</span>{view === id && <ChevronRight size={16}/>}</button>)}
          {profile.role === "admin" && <><p className="nav-label">ADMINISTRACIÃ“N</p>
          {allowedNav.filter(item => ["tecnicos", "usuarios", "configuracion"].includes(item.id)).map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={19}/><span>{label}</span>{view === id && <ChevronRight size={16}/>}</button>)}</>}
        </nav>
        <div className="connection-card"><span>{cloudStatus === "connected" ? "SUPABASE CONECTADO" : cloudStatus === "offline" ? "CONEXIÃ“N INTERRUMPIDA" : "CONECTANDO..."}</span><p>{cloudStatus === "connected" ? "Los datos se leen y guardan directamente en producción." : "No se guardarán cambios hasta recuperar la conexión."}</p><button onClick={() => notify(cloudStatus === "connected" ? "Conexión de producción activa" : "Reintentaremos la conexión automáticamente")}>{cloudStatus === "connected" ? "Producción activa" : "Ver estado"}</button></div>
        <div className="sidebar-foot"><p>Servicio bilingÃ¼e</p><small>Bilingual Service Â· Tijuana, B.C.</small></div>
      </aside>

      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu /></button>
          <div className="global-search"><Search size={19}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar cliente, folio o teléfono..." /></div>
          <div className="top-actions">
            <a className="whatsapp-button" href="https://wa.me/526641216748" target="_blank"><MessageCircle size={18}/><span>WhatsApp</span></a>
            <button className="notification"><Bell size={20}/><i>3</i></button>
            <button className="user-chip logout-chip" onClick={logout} title="Cerrar sesión"><div>{profile.full_name.split(" ").map(x => x[0]).slice(0,2).join("")}</div><span><strong>{profile.full_name}</strong><small>{roleLabel} Â· Cerrar sesión</small></span></button>
          </div>
        </header>

        <div className="workspace">
          <section className="page-heading">
            <div><p className="eyebrow">IZZA SERVICIOS DE MANTENIMIENTO</p><h1>{navItems.find(n => n.id === view)?.label}</h1><p>{view === "panel" ? "Resumen operativo de hoy Â· Tijuana, Baja California" : "Gestiona la información de forma rápida y segura."}</p></div>
            <div className="heading-actions">
              <button className="secondary-button" onClick={openNewQuote}><FileText size={18}/>Nueva cotización</button>
              <button className="primary-button" onClick={openServiceForm}><Plus size={18}/>Nuevo servicio</button>
            </div>
          </section>

          {view === "panel" && <Dashboard services={services} quotes={quotes} payments={payments} navigate={navigate} setModal={next => next === "quote" ? openNewQuote() : setModal(next)} openServiceForm={openServiceForm} />}
          {view === "agenda" && <Agenda services={filteredServices} clients={clients} technicians={technicians} mode={agendaMode} setMode={setAgendaMode} notify={notify} />}
          {view === "clientes" && (selectedClientId && clients.length > 0
            ? <PropertyProfile client={clients.find(client => client.id === selectedClientId) || clients[0]} services={services} onBack={()=>setSelectedClientId(null)} notify={notify}/>
            : <Clients clients={clients.filter(c => `${c.name} ${c.company} ${c.phone}`.toLowerCase().includes(query.toLowerCase()))} openNew={() => setModal("client")} openProperty={setSelectedClientId} />)}
          {view === "cotizaciones" && <Quotes quotes={quotes} notify={notify} openNew={openNewQuote} openEdit={openEditQuote} onApprove={quote=>runQuoteWorkflow(quote,"approve")} onReject={quote=>runQuoteWorkflow(quote,"reject")} onConvert={quote=>runQuoteWorkflow(quote,"convert")} accessToken={accessToken} busy={quoteWorkflowBusy} />}
          {view === "ordenes" && <Orders orders={orders} clients={clients} technicians={technicians} notify={notify} openMaterials={openMaterialQuote} onAssign={assignOrder} />}
          {view === "materiales" && <MaterialsModule quotes={materialQuotes} orders={orders} openQuote={openMaterialQuote} />}
          {view === "pagos" && <Payments payments={payments} openNew={() => setModal("payment")} />}
          {view === "tecnicos" && <Technicians techs={technicians} onSave={updateTechnician} onTechniciansChanged={loadTechnicians} notify={notify} />}
          {view === "usuarios" && <UserAdministration notify={notify} onTechniciansChanged={loadTechnicians} />}
          {view === "configuracion" && <Configuration notify={notify} />}
        </div>
      </main>

      <nav className="mobile-nav">
        {allowedNav.slice(0, 5).map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={20}/><span>{label}</span></button>)}
      </nav>

      {modal && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">{modal === "quote" && editingQuoteId ? "EDITAR REGISTRO" : "NUEVO REGISTRO"}</p><h2>{modal === "service" ? "Programar servicio" : modal === "client" ? "Registrar cliente" : modal === "quote" ? editingQuoteId ? "Editar cotización" : "Nueva cotización" : "Registrar pago"}</h2></div><button onClick={() => setModal(null)} aria-label="Cerrar"><X/></button></div>
        {modal === "service" && <form onSubmit={serviceForm.handleSubmit(createService)} className="form-grid">
          <label className="wide">Cliente<select {...serviceForm.register("client")}><option value="">Selecciona...</option>{clients.map(c => <option key={c.id}>{c.name}</option>)}</select><em>{serviceForm.formState.errors.client?.message}</em></label>
          <label>Tipo de servicio<select {...serviceForm.register("type")}><option value="">Selecciona...</option>{["Plomería","Electricidad","Boilers","Bombas de agua","Impermeabilización","Refrigeración","Minisplit","Mantenimiento general"].map(x => <option key={x}>{x}</option>)}</select><em>{serviceForm.formState.errors.type?.message}</em></label>
          <label>Técnico<select {...serviceForm.register("technician")}><option value="">Selecciona...</option>{technicians.filter(technician => technician.active).map(technician => <option key={technician.id} value={technician.name}>{technician.name}</option>)}</select><em>{serviceForm.formState.errors.technician?.message}</em></label>
          <label>Fecha<input type="date" {...serviceForm.register("date")} /></label><label>Hora<input type="time" {...serviceForm.register("time")} /></label>
          <label className="wide">Prioridad<select {...serviceForm.register("priority")}><option>Normal</option><option>Urgente</option><option>Emergencia</option></select></label>
          <div className="modal-actions wide"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancelar</button><button className="primary-button">Guardar servicio</button></div>
        </form>}
        {modal === "client" && <form onSubmit={clientForm.handleSubmit(createClient)} className="form-grid">
          <label>Nombre completo<input {...clientForm.register("name")} placeholder="Nombre y apellidos"/><em>{clientForm.formState.errors.name?.message}</em></label>
          <label>Empresa<input {...clientForm.register("company")} /><em>{clientForm.formState.errors.company?.message}</em></label>
          <label>Teléfono / WhatsApp<input {...clientForm.register("phone")} placeholder="664 000 0000"/><em>{clientForm.formState.errors.phone?.message}</em></label>
          <label>Correo<input {...clientForm.register("email")} placeholder="correo@ejemplo.mx"/><em>{clientForm.formState.errors.email?.message}</em></label>
          <label className="wide">Dirección<input {...clientForm.register("address")} placeholder="Calle, número, colonia, ciudad"/><em>{clientForm.formState.errors.address?.message}</em></label>
          <div className="modal-actions wide"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancelar</button><button className="primary-button">Guardar cliente</button></div>
        </form>}
        {modal === "quote" && <div className="quote-form">
          <div className="form-grid"><label>Cliente<select value={quoteClient} onChange={e => setQuoteClient(e.target.value)} disabled={clients.length === 0}>{clients.length === 0 ? <option>Primero registra un cliente</option> : clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></label><label>Servicio<select value={quoteType} onChange={e => setQuoteType(e.target.value)}><option>Servicio general</option><option>Minisplit</option><option>Plomería</option><option>Electricidad</option><option>Impermeabilización</option><option>Boilers</option></select></label></div>
          <div className="quote-concepts-head"><h3>Conceptos</h3><div><button type="button" className="text-button" onClick={() => setQuoteItems(current => [...current, { id: quoteItemId(), concept: "", quantity: "1", unitPrice: "" }])}><Plus size={15}/> Agregar concepto</button><button type="button" className="text-button" onClick={() => setQuoteItems(current => [...current, { id: quoteItemId(), concept: "Material: ", quantity: "1", unitPrice: "" }])}><PackageSearch size={15}/> Agregar material</button></div></div>
          <div className="quote-line quote-line-head"><span>Concepto</span><span>Cant.</span><span>Precio unitario</span><span>Importe</span><span></span></div>
          {quoteItems.map((item, index) => <div className="quote-line" key={item.id}>
            <input aria-label={`Concepto ${index + 1}`} value={item.concept} onChange={e => updateQuoteItem(item.id, { concept: e.target.value })} placeholder="Trabajo o material"/>
            <input aria-label={`Cantidad ${index + 1}`} inputMode="decimal" type="number" min="0.01" step="0.01" value={item.quantity} onChange={e => updateQuoteItem(item.id, { quantity: e.target.value })}/>
            <input aria-label={`Precio unitario ${index + 1}`} inputMode="decimal" type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateQuoteItem(item.id, { unitPrice: e.target.value })}/>
            <strong>{money.format(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</strong>
            <button type="button" className="remove-line" aria-label={`Eliminar concepto ${index + 1}`} disabled={quoteItems.length === 1} onClick={() => setQuoteItems(current => current.filter(row => row.id !== item.id))}><X size={15}/></button>
          </div>)}
          <div className="quote-options"><label><input type="checkbox" checked={quoteTax} onChange={e => setQuoteTax(e.target.checked)}/> Aplicar IVA (16%)</label><label>Descuento <input type="number" value={quoteDiscount} onChange={e => setQuoteDiscount(+e.target.value)}/></label></div>
          <div className="quote-total"><span>Subtotal <b>{money.format(quoteSubtotal)}</b></span><span>IVA <b>{money.format(quoteIva)}</b></span><span>Descuento <b>-{money.format(quoteDiscount)}</b></span><strong><label htmlFor="quote-total-input">TOTAL</label><input id="quote-total-input" aria-label="Total de la cotización" inputMode="decimal" type="text" value={quoteManualTotal ? quoteTotalInput : calculatedQuoteTotal.toFixed(2)} onFocus={e => { if (!quoteManualTotal) { setQuoteTotalInput(calculatedQuoteTotal.toFixed(2)); setQuoteManualTotal(true); requestAnimationFrame(() => e.currentTarget.select()); } }} onChange={e => { const value = e.target.value; if (/^\d*(?:[.,]\d{0,2})?$/.test(value)) setQuoteTotalInput(value); }}/></strong></div>
          <div className="quote-total-mode"><span>{quoteManualTotal ? "Total capturado manualmente" : "Total calculado automáticamente"}</span>{quoteManualTotal && <button type="button" className="text-button" onClick={() => { setQuoteManualTotal(false); setQuoteTotalInput(""); }}>Usar cálculo automático</button>}</div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Cancelar</button><button className="primary-button" disabled={clients.length === 0 || savingQuote} onClick={saveQuote}>{savingQuote ? "Guardando..." : editingQuoteId ? "Actualizar cotización" : "Guardar borrador"}</button></div>
        </div>}
        {modal === "payment" && <div className="form-grid">
          <label>Cliente<select>{clients.map(c => <option key={c.id}>{c.name}</option>)}</select></label><label>Folio relacionado<select><option>SRV-1048</option><option>COT-2026-082</option></select></label>
          <label>Importe<input type="number" defaultValue="1000"/></label><label>Método<select><option>Transferencia</option><option>Efectivo</option><option>Tarjeta</option><option>Depósito</option></select></label>
          <div className="modal-actions wide"><button className="secondary-button" onClick={() => setModal(null)}>Cancelar</button><button className="primary-button" onClick={createPayment}>Registrar pago</button></div>
        </div>}
      </div></div>}
      {materialQuoteOpen && <MaterialQuoteEditor
        quote={materialQuoteOpen}
        role={profile.role}
        accessToken={accessToken}
        onClose={() => setMaterialQuoteOpen(null)}
        onSaved={quote => {
          setMaterialQuotes(current => [quote, ...current.filter(item => item.id !== quote.id && item.work_order_folio !== quote.work_order_folio)]);
          setMaterialQuoteOpen(quote);
          void refreshOperationalData();
        }}
        onFormalQuote={quote => setQuotes(current => [quote, ...current.filter(item => item.folio !== quote.folio)])}
        notify={notify}
      />}
      {toast && <div className="toast"><CheckCircle2 size={19}/>{toast}</div>}
    </div>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (profile: Profile, token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [profileFailure, setProfileFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (!supabase) return;

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        setMessage("");
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);
  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(""); setProfileFailure(false);
    try {
      if (!supabase) throw new Error("La conexión segura no está disponible.");
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) { setMessage("Correo o contraseña incorrectos."); return; }
      const response = await fetch("/api/auth/profile", {
        headers: { authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.profile) {
        setMessage(result.error || "Tu usuario no tiene un perfil válido.");
        setProfileFailure(true);
        return;
      }
      onAuthenticated(result.profile, data.session.access_token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible iniciar sesión.");
    } finally {
      setBusy(false);
    }
  };
  const recover = async () => {
    if (!email.includes("@")) { setMessage("Escribe primero tu correo electrónico."); return; }
    if (!supabase) { setMessage("La conexión segura no está disponible."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMessage(error ? error.message : "Te enviamos un enlace para restablecer tu contraseña.");
  };
  const saveNewPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 8) {
      setMessage("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setBusy(true);
    setMessage("");

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }

    await supabase.auth.signOut();
    setRecoveryMode(false);
    setNewPassword("");
    setPassword("");
    setMessage("Contraseña actualizada. Ya puedes iniciar sesión.");
    setBusy(false);
  };
  if (recoveryMode) {
    return <main className="login-page">
      <section className="login-card">
        <Image src="/logo_izza.png" alt="IZZA Smart" width={94} height={94} priority unoptimized />
        <p className="eyebrow">IZZA SERVICIOS DE MANTENIMIENTO</p>
        <h1>Crear nueva contrase&ntilde;a</h1>
        <p>Escribe una nueva contrase&ntilde;a para tu cuenta.</p>
        <form onSubmit={saveNewPassword}>
          <label>
            Nueva contrase&ntilde;a
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {message && <div className="auth-message">{message}</div>}
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando..." : "Guardar nueva contraseña"}
          </button>
        </form>
      </section>
    </main>;
  }
  return <main className="login-page">
    <section className="login-card">
      <Image src="/logo_izza.png" alt="IZZA Smart" width={94} height={94} priority unoptimized />
      <p className="eyebrow">IZZA SERVICIOS DE MANTENIMIENTO</p><h1>Bienvenido a IZZA Smart</h1>
      <p>Ingresa con el usuario asignado por administración.</p>
      <form onSubmit={login}>
        <label>Correo electrónico<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {message && <div className="auth-message">{message}</div>}
        <button className="primary-button" disabled={busy}>{busy ? "Ingresandoâ€¦" : "Iniciar sesión"}</button>
        {profileFailure && <button type="button" className="secondary-button" onClick={async () => {
          if (supabase) await supabase.auth.signOut().catch(() => undefined);
          setProfileFailure(false); setPassword(""); setMessage("Sesión cerrada. Puedes volver a intentarlo.");
        }}>Cerrar sesión</button>}
        <button type="button" className="text-button recover-button" onClick={recover}>¿Olvidaste tu contraseña?</button>
      </form>
    </section>
  </main>;
}

function AuthErrorScreen({ message, onRetry, onLogout }: { message: string; onRetry: () => void; onLogout: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <main className="login-page">
    <section className="login-card auth-error-card" role="alert">
      <Image src="/logo_izza.png" alt="IZZA Smart" width={88} height={88} priority unoptimized />
      <AlertTriangle className="auth-error-icon" aria-hidden="true" />
      <h1>No pudimos abrir tu perfil</h1>
      <p>{message}</p>
      <p className="auth-help">Tus datos no se modificaron. Puedes reintentar la conexión o cerrar la sesión para volver al acceso.</p>
      <button className="primary-button" type="button" onClick={onRetry}>Reintentar</button>
      <button className="primary-button" disabled={busy} onClick={async () => {
        setBusy(true);
        await onLogout();
        setBusy(false);
      }}>{busy ? "Cerrando sesiónâ€¦" : "Cerrar sesión y volver al acceso"}</button>
    </section>
  </main>;
}

function TechnicianWorkspace({ profile, orders, accessToken, setOrders, onLogout, notify, toast, materialQuoteOpen, openMaterials, closeMaterials, onMaterialSaved }: {
  profile: Profile; orders: WorkOrder[]; accessToken: string; setOrders: (orders: WorkOrder[]) => void;
  onLogout: () => void; notify: (message: string) => void; toast: string;
  materialQuoteOpen: MaterialQuote | null; openMaterials: (order?: WorkOrder) => void; closeMaterials: () => void;
  onMaterialSaved: (quote: MaterialQuote) => void;
}) {
  const [saving, setSaving] = useState("");
  const uploadEvidence = async (order: WorkOrder, category: "before" | "after", files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData(); form.set("folio", order.folio); form.set("category", category);
    Array.from(files).forEach(file => form.append("files", file));
    notify("Subiendo fotografíasâ€¦");
    const response = await fetch("/api/orders/evidence", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: form });
    notify(response.ok ? "Fotografías guardadas" : "No se pudieron subir las fotografías");
  };
  const saveOrder = async (order: WorkOrder) => {
    setSaving(order.folio);
    try {
      const response = await fetch("/api/sync", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ orders: [order] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error();
      setOrders(result.data.orders); notify("Orden actualizada correctamente");
    } catch { notify("No se pudo actualizar la orden"); } finally { setSaving(""); }
  };
  return <main className="technician-page">
    <header className="tech-header"><div><Image src="/logo_izza.png" alt="IZZA" width={52} height={52} unoptimized/><span><strong>Mis órdenes</strong><small>{profile.full_name} Â· Técnico</small></span></div><button className="secondary-button" onClick={onLogout}>Cerrar sesión</button></header>
    <section className="tech-workspace">
      <div className="page-heading"><div><p className="eyebrow">TRABAJO ASIGNADO</p><h1>Ã“rdenes de servicio</h1><p>Solo puedes consultar las órdenes asignadas a tu cuenta.</p></div></div>
      {!orders.length && <div className="card empty"><ClipboardList/><strong>No tienes órdenes asignadas</strong><p>Cuando recepción te asigne un servicio aparecerá aquí.</p></div>}
      <div className="tech-order-list">{orders.map(order => <article className="card tech-order" key={order.folio}>
        <div className="order-head"><span>{order.folio}</span><StatusBadge status={order.status}/></div>
        <h2>{order.service}</h2><p><UserRound/> {order.client}</p><p><CalendarDays/> {order.date}</p><p><MapPin/> {order.address}</p>
        <div className="tech-contact-actions">
          <a className="secondary-button" target="_blank" href={`https://maps.google.com/?q=${encodeURIComponent(order.address || "")}`}><MapPin size={17}/>Cómo llegar</a>
          <a className="whatsapp-button" target="_blank" href={`https://wa.me/52${(order.phone || "").replace(/\D/g,"")}`}><MessageCircle size={17}/>WhatsApp</a>
        </div>
        <label>Estado del servicio<select value={order.status} onChange={e => setOrders(orders.map(item => item.folio === order.folio ? {...item, status: e.target.value as WorkOrder["status"]} : item))}><option value="Asignada">Pendiente</option><option>En proceso</option><option value="Terminada">Finalizado</option></select></label>
        <label>Observaciones<textarea value={order.observations || ""} onChange={e => setOrders(orders.map(item => item.folio === order.folio ? {...item, observations: e.target.value} : item))} placeholder="Describe el trabajo realizado, materiales o recomendacionesâ€¦"/></label>
        <div className="evidence-upload"><label><Camera size={18}/>Fotos del antes<input type="file" accept="image/*" capture="environment" multiple onChange={e => uploadEvidence(order, "before", e.target.files)} /></label><label><Camera size={18}/>Fotos del después<input type="file" accept="image/*" capture="environment" multiple onChange={e => uploadEvidence(order, "after", e.target.files)} /></label></div>
        <div className="tech-save-actions"><button className="secondary-button" onClick={() => openMaterials(order)}><PackageSearch size={18}/>Cotizar materiales</button><button className="primary-button save-tech-order" disabled={saving === order.folio} onClick={() => saveOrder(order)}>{saving === order.folio ? "Guardandoâ€¦" : "Guardar avance"}</button></div>
      </article>)}</div>
    </section>{materialQuoteOpen && <MaterialQuoteEditor quote={materialQuoteOpen} role="technician" accessToken={accessToken} onClose={closeMaterials} onSaved={onMaterialSaved} notify={notify}/>} {toast && <div className="toast"><CheckCircle2 size={19}/>{toast}</div>}
  </main>;
}

function Dashboard({ services, quotes, payments, navigate, setModal, openServiceForm }: { services: Service[]; quotes: Quote[]; payments: Payment[]; navigate: (v: View) => void; setModal: (v: "service" | "quote") => void; openServiceForm: () => void }) {
  const todays = services.filter(s => s.date === today);
  const collected = payments.reduce((total, payment) => total + payment.amount, 0);
  const outstanding = services.reduce((total, service) => total + service.balance, 0);
  const advances = payments.filter(payment => payment.type === "Anticipo").reduce((total, payment) => total + payment.amount, 0);
  const unansweredQuotes = quotes.filter(quote => quote.status === "Enviada").length;
  return <div className="dashboard">
    <section className="metrics-grid">
      <MetricCard label="Servicios para hoy" value={String(todays.length)} note={`${todays.filter(s => s.status === "En proceso").length} en proceso`} icon={CalendarDays}/>
      <MetricCard label="Pendientes" value={String(services.filter(s => s.status.includes("Pendiente")).length)} note="Requieren confirmación" icon={Clock3} tone="gold"/>
      <MetricCard label="Cotizaciones" value={String(quotes.filter(q => q.status === "Enviada").length)} note="Esperando respuesta" icon={FileText} tone="blue"/>
      <MetricCard label="Ingresos del mes" value={money.format(payments.reduce((a,p) => a + p.amount, 0))} note="+12.4% vs. mes anterior" icon={WalletCards} tone="green"/>
    </section>
    <section className="dashboard-grid">
      <article className="card schedule-card">
        <div className="card-head"><div><p className="eyebrow">OPERACIÃ“N DE HOY</p><h2>Próximos servicios</h2></div><button className="text-button" onClick={() => navigate("agenda")}>Ver agenda <ArrowUpRight size={16}/></button></div>
        <div className="timeline">{todays.map((s, i) => <div className="timeline-item" key={s.id}><div className="time"><strong>{s.time}</strong><span>{s.end}</span></div><div className="line"><i className={i === 0 ? "current" : ""}/></div><div className="service-info"><div><strong>{s.client}</strong><StatusBadge status={s.status}/></div><p><Wrench size={14}/>{s.type} Â· {s.technician}</p><p><MapPin size={14}/>{s.address}</p></div><a href={`https://wa.me/52${s.phone}`} target="_blank" aria-label={`WhatsApp de ${s.client}`}><MessageCircle size={18}/></a></div>)}</div>
      </article>
      <article className="card finance-card">
        <div className="card-head"><div><p className="eyebrow">FLUJO DEL MES</p><h2>Resumen financiero</h2></div><button className="icon-button"><MoreHorizontal/></button></div>
        <div className="income"><span>Ingresos registrados</span><strong>{money.format(collected)}</strong><small>Calculado con los pagos en Supabase</small><div className="progress"><i style={{width: collected > 0 ? "100%" : "0%"}}/></div></div>
        <div className="finance-list"><div><span><i className="dot green"/>Cobrado</span><b>{money.format(collected)}</b></div><div><span><i className="dot gold"/>Por cobrar</span><b>{money.format(outstanding)}</b></div><div><span><i className="dot blue"/>Anticipos</span><b>{money.format(advances)}</b></div></div>
        <button className="secondary-button wide-button" onClick={() => navigate("pagos")}>Ver todos los pagos</button>
      </article>
      <article className="card alerts-card">
        <div className="card-head"><div><p className="eyebrow">ATENCIÃ“N</p><h2>Alertas importantes</h2></div><span className="count">{unansweredQuotes + (outstanding > 0 ? 1 : 0)}</span></div>
        <div className="alert info"><FileText/><div><strong>{unansweredQuotes} cotizaciones sin respuesta</strong><p>Da seguimiento antes de que pierdan vigencia.</p></div></div>
        <div className="alert neutral"><CreditCard/><div><strong>{money.format(outstanding)} por cobrar</strong><p>Calculado con los saldos registrados.</p></div></div>
      </article>
      <article className="card quick-card"><div className="card-head"><div><p className="eyebrow">ACCESOS RÃPIDOS</p><h2>¿Qué quieres hacer?</h2></div></div><div className="quick-grid">
        <button onClick={openServiceForm}><span><Plus/></span><strong>Nuevo servicio</strong><small>Agenda una visita</small></button>
        <button onClick={() => setModal("quote")}><span><FileText/></span><strong>Nueva cotización</strong><small>Calcula y comparte</small></button>
        <button onClick={() => navigate("clientes")}><span><Users/></span><strong>Buscar cliente</strong><small>Consulta historial</small></button>
        <button onClick={() => navigate("ordenes")}><span><Camera/></span><strong>Subir evidencia</strong><small>Antes y después</small></button>
      </div></article>
    </section>
  </div>;
}

function Agenda({ services, clients, technicians, mode, setMode, notify }: { services: Service[]; clients: Client[]; technicians: TechnicianCard[]; mode: string; setMode: (m:string)=>void; notify:(m:string)=>void }) {
  const [anchorDate, setAnchorDate] = useState(services[0]?.date || today);
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const filtered = services.filter(service => (!technicianFilter || service.technician === technicianFilter) && (!statusFilter || service.status === statusFilter));
  const parseDate = (value:string) => new Date(`${value}T12:00:00`);
  const isoDate = (value:Date) => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
  const addDays = (value:Date, days:number) => { const next = new Date(value); next.setDate(next.getDate()+days); return next; };
  const weekStartFor = (value:Date) => addDays(value,-((value.getDay()+6)%7));
  const label = (value:Date, options:Intl.DateTimeFormatOptions) => value.toLocaleDateString("es-MX",options);
  const anchor = parseDate(anchorDate);
  const weekStart = weekStartFor(anchor);
  const visibleDays = mode === "Día" ? [anchor] : Array.from({length:7},(_,index)=>addDays(weekStart,index));
  const monthGridStart = weekStartFor(new Date(anchor.getFullYear(),anchor.getMonth(),1,12));
  const monthDays = Array.from({length:42},(_,index)=>addDays(monthGridStart,index));
  const servicesFor = (date:Date) => filtered.filter(service=>service.date===isoDate(date));
  const move = (direction:number) => { const next=new Date(anchor); if(mode==="Mes") next.setMonth(next.getMonth()+direction); else next.setDate(next.getDate()+direction*(mode==="Semana"?7:1)); setAnchorDate(isoDate(next)); };
  const periodLabel = mode === "Día" ? label(anchor,{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : mode === "Semana" ? `${label(weekStart,{day:"numeric",month:"short"})} â€“ ${label(addDays(weekStart,6),{day:"numeric",month:"short",year:"numeric"})}` : label(anchor,{month:"long",year:"numeric"});
  return <section className="card module-card">
    <div className="toolbar"><div className="segmented">{["Día","Semana","Mes","Lista"].map(x => <button type="button" className={mode===x?"active":""} onClick={()=>setMode(x)} key={x}>{x}</button>)}</div><div className="filters"><select aria-label="Filtrar por técnico" value={technicianFilter} onChange={event=>setTechnicianFilter(event.target.value)}><option value="">Todos los técnicos</option>{technicians.filter(technician => technician.active).map(technician => <option key={technician.id} value={technician.name}>{technician.name}</option>)}</select><select aria-label="Filtrar por estado" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{["Pendiente de confirmar","Confirmado","En camino","En proceso","Terminado","Reprogramado"].map(status=><option key={status}>{status}</option>)}</select></div></div>
    {mode !== "Lista" && <div className="calendar-preview"><div className="calendar-navigation"><button type="button" onClick={()=>move(-1)} aria-label="Periodo anterior"><ChevronLeft/></button><button type="button" className="calendar-today" onClick={()=>setAnchorDate(today)}>Hoy</button><strong>{periodLabel}</strong><button type="button" onClick={()=>move(1)} aria-label="Periodo siguiente"><ChevronRight/></button></div><h3>Vista {mode}</h3><p>{filtered.length} servicios coinciden con los filtros seleccionados.</p>
      {(mode==="Día"||mode==="Semana")&&<div className={`calendar-days calendar-${mode==="Día"?"day":"week"}`}>{visibleDays.map(date=><div key={isoDate(date)} className={isoDate(date)===today?"calendar-current-day":""}><strong>{label(date,{weekday:"short",day:"numeric",month:"short"})}</strong>{servicesFor(date).length?servicesFor(date).map(service=><button type="button" className="calendar-service" key={service.id} onClick={()=>notify(`${service.folio}: ${service.client} Â· ${service.status}`)}><b>{service.time} Â· {service.client}</b><small>{service.type} Â· {service.technician}</small><StatusBadge status={service.status}/></button>):<span className="calendar-empty-day">Sin servicios</span>}</div>)}</div>}
      {mode==="Mes"&&<div className="calendar-month"><div className="calendar-weekdays">{["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(day=><span key={day}>{day}</span>)}</div><div className="calendar-month-grid">{monthDays.map(date=><div key={isoDate(date)} className={`${date.getMonth()!==anchor.getMonth()?"outside-month ":""}${isoDate(date)===today?"calendar-current-day":""}`}><strong>{date.getDate()}</strong>{servicesFor(date).slice(0,3).map(service=><button type="button" key={service.id} onClick={()=>notify(`${service.folio}: ${service.client} Â· ${service.status}`)}>{service.time} Â· {service.client}</button>)}{servicesFor(date).length>3&&<small>+{servicesFor(date).length-3} más</small>}</div>)}</div></div>}
    </div>}
    {mode === "Lista" && <div className="data-table"><div className="table-row table-header"><span>Horario / folio</span><span>Cliente y propiedad</span><span>Técnico</span><span>Prioridad</span><span>Estado</span><span>Acciones</span></div>{filtered.map(s=><div className="table-row" key={s.id}><span><strong>{s.date} Â· {s.time}</strong><small>{s.folio}</small></span><span><strong>{s.client}</strong><small>{s.type} Â· {s.address}</small><PropertyAgendaSummary clientId={clients.find(client=>client.name===s.client)?.id || 0}/></span><span>{s.technician}</span><span><StatusBadge status={s.priority}/></span><span><StatusBadge status={s.status}/></span><span className="row-actions"><a href={`https://wa.me/52${s.phone}`} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={17}/></a><a href={`https://maps.google.com/?q=${encodeURIComponent(s.address)}`} target="_blank" rel="noreferrer" title="Cómo llegar"><MapPin size={17}/></a><button onClick={()=>notify("Servicio abierto para edición")}><MoreHorizontal size={17}/></button></span></div>)}{!filtered.length&&<div className="agenda-empty-filter"><CalendarDays/><strong>No hay servicios con estos filtros</strong><span>Cambia el técnico o el estado.</span></div>}</div>}
  </section>;
}

function Clients({ clients, openNew, openProperty }: { clients: Client[]; openNew:()=>void; openProperty:(clientId:number)=>void }) {
  return <section className="card module-card"><div className="module-head"><div><h2>Directorio de clientes</h2><p>{clients.length} clientes sincronizados</p></div><button className="primary-button" onClick={openNew}><Plus size={18}/>Nuevo cliente</button></div>
    <div className="client-grid">{clients.map(c=><article className="client-card" key={c.id}><div className="client-top"><div className="avatar">{c.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div><button><MoreHorizontal/></button></div><h3>{c.name}</h3><p className="company">{c.company}</p><div className="client-contact"><span><Phone/>{c.phone}</span><span><MapPin/>{c.address}</span></div><div className="client-stats"><span><small>Servicios</small><strong>{c.services}</strong></span><span><small>Saldo</small><strong className={c.balance ? "due":""}>{money.format(c.balance)}</strong></span></div><div className="client-actions"><a href={`https://wa.me/52${c.phone.replace(/\s/g,"")}`} target="_blank"><MessageCircle/>WhatsApp</a><button onClick={()=>openProperty(c.id)}><Home/>Propiedad <ChevronRight/></button></div></article>)}</div>
  </section>;
}

function Quotes({ quotes, notify, openNew, openEdit, onApprove, onReject, onConvert, accessToken, busy }: { quotes: Quote[]; notify:(m:string)=>void; openNew:()=>void; openEdit:(quote:Quote)=>void; onApprove:(quote:Quote)=>void; onReject:(quote:Quote)=>void; onConvert:(quote:Quote)=>void; accessToken:string; busy:string }) {
  return <section className="card module-card"><div className="module-head"><div><h2>Cotizaciones recientes</h2><p>Calcula, aprueba y convierte en servicio.</p></div><div className="module-actions"><a className="secondary-button" href="/Cotizacion_IZZA_Premium_Automatica.docm" download><Download size={18}/>Plantilla automática</a><button className="primary-button" onClick={openNew}><Plus size={18}/>Nueva cotización</button></div></div>
    <div className="quote-template-banner"><div><FileText/><span><strong>Cotización premium IZZA con VBA</strong><small>Abre en Word, habilita el contenido y captura cantidad, precio, IVA, descuento o anticipo: todos los totales se recalculan al salir del campo.</small></span></div><a href="/Cotizacion_IZZA_Premium_Automatica.docm" download>Descargar versión automática <Download size={16}/></a></div>
    <div className="data-table"><div className="table-row quote-cols table-header"><span>Folio / fecha</span><span>Cliente</span><span>Servicio</span><span>Total</span><span>Estado</span><span>Acciones</span></div>{quotes.map(q=>{ const whatsapp=encodeURIComponent(`Cotización ${q.folio}\nCliente: ${q.client}\nServicio: ${q.type}\nTotal: ${money.format(q.total)}`); return <div className="table-row quote-cols" key={q.id}><span><strong>{q.folio}</strong><small>{q.date} Â· Vigencia {q.validity}</small></span><span>{q.client}</span><span>{q.type}</span><span><strong>{money.format(q.total)}</strong></span><span><StatusBadge status={q.status}/></span><span className="quote-workflow-actions"><div className="row-actions"><a href={`/api/quotes/pdf?folio=${encodeURIComponent(q.folio)}&token=${encodeURIComponent(accessToken)}`} target="_blank" rel="noreferrer" title="Descargar PDF" onClick={()=>notify("Generando PDF de la cotización")}><Download size={17}/></a><a href={`https://wa.me/?text=${whatsapp}`} target="_blank" rel="noreferrer" title="Compartir por WhatsApp"><MessageCircle size={17}/></a><button onClick={()=>openEdit(q)} title="Editar cotización"><MoreHorizontal size={17}/></button></div>{q.status==="Borrador"&&<><button className="reject-button" disabled={!!busy} onClick={()=>onReject(q)}>{busy===`${q.folio}:reject`?"Rechazandoâ€¦":"Rechazar"}</button><button className="approve-quote-button" disabled={!!busy} onClick={()=>onApprove(q)}><CheckCircle2/> {busy===`${q.folio}:approve`?"Aprobando y creandoâ€¦":"Aprobar y crear orden"}</button></>}{q.status==="Aprobada"&&<button className="convert-order-button" disabled={!!busy} onClick={()=>onConvert(q)}><ClipboardList/> {busy===`${q.folio}:convert`?"Creandoâ€¦":"Crear orden"}</button>}</span></div>})}</div>
  </section>;
}

function Orders({ orders, clients, technicians, notify, openMaterials, onAssign }: { orders: WorkOrder[]; clients: Client[]; technicians: TechnicianCard[]; notify:(m:string)=>void; openMaterials:(order:WorkOrder)=>void; onAssign:(orderId:number, technician:string)=>void }) {
  return <section className="card module-card"><div className="module-head"><div><h2>Ã“rdenes de servicio</h2><p>Seguimiento técnico, evidencia y firmas.</p></div><button className="primary-button" onClick={()=>notify("Selecciona una cotización aprobada para convertirla")}><Plus size={18}/>Nueva orden</button></div>
    {!orders.length && <div className="empty-materials"><ClipboardList/><strong>Aún no hay órdenes de servicio</strong><span>Al aprobar una cotización, su orden aparecerá aquí automáticamente.</span></div>}
    <div className="order-grid">{orders.map(o=><article className="order-card" key={o.id}><div className="order-head"><span>{o.folio}</span><StatusBadge status={o.status}/></div><h3>{o.service}</h3><p><UserRound/> {o.client}</p><label className="order-assignment"><span><Wrench/>Técnico asignado</span><select value={o.technician || "Sin asignar"} onChange={event => onAssign(o.id, event.target.value)}><option value="Sin asignar">Sin asignar</option>{technicians.filter(technician => technician.active).map(technician => <option key={technician.id} value={technician.name}>{technician.name}</option>)}</select></label><PropertyAgendaSummary clientId={clients.find(client => client.name === o.client)?.id || 0}/><div className="order-meta"><span><CalendarDays/>{o.date}</span><span><Camera/>{o.evidence} fotos</span><strong>{money.format(o.total)}</strong></div><div className="order-actions"><button onClick={()=>notify("Orden abierta")}>Abrir orden</button><button onClick={()=>openMaterials(o)}><PackageSearch/> Cotizar materiales</button></div></article>)}</div>
  </section>;
}

function emptyMaterialItem(groupKey = crypto.randomUUID()): MaterialItem {
  return { group_key: groupKey, name: "", description: "", brand: "", model: "", unit: "pieza", quantity: 1, unit_price: 0, supplier: "", product_url: "", notes: "", availability: "Por confirmar", consulted_at: today, selected: true };
}

function MaterialsModule({ quotes, orders, openQuote }: { quotes: MaterialQuote[]; orders: WorkOrder[]; openQuote:(order?:WorkOrder)=>void }) {
  return <section className="card module-card"><div className="module-head"><div><h2>Cotizador de materiales</h2><p>Compara proveedores y prepara el precio para el cliente.</p></div><button className="primary-button" onClick={()=>openQuote(orders[0])}><Plus size={18}/>Nueva cotización</button></div>
    <div className="supplier-shortcuts"><a href="https://share.google/FuThEJm2QmwOutVgU" target="_blank" rel="noreferrer"><ExternalLink/>Grupo PETSA</a><a href="https://share.google/rMKKduRdJ52kAGlJj" target="_blank" rel="noreferrer"><ExternalLink/>Segundo proveedor</a></div>
    <div className="material-quote-list">{quotes.length ? quotes.map(quote=><button key={quote.id || quote.work_order_folio} onClick={()=>openQuote(orders.find(order=>order.folio===quote.work_order_folio))}><span><strong>{quote.folio || "Borrador"} Â· {quote.client}</strong><small>{quote.work_order_folio} Â· {quote.technician} Â· {quote.updated_at?.slice(0,10) || today}</small></span><StatusBadge status={quote.status === "approved" ? "Aprobada" : quote.status === "rejected" ? "Rechazada" : quote.status === "pending" ? "Enviada" : "Borrador"}/><ChevronRight/></button>) : <div className="empty-materials"><PackageSearch/><strong>Aún no hay cotizaciones de materiales</strong><span>Abre una orden y toca â€œCotizar materialesâ€.</span></div>}</div>
  </section>;
}

function MaterialQuoteEditor({ quote, role, accessToken, onClose, onSaved, onFormalQuote, notify }: { quote:MaterialQuote; role:AppRole; accessToken:string; onClose:()=>void; onSaved:(quote:MaterialQuote)=>void; onFormalQuote?:(quote:Quote)=>void; notify:(message:string)=>void }) {
  const [draft, setDraft] = useState<MaterialQuote>(()=>structuredClone(quote));
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [uploading, setUploading] = useState("");
  const lastSaved = useRef("");
  const selected = draft.items.filter(item=>item.selected);
  const realCost = selected.reduce((sum,item)=>sum + Number(item.quantity||0)*Number(item.unit_price||0),0);
  const iva = draft.apply_tax ? Math.max(0, realCost - draft.discount + draft.shipping + draft.additional_charges) * (draft.tax_rate/100) : 0;
  const additional = realCost * (draft.markup_percent/100);
  const clientMaterials = Math.max(0, realCost + additional + draft.shipping + draft.additional_charges + iva - draft.discount);
  const generalTotal = clientMaterials + Number(draft.labor||0);
  const updateItem = (index:number, patch:Partial<MaterialItem>) => setDraft(current=>({...current,items:current.items.map((item,i)=>i===index?{...item,...patch}:item)}));
  const addAlternative = (item:MaterialItem) => setDraft(current=>({...current,items:[...current.items,{...emptyMaterialItem(item.group_key),name:item.name,description:item.description,unit:item.unit,selected:false}]}));
  const save = async (status=draft.status, quiet=false) => {
    if (!draft.items.length || draft.items.some(item=>!item.name.trim() || item.quantity<=0 || item.unit_price<0)) { if(!quiet) notify("Completa nombre, cantidad y precio de cada material"); return; }
    setSaving(true); setSaveState("saving");
    try {
      const response = await fetch("/api/material-quotes",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${accessToken}`},body:JSON.stringify({...draft,status})});
      const result = await response.json(); if(!response.ok) throw new Error(result.error);
      lastSaved.current=JSON.stringify({...result.quote,updated_at:undefined}); setDraft(result.quote); onSaved(result.quote); setSaveState("saved");
      if(!quiet) notify(status === "approved" ? "Cotización aprobada y guardada en Supabase" : status === "rejected" ? "Cotización rechazada y guardada en Supabase" : "Cotización de materiales guardada en Supabase");
    } catch(error) { setSaveState("error"); if(!quiet) notify(error instanceof Error ? error.message : "No se pudo guardar"); } finally { setSaving(false); }
  };
  useEffect(()=>{
    const signature=JSON.stringify({...draft,updated_at:undefined});
    if(signature===lastSaved.current || !draft.items.length || draft.items.some(item=>!item.name.trim() || item.quantity<=0 || item.unit_price<0)) return;
    setSaveState("idle");
    const timer=window.setTimeout(()=>save(draft.status,true),900);
    return()=>window.clearTimeout(timer);
  },[draft]);
  const upload = async (index:number,file?:File) => {
    if(!file) return; setUploading(String(index));
    const form=new FormData(); form.set("file",file); form.set("work_order_folio",draft.work_order_folio);
    try { const response=await fetch("/api/material-quotes/upload",{method:"POST",headers:{authorization:`Bearer ${accessToken}`},body:form}); const result=await response.json(); if(!response.ok) throw new Error(result.error); updateItem(index,{image_url:result.url}); notify("Imagen adjuntada y lista para guardarse"); }
    catch { notify("No se pudo adjuntar la imagen"); } finally { setUploading(""); }
  };
  const convertToFormalQuote = async () => {
    if(!draft.id || !selected.length) { notify("Guarda y selecciona al menos un material"); return; }
    setSaving(true);
    try {
      const response=await fetch("/api/material-quotes/convert",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${accessToken}`},body:JSON.stringify({id:draft.id})});
      const result=await response.json(); if(!response.ok) throw new Error(result.error);
      onFormalQuote?.(result.quote); notify("Partidas convertidas en cotización formal");
    } catch(error) { notify(error instanceof Error?error.message:"No se pudo convertir la cotización"); } finally { setSaving(false); }
  };
  const whatsappText = encodeURIComponent(`Cotización ${draft.folio||""}\nCliente: ${draft.client}\nMateriales: ${money.format(clientMaterials)}\nMano de obra: ${money.format(draft.labor)}\nTotal: ${money.format(generalTotal)}`);
  return <div className="material-editor-backdrop"><section className="material-editor" role="dialog" aria-modal="true"><header><div><p className="eyebrow">ORDEN {draft.work_order_folio}</p><h2>Cotizador de materiales</h2><span>{draft.client} Â· {draft.technician}</span><small className={`material-save-state ${saveState}`}>{saveState==="saving"?"Guardandoâ€¦":saveState==="saved"?"Guardado automáticamente":saveState==="error"?"Error al guardar":"Los cambios se guardan automáticamente"}</small></div><button onClick={onClose} aria-label="Cerrar"><X/></button></header>
    <div className="supplier-shortcuts sticky-suppliers"><a href="https://share.google/FuThEJm2QmwOutVgU" target="_blank" rel="noreferrer"><ExternalLink/>Grupo PETSA</a><a href="https://share.google/rMKKduRdJ52kAGlJj" target="_blank" rel="noreferrer"><ExternalLink/>Segundo proveedor</a></div>
    <div className="material-items">{draft.items.map((item,index)=><article className={`material-item ${item.selected?"selected":""}`} key={`${item.group_key}-${index}`}><div className="material-item-head"><label className="material-choice"><input type="checkbox" checked={item.selected} onChange={e=>updateItem(index,{selected:e.target.checked})}/>Usar esta alternativa</label><button className="danger-icon" onClick={()=>setDraft(current=>({...current,items:current.items.filter((_,i)=>i!==index)}))} disabled={draft.items.length===1}><Trash2/></button></div>
      <div className="material-form-grid"><label className="wide">Material<input value={item.name} onChange={e=>updateItem(index,{name:e.target.value})} placeholder="Ej. Centro de carga"/></label><label className="wide">Descripción<textarea value={item.description} onChange={e=>updateItem(index,{description:e.target.value})}/></label><label>Marca<input value={item.brand} onChange={e=>updateItem(index,{brand:e.target.value})}/></label><label>Modelo<input value={item.model} onChange={e=>updateItem(index,{model:e.target.value})}/></label><label>Unidad<select value={item.unit} onChange={e=>updateItem(index,{unit:e.target.value})}><option>pieza</option><option>metro</option><option>litro</option><option>kilogramo</option><option>caja</option><option>rollo</option><option>servicio</option></select></label><label>Cantidad<input type="number" min=".01" step=".01" value={item.quantity} onChange={e=>updateItem(index,{quantity:+e.target.value})}/></label><label>Precio unitario<input type="number" min="0" step=".01" value={item.unit_price} onChange={e=>updateItem(index,{unit_price:+e.target.value})}/></label><label>Importe<input readOnly value={money.format(item.quantity*item.unit_price)}/></label><label>Proveedor<input value={item.supplier} onChange={e=>updateItem(index,{supplier:e.target.value})}/></label><label>Liga del producto<input type="url" value={item.product_url} onChange={e=>updateItem(index,{product_url:e.target.value})} placeholder="https://..."/></label><label>Disponibilidad<input value={item.availability} onChange={e=>updateItem(index,{availability:e.target.value})}/></label><label>Fecha de consulta<input type="date" value={item.consulted_at} onChange={e=>updateItem(index,{consulted_at:e.target.value})}/></label><label className="wide">Observaciones<textarea value={item.notes} onChange={e=>updateItem(index,{notes:e.target.value})}/></label><label className="wide photo-input"><Camera/> {uploading===String(index)?"Subiendoâ€¦":"Adjuntar foto o captura"}<input type="file" accept="image/*" capture="environment" onChange={e=>upload(index,e.target.files?.[0])}/>{item.image_url&&<a href={item.image_url} target="_blank" rel="noreferrer">Ver imagen</a>}</label></div>
      <button className="alternative-button" onClick={()=>addAlternative(item)}><Copy/>Agregar alternativa para comparar</button>
    </article>)}</div>
    <button className="add-material-button" onClick={()=>setDraft(current=>({...current,items:[...current.items,emptyMaterialItem()]}))}><Plus/>Agregar otro material</button>
    <section className="material-totals"><h3>Resumen de cotización</h3><div className="material-adjustments"><label><input type="checkbox" checked={draft.apply_tax} onChange={e=>setDraft({...draft,apply_tax:e.target.checked})}/>Agregar IVA</label><label>IVA %<input type="number" min="0" step=".01" value={draft.tax_rate} onChange={e=>setDraft({...draft,tax_rate:+e.target.value})}/></label><label>Descuento<input type="number" min="0" step=".01" value={draft.discount} onChange={e=>setDraft({...draft,discount:+e.target.value})}/></label><label>Envío / traslado<input type="number" min="0" step=".01" value={draft.shipping} onChange={e=>setDraft({...draft,shipping:+e.target.value})}/></label><label>Cargos adicionales<input type="number" min="0" step=".01" value={draft.additional_charges} onChange={e=>setDraft({...draft,additional_charges:+e.target.value})}/></label>{role==="admin"&&<label><Percent/>Adicional compra, desperdicio o utilidad<input type="number" min="0" step=".01" value={draft.markup_percent} onChange={e=>setDraft({...draft,markup_percent:+e.target.value})}/></label>}<label>Mano de obra<input type="number" min="0" step=".01" value={draft.labor} onChange={e=>setDraft({...draft,labor:+e.target.value})}/></label></div>
      <div className="material-summary"><span>Costo real de materiales <b>{money.format(realCost)}</b></span><span>Porcentaje adicional ({draft.markup_percent}%) <b>{money.format(additional)}</b></span><span>Precio de materiales para el cliente <b>{money.format(clientMaterials)}</b></span><span>Mano de obra <b>{money.format(draft.labor)}</b></span><strong>Total general <b>{money.format(generalTotal)}</b></strong></div>
    </section>
    <footer><button className="secondary-button" onClick={()=>save()} disabled={saving}>{saving?"Guardandoâ€¦":"Guardar ahora"}</button>{role==="admin"&&<><button className="reject-button" onClick={()=>save("rejected")} disabled={saving}>{saving?"Procesandoâ€¦":"Rechazar"}</button><button className="approve-button" onClick={()=>save("approved")} disabled={saving}>{saving?"Procesandoâ€¦":"Aprobar"}</button><button className="secondary-button" onClick={convertToFormalQuote} disabled={!draft.id||saving}><FileText/>Crear cotización formal</button></>}<button className="secondary-button" onClick={()=>window.open(`/api/material-quotes/pdf?id=${draft.id||""}&token=${encodeURIComponent(accessToken)}`,"_blank")} disabled={!draft.id||saving}><Download/>PDF</button>{draft.id?<a className="whatsapp-share" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer"><Send/>WhatsApp</a>:<button className="whatsapp-share" disabled title="Guarda primero la cotización"><Send/>WhatsApp</button>}</footer>
  </section></div>;
}

function Payments({ payments, openNew }: { payments: Payment[]; openNew:()=>void }) {
  return <section className="card module-card"><div className="module-head"><div><h2>Movimientos registrados</h2><p>Total del periodo: {money.format(payments.reduce((a,p)=>a+p.amount,0))}</p></div><button className="primary-button" onClick={openNew}><Plus size={18}/>Registrar pago</button></div>
    <div className="data-table"><div className="table-row payment-cols table-header"><span>Recibo</span><span>Cliente</span><span>Fecha</span><span>Tipo</span><span>Método</span><span>Importe</span></div>{payments.map(p=><div className="table-row payment-cols" key={p.id}><span><strong>{p.folio}</strong></span><span>{p.client}</span><span>{p.date}</span><span><StatusBadge status={p.type}/></span><span>{p.method}</span><span><strong>{money.format(p.amount)}</strong></span></div>)}</div>
  </section>;
}

type TechnicianCard = { id: number | string; name: string; specialty: string; phone: string; today: number; done: number; active: boolean };

function Technicians({ techs, onSave, onTechniciansChanged, notify }: {
  techs: TechnicianCard[];
  onSave: (updated: TechnicianCard, previousName: string) => void;
  onTechniciansChanged: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const emptyTechnician = {
    full_name: "",
    email: "",
    phone: "",
    specialty: "",
    password: "",
    confirm_password: "",
    active: true,
  };
  const [editing, setEditing] = useState<TechnicianCard | null>(null);
  const [creating, setCreating] = useState<typeof emptyTechnician | null>(null);
  const [previousName, setPreviousName] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [creationMessage, setCreationMessage] = useState<{ type: "success" | "error" | "diagnostic"; text: string } | null>(null);

  const saveTechnician = () => {
    if (!editing || editing.name.trim().length < 3 || editing.phone.trim().length < 10) return;
    onSave(editing, previousName);
    setEditing(null);
  };

  const openNewTechnician = () => {
    setCreationMessage({ type: "diagnostic", text: "Botón recibido correctamente. Abriendo formularioâ€¦" });
    setCreating({ ...emptyTechnician });
  };

  const createTechnician = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!creating || creatingUser) return;
    setCreationMessage(null);
    if (creating.full_name.trim().length < 3) return setCreationMessage({ type: "error", text: "Escribe el nombre completo del técnico." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(creating.email.trim())) return setCreationMessage({ type: "error", text: "Escribe un correo electrónico válido." });
    if (creating.phone.trim() && creating.phone.replace(/\D/g, "").length < 10) return setCreationMessage({ type: "error", text: "El teléfono debe tener al menos 10 dígitos." });
    if (creating.password.length < 8) return setCreationMessage({ type: "error", text: "La contraseña temporal debe tener al menos 8 caracteres." });
    if (creating.password !== creating.confirm_password) return setCreationMessage({ type: "error", text: "Las contraseñas no coinciden." });
    setCreatingUser(true);
    try {
      const response = await supabaseAuthenticatedFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          ...creating,
          role: "technician",
          technician_id: "",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Error ${response.status}: no se pudo crear el técnico`);
      await onTechniciansChanged();
      window.dispatchEvent(new Event("izza:technicians-changed"));
      setCreating(null);
      setCreationMessage({ type: "success", text: `${creating.full_name.trim()} fue creado y ya está disponible en Usuarios, Técnicos y Programar servicio.` });
      notify("Técnico creado correctamente");
    } catch (failure) {
      const exactError = failure instanceof Error ? failure.message : "No se pudo crear el técnico";
      setCreationMessage({ type: "error", text: exactError });
    } finally {
      setCreatingUser(false);
    }
  };

  return <section className="card module-card">
    <div className="module-head"><div><h2>Equipo técnico</h2><p>Edita nombres, teléfonos, especialidades y disponibilidad.</p></div><button type="button" className="primary-button" aria-haspopup="dialog" aria-controls="new-technician-dialog" onClick={openNewTechnician}><Plus size={18}/>Nuevo técnico</button></div>
    {creationMessage && <div className={`technician-creation-message ${creationMessage.type}`} role={creationMessage.type === "error" ? "alert" : "status"}>{creationMessage.type === "error" ? <AlertTriangle/> : <CheckCircle2/>}<span>{creationMessage.text}</span></div>}
    <div className="tech-grid">{techs.map(t=><article className="tech-card" key={t.id}>
      <div className="avatar tech"><Wrench/></div><StatusBadge status={t.active ? "Activo" : "Inactivo"}/>
      <h3>{t.name}</h3><p>{t.specialty}</p><span><Phone/>{t.phone}</span>
      <div className="tech-stats"><b>{t.today}</b><small>hoy</small><b>{t.done}</b><small>terminados</small></div>
      <button className="edit-tech-button" onClick={() => { setPreviousName(t.name); setEditing({...t}); }}><Settings size={15}/>Editar técnico</button>
    </article>)}</div>
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><div className="modal technician-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">EQUIPO TÃ‰CNICO</p><h2>Editar técnico</h2></div><button onClick={() => setEditing(null)} aria-label="Cerrar"><X/></button></div>
      <div className="form-grid">
        <label className="wide">Nombre completo<input value={editing.name} onChange={e => setEditing({...editing, name:e.target.value})}/></label>
        <label>Teléfono<input value={editing.phone} onChange={e => setEditing({...editing, phone:e.target.value})}/></label>
        <label>Estado<select value={editing.active ? "Activo" : "Inactivo"} onChange={e => setEditing({...editing, active:e.target.value === "Activo"})}><option>Activo</option><option>Inactivo</option></select></label>
        <label className="wide">Especialidad<input value={editing.specialty} onChange={e => setEditing({...editing, specialty:e.target.value})} placeholder="Ej. Plomería Â· Boilers"/></label>
        <div className="modal-actions wide"><button className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary-button" onClick={saveTechnician}>Guardar cambios</button></div>
      </div>
    </div></div>}
    {creating && <div className="modal-backdrop user-modal-backdrop" onMouseDown={() => !creatingUser && setCreating(null)}>
      <form id="new-technician-dialog" role="dialog" aria-modal="true" aria-labelledby="new-technician-title" className="modal user-modal" onSubmit={createTechnician} onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">NUEVO ACCESO TÃ‰CNICO</p><h2 id="new-technician-title">Crear técnico</h2></div><button type="button" disabled={creatingUser} onClick={() => setCreating(null)} aria-label="Cerrar formulario"><X/></button></div>
        <div className="form-grid">
          {creationMessage?.type === "error" && <div className="user-error wide" role="alert"><AlertTriangle/><span>{creationMessage.text}</span></div>}
          <label className="wide">Nombre completo<input autoFocus required autoComplete="name" value={creating.full_name} onChange={event => setCreating({ ...creating, full_name: event.target.value })}/></label>
          <label>Correo electrónico<input required type="email" autoComplete="email" value={creating.email} onChange={event => setCreating({ ...creating, email: event.target.value })}/></label>
          <label>Teléfono opcional<input inputMode="tel" autoComplete="tel" value={creating.phone} onChange={event => setCreating({ ...creating, phone: event.target.value })}/></label>
          <label className="wide">Especialidad<input value={creating.specialty} onChange={event => setCreating({ ...creating, specialty: event.target.value })} placeholder="Ej. Plomería Â· Electricidad Â· Boilers"/></label>
          <label>Rol<input readOnly value="Técnico"/></label>
          <label>Estado<select value={creating.active ? "active" : "inactive"} onChange={event => setCreating({ ...creating, active: event.target.value === "active" })}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
          <label>Contraseña temporal<div className="password-field"><KeyRound/><input required type="password" autoComplete="new-password" minLength={8} value={creating.password} onChange={event => setCreating({ ...creating, password: event.target.value })} placeholder="Mínimo 8 caracteres"/></div></label>
          <label>Confirmar contraseña<div className="password-field"><KeyRound/><input required type="password" autoComplete="new-password" minLength={8} value={creating.confirm_password} onChange={event => setCreating({ ...creating, confirm_password: event.target.value })} placeholder="Repite la contraseña"/></div></label>
          <p className="technician-server-note wide"><ShieldCheck/>La cuenta se crea de forma segura en Supabase Auth y se vincula automáticamente con el catálogo de Técnicos.</p>
          <div className="modal-actions wide"><button type="button" className="secondary-button" disabled={creatingUser} onClick={() => setCreating(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={creatingUser}>{creatingUser ? "Creando técnicoâ€¦" : "Crear técnico"}</button></div>
        </div>
      </form>
    </div>}
  </section>;
}

function Configuration({ notify }: { notify:(m:string)=>void }) {
  return <section className="settings-layout"><article className="card settings-card"><div className="card-head"><div><p className="eyebrow">IDENTIDAD</p><h2>Datos de la empresa</h2></div></div><div className="settings-brand"><Image src="/logo_izza.png" alt="Logotipo IZZA" width={76} height={76} unoptimized/><button className="secondary-button">Cambiar logotipo</button></div><div className="form-grid"><label>Empresa<input defaultValue="IZZA Servicios de Mantenimiento"/></label><label>WhatsApp<input defaultValue="664 121 67 48"/></label><label className="wide">Eslogan<input defaultValue="Soluciones confiables, resultados que duran."/></label><label>Ciudad<input defaultValue="Tijuana, Baja California"/></label><label>IVA<input defaultValue="16%"/></label></div><button className="primary-button" onClick={()=>notify("Configuración guardada")}>Guardar cambios</button></article>
    <article className="card integration-card"><div className="integration-icon"><CheckCircle2/></div><h2>Supabase conectado</h2><p>Clientes, agenda, cotizaciones, órdenes y pagos se leen y guardan directamente en la base de producción.</p><ol><li>Proyecto IZZA-SMART activo.</li><li>Tablas y seguridad configuradas.</li><li>Sin datos de demostración.</li></ol><button className="secondary-button" onClick={()=>notify("La conexión de producción con Supabase está activa")}>Comprobar conexión</button></article></section>;
}

function UserAdministration({ notify, onTechniciansChanged }: { notify: (message: string) => void; onTechniciansChanged: () => Promise<void> }) {
  const empty = { email: "", password: "", confirm_password: "", full_name: "", phone: "", role: "reception" as AppRole, active: true, technician_id: "" };
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [technicianCatalog, setTechnicianCatalog] = useState<TechnicianCatalogOption[]>([]);
  const [editing, setEditing] = useState<(typeof empty & { id?: string; protected?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [sessionReady, setSessionReady] = useState(false);

  const request = async (url = "/api/admin/users", options?: RequestInit) => {
    const response = await supabaseAuthenticatedFetch(url, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "No se pudo completar la operación");
    return result;
  };
  const load = async () => {
    setLoading(true); setError("");
    try {
      const result = await request();
      setUsers(result.users || []);
      setTechnicianCatalog(result.technician_catalog || []);
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron consultar los usuarios"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!supabase) {
      const timer = window.setTimeout(() => {
        setError("No fue posible abrir la conexión segura. Reintenta en unos segundos.");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let active = true;
    withTimeout(supabase.auth.getSession(), "Supabase tardó demasiado en recuperar la sesión.")
      .then(({ data, error: sessionError }) => {
        if (sessionError) throw sessionError;
        if (!data.session) throw new Error("Tu sesión terminó. Cierra sesión e ingresa nuevamente.");
        // La sesion se procesa en onAuthStateChange.
      })
      .catch(failure => {
        if (active) {
          setError(failure instanceof Error ? failure.message : "No fue posible recuperar tu acceso.");
          setLoading(false);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(false);
        setError("");
        return;
      }
      setSessionReady(Boolean(session));
      if (session) {
        setError("");
        void load();
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
    // The session subscription retriggers the real Authentication query
    // whenever Supabase signs in or refreshes its access token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    const refresh = () => { void load(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const poll = window.setInterval(refresh, 5_000);
    const channel = supabase?.channel("izza-user-administration")
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "technicians" }, refresh)
      .subscribe();
    window.addEventListener("izza:technicians-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("izza:technicians-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady]);

  const save = async () => {
    if (!editing) return;
    setFormError("");
    if (editing.full_name.trim().length < 3) return setFormError("Escribe el nombre completo.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editing.email.trim())) return setFormError("Escribe un correo electrónico válido.");
    if (!editing.id && editing.password.length < 8) return setFormError("La contraseña temporal debe tener al menos 8 caracteres.");
    if (!editing.id && editing.password !== editing.confirm_password) return setFormError("Las contraseñas no coinciden.");
    if (editing.id && editing.password && editing.password !== editing.confirm_password) return setFormError("Las contraseñas no coinciden.");
    setSaving(true);
    try {
      await request("/api/admin/users", {
        method: editing.id ? "PATCH" : "POST",
        body: JSON.stringify(editing),
      });
      setEditing(null);
      await Promise.all([load(), onTechniciansChanged()]);
      window.dispatchEvent(new Event("izza:technicians-changed"));
      notify(editing.id ? "Usuario actualizado en Supabase" : "Usuario creado y listo para iniciar sesión");
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : "No se pudo guardar"); }
    finally { setSaving(false); }
  };
  const remove = async (user: SystemUser) => {
    if (user.protected || !window.confirm(`¿Eliminar el acceso de ${user.full_name}? Esta acción no se puede deshacer.`)) return;
    try {
      await request(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: "DELETE" });
      await Promise.all([load(), onTechniciansChanged()]);
      window.dispatchEvent(new Event("izza:technicians-changed"));
      notify("Usuario eliminado");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo eliminar"); }
  };
  const beginEdit = (user: SystemUser) => setEditing({
    id: user.id, email: user.email, password: "", confirm_password: "", full_name: user.full_name, phone: user.phone || "",
    role: user.role || "reception", active: user.active, protected: user.protected, technician_id: user.technician?.id || "",
  });
  const openNewUser = () => {
    setFormError("");
    setEditing({ email: "", password: "", confirm_password: "", full_name: "", phone: "", role: "reception", active: true, technician_id: "" });
  };
  const roleName = (role: AppRole | null) => role === "admin" ? "Administrador" : role === "reception" ? "Recepción" : role === "technician" ? "Técnico" : "Sin perfil";

  return <section className="module-card user-admin">
    <div className="module-head"><div><p className="eyebrow">ADMINISTRACIÃ“N DEL SISTEMA</p><h2>Usuarios y accesos</h2><p>Crea cuentas, asigna roles y administra el acceso sin entrar a Supabase.</p></div><button type="button" className="primary-button" aria-haspopup="dialog" aria-controls="new-user-dialog" onClick={openNewUser}><UserPlus/>Nuevo usuario</button></div>
    {error && <div className="user-error"><AlertTriangle/>{error}<button onClick={load}>Reintentar</button></div>}
    <div className="user-role-summary">
      {(["admin","reception","technician"] as AppRole[]).map(role => <article key={role}><ShieldCheck/><span><strong>{users.filter(user => user.role === role && user.active).length}</strong><small>{roleName(role)}{role === "technician" ? "s" : ""}</small></span></article>)}
    </div>
    {loading ? <div className="user-empty">Consultando accesosâ€¦</div> : users.length === 0 ? <div className="user-empty">No hay usuarios registrados.</div> :
      <div className="user-table"><div className="user-row user-header"><span>Usuario</span><span>Rol</span><span>Estado</span><span>Ãšltimo acceso</span><span>Acciones</span></div>
      {users.map(user => <div className="user-row" key={user.id}>
        <span><strong>{user.full_name}</strong><small>{user.email}</small><small>{user.phone || "Sin teléfono"}</small></span>
        <span><b className={`role-pill role-${user.role || "unconfigured"}`}>{roleName(user.role)}</b>{!user.profile_configured && <small>Configura este acceso</small>}{user.role === "technician" && <small>{user.technician ? "Ficha vinculada" : "Vinculación pendiente"}</small>}</span>
        <span><StatusBadge status={user.active ? "Activo" : "Inactivo"}/></span>
        <span><small>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("es-MX") : "Aún no ingresa"}</small></span>
        <span className="user-actions"><button onClick={() => beginEdit(user)} title="Editar usuario"><Settings/></button><button disabled={user.protected} onClick={() => remove(user)} title={user.protected ? "Cuenta protegida" : "Eliminar usuario"}><Trash2/></button></span>
      </div>)}</div>}
    {editing && <div className="modal-backdrop user-modal-backdrop" onMouseDown={() => !saving && setEditing(null)}><form id="new-user-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" className="modal user-modal" onSubmit={event => { event.preventDefault(); void save(); }} onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">{editing.id ? "EDITAR ACCESO" : "NUEVO ACCESO"}</p><h2 id="user-dialog-title">{editing.id ? editing.full_name : "Crear usuario"}</h2></div><button type="button" disabled={saving} onClick={() => setEditing(null)} aria-label="Cerrar formulario"><X/></button></div>
      {editing.protected && <div className="protected-note"><ShieldCheck/>Esta es la cuenta propietaria. Siempre conservará el rol Administrador y permanecerá activa.</div>}
      {formError && <div className="user-error" role="alert"><AlertTriangle/>{formError}</div>}
      <div className="form-grid">
        <label className="wide">Nombre completo<input required autoFocus value={editing.full_name} onChange={e => setEditing({...editing, full_name:e.target.value})}/></label>
        <label>Correo electrónico<input required type="email" autoComplete="email" value={editing.email} onChange={e => setEditing({...editing, email:e.target.value})}/></label>
        <label>Teléfono opcional<input inputMode="tel" autoComplete="tel" value={editing.phone} onChange={e => setEditing({...editing, phone:e.target.value})}/></label>
        <label>Rol<select disabled={editing.protected} value={editing.role} onChange={e => setEditing({...editing, role:e.target.value as AppRole})}><option value="admin">Administrador</option><option value="reception">Recepción</option><option value="technician">Técnico</option></select></label>
        <label>Estado<select disabled={editing.protected} value={editing.active ? "active" : "inactive"} onChange={e => setEditing({...editing, active:e.target.value === "active"})}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
        {editing.role === "technician" && <label className="wide">Vinculación con catálogo de técnicos<select value={editing.technician_id} onChange={e => setEditing({...editing, technician_id:e.target.value})}><option value="">Crear una ficha técnica nueva</option>{technicianCatalog.map(technician => <option key={technician.id} value={technician.id}>{technician.name}{technician.phone ? ` Â· ${technician.phone}` : ""}</option>)}</select><small>Selecciona una ficha real existente sin usuario, o crea una nueva automáticamente.</small></label>}
        <label>Contraseña temporal {editing.id && "(opcional)"}<div className="password-field"><KeyRound/><input required={!editing.id} type="password" autoComplete="new-password" minLength={editing.id ? undefined : 8} value={editing.password} onChange={e => setEditing({...editing, password:e.target.value})} placeholder={editing.id ? "Conservar contraseña actual" : "Mínimo 8 caracteres"}/></div></label>
        <label>Confirmar contraseña<div className="password-field"><KeyRound/><input required={!editing.id || Boolean(editing.password)} type="password" autoComplete="new-password" value={editing.confirm_password} onChange={e => setEditing({...editing, confirm_password:e.target.value})} placeholder="Repite la contraseña"/></div></label>
        <div className="modal-actions wide"><button type="button" className="secondary-button" disabled={saving} onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Guardandoâ€¦" : editing.id ? "Guardar cambios" : "Crear usuario"}</button></div>
      </div>
    </form></div>}
  </section>;
}




