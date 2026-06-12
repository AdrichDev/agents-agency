"use client";

import budgetLogo from "../../assets/3A_Estudio_Banner_FondoNegro_1024_WEB.png";
import { Badge } from "@/components/ui/Badge";
import { fmt, type BudgetRecord, type BudgetStatus } from "./types";

interface BudgetPreviewProps {
  budget: BudgetRecord;
  onBack: () => void;
  onUpdateStatus: (id: string, status: BudgetStatus) => void;
  onEditRechazada: (budget: BudgetRecord) => void;
}

export function BudgetPreview({ budget: b, onBack, onUpdateStatus, onEditRechazada }: BudgetPreviewProps) {
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
          <button onClick={onBack} className="text-sm font-bold text-slate-400 hover:text-white transition">← Volver</button>
          <Badge variant={b.status} className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
            {b.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          {b.status === "generada" && (
            <>
              <button onClick={() => onUpdateStatus(b.id, "aceptada")} className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded-lg text-xs font-bold transition">Aceptar</button>
              <button onClick={() => onUpdateStatus(b.id, "rechazada")} className="px-3 py-1.5 bg-red-500/20 text-red-300 hover:bg-red-500/30 rounded-lg text-xs font-bold transition">Rechazar</button>
              <button onClick={() => onUpdateStatus(b.id, "caducada")} className="px-3 py-1.5 bg-slate-500/20 text-slate-300 hover:bg-slate-500/30 rounded-lg text-xs font-bold transition">Caducar</button>
            </>
          )}
          {b.status === "rechazada" && (
            <button onClick={() => onEditRechazada(b)} className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-xs font-bold transition">Editar y Nueva Versión</button>
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
