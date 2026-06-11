"use client";

import { useState, useEffect } from "react";

interface BudgetService {
  id: string;
  name: string;
  implPrice: number;
  maintPrice: number;
  selected: boolean;
  quantity: number;
}

export default function BillingAndBudgets() {
  // Datos del Emisor (Editables)
  const [ourCompany, setOurCompany] = useState("");
  const [ourCif, setOurCif] = useState("");
  const [ourAddress, setOurAddress] = useState("");
  const [ourEmail, setOurEmail] = useState("");
  const [ourPhone, setOurPhone] = useState("");

  // Estado de edición
  const [isEditing, setIsEditing] = useState(false);
  const [tempCompany, setTempCompany] = useState("");
  const [tempCif, setTempCif] = useState("");
  const [tempAddress, setTempAddress] = useState("");
  const [tempEmail, setTempEmail] = useState("");
  const [tempPhone, setTempPhone] = useState("");

  // Cargar de localStorage
  useEffect(() => {
    const company = localStorage.getItem("issuer-company") || "";
    const cif = localStorage.getItem("issuer-cif") || "";
    const address = localStorage.getItem("issuer-address") || "";
    const email = localStorage.getItem("issuer-email") || "";
    const phone = localStorage.getItem("issuer-phone") || "";

    setOurCompany(company);
    setOurCif(cif);
    setOurAddress(address);
    setOurEmail(email);
    setOurPhone(phone);
  }, []);

  const startEditing = () => {
    setTempCompany(ourCompany);
    setTempCif(ourCif);
    setTempAddress(ourAddress);
    setTempEmail(ourEmail);
    setTempPhone(ourPhone);
    setIsEditing(true);
  };

  const saveEditing = () => {
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

    setIsEditing(false);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  // Datos del Cliente (Editables)
  const [clientName, setClientName] = useState("");
  const [clientCif, setClientCif] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [quoteNumber, setQuoteNumber] = useState("AD-2026-001");

  // Servicios
  const [services, setServices] = useState<BudgetService[]>([
    { id: "agent", name: "Agente de IA / Chatbot Inteligente", implPrice: 450, maintPrice: 49, selected: false, quantity: 1 },
    { id: "web_no_chat", name: "Desarrollo Web Profesional (sin Chatbot)", implPrice: 800, maintPrice: 29, selected: false, quantity: 1 },
    { id: "web_chat", name: "Página Web Premium con Chatbot Integrado", implPrice: 1200, maintPrice: 69, selected: false, quantity: 1 },
    { id: "hours", name: "Horas de Desarrollo a Medida / Integración", implPrice: 75, maintPrice: 0, selected: false, quantity: 5 },
    { id: "tokens", name: "Bolsa Mensual Extra de Tokens de IA (1M)", implPrice: 0, maintPrice: 15, selected: false, quantity: 1 },
  ]);

  const toggleService = (id: string) => {
    setServices(
      services.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s))
    );
  };

  const updateQuantity = (id: string, qty: number) => {
    setServices(
      services.map((s) => (s.id === id ? { ...s, quantity: Math.max(1, qty) } : s))
    );
  };

  // Cálculos de Totals
  const subtotalImpl = services
    .filter((s) => s.selected)
    .reduce((acc, s) => acc + s.implPrice * s.quantity, 0);

  const subtotalMaint = services
    .filter((s) => s.selected)
    .reduce((acc, s) => acc + s.maintPrice * s.quantity, 0);

  const totalImpl = subtotalImpl;
  const totalMaint = subtotalMaint;

  const totalInitialWithVat = totalImpl * 1.21;
  const totalMaintWithVat = totalMaint * 1.21;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="w-full">
      {/* Contenedor no imprimible en pantalla */}
      <div className="no-print">
        <div className="mb-8">
          <div className="kicker mb-2">Administración</div>
          <h1 className="text-3xl font-extrabold text-white">Facturación y Presupuestos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Revisa precios oficiales de ADRICH y genera presupuestos listos para descargar en PDF.
          </p>
        </div>

        {/* Sección 1: Datos de la Empresa y Tarifas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          {/* Datos fiscales de Adrich */}
          <div className="card p-6 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Datos del Emisor</h3>
                {!isEditing && (
                  <button
                    onClick={startEditing}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition"
                  >
                    ✏️ Editar
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Empresa</label>
                    <input
                      type="text"
                      className="input-dark !py-1 px-2.5 text-xs"
                      value={tempCompany}
                      onChange={(e) => setTempCompany(e.target.value)}
                      placeholder="Ej. ADRICH IA AGENCY"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">NIF / CIF</label>
                    <input
                      type="text"
                      className="input-dark !py-1 px-2.5 text-xs"
                      value={tempCif}
                      onChange={(e) => setTempCif(e.target.value)}
                      placeholder="Ej. B98765432"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Dirección</label>
                    <input
                      type="text"
                      className="input-dark !py-1 px-2.5 text-xs"
                      value={tempAddress}
                      onChange={(e) => setTempAddress(e.target.value)}
                      placeholder="Ej. Paseo de la Castellana 95, Madrid"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Email</label>
                    <input
                      type="email"
                      className="input-dark !py-1 px-2.5 text-xs"
                      value={tempEmail}
                      onChange={(e) => setTempEmail(e.target.value)}
                      placeholder="Ej. info@empresa.com"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Teléfono</label>
                    <input
                      type="text"
                      className="input-dark !py-1 px-2.5 text-xs"
                      value={tempPhone}
                      onChange={(e) => setTempPhone(e.target.value)}
                      placeholder="Ej. +34 600 000 000"
                    />
                  </div>
                  <div className="flex gap-2 pt-2.5">
                    <button
                      onClick={saveEditing}
                      className="flex-1 py-1.5 px-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-bold transition"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={cancelEditing}
                      className="flex-1 py-1.5 px-3 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 rounded-lg text-xs font-bold border border-edge transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-xs">
                  {ourCompany || ourCif || ourAddress || ourEmail || ourPhone ? (
                    <>
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 uppercase tracking-wider">Empresa</span>
                        <span className="text-white font-medium text-sm">{ourCompany || "—"}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 uppercase tracking-wider">NIF / CIF</span>
                        <span className="text-white font-medium text-sm">{ourCif || "—"}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 uppercase tracking-wider">Dirección</span>
                        <span className="text-white font-medium text-sm">{ourAddress || "—"}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 uppercase tracking-wider">Email</span>
                        <span className="text-white font-medium text-sm block truncate">{ourEmail || "—"}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 uppercase tracking-wider">Teléfono</span>
                        <span className="text-white font-medium text-sm">{ourPhone || "—"}</span>
                      </div>
                    </>
                  ) : (
                    <div className="py-6 text-center">
                      <p className="text-slate-500 italic">No hay datos del emisor.</p>
                      <button
                        onClick={startEditing}
                        className="mt-3 py-1.5 px-4 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5"
                      >
                        ✏️ Configurar Emisor
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tarifas Oficiales */}
          <div className="card p-6 lg:col-span-2">
            <h3 className="text-lg font-bold text-white mb-4">Planes y Precios Oficiales</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-edge text-slate-500 text-xs uppercase tracking-wider">
                    <th className="py-2.5">Servicios</th>
                    <th className="py-2.5 text-right">Implantación (Pago único)</th>
                    <th className="py-2.5 text-right">Mantenimiento (Mensual)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge text-slate-300">
                  <tr>
                    <td className="py-3 font-medium text-white">Agente de IA / Chatbot</td>
                    <td className="py-3 text-right">450 €</td>
                    <td className="py-3 text-right">49 € / mes</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-medium text-white">Desarrollo Web (sin Chatbot)</td>
                    <td className="py-3 text-right">800 €</td>
                    <td className="py-3 text-right">29 € / mes</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-medium text-white">Web Completa + Chatbot Pack</td>
                    <td className="py-3 text-right">1.200 €</td>
                    <td className="py-3 text-right">69 € / mes</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-medium text-white">Horas Desarrollo a Medida</td>
                    <td className="py-3 text-right">75 € / hora</td>
                    <td className="py-3 text-right">0 €</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-medium text-white">Bolsa extra 1M Tokens IA</td>
                    <td className="py-3 text-right">0 €</td>
                    <td className="py-3 text-right">15 € / mes</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sección 2: Cotizador Interactivo */}
        <div className="card p-8 mb-8">
          <h2 className="text-xl font-bold text-white mb-6">Generador de Presupuesto</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Formulario Cliente */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">Datos del Cliente</h3>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Nombre / Razón Social</label>
                <input
                  type="text"
                  placeholder="Empresa S.L."
                  className="input-dark"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">NIF / CIF</label>
                  <input
                    type="text"
                    placeholder="B12345678"
                    className="input-dark"
                    value={clientCif}
                    onChange={(e) => setClientCif(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">Nº Presupuesto</label>
                  <input
                    type="text"
                    placeholder="AD-2026-001"
                    className="input-dark"
                    value={quoteNumber}
                    onChange={(e) => setQuoteNumber(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Dirección Cliente</label>
                <input
                  type="text"
                  placeholder="Calle Gran Vía 12, Madrid"
                  className="input-dark"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Email Cliente</label>
                <input
                  type="email"
                  placeholder="contacto@cliente.com"
                  className="input-dark"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Selección de Servicios */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">Conceptos Incluidos</h3>
              <div className="space-y-3 max-h-[340px] overflow-y-auto pr-2">
                {services.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-edge hover:bg-white/[0.04] transition">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={s.selected}
                        onChange={() => toggleService(s.id)}
                        className="w-4 h-4 rounded text-indigo-600 border-edge bg-ink focus:ring-indigo-500 cursor-pointer"
                      />
                      <div className="leading-tight">
                        <p className="text-sm font-medium text-white">{s.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {s.implPrice > 0 ? `Puesta en marcha: ${s.implPrice}€` : ""}
                          {s.implPrice > 0 && s.maintPrice > 0 ? " | " : ""}
                          {s.maintPrice > 0 ? `Mensual: ${s.maintPrice}€/mes` : ""}
                        </p>
                      </div>
                    </div>
                    {s.selected && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Cant:</span>
                        <input
                          type="number"
                          className="w-14 bg-white/5 border border-edge rounded-lg px-2 py-1 text-xs text-center text-white"
                          value={s.quantity}
                          min="1"
                          onChange={(e) => updateQuantity(s.id, parseInt(e.target.value))}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Resumen de Totales y Exportar */}
          <div className="border-t border-edge pt-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="grid grid-cols-2 gap-8 text-sm">
              <div>
                <p className="text-slate-500 uppercase tracking-wider text-xs font-semibold">Pago Único (Sin IVA)</p>
                <p className="text-2xl font-black text-white mt-1">{subtotalImpl} €</p>
                <p className="text-xs text-slate-400 mt-0.5">Con IVA (21%): {totalInitialWithVat.toFixed(2)} €</p>
              </div>
              <div>
                <p className="text-slate-500 uppercase tracking-wider text-xs font-semibold">Mensualidad (Sin IVA)</p>
                <p className="text-2xl font-black text-white mt-1">{subtotalMaint} € / mes</p>
                <p className="text-xs text-slate-400 mt-0.5">Con IVA (21%): {totalMaintWithVat.toFixed(2)} € / mes</p>
              </div>
            </div>

            <button
              onClick={handlePrint}
              disabled={!clientName || services.filter((s) => s.selected).length === 0}
              className="btn-grad disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              📥 Generar y Exportar Presupuesto PDF
            </button>
          </div>
        </div>
      </div>

      {/* VISTA DE IMPRESIÓN (Presupuesto Formal) */}
      <div className="hidden print:block print-area bg-white text-slate-900 p-10 font-sans min-h-screen">
        {/* Encabezado */}
        <div className="flex justify-between items-start border-b-2 border-slate-200 pb-6 mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-wider text-slate-900">{ourCompany}</h1>
            <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest">Soluciones de Inteligencia Artificial y Web</p>
          </div>
          <div className="text-right text-sm">
            <h2 className="text-xl font-bold text-slate-800">PRESUPUESTO</h2>
            <p className="text-slate-500 mt-1">Nº: <strong className="text-slate-800">{quoteNumber}</strong></p>
            <p className="text-slate-500">Fecha: {new Date().toLocaleDateString("es-ES")}</p>
          </div>
        </div>

        {/* Datos Emisor y Receptor */}
        <div className="grid grid-cols-2 gap-8 mb-10 text-sm">
          <div>
            <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-1.5 mb-2">DATOS DE LA EMPRESA (EMISOR)</h3>
            <p className="font-semibold">{ourCompany}</p>
            <p className="text-slate-600">NIF/CIF: {ourCif}</p>
            <p className="text-slate-600">{ourAddress}</p>
            <p className="text-slate-600">Email: {ourEmail}</p>
            {ourPhone && <p className="text-slate-600">Teléfono: {ourPhone}</p>}
          </div>
          <div>
            <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-1.5 mb-2">DATOS DEL CLIENTE (RECEPTOR)</h3>
            <p className="font-semibold text-slate-900">{clientName || "—"}</p>
            <p className="text-slate-600">CIF: {clientCif || "—"}</p>
            <p className="text-slate-600">{clientAddress || "—"}</p>
            <p className="text-slate-600">Email: {clientEmail || "—"}</p>
          </div>
        </div>

        {/* Conceptos */}
        <table className="w-full text-left text-sm mb-10 border-collapse">
          <thead>
            <tr className="bg-slate-100 border-b-2 border-slate-200 text-slate-700 font-bold">
              <th className="p-3">Servicio / Concepto</th>
              <th className="p-3 text-center">Cant.</th>
              <th className="p-3 text-right">Puesta en marcha (Unid.)</th>
              <th className="p-3 text-right">Mantenimiento (Mensual)</th>
              <th className="p-3 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {services
              .filter((s) => s.selected)
              .map((s) => (
                <tr key={s.id} className="text-slate-800">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 text-center">{s.quantity}</td>
                  <td className="p-3 text-right">{s.implPrice > 0 ? `${s.implPrice} €` : "—"}</td>
                  <td className="p-3 text-right">{s.maintPrice > 0 ? `${s.maintPrice} €` : "—"}</td>
                  <td className="p-3 text-right font-semibold">
                    {s.implPrice > 0 ? `${s.implPrice * s.quantity} €` : ""}
                    {s.implPrice > 0 && s.maintPrice > 0 ? " + " : ""}
                    {s.maintPrice > 0 ? `${s.maintPrice * s.quantity} € / mes` : ""}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {/* Bloque de Totales */}
        <div className="flex justify-end mb-10">
          <div className="w-80 bg-slate-50 p-5 rounded-xl border border-slate-200 text-sm">
            <div className="space-y-2.5">
              <div className="flex justify-between text-slate-600">
                <span>Total Puesta en marcha:</span>
                <span className="font-semibold text-slate-900">{subtotalImpl} €</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Total Mantenimiento:</span>
                <span className="font-semibold text-slate-900">{subtotalMaint} € / mes</span>
              </div>
              <div className="border-t border-slate-200 my-2 pt-2 flex justify-between text-slate-500 text-xs">
                <span>IVA (21%):</span>
                <span>
                  +{(subtotalImpl * 0.21).toFixed(2)} € / +{(subtotalMaint * 0.21).toFixed(2)} €
                </span>
              </div>
              <div className="border-t border-slate-300 pt-2.5 space-y-2">
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <span>Total Inicial:</span>
                  <span>{totalInitialWithVat.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <span>Total Mantenimiento:</span>
                  <span>{totalMaintWithVat.toFixed(2)} € / mes</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Términos y Firmas */}
        <div className="mt-20 pt-10 border-t border-slate-200 text-xs text-slate-500">
          <h4 className="font-bold text-slate-700 mb-1.5 uppercase">Términos y condiciones</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Este presupuesto tiene una validez de 30 días naturales desde la fecha de emisión.</li>
            <li>El pago único inicial del 50% se realizará a la aceptación y firma de este presupuesto.</li>
            <li>El 50% restante se abonará una vez completado el desarrollo y previo al despliegue.</li>
            <li>La cuota de mantenimiento mensual se facturará el día 1 de cada mes mediante domiciliación bancaria.</li>
          </ul>

          <div className="grid grid-cols-2 gap-20 mt-16 text-center text-sm">
            <div className="border-t border-slate-200 pt-3">
              <p className="text-slate-400">Aceptado por el Cliente</p>
              <p className="font-bold mt-1 text-slate-700">{clientName || "Firma y fecha"}</p>
            </div>
            <div className="border-t border-slate-200 pt-3">
              <p className="text-slate-400">Emitido por</p>
              <p className="font-bold mt-1 text-slate-700">{ourCompany}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
