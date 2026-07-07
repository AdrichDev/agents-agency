"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import type { DemoAppointment } from "@/components/agenda/agenda-fullscreen";
import { APPOINTMENT_STATUSES } from "@/components/agenda/status";
import { TAREAS_PREDEFINIDAS } from "@/lib/agenda/tareas-predefinidas";
import {
  buildGoogleMapsEmbedUrl,
  buildGoogleMapsSearchUrl,
} from "@/lib/agenda/google-maps-url";
import { splitComercial, joinComercial } from "@/lib/agenda/acciones-canales";

/**
 * Modal de detalle de cita estilo OperaOS (creador_CRM CitaDetalleModal),
 * portado para aa-agenda-operaos-parity P5 sobre el chasis `.opera-modal` de
 * globals.css. Tres responsabilidades:
 *  - Lectura: ficha `dl/dt/dd` (cliente/contacto/servicio/fecha/hora/estado/
 *    email/teléfono/dirección) + mapa embebido de Google si hay dirección +
 *    anotaciones con guardado independiente (PATCH {notes}).
 *  - Cambio rápido de estado: <select> en la fila Estado → PATCH {status}; la
 *    UI refleja SIEMPRE la respuesta persistida, nunca el valor optimista.
 *  - Edición: formulario con los mismos campos que el modal de alta,
 *    precargado; en fallo del PATCH conserva lo escrito y muestra el error
 *    (patrón anti-cierre-en-error, igual que NuevaCitaModal).
 * Los eventos importados de Google (source === "google") no tienen fila en
 * PlatformAppointment: sin editar/eliminar/estado, solo nota informativa.
 */

// Mismo chasis de input que el modal de alta (nueva-cita-modal.tsx).
const inputCls =
  "mt-1 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-transparent px-3 py-2 text-sm text-white";
const labelCls = "block text-xs font-medium text-[rgb(148,163,184)]";
// Fila de la ficha dl/dt/dd (paridad OperaOS cita-detalle-modal.tsx).
const dtCls = "text-[11px] font-bold uppercase tracking-wider text-[var(--accent-1)]";

/**
 * Extrae el profesional/comercial asignado a la cita desde `notes`. AA no
 * tiene columna dedicada (a diferencia de OperaOS `cita.empleado`): el modal
 * de alta (nueva-cita-modal.tsx) pliega el comercial elegido como el segmento
 * `Comercial: <nombre>` dentro de `notes` (ver acciones-canales.ts para el
 * resto de segmentos). Devuelve "" si no hay segmento — el llamador aplica el
 * fallback "—" (paridad `cita.empleado || '—'`).
 */
export function parseProfesional(notes?: string | null): string {
  if (!notes) return "";
  const segmento = notes
    .split("|")
    .map((s) => s.trim())
    .find((s) => /^comercial\s*:/i.test(s));
  if (!segmento) return "";
  return segmento.slice(segmento.indexOf(":") + 1).trim();
}

// Horarios disponibles: 09:00 a 19:00 en intervalos de 30 minutos
function buildHourSlots(): string[] {
  const slots: string[] = [];
  for (let hour = 9; hour <= 19; hour += 1) {
    for (const minute of [0, 30]) {
      if (hour === 19 && minute === 30) continue; // tope 19:00
      slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }
  return slots;
}
const HOUR_SLOTS = buildHourSlots();

/** Campos parcheables vía PATCH /api/agenda/appointments/:id. */
export type AppointmentPatch = Partial<
  Pick<
    DemoAppointment,
    "date" | "time" | "client" | "service" | "notes" | "status"
  >
>;

export function CitaDetalleModal({
  appointment,
  initialEditing = false,
  onClose,
  onPatch,
  existingAppointments,
}: {
  appointment: DemoAppointment;
  /** Abrir directamente en modo edición (RowActions "Editar" de la tarjeta). */
  initialEditing?: boolean;
  onClose: () => void;
  /** PATCH parcial; devuelve la cita persistida o null en fallo. */
  onPatch: (id: string, patch: AppointmentPatch) => Promise<DemoAppointment | null>;
  /** Citas ya existentes: alimenta disponibilidad de los chips de hora. */
  existingAppointments: DemoAppointment[];
}) {
  // Solo las citas AA nativas (fila real de PlatformAppointment) son editables:
  // los eventos importados de Google no tienen id que PATCH/DELETE resuelva.
  const isEditable = appointment.source !== "google";

  const [editing, setEditing] = useState(initialEditing && isEditable);
  const [actionError, setActionError] = useState("");
  // Operación en vuelo (PATCH/DELETE): deshabilita controles, evita dobles envíos.
  const [busy, setBusy] = useState(false);
  // Borrador de anotaciones (guardado independiente del formulario completo).
  // Se siembra SOLO con la parte de anotaciones: el segmento "Comercial: <nombre>"
  // (si existe) queda oculto aquí y se restaura al guardar (ver saveNotes).
  const [notesDraft, setNotesDraft] = useState(splitComercial(appointment.notes).anotaciones);
  const [form, setForm] = useState({
    date: appointment.date,
    time: appointment.time,
    client: appointment.client,
    service: appointment.service,
    status: appointment.status,
    // Igual que notesDraft: el formulario completo tampoco expone/edita el
    // segmento Comercial, para no perderlo al guardar (ver submitEdit).
    notes: splitComercial(appointment.notes).anotaciones,
  });

  // Servicio/tarea: select predefinido o custom "Otro"
  const [taskChoice, setTaskChoice] = useState(
    appointment.service && TAREAS_PREDEFINIDAS.includes(appointment.service)
      ? appointment.service
      : appointment.service
        ? "Otro"
        : "",
  );
  const [customTask, setCustomTask] = useState(
    appointment.service && !TAREAS_PREDEFINIDAS.includes(appointment.service)
      ? appointment.service
      : "",
  );

  const summary = appointment.contactSummary;
  const address = summary?.address?.trim() || "";
  const mapaEmbedUrl = buildGoogleMapsEmbedUrl(address);
  const mapaEnlaceUrl = buildGoogleMapsSearchUrl(address);

  // Ocupación de un slot: alguna cita existente en la misma fecha/hora, salvo
  // las canceladas y la propia cita siendo editada (liberan el hueco).
  function isSlotTaken(time: string) {
    return existingAppointments.some(
      (a) => a.id !== appointment.id && a.date === form.date && a.time === time && a.status !== "Cancelada",
    );
  }

  function handleTaskChange(value: string) {
    setTaskChoice(value);
    if (value !== "Otro") {
      setForm((f) => ({ ...f, service: value }));
    } else {
      setForm((f) => ({ ...f, service: customTask }));
    }
  }

  function handleCustomTaskChange(value: string) {
    setCustomTask(value);
    setForm((f) => ({ ...f, service: value }));
  }

  // Cambio rápido de estado sin abrir el formulario completo. El select es
  // controlado por appointment.status (dato persistido): en fallo del PATCH
  // el valor visible no cambia, así la UI nunca miente sobre lo guardado.
  async function changeStatus(status: DemoAppointment["status"]) {
    if (busy || status === appointment.status) return;
    setActionError("");
    setBusy(true);
    const updated = await onPatch(appointment.id, { status });
    setBusy(false);
    if (!updated) setActionError("No se pudo cambiar el estado. Inténtalo de nuevo.");
  }

  // Guardar solo las anotaciones (PATCH {notes}) sin pasar por el modo edición.
  async function saveNotes() {
    if (busy) return;
    setActionError("");
    setBusy(true);
    // Recompone `notes` anteponiendo el Comercial ya persistido: el usuario
    // solo edita anotaciones, pero el segmento Comercial nunca se pierde.
    const merged = joinComercial(splitComercial(appointment.notes).comercial, notesDraft.trim());
    const updated = await onPatch(appointment.id, { notes: merged || undefined });
    setBusy(false);
    if (!updated) {
      // Fallo: el borrador se conserva en el textarea para reintentar.
      setActionError("No se pudo guardar la anotación. Inténtalo de nuevo.");
    }
  }

  async function submitEdit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    // Misma validación de obligatorios que el modal de alta.
    if (!form.client.trim() || !form.date || !form.time) {
      setActionError("Cliente, fecha y hora son obligatorios.");
      return;
    }
    setActionError("");
    setBusy(true);
    // Igual que saveNotes: el Comercial ya persistido se antepone al guardar,
    // el formulario de edición completo nunca lo toca ni lo borra.
    const mergedNotes = joinComercial(
      splitComercial(appointment.notes).comercial,
      form.notes.trim(),
    );
    const updated = await onPatch(appointment.id, {
      date: form.date,
      time: form.time,
      client: form.client.trim(),
      service: form.service.trim(),
      status: form.status,
      notes: mergedNotes || undefined,
      // Email y teléfono no se editan en el formulario: se preservan en BD.
    });
    setBusy(false);
    if (updated) {
      // Éxito: volver a lectura con los datos ya refrescados por el padre.
      setNotesDraft(splitComercial(updated.notes).anotaciones);
      setEditing(false);
    } else {
      // Fallo: el formulario conserva lo escrito y se avisa (anti-cierre-en-error).
      setActionError("No se pudieron guardar los cambios. Inténtalo de nuevo.");
    }
  }

  // Filas de la ficha (paridad OperaOS). TODAS se muestran siempre con fallback
  // "—" cuando no hay dato: el usuario quiere ver el apartado aunque esté vacío,
  // no que la fila desaparezca (que era lo que dejaba el detalle a medias).
  const estadoNode: React.ReactNode = isEditable ? (
    // Cambio rápido de estado: persiste vía PATCH al seleccionar.
    <select
      key="estado"
      className="w-full max-w-48 rounded-lg border border-[rgba(255,255,255,0.1)] bg-transparent px-2 py-1 text-sm font-semibold text-white"
      value={appointment.status}
      disabled={busy}
      onChange={(e) => changeStatus(e.target.value as DemoAppointment["status"])}
      data-testid="agenda-detail-status-select"
    >
      {APPOINTMENT_STATUSES.map((s) => (
        <option key={s} value={s} className="bg-[#111]">
          {s}
        </option>
      ))}
    </select>
  ) : (
    appointment.status
  );

  const direccionNode: React.ReactNode = (
    <span key="direccion">
      {address || "—"}
      {/* Pin junto a la dirección: abre Google Maps en pestaña nueva. */}
      {mapaEnlaceUrl && (
        <a
          href={mapaEnlaceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 inline-flex items-center align-middle text-[var(--accent-1)] transition hover:opacity-80"
          title="Abrir dirección en Google Maps"
          aria-label="Abrir dirección en Google Maps"
        >
          <MapPin className="h-4 w-4" />
        </a>
      )}
    </span>
  );

  const campos: [string, React.ReactNode][] = [
    ["Cliente", summary?.commercialName || appointment.client || "—"],
    ["Persona de contacto", summary?.contactPerson || appointment.client || "—"],
    ["Servicio", appointment.service || "—"],
    ["Profesional", parseProfesional(appointment.notes) || "—"],
    ["Fecha", appointment.date.split("-").reverse().join("/")],
    ["Hora", appointment.time],
    ["Estado", estadoNode],
    ["Dirección", direccionNode],
  ];

  return (
    <div className="opera-modal-backdrop" data-testid="agenda-detail-modal" onClick={onClose}>
      <div className="opera-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opera-modal-header">
          <h3 className="opera-modal-title">{editing ? "Editar Cita" : "Detalle de cita"}</h3>
          <button
            type="button"
            className="opera-modal-close"
            onClick={onClose}
            data-testid="modal-close-button"
            aria-label="Cerrar modal"
          >
            ×
          </button>
        </div>

        <div className="opera-modal-body">
          {editing ? (
            // ===== Modo edición: mismos campos que el modal de alta, precargados =====
            <form data-testid="agenda-edit-form" onSubmit={submitEdit}>
              <label className={labelCls}>Cliente *</label>
              <input
                type="text"
                className={inputCls}
                placeholder="Nombre del cliente"
                value={form.client}
                onChange={(e) => setForm({ ...form, client: e.target.value })}
                data-testid="agenda-detail-client-input"
              />

              <label className={`${labelCls} mt-3`}>Servicio</label>
              <select
                className={inputCls}
                value={taskChoice}
                onChange={(e) => handleTaskChange(e.target.value)}
                data-testid="agenda-detail-service"
              >
                <option value="" className="bg-[#0b0c10]">
                  Selecciona una tarea o reunión…
                </option>
                {TAREAS_PREDEFINIDAS.map((t) => (
                  <option key={t} value={t} className="bg-[#0b0c10]">
                    {t}
                  </option>
                ))}
              </select>
              {taskChoice === "Otro" && (
                <input
                  type="text"
                  className={`${inputCls} mt-2`}
                  placeholder="Describe la tarea o reunión"
                  value={customTask}
                  onChange={(e) => handleCustomTaskChange(e.target.value)}
                  data-testid="agenda-detail-service-custom"
                />
              )}

              <label className={`${labelCls} mt-3`}>Fecha *</label>
              <input
                type="date"
                className={inputCls}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />

              <label className={`${labelCls} mt-3`}>Hora *</label>
              <div className="agenda-hour-chip-grid" role="group" aria-label="Horas disponibles">
                {HOUR_SLOTS.map((slot) => {
                  const taken = isSlotTaken(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      className="agenda-hour-chip"
                      disabled={taken}
                      data-selected={form.time === slot}
                      data-time={slot}
                      data-disabled={taken ? "true" : undefined}
                      onClick={() => setForm({ ...form, time: slot })}
                      data-testid="agenda-detail-hour-chip"
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>

              <label className={`${labelCls} mt-3`}>Estado</label>
              <select
                className={inputCls}
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as DemoAppointment["status"] })
                }
              >
                {APPOINTMENT_STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-[#111]">
                    {s}
                  </option>
                ))}
              </select>

              <label className={`${labelCls} mt-3`}>Notas</label>
              <textarea
                className={`${inputCls} min-h-[60px] resize-none`}
                placeholder="Anotaciones opcionales"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />

              {actionError && (
                <p className="mt-3 text-xs text-red-500" data-testid="agenda-detail-error">
                  {actionError}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setActionError("");
                    setEditing(false);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                  data-testid="agenda-detail-save-btn"
                >
                  {busy ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </form>
          ) : (
            // ===== Modo lectura: ficha dl/dt/dd + mapa + anotaciones =====
            <>
              <dl className="divide-y divide-[rgba(255,255,255,0.1)] text-sm">
                {campos.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[110px_1fr] gap-3 py-2">
                    <dt className={dtCls}>{label}</dt>
                    <dd className="break-words whitespace-pre-wrap text-white">{value}</dd>
                  </div>
                ))}
              </dl>

              {/* Ubicación: siempre presente. Con dirección → mapa embebido de
                  Google (sin API key) + enlace. Sin dirección → aviso, para que
                  el apartado no desaparezca. */}
              <div className="mt-4">
                <label className={labelCls}>Ubicación</label>
                {mapaEmbedUrl ? (
                  <>
                    <div className="mt-1 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.1)]">
                      <iframe
                        title="Ubicación de la cita en Google Maps"
                        src={mapaEmbedUrl}
                        className="h-40 w-full sm:h-52"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        data-testid="agenda-detail-map"
                      />
                    </div>
                    {mapaEnlaceUrl && (
                      <a
                        href={mapaEnlaceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-[var(--accent-1)] underline"
                        data-testid="agenda-detail-maps-link"
                      >
                        Abrir en Google Maps
                      </a>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-400" data-testid="agenda-detail-no-map">
                    Sin dirección asociada a esta cita.
                  </p>
                )}
              </div>

              {/* Anotaciones con guardado independiente (PATCH {notes}). Los
                  eventos de Google no son parcheables: solo lectura. */}
              <div className="mt-4">
                <label className={labelCls}>Anotaciones</label>
                <textarea
                  className={`${inputCls} min-h-[80px] resize-none`}
                  rows={4}
                  value={isEditable ? notesDraft : splitComercial(appointment.notes).anotaciones}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  readOnly={!isEditable}
                  placeholder="Añade una anotación sobre esta cita…"
                  data-testid="agenda-detail-notes"
                />
                {isEditable && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busy}
                      onClick={saveNotes}
                      data-testid="agenda-detail-save-note-btn"
                    >
                      Guardar anotación
                    </button>
                  </div>
                )}
              </div>

              {!isEditable && (
                // Evento importado de Google: sin fila en BD, se edita en Google.
                <p className="mt-3 text-xs text-[rgb(148,163,184)]" data-testid="agenda-detail-google-note">
                  Evento importado de Google Calendar: edítalo desde Google.
                </p>
              )}

              {actionError && (
                <p className="mt-3 text-xs text-red-500" data-testid="agenda-detail-error">
                  {actionError}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer solo en lectura: en edición los botones viven en el form. */}
        {!editing && (
          <div className="opera-modal-foot">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cerrar
            </button>
            {isEditable && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setActionError("");
                    // Re-sembrar el formulario con la cita ACTUAL (puede haber
                    // cambiado por el cambio rápido de estado o de anotación).
                    setForm({
                      date: appointment.date,
                      time: appointment.time,
                      client: appointment.client,
                      service: appointment.service,
                      status: appointment.status,
                      notes: splitComercial(appointment.notes).anotaciones,
                    });
                    setTaskChoice(
                      appointment.service && TAREAS_PREDEFINIDAS.includes(appointment.service)
                        ? appointment.service
                        : appointment.service
                          ? "Otro"
                          : "",
                    );
                    setCustomTask(
                      appointment.service && !TAREAS_PREDEFINIDAS.includes(appointment.service)
                        ? appointment.service
                        : "",
                    );
                    setEditing(true);
                  }}
                  data-testid="agenda-detail-edit-btn"
                >
                  Editar
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
