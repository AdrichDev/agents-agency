"use client";

import { useState } from "react";
import { fmt, toNum, type BudgetService } from "./types";
import type { IssuerData } from "@/hooks/useIssuerData";

/** Estado inicial del formulario (alta nueva o edición de versión rechazada). */
export interface BudgetDraft {
  linkedClientId: string;
  clientName: string;
  clientRazonSocial: string;
  clientCif: string;
  clientAddress: string;
  clientEmail: string;
  clientPhone: string;
  clientContact: string;
  quoteNumber: string;
  services: BudgetService[];
}

export interface BudgetPayload {
  quoteNumber: string;
  status: "generada";
  clientId?: string;
  clientSnapshot: Record<string, string>;
  issuerSnapshot: Record<string, string>;
  subtotalImpl: number;
  subtotalMaint: number;
  totalImpl: number;
  totalMaint: number;
  vatRate: number;
  lines: Array<{ serviceId: string; name: string; description: string; quantity: number; implPrice: number; maintPrice: number }>;
}

interface BudgetFormProps {
  draft: BudgetDraft;
  clientsList: any[];
  issuer: IssuerData;
  saving: boolean;
  onSaveIssuer: (issuer: IssuerData) => void;
  onCancel: () => void;
  onGenerate: (payload: BudgetPayload, linkedClientId: string) => void;
}

export function BudgetForm({ draft, clientsList, issuer, saving, onSaveIssuer, onCancel, onGenerate }: BudgetFormProps) {
  // Emisor (edición inline)
  const [isEditingIssuer, setIsEditingIssuer] = useState(false);
  const [tempCompany, setTempCompany] = useState("");
  const [tempCif, setTempCif] = useState("");
  const [tempAddress, setTempAddress] = useState("");
  const [tempEmail, setTempEmail] = useState("");
  const [tempPhone, setTempPhone] = useState("");

  // Cliente
  const [linkedClientId, setLinkedClientId] = useState(draft.linkedClientId);
  const [clientName, setClientName] = useState(draft.clientName);
  const [clientRazonSocial, setClientRazonSocial] = useState(draft.clientRazonSocial);
  const [clientCif, setClientCif] = useState(draft.clientCif);
  const [clientAddress, setClientAddress] = useState(draft.clientAddress);
  const [clientEmail, setClientEmail] = useState(draft.clientEmail);
  const [clientPhone, setClientPhone] = useState(draft.clientPhone);
  const [clientContact, setClientContact] = useState(draft.clientContact);
  const [quoteNumber, setQuoteNumber] = useState(draft.quoteNumber);

  // Combobox de vinculación de cliente: búsqueda filtrable al escribir.
  const initialLinked = clientsList.find((c) => c.id === draft.linkedClientId);
  const [clientSearch, setClientSearch] = useState(
    initialLinked ? `${initialLinked.codigo ? `${initialLinked.codigo} — ` : ""}${initialLinked.name}` : ""
  );
  const [showClientList, setShowClientList] = useState(false);
  const filteredClients = clientSearch.trim()
    ? clientsList.filter((c) => {
        const q = clientSearch.toLowerCase();
        return (
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.codigo ?? "").toLowerCase().includes(q) ||
          (c.razonSocial ?? "").toLowerCase().includes(q) ||
          (c.cif ?? "").toLowerCase().includes(q)
        );
      })
    : clientsList;

  // Servicios
  const [services, setServices] = useState<BudgetService[]>(draft.services);

  const linkClient = (id: string) => {
    setLinkedClientId(id);
    if (!id) {
      setClientSearch("");
      return;
    }
    const c = clientsList.find((cl) => cl.id === id);
    if (!c) return;
    setClientName(c.name || "");
    setClientRazonSocial(c.razonSocial || c.name || "");
    setClientCif(c.cif || "");
    setClientAddress(c.direccion || c.address || "");
    setClientEmail(c.email || "");
    setClientPhone(c.phone || "");
    setClientContact(c.contact || c.contactPerson || "");
    setClientSearch(`${c.codigo ? `${c.codigo} — ` : ""}${c.name}`);
    setShowClientList(false);
  };

  const startEditingIssuer = () => {
    setTempCompany(issuer.company);
    setTempCif(issuer.cif);
    setTempAddress(issuer.address);
    setTempEmail(issuer.email);
    setTempPhone(issuer.phone);
    setIsEditingIssuer(true);
  };
  const saveEditingIssuer = () => {
    onSaveIssuer({ company: tempCompany, cif: tempCif, address: tempAddress, email: tempEmail, phone: tempPhone });
    setIsEditingIssuer(false);
  };

  const toggleService = (id: string) =>
    setServices(services.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)));
  const updateQuantity = (id: string, qty: number) =>
    setServices(services.map((s) => (s.id === id ? { ...s, quantity: Math.max(1, toNum(qty) || 1) } : s)));

  const selectedServices = services.filter((s) => s.selected);
  const subtotalImpl = selectedServices.reduce((a, s) => a + toNum(s.implPrice) * toNum(s.quantity), 0);
  const subtotalMaint = selectedServices.reduce((a, s) => a + toNum(s.maintPrice) * toNum(s.quantity), 0);
  const totalImpl = subtotalImpl * 1.21;
  const totalMaint = subtotalMaint * 1.21;

  const isClientValid = clientName.trim() && clientCif.trim() && clientAddress.trim() && clientEmail.trim() && clientPhone.trim() && clientContact.trim();
  const canGenerate = isClientValid && selectedServices.length > 0;

  const handleGenerate = () => {
    if (!canGenerate) return;
    const payload: BudgetPayload = {
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
        company: issuer.company,
        cif: issuer.cif,
        address: issuer.address,
        email: issuer.email,
        phone: issuer.phone,
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
    onGenerate(payload, linkedClientId);
  };

  return (
    <div className="w-full relative">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="kicker mb-2">Generador</div>
          <h1 className="text-3xl font-extrabold text-white">Nuevo Presupuesto</h1>
        </div>
        <button onClick={onCancel} className="px-4 py-2 border border-edge text-slate-300 hover:text-white hover:bg-white/5 rounded-xl font-bold transition text-sm">
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
          ) : issuer.company ? (
            <div className="divide-y divide-edge/50">
              <p className="text-sm font-bold text-white mb-3">{issuer.company}</p>
              {[
                { icon: "🪪", val: issuer.cif },
                { icon: "📍", val: issuer.address },
                { icon: "✉️", val: issuer.email },
                { icon: "📞", val: issuer.phone },
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
            <div className="md:col-span-2 relative">
              <label className="block text-xs text-slate-400 mb-1.5">Vincular a cliente existente</label>
              <input
                type="text"
                className="input-dark w-full"
                placeholder="Busca por nombre, código o CIF…"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowClientList(true);
                  if (linkedClientId) setLinkedClientId(""); // al reescribir, desvincula
                }}
                onFocus={() => setShowClientList(true)}
                onBlur={() => setTimeout(() => setShowClientList(false), 150)}
              />
              {showClientList && (
                <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-edge bg-ink shadow-2xl">
                  <li
                    onMouseDown={() => linkClient("")}
                    className="px-3 py-2 text-xs text-slate-400 hover:bg-white/5 cursor-pointer"
                  >
                    — Sin vincular (cliente manual) —
                  </li>
                  {filteredClients.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-slate-500">Sin coincidencias</li>
                  ) : (
                    filteredClients.map((c) => (
                      <li
                        key={c.id}
                        onMouseDown={() => linkClient(c.id)}
                        className="px-3 py-2 text-sm text-white hover:bg-indigo-500/20 cursor-pointer"
                      >
                        {c.codigo ? <span className="text-slate-400">{c.codigo} — </span> : ""}
                        {c.name}
                        {c.cif ? <span className="text-slate-500 text-xs"> · {c.cif}</span> : ""}
                      </li>
                    ))
                  )}
                </ul>
              )}
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
