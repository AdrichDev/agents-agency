"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import type { DemoAppointment } from "@/components/agenda/agenda-fullscreen";
import { APPOINTMENT_STATUSES } from "@/components/agenda/status";
import { TAREAS_PREDEFINIDAS } from "@/lib/agenda/tareas-predefinidas";
import { ACCIONES_COMERCIALES, CANALES, buildCitaNotes } from "@/lib/agenda/acciones-canales";
import { api } from "@/lib/api";

/**
 * Modal de alta de cita estilo OperaOS (creador_CRM NuevaCitaModal), adaptado
 * al modelo plano de AA (aa-agenda-operaos-parity P4) y ampliado con paridad UX
 * completa (aa-nueva-cita-rebuild): selector de cartera de clientes precargada,
 * tareas/reuniones predefinidas, comercial asignado, chips de hora reales y
 * sección Acción/Canal — todo plegado en los mismos campos planos que ya acepta
 * el back (client/service/notes/email/phone), sin tocar el modelo de datos.
 *
 * Patrón anti-falso-éxito (heredado del stub P3): `onSave` persiste vía POST y
 * devuelve true/false; en éxito el padre cierra el modal, en fallo se muestra
 * el error y el formulario CONSERVA lo escrito (no se resetea ni se cierra).
 */

// Mismo chasis de input que el resto de formularios de la agenda AA.
const inputCls =
  "mt-1 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-transparent px-3 py-2 text-sm text-white";
const labelCls = "block text-xs font-medium text-[rgb(148,163,184)]";

/** Tenant mínimo que consume este modal desde GET /api/clients. */
type TenantOption = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
};

/** Contacto (lead/prospecto) que consume este modal desde GET /api/contacts. */
type ContactOption = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
};

/** Miembro de plataforma que consume este modal desde GET /api/agenda/team. */
type TeamMember = { id: string; name: string; role: string };

// Slots fijos 09:00-19:00 cada 30 min: la disponibilidad real se resuelve
// contra `existingAppointments` (no hay endpoint de slots en AA todavía).
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

export function NuevaCitaModal({
  defaultDate,
  onClose,
  onSave,
  existingAppointments,
}: {
  /** Día seleccionado en el grid: fecha inicial del formulario. */
  defaultDate: string;
  onClose: () => void;
  /** Persiste la cita (POST); true = guardada (el padre cierra), false = fallo. */
  onSave: (appt: DemoAppointment) => Promise<boolean>;
  /** Citas ya existentes: alimenta la disponibilidad de los chips de hora. */
  existingAppointments: DemoAppointment[];
}) {
  const [form, setForm] = useState({
    client: "",
    service: "",
    date: defaultDate,
    time: "09:00",
    email: "",
    phone: "",
    // Default OperaOS/back: una cita agendada por el owner nace confirmada.
    status: "Confirmada" as DemoAppointment["status"],
    notes: "",
  });
  const [error, setError] = useState("");
  // Guardado en vuelo: deshabilita "Crear cita" para evitar doble submit.
  const [saving, setSaving] = useState(false);

  // Cartera de clientes precargada: clientes (GET /api/clients) + contactos
  // (GET /api/contacts, leads/prospectos). "Sin cartera" es el valor por
  // defecto (cita personal, sin cliente/contacto asociado). La clave del select
  // lleva prefijo `client:`/`contact:` para distinguir el origen del autofill.
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [selectedCarteraKey, setSelectedCarteraKey] = useState("");

  // Servicio/tarea: catálogo predefinido + fallback de texto libre en "Otro".
  const [taskChoice, setTaskChoice] = useState("");
  const [customTask, setCustomTask] = useState("");

  // Comercial asignado (GET /api/agenda/team): sin columna dedicada en AA, se
  // pliega en `notes` como línea "Comercial: <nombre>".
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [comercialId, setComercialId] = useState("");

  // Sección Acción y Canal: ambos opcionales, se pliegan en `notes` vía buildCitaNotes.
  const [accion, setAccion] = useState("");
  const [canal, setCanal] = useState("");

  // Todas las cargas usan `api()`: antepone la base del back (NEXT_PUBLIC_API_URL)
  // y el Bearer token de Supabase. Un `fetch` relativo pega al server de Next
  // (sin token) → 401 y los selects quedaban vacíos.
  useEffect(() => {
    let cancelled = false;
    api<TenantOption[]>("/api/clients")
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setTenants(data);
      })
      .catch(() => {
        // Fetch fallido: el select sigue mostrando solo "Sin cartera".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<ContactOption[]>("/api/contacts")
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setContacts(
            data.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email ?? null,
              phone: c.phone ?? null,
            })),
          );
        }
      })
      .catch(() => {
        // Fetch fallido: la cartera muestra solo clientes (o "Sin cartera").
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<TeamMember[]>("/api/agenda/team")
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setTeam(data);
      })
      .catch(() => {
        // Endpoint aún no disponible o fallido: fallback a solo "Cualquiera".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCarteraChange(key: string) {
    setSelectedCarteraKey(key);
    if (!key) return;
    // Clave con prefijo `client:`/`contact:` — resuelve contra la lista origen.
    const [kind, id] = key.split(":");
    const match =
      kind === "contact"
        ? contacts.find((c) => c.id === id)
        : tenants.find((t) => t.id === id);
    if (match) {
      // Autocompleta pero deja los campos editables después.
      setForm((f) => ({
        ...f,
        client: match.name,
        email: match.email ?? f.email,
        phone: match.phone ?? f.phone,
      }));
    }
  }

  function handleTaskChange(value: string) {
    setTaskChoice(value);
    if (value !== "Otro") setForm((f) => ({ ...f, service: value }));
    else setForm((f) => ({ ...f, service: customTask }));
  }

  function handleCustomTaskChange(value: string) {
    setCustomTask(value);
    setForm((f) => ({ ...f, service: value }));
  }

  // Ocupación de un slot: alguna cita existente en la misma fecha/hora, salvo
  // las canceladas (liberan el hueco).
  function isSlotTaken(time: string) {
    return existingAppointments.some(
      (a) => a.date === form.date && a.time === time && a.status !== "Cancelada",
    );
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (saving) return;
    // Validación de obligatorios ANTES de llamar a la API: fecha y hora.
    // Cliente y servicio son opcionales (cita personal sin cartera asociada).
    if (!form.date || !form.time) {
      setError("Fecha y hora son obligatorias.");
      return;
    }
    setError("");
    setSaving(true);

    // Merge de notas: Comercial (si hay uno asignado) primero, luego
    // Acción/Canal/Comentarios (buildCitaNotes) — mismo separador ` | ` en
    // ambos segmentos para que el resultado sea un único string coherente.
    const comercial = team.find((m) => m.id === comercialId);
    const comercialNote = comercial ? `Comercial: ${comercial.name}` : "";
    const accionCanalNotes = buildCitaNotes(accion, canal, form.notes);
    const mergedNotes = [comercialNote, accionCanalNotes].filter(Boolean).join(" | ");

    const saved = await onSave({
      id: `local-${Date.now()}`, // id provisional: el back devuelve el real
      date: form.date,
      time: form.time,
      // Cliente opcional: sin cartera se usa la tarea como título, o "Cita
      // personal". El back sigue exigiendo `client` no vacío (columna NOT NULL),
      // así que el fallback evita el 400 sin tocar el esquema.
      client: form.client.trim() || form.service.trim() || "Cita personal",
      service: form.service.trim(),
      owner: "Sin asignar", // el back responde con el owner real de plataforma
      status: form.status,
      notes: mergedNotes || undefined,
      // Contacto opcional: el back lo cruza contra Tenant/ProspectContact.
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
    });
    setSaving(false);
    // En éxito el padre ya cerró el modal; en fallo se conservan los datos.
    if (!saved) setError("No se pudo guardar la cita. Inténtalo de nuevo.");
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 backdrop-blur-sm"
      data-testid="agenda-add-task-modal"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[var(--panel)] p-6 shadow-xl"
      >
        <p className="mb-4 text-lg font-semibold text-white">Nueva cita</p>

        <label className={labelCls}>Cartera de clientes</label>
        <select
          className={inputCls}
          value={selectedCarteraKey}
          onChange={(e) => handleCarteraChange(e.target.value)}
          data-testid="agenda-add-task-tenant"
        >
          <option value="" className="bg-[#0b0c10]">
            — Sin cartera de cliente (cita personal) —
          </option>
          {/* Clientes y contactos en una sola lista, sin etiquetas, alfabética. */}
          {[
            ...tenants.map((t) => ({ key: `client:${t.id}`, name: t.name })),
            ...contacts.map((c) => ({ key: `contact:${c.id}`, name: c.name })),
          ]
            .sort((a, b) => a.name.localeCompare(b.name, "es"))
            .map((o) => (
              <option key={o.key} value={o.key} className="bg-[#0b0c10]">
                {o.name}
              </option>
            ))}
        </select>

        <label className={`${labelCls} mt-3`}>Servicio / tarea</label>
        <select
          className={inputCls}
          value={taskChoice}
          onChange={(e) => handleTaskChange(e.target.value)}
          data-testid="agenda-add-task-service"
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
            data-testid="agenda-add-task-service-custom"
          />
        )}

        <label className={`${labelCls} mt-3`}>Empleado</label>
        {/* Sin columna dedicada en el modelo plano de AA: el nombre elegido se
            pliega en `notes` como "Comercial: <nombre>" al enviar el formulario. */}
        <select
          className={inputCls}
          value={comercialId}
          onChange={(e) => setComercialId(e.target.value)}
          data-testid="agenda-add-task-comercial"
        >
          <option value="" className="bg-[#0b0c10]">
            Cualquiera
          </option>
          {/* Todos los empleados (Admin incluido) en una sola lista alfabética. */}
          {[...team]
            .sort((a, b) => a.name.localeCompare(b.name, "es"))
            .map((m) => (
              <option key={m.id} value={m.id} className="bg-[#0b0c10]">
                {m.name}
              </option>
            ))}
        </select>

        <div className="mt-3">
          <label className={labelCls}>Fecha *</label>
          <input
            type="date"
            className={inputCls}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            data-testid="agenda-add-task-date"
          />
        </div>

        {/* Las horas disponibles solo cargan tras elegir empleado: la hora se
            selecciona por chip, no hay input nativo de hora. */}
        <label className={`${labelCls} mt-3`}>Hora *</label>
        {!comercialId ? (
          <p className="text-sm text-white/50" data-testid="agenda-add-task-hour-hint">
            Selecciona un empleado para ver las horas disponibles.
          </p>
        ) : (
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
                  data-testid="agenda-add-task-hour-chip"
                >
                  {slot}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Acción</label>
            <select
              className={inputCls}
              value={accion}
              onChange={(e) => setAccion(e.target.value)}
              data-testid="agenda-add-task-accion"
            >
              <option value="" className="bg-[#0b0c10]">
                Selecciona una acción…
              </option>
              {ACCIONES_COMERCIALES.map((a) => (
                <option key={a} value={a} className="bg-[#0b0c10]">
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Canal</label>
            <select
              className={inputCls}
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              data-testid="agenda-add-task-canal"
            >
              <option value="" className="bg-[#0b0c10]">
                Selecciona un canal…
              </option>
              {CANALES.map((c) => (
                <option key={c} value={c} className="bg-[#0b0c10]">
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-600" data-testid="agenda-add-task-error">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary flex items-center gap-2"
            disabled={saving}
            data-testid="agenda-add-task-submit"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarPlus className="h-4 w-4" />
            )}
            Crear cita
          </button>
        </div>
      </form>
    </div>
  );
}
