"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import budgetLogo from "../../assets/3A_Estudio_Banner_FondoNegro_1024_WEB.png";
import { api } from "@/lib/api";

// --- Types ---
interface BudgetService {
  id: string;
  name: string;
  description: string;
  implPrice: number;
  maintPrice: number;
  selected: boolean;
  quantity: number;
}

const SERVICES_CATALOG: BudgetService[] = [
  { id: "chatbot_basic", name: "Agente IA — Plan Starter", description: "Chatbot con IA, base de conocimiento, widget web y soporte básico", implPrice: 1200, maintPrice: 89, selected: false, quantity: 1 },
  { id: "chatbot_pro", name: "Agente IA — Plan Pro", description: "Chatbot multi-canal (web + WhatsApp + email), CRM básico, analytics", implPrice: 2900, maintPrice: 179, selected: false, quantity: 1 },
  { id: "chatbot_enterprise", name: "Agente IA — Plan Enterprise", description: "Agente autónomo con integraciones avanzadas, voz, RAG y SLA garantizado", implPrice: 6900, maintPrice: 449, selected: false, quantity: 1 },
  { id: "web_basic", name: "Página Web Profesional", description: "Landing page o web corporativa responsive, SEO básico, panel CMS", implPrice: 1190, maintPrice: 49, selected: false, quantity: 1 },
  { id: "web_chatbot", name: "Web Completa + Chatbot Integrado", description: "Web corporativa completa con agente IA integrado y multi-idioma", implPrice: 3400, maintPrice: 149, selected: false, quantity: 1 },
  { id: "automation", name: "Automatización de Procesos (RPA/n8n)", description: "Flujos automatizados: email, CRM, facturación, notificaciones", implPrice: 1900, maintPrice: 119, selected: false, quantity: 1 },
  { id: "hours", name: "Horas de Desarrollo a Medida", description: "Integraciones personalizadas, APIs, scripts, desarrollo específico", implPrice: 95, maintPrice: 0, selected: false, quantity: 10 },
  { id: "tokens", name: "Bolsa Mensual Extra de Tokens IA (5M)", description: "Ampliación de capacidad de procesamiento de IA por 5 millones de tokens", implPrice: 0, maintPrice: 39, selected: false, quantity: 1 },
];

const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

type BudgetStatus = "generada" | "aceptada" | "caducada" | "rechazada";

interface BudgetRecord {
  id: string;
  quoteNumber: string;
  status: BudgetStatus;
  subtotalImpl: number;
  subtotalMaint: number;
  totalImpl: number;
  totalMaint: number;
  clientId?: string | null;
  client?: { id: string; name: string; cif?: string | null } | null;
  clientSnapshot: any;
  issuerSnapshot: any;
  lines: any[];
  createdAt: string;
}

function BillingAndBudgets() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientIdFilter = searchParams.get("clientId");
  const [filteredClientName, setFilteredClientName] = useState<string | null>(null);
  const [viewState, setViewState] = useState<"list" | "create" | "preview">("list");
  
  // --- LIST STATE ---
  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // --- PREVIEW STATE ---
  const [selectedBudget, setSelectedBudget] = useState<BudgetRecord | null>(null);

  // --- CREATION FORM STATE ---
  // Issuer
  const [ourCompany, setOurCompany] = useState("");
  const [ourCif, setOurCif] = useState("");
  const [ourAddress, setOurAddress] = useState("");
  const [ourEmail, setOurEmail] = useState("");
  const [ourPhone, setOurPhone] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  
  const [isEditingIssuer, setIsEditingIssuer] = useState(false);
  const [tempCompany, setTempCompany] = useState("");
  const [tempCif, setTempCif] = useState("");
  const [tempAddress, setTempAddress] = useState("");
  const [tempEmail, setTempEmail] = useState("");
  const [tempPhone, setTempPhone] = useState("");

  // Client
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [linkedClientId, setLinkedClientId] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [clientRazonSocial, setClientRazonSocial] = useState("");
  const [clientCif, setClientCif] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [quoteNumber, setQuoteNumber] = useState("");

  // Services
  const [services, setServices] = useState<BudgetService[]>(SERVICES_CATALOG);
  const [saving, setSaving] = useState(false);

  // Load Initial Data
  useEffect(() => {
    fetchBudgets();

    api("/api/clients")
      .then((data) => setClientsList(Array.isArray(data) ? data : []))
      .catch(() => setClientsList([]));

    // Load issuer from localstorage
    setOurCompany(localStorage.getItem("issuer-company") || "");
    setOurCif(localStorage.getItem("issuer-cif") || "");
    setOurAddress(localStorage.getItem("issuer-address") || "");
    setOurEmail(localStorage.getItem("issuer-email") || "");
    setOurPhone(localStorage.getItem("issuer-phone") || "");
    setLogo(localStorage.getItem("sidebar-logo") || null);
  }, []);

  // Nombre del cliente filtrado (chip "Cliente: {name}")
  useEffect(() => {
    if (!clientIdFilter) {
      setFilteredClientName(null);
      return;
    }
    let cancelled = false;
    api(`/api/clients/${clientIdFilter}`)
      .then((data) => {
        if (!cancelled) {
          setFilteredClientName(data && typeof data.name === "string" ? data.name : null);
        }
      })
      .catch(() => {
        if (!cancelled) setFilteredClientName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientIdFilter]);

  const clearClientFilter = () => {
    setFilteredClientName(null);
    router.replace("/facturacion");
  };

  const fetchBudgets = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:4000/api/budgets");
      const data = await res.json();
      setBudgets(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const linkClient = (id: string) => {
    setLinkedClientId(id);
    if (!id) return;
    const c = clientsList.find((cl) => cl.id === id);
    if (!c) return;
    setClientName(c.name || "");
    setClientRazonSocial(c.razonSocial || c.name || "");
    setClientCif(c.cif || "");
    setClientAddress(c.direccion || c.address || "");
    setClientEmail(c.email || "");
    setClientPhone(c.phone || "");
    setClientContact(c.contact || c.contactPerson || "");
  };

  const startNewBudget = () => {
    setLinkedClientId("");
    setClientName("");
    setClientRazonSocial("");
    setClientCif("");
    setClientAddress("");
    setClientEmail("");
    setClientPhone("");
    setClientContact("");
    setQuoteNumber(`AD-${new Date().getFullYear()}-${String(budgets.length + 1).padStart(3, "0")}`);
    setServices(SERVICES_CATALOG.map(s => ({ ...s, selected: false })));
    setViewState("create");
  };

  // Issuer Edition
  const startEditingIssuer = () => {
    setTempCompany(ourCompany);
    setTempCif(ourCif);
    setTempAddress(ourAddress);
    setTempEmail(ourEmail);
    setTempPhone(ourPhone);
    setIsEditingIssuer(true);
  };
  const saveEditingIssuer = () => {
    setOurCompany(tempCompany);
    setOurCif(tempCif);
    setOurAddress(tempAddress);
    setOurEmail(tempEmail);
    setOurPhone(tempPhone);
    localStorage.setItem("issuer-company", tempCompany);
    localStorage.setItem("issuer-cif", tempCif);
    localStorage.setItem("issuer-address", tempAddress);
    localStorage.setItem("issuer-email", tempEmail);
    localStorage.setItem("issuer-phone", tempPhone);
    setIsEditingIssuer(false);
  };

  // Services selection
  const toggleService = (id: string) =>
    setServices(services.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)));
  const updateQuantity = (id: string, qty: number) =>
    setServices(services.map((s) => (s.id === id ? { ...s, quantity: Math.max(1, qty) } : s)));

  const selectedServices = services.filter((s) => s.selected);
  const subtotalImpl = selectedServices.reduce((a, s) => a + s.implPrice * s.quantity, 0);
  const subtotalMaint = selectedServices.reduce((a, s) => a + s.maintPrice * s.quantity, 0);
  const totalImpl = subtotalImpl * 1.21;
  const totalMaint = subtotalMaint * 1.21;

  // Validation
  const isClientValid = clientName.trim() && clientCif.trim() && clientAddress.trim() && clientEmail.trim() && clientPhone.trim() && clientContact.trim();
  const canGenerate = isClientValid && selectedServices.length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setSaving(true);
    try {
      const payload = {
        quoteNumber,
        status: "generada",
        clientId: linkedClientId || undefined,
        clientSnapshot: {
          name: clientName,
          razonSocial: clientRazonSocial,
          cif: clientCif,
          address: clientAddress,
          email: clientEmail,
          phone: clientPhone,
          contactPerson: clientContact,
        },
        issuerSnapshot: {
          company: ourCompany,
          cif: ourCif,
          address: ourAddress,
          email: ourEmail,
          phone: ourPhone,
        },
        subtotalImpl,
        subtotalMaint,
        totalImpl,
        totalMaint,
        vatRate: 0.21,
        lines: selectedServices.map((s) => ({
          serviceId: s.id,
          name: s.name,
          description: s.description,
          quantity: s.quantity,
          implPrice: s.implPrice,
          maintPrice: s.maintPrice,
        })),
      };

      const res = await fetch("http://localhost:4000/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const newBudget = await res.json();
      
      await fetchBudgets();
      setSelectedBudget(newBudget);
      setViewState("preview");
    } catch (e) {
      console.error(e);
      alert("Error al guardar presupuesto");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: BudgetStatus) => {
    try {
      const res = await fetch(`http://localhost:4000/api/budgets/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        if (selectedBudget && selectedBudget.id === id) {
          setSelectedBudget({ ...selectedBudget, status });
        }
        setBudgets(budgets.map(b => b.id === id ? { ...b, status } : b));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleEditRechazada = (budget: BudgetRecord) => {
    setLinkedClientId(budget.clientId || "");
    setClientName(budget.clientSnapshot.name || "");
    setClientRazonSocial(budget.clientSnapshot.razonSocial || "");
    setClientCif(budget.clientSnapshot.cif || "");
    setClientAddress(budget.clientSnapshot.address || "");
    setClientEmail(budget.clientSnapshot.email || "");
    setClientPhone(budget.clientSnapshot.phone || "");
    setClientContact(budget.clientSnapshot.contactPerson || "");
    setQuoteNumber(budget.quoteNumber + "-R");
    
    const budgetServiceIds = budget.lines.map(l => l.serviceId);
    setServices(SERVICES_CATALOG.map(s => {
      const line = budget.lines.find(l => l.serviceId === s.id);
      return line ? { ...s, selected: true, quantity: line.quantity } : { ...s, selected: false };
    }));
    setViewState("create");
  };

  const filteredBudgets = budgets.filter(b => {
    if (clientIdFilter && (b.clientId || b.client?.id) !== clientIdFilter) return false;
    const term = search.toLowerCase();
    const cName = (b.clientSnapshot?.name || "").toLowerCase();
    const cContact = (b.clientSnapshot?.contactPerson || "").toLowerCase();
    return cName.includes(term) || cContact.includes(term);
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "generada": return "bg-blue-500/20 text-blue-400";
      case "aceptada": return "bg-emerald-500/20 text-emerald-400";
      case "rechazada": return "bg-red-500/20 text-red-400";
      case "caducada": return "bg-slate-500/20 text-slate-400";
      default: return "bg-white/10 text-white";
    }
  };

  // === RENDERERS ===

  if (viewState === "preview" && selectedBudget) {
    const b = selectedBudget;
    const dateStr = new Date(b.createdAt).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
    const vatImpl = b.subtotalImpl * 0.21;
    const vatMaint = b.subtotalMaint * 0.21;

    const vencimientoDate = new Date(b.createdAt);
    vencimientoDate.setDate(vencimientoDate.getDate() + 30);
    const vencimientoStr = vencimientoDate.toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });

    return (
      <div className="w-full">
        {/* Barra superior de controles (no-print) */}
        <div className="no-print flex items-center justify-between bg-white/5 border border-edge p-4 rounded-xl mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => setViewState("list")} className="text-sm font-bold text-slate-400 hover:text-white transition">← Volver</button>
            <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getStatusColor(b.status)}`}>
              {b.status}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {b.status === "generada" && (
              <>
                <button onClick={() => updateStatus(b.id, "aceptada")} className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded-lg text-xs font-bold transition">Aceptar</button>
                <button onClick={() => updateStatus(b.id, "rechazada")} className="px-3 py-1.5 bg-red-500/20 text-red-300 hover:bg-red-500/30 rounded-lg text-xs font-bold transition">Rechazar</button>
                <button onClick={() => updateStatus(b.id, "caducada")} className="px-3 py-1.5 bg-slate-500/20 text-slate-300 hover:bg-slate-500/30 rounded-lg text-xs font-bold transition">Caducar</button>
              </>
            )}
            {b.status === "rechazada" && (
              <button onClick={() => handleEditRechazada(b)} className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-xs font-bold transition">Editar y Nueva Versión</button>
            )}
            <div className="w-px h-6 bg-edge mx-2"></div>
            <button onClick={() => window.print()} className="px-4 py-2 bg-white text-ink rounded-lg text-sm font-bold hover:bg-slate-200 transition flex items-center gap-2">
              🖨️ Imprimir
            </button>
          </div>
        </div>

        {/* FACTURA IMPRIMIBLE */}
        {/* Añadimos estilos en línea para aislar la impresión y asegurar el diseño */}
        <style dangerouslySetInnerHTML={{__html: `
          @page { size: auto; margin: 0mm; } /* Elimina cabeceras y pies de página del navegador */
          @media print {
            body { 
              background: white !important; 
              color: black !important; 
              margin: 15mm !important; /* Margen físico para que el contenido no quede pegado al borde */
            }
            .no-print, nav, aside, header { display: none !important; }
            .print-only { display: block !important; }
            .print-area { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: 100% !important; }
          }
        `}} />

        <div className="print-area bg-white text-slate-900 rounded-2xl shadow-xl overflow-hidden max-w-4xl mx-auto" style={{ fontFamily: "'Inter', sans-serif" }}>
          <div className="p-10 md:p-14">
            {/* CABECERA */}
            <div className="flex justify-between items-start pb-8 mb-8" style={{ borderBottom: "2px solid #e2e8f0" }}>
              
              {/* Izquierda: Presupuesto y Datos */}
              <div>
                <h2 style={{ fontFamily: "Georgia, serif", fontSize: 36, fontWeight: 900, color: "#0f172a", textTransform: "uppercase", letterSpacing: 2, margin: "0 0 16px" }}>Presupuesto</h2>
                <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
                  <p style={{ margin: 0 }}><strong>Fecha de Presupuesto:</strong> {dateStr}</p>
                  <p style={{ margin: 0 }}><strong>Nº:</strong> {b.quoteNumber}</p>
                  <p style={{ margin: 0 }}><strong>Fecha de Vencimiento:</strong> {vencimientoStr}</p>
                </div>
              </div>

              {/* Derecha: Logo Completo */}
              <div style={{ textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                <img src={budgetLogo.src} alt="Logo Empresa" style={{ height: 110, objectFit: "contain" }} />
              </div>
            </div>

            {/* EMISOR + RECEPTOR */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginBottom: 40, fontSize: 13 }}>
              <div>
                <h3 style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 2, borderBottom: "1px solid #e2e8f0", paddingBottom: 6, marginBottom: 10 }}>Emisor</h3>
                <p style={{ fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>{b.issuerSnapshot.company || "—"}</p>
                {b.issuerSnapshot.cif && <p style={{ color: "#64748b", margin: "0 0 2px" }}>NIF/CIF: {b.issuerSnapshot.cif}</p>}
                {b.issuerSnapshot.address && <p style={{ color: "#64748b", margin: "0 0 2px" }}>{b.issuerSnapshot.address}</p>}
                {b.issuerSnapshot.email && <p style={{ color: "#64748b", margin: "0 0 2px" }}>{b.issuerSnapshot.email}</p>}
                {b.issuerSnapshot.phone && <p style={{ color: "#64748b", margin: 0 }}>{b.issuerSnapshot.phone}</p>}
              </div>
              <div>
                <h3 style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 2, borderBottom: "1px solid #e2e8f0", paddingBottom: 6, marginBottom: 10 }}>Cliente</h3>
                <p style={{ fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>{b.clientSnapshot.name || "—"}</p>
                {b.clientSnapshot.cif && <p style={{ color: "#64748b", margin: "0 0 2px" }}>NIF/CIF: {b.clientSnapshot.cif}</p>}
                {b.clientSnapshot.address && <p style={{ color: "#64748b", margin: "0 0 2px" }}>{b.clientSnapshot.address}</p>}
                {b.clientSnapshot.email && <p style={{ color: "#64748b", margin: 0 }}>{b.clientSnapshot.email}</p>}
                {b.clientSnapshot.contactPerson && <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 11 }}>Atn: {b.clientSnapshot.contactPerson}</p>}
              </div>
            </div>

            {/* TABLA DE CONCEPTOS */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 32 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, borderBottom: "2px solid #e2e8f0" }}>Servicio / Concepto</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, borderBottom: "2px solid #e2e8f0" }}>Cant.</th>
                  <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, borderBottom: "2px solid #e2e8f0" }}>Puesta en marcha</th>
                  <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, borderBottom: "2px solid #e2e8f0" }}>Mensualidad</th>
                  <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, borderBottom: "2px solid #e2e8f0" }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {b.lines.map((s, i) => (
                  <tr key={s.id || i} style={{ background: i % 2 === 0 ? "#ffffff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#0f172a" }}>
                      {s.name}
                      <span style={{ display: "block", fontSize: 11, color: "#94a3b8", fontWeight: 400, marginTop: 2 }}>{s.description}</span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: "#475569" }}>{s.quantity}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {s.implPrice > 0 ? `${fmt(s.implPrice)} €` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {s.maintPrice > 0 ? `${fmt(s.maintPrice)} €/mes` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                      {s.implPrice > 0 && <span>{fmt(s.implPrice * s.quantity)} €</span>}
                      {s.implPrice > 0 && s.maintPrice > 0 && <span style={{ color: "#94a3b8", margin: "0 4px" }}>+</span>}
                      {s.maintPrice > 0 && <span>{fmt(s.maintPrice * s.quantity)} €/mes</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* TOTALES */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 48 }}>
              <div style={{ width: 340, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "20px 24px", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", marginBottom: 8 }}>
                  <span>Base imponible (pago único):</span>
                  <span style={{ fontWeight: 600, color: "#0f172a" }}>{fmt(b.subtotalImpl)} €</span>
                </div>
                {b.subtotalMaint > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", marginBottom: 8 }}>
                    <span>Base imponible (mensual):</span>
                    <span style={{ fontWeight: 600, color: "#0f172a" }}>{fmt(b.subtotalMaint)} €/mes</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 12, paddingTop: 8, borderTop: "1px solid #e2e8f0", marginBottom: 8 }}>
                  <span>IVA (21%):</span>
                  <span>{fmt(vatImpl)} €{b.subtotalMaint > 0 ? ` / ${fmt(vatMaint)} €/mes` : ""}</span>
                </div>
                <div style={{ borderTop: "2px solid #e2e8f0", paddingTop: 12, marginTop: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 16, color: "#0f172a", marginBottom: b.subtotalMaint > 0 ? 6 : 0 }}>
                    <span>Total pago único:</span>
                    <span>{fmt(b.totalImpl)} €</span>
                  </div>
                  {b.subtotalMaint > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 16, color: "#0f172a" }}>
                      <span>Total mensual:</span>
                      <span>{fmt(b.totalMaint)} €/mes</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* CONDICIONES + FIRMA */}
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 24, fontSize: 11, color: "#64748b" }}>
              <h4 style={{ fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontSize: 10 }}>Términos y Condiciones</h4>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                <li>Este presupuesto tiene una validez de 30 días naturales desde la fecha de emisión.</li>
                <li>El 50% del pago único se abona a la aceptación y el 50% restante al despliegue en producción.</li>
                <li>La cuota de mantenimiento se factura el día 1 de cada mes mediante domiciliación bancaria.</li>
                <li>Los precios indicados no incluyen IVA (21%), aplicable según normativa vigente.</li>
              </ul>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, marginTop: 60, textAlign: "center" }}>
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                  <p style={{ color: "#94a3b8", margin: 0, fontSize: 11 }}>Firma y fecha del Cliente</p>
                  <p style={{ fontWeight: 700, color: "#475569", marginTop: 4 }}>{b.clientSnapshot.name || "_______________"}</p>
                </div>
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                  <p style={{ color: "#94a3b8", margin: 0, fontSize: 11 }}>Emitido por</p>
                  <p style={{ fontWeight: 700, color: "#475569", marginTop: 4 }}>{b.issuerSnapshot.company || "ADRICH"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === CREATION FORM VIEW ===
  if (viewState === "create") {
    return (
      <div className="w-full relative">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="kicker mb-2">Generador</div>
            <h1 className="text-3xl font-extrabold text-white">Nuevo Presupuesto</h1>
          </div>
          <button onClick={() => setViewState("list")} className="px-4 py-2 border border-edge text-slate-300 hover:text-white hover:bg-white/5 rounded-xl font-bold transition text-sm">
            Cancelar
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Datos Emisor */}
          <div className="card p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Datos del Emisor</h3>
              {!isEditingIssuer && (
                <button onClick={startEditingIssuer} className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition">✏️ Editar</button>
              )}
            </div>
            {isEditingIssuer ? (
              <div className="space-y-3">
                {[
                  { label: "Empresa", val: tempCompany, set: setTempCompany },
                  { label: "NIF/CIF", val: tempCif, set: setTempCif },
                  { label: "Dirección", val: tempAddress, set: setTempAddress },
                  { label: "Email", val: tempEmail, set: setTempEmail },
                  { label: "Teléfono", val: tempPhone, set: setTempPhone },
                ].map(({ label, val, set }) => (
                  <div key={label}>
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">{label}</label>
                    <input className="input-dark !py-1 px-2.5 text-xs" value={val} onChange={(e) => set(e.target.value)} />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={saveEditingIssuer} className="flex-1 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-bold transition">Guardar</button>
                  <button onClick={() => setIsEditingIssuer(false)} className="flex-1 py-1.5 border border-edge text-slate-300 rounded-lg text-xs font-bold hover:bg-white/5 transition">Cancelar</button>
                </div>
              </div>
            ) : ourCompany ? (
              <div className="divide-y divide-edge/50">
                <p className="text-sm font-bold text-white mb-3">{ourCompany}</p>
                {[
                  { icon: "🪪", val: ourCif },
                  { icon: "📍", val: ourAddress },
                  { icon: "✉️", val: ourEmail },
                  { icon: "📞", val: ourPhone },
                ].filter(d => d.val).map((d, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-2.5 text-xs text-slate-300">
                    <span className="shrink-0">{d.icon}</span> <span>{d.val}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 text-sm">Sin datos del emisor.<br/><button onClick={startEditingIssuer} className="text-indigo-400 font-bold mt-2 hover:underline">Configurar</button></div>
            )}
          </div>

          {/* Datos Cliente */}
          <div className="card p-6 lg:col-span-2 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Datos del Cliente</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1.5">Vincular a cliente existente</label>
                <select
                  className="input-dark w-full"
                  value={linkedClientId}
                  onChange={(e) => linkClient(e.target.value)}
                >
                  <option value="">— Sin vincular (cliente manual) —</option>
                  {clientsList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codCliente ? `${c.codCliente} — ` : ""}{c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Nombre comercial *</label>
                <input type="text" className="input-dark" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Razón Social</label>
                <input type="text" className="input-dark" value={clientRazonSocial} onChange={(e) => setClientRazonSocial(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">NIF / CIF *</label>
                <input type="text" className="input-dark" value={clientCif} onChange={(e) => setClientCif(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Nº Presupuesto *</label>
                <input type="text" className="input-dark" value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1.5">Dirección *</label>
                <input type="text" className="input-dark" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Email *</label>
                <input type="email" className="input-dark" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Teléfono *</label>
                <input type="tel" className="input-dark" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1.5">Persona de contacto *</label>
                <input type="text" className="input-dark" value={clientContact} onChange={(e) => setClientContact(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* Conceptos */}
        <div className="card p-6 mb-8">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Conceptos a Incluir</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {services.map((s) => (
              <div key={s.id} onClick={() => toggleService(s.id)} className={`flex items-center justify-between p-3 rounded-xl border transition cursor-pointer ${s.selected ? "bg-indigo-500/10 border-indigo-500/40" : "bg-white/[0.02] border-edge hover:bg-white/[0.04]"}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <input type="checkbox" checked={s.selected} onChange={() => toggleService(s.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded text-indigo-600 border-edge bg-ink" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{s.name}</p>
                    <p className="text-xs text-slate-500 truncate">{s.description}</p>
                  </div>
                </div>
                {s.selected && (
                  <input type="number" className="w-14 bg-white/5 border border-edge rounded-lg px-2 py-1 text-xs text-center text-white ml-3" value={s.quantity} min="1" onClick={(e) => e.stopPropagation()} onChange={(e) => updateQuantity(s.id, parseInt(e.target.value))} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Acciones */}
        <div className="sticky bottom-8 card p-6 flex flex-col md:flex-row justify-between items-center gap-4 border-t-4 border-indigo-500 shadow-2xl">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">Pago Único (+IVA)</p>
              <p className="text-xl font-black text-white">{fmt(subtotalImpl)} €</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">Mensualidad (+IVA)</p>
              <p className="text-xl font-black text-white">{fmt(subtotalMaint)} €</p>
            </div>
          </div>
          <button 
            onClick={handleGenerate} 
            disabled={!canGenerate || saving} 
            className="btn-grad px-8 py-3 w-full md:w-auto disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Generar Presupuesto"}
          </button>
        </div>
      </div>
    );
  }

  // === DEFAULT VIEW: LIST OF BUDGETS ===
  return (
    <div className="w-full">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="kicker mb-2 text-neon-cyan">Administración</div>
          <h1 className="text-3xl font-extrabold text-neon-gradient">Facturación</h1>
          <p className="text-sm text-slate-500 mt-1">
            Historial de facturas y presupuestos generados.
          </p>
        </div>
        <button onClick={startNewBudget} className="bg-neon-gradient text-white font-bold rounded-xl px-5 py-2.5 flex items-center gap-2 hover:opacity-90 transition shadow-[0_0_15px_rgba(157,0,255,0.4)]">
          <span className="text-lg leading-none">+</span> Nueva factura
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-edge flex items-center justify-between gap-4 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por cliente o contacto..."
            className="input-dark max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {clientIdFilter && (
            <button
              onClick={clearClientFilter}
              title="Quitar filtro de cliente"
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/40 text-neon-cyan text-xs font-bold hover:bg-cyan-500/20 transition"
            >
              Cliente: {filteredClientName || "..."}
              <span className="text-sm leading-none">&#x2715;</span>
            </button>
          )}
        </div>
        
        {loading ? (
          <div className="p-8 text-center text-slate-500">Cargando facturas...</div>
        ) : filteredBudgets.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <div className="w-16 h-16 bg-white/[0.02] border border-edge rounded-2xl flex items-center justify-center text-2xl mb-4">🗂️</div>
            <p className="text-slate-300 font-medium">No hay facturas generadas</p>
            <p className="text-sm text-slate-500 mt-1">Pulsa en "Nueva factura" para empezar a generar presupuestos.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-edge bg-white/[0.02] text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-bold">Nº Presupuesto</th>
                  <th className="px-6 py-4 font-bold">Cliente</th>
                  <th className="px-6 py-4 font-bold">Contacto</th>
                  <th className="px-6 py-4 font-bold text-right">Total</th>
                  <th className="px-6 py-4 font-bold">Fecha</th>
                  <th className="px-6 py-4 font-bold">Estado</th>
                  <th className="px-6 py-4 font-bold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {filteredBudgets.map(b => (
                  <tr key={b.id} className="hover:bg-white/[0.02] transition group">
                    <td className="px-6 py-4 text-white font-medium">{b.quoteNumber}</td>
                    <td className="px-6 py-4 text-slate-300">{b.clientSnapshot.name}</td>
                    <td className="px-6 py-4 text-slate-400">{b.clientSnapshot.contactPerson || "—"}</td>
                    <td className="px-6 py-4 text-right tabular-nums text-white font-medium">
                      {fmt(b.subtotalImpl)} €
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getStatusColor(b.status)}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => { setSelectedBudget(b); setViewState("preview"); }}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold text-slate-300 transition"
                      >
                        Ver / Imprimir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// useSearchParams exige un boundary de Suspense en el prerender estático.
export default function FacturacionPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando facturación...</div>}>
      <BillingAndBudgets />
    </Suspense>
  );
}
