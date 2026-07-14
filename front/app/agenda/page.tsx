"use client";

import { useEffect, useRef, useState } from "react";
import { api, getToken } from "@/lib/api";

import { AgendaGrid } from "@/components/agenda/agenda-grid";
import { CitaDetalleModal } from "@/components/agenda/cita-detalle-modal";
import { ClienteInfoModal } from "@/components/agenda/cliente-info-modal";
import { NuevaCitaModal } from "@/components/agenda/nueva-cita-modal";
import { estadoTone, tone, toneClass } from "@/components/agenda/status";
import {
  DEMO_APPOINTMENTS,
  agendaStyles,
  dateKey,
  parseDate,
  type DemoAppointment,
} from "@/components/agenda/agenda-fullscreen";

/**
 * Página /agenda reescrita sobre el motor AgendaGrid (aa-agenda-operaos-parity
 * P3): calendario mes/semana/día + panel del día (DiaPanel) + CitaAgendaCard
 * estilo OperaOS. La carga de datos (demo/API/Google Calendar) y el CRUD se
 * conservan del change previo aa-agenda-crm-parity.
 */

// Borde de los eventos importados de Google (verde, distinto de las citas AA).
const GOOGLE_BORDER = "#34d399";

/** Tarjeta de cita estilo OperaOS (creador_CRM /citas CitaAgendaCard):
 * chasis `.cita-full-card` con borde-izq por estado (`estadoTone`), hora en
 * acento, cliente, meta `servicio · owner`, badge de estado y acciones
 * Editar/Eliminar. La variante `compact` (semana/día) omite meta y acciones.
 * Click en la tarjeta (fuera de las acciones) abre el detalle. */
function CitaAgendaCard({
  appt,
  compact,
  onOpenDetalle,
  onOpenFicha,
  onEdit,
  onDelete,
}: {
  appt: DemoAppointment;
  compact: boolean;
  onOpenDetalle: () => void;
  onOpenFicha: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isGoogle = appt.source === "google";
  return (
    <div
      className={compact ? "cita-full-card cita-full-card-compact" : "cita-full-card"}
      style={{ borderLeftColor: isGoogle ? GOOGLE_BORDER : estadoTone(appt.status) }}
      data-testid={isGoogle ? "agenda-google-event-card" : "agenda-event-card"}
      data-tone={tone(appt.status)}
      onClick={onOpenDetalle}
    >
      <div className="time">{appt.time}</div>
      <div className="client">
        {appt.client ? (
          <button
            type="button"
            className="text-left underline-offset-2 transition hover:text-[var(--accent-1)] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFicha();
            }}
            data-testid="agenda-card-client-btn"
          >
            {appt.client}
          </button>
        ) : (
          <span className="text-slate-500">Personal</span>
        )}
      </div>
      {!compact && (
        <>
          <div className="meta">
            {appt.service} · {appt.owner}
          </div>
          <div
            className="mt-1 flex items-center justify-between gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass(appt.status)}`}
            >
              {appt.status}
            </span>
            {/* RowActions (paridad OperaOS). Los eventos importados de Google no
                tienen fila en BD: sin acciones (se editan en Google Calendar). */}
            {!isGoogle && (
              <div className="flex gap-2 text-xs font-semibold text-slate-400">
                <button
                  type="button"
                  className="transition hover:text-white"
                  onClick={onEdit}
                  data-testid="agenda-card-edit"
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="transition hover:text-red-400"
                  onClick={onDelete}
                  data-testid="agenda-card-delete"
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function AgendaPage() {
  const [appointments, setAppointments] = useState<DemoAppointment[]>([]);
  const appointmentsRef = useRef(appointments);
  appointmentsRef.current = appointments;
  // Marca si la vista sigue sobre el fallback demo o ya carga citas reales del tenant
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeModalAppointment, setActiveModalAppointment] = useState<DemoAppointment | null>(null);
  const [clienteFicha, setClienteFicha] = useState<DemoAppointment | null>(null);
  // Cita pendiente de confirmar borrado desde RowActions de la tarjeta.
  const [deletingAppt, setDeletingAppt] = useState<DemoAppointment | null>(null);
  // "Editar" de la tarjeta abre el detalle directamente en modo edición.
  const [detailStartEditing, setDetailStartEditing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [calendarSynced, setCalendarSynced] = useState(false);
  const [calendarLabel, setCalendarLabel] = useState<string | null>(null);
  const [googleEvents, setGoogleEvents] = useState<DemoAppointment[]>([]);
  const [calendarRefreshTick, setCalendarRefreshTick] = useState(0);
  // Día seleccionado en el grid (default de fecha del modal de alta). El grid
  // gobierna su propio cursor; aquí solo se refleja la selección del usuario.
  const [selectedDate, setSelectedDate] = useState("");
  // Rango visible [from, to] que reporta AgendaGrid tras navegar/cambiar vista;
  // escopa el import de eventos de Google Calendar (con margen de una semana).
  const [visibleRange, setVisibleRange] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    // "Hoy" real solo en cliente (anti mismatch de hidratación): coincide con
    // la selección inicial de AgendaGrid, que también se resuelve al montar.
    const now = new Date();
    setSelectedDate(dateKey(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  useEffect(() => {
    async function loadAppointments() {
      const token = await getToken();
      if (!token) {
        // Sin sesión: modo demostración explícito (aviso visible en cabecera),
        // no se confunde con datos reales del tenant.
        setAppointments(DEMO_APPOINTMENTS);
        setUsingDemoData(true);
        setLoading(false);
        return;
      }
      try {
        // Reservas de clientes (booking widget) + citas manuales del owner
        // (aa-agenda-google-import) — dos tablas distintas, misma lista.
        const [bookingData, manualData] = await Promise.all([
          api<any[]>("/api/booking/appointments").catch(() => []),
          api<any[]>("/api/agenda/appointments").catch(() => []),
        ]);
        // Coerción defensiva: si un endpoint no devuelve array (respuesta vacía
        // o inesperada) no rompemos el merge ni caemos a un error espurio.
        const asArray = (value: unknown) => (Array.isArray(value) ? value : []);
        const merged = [...asArray(bookingData), ...asArray(manualData)];
        setAppointments(merged);
        setUsingDemoData(false);
      } catch (err) {
        // Con sesión pero fallo real de carga: estado de error explícito, nunca
        // datos demo silenciosos (evita "citas fantasma" indistinguibles).
        console.error("Error cargando citas de la agenda:", err);
        setAppointments([]);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    loadAppointments();
  }, []);

  useEffect(() => {
    // Estado de conexión a nivel plataforma (AA single-tenant, una sola cuenta
    // Google — aa-agenda-google-import). Sin resolución por agente.
    async function loadCalendarStatus() {
      const token = await getToken();
      if (!token) return;
      try {
        const data = await api<{ connected: boolean; accountLabel: string | null }>(
          "/api/calendar/status",
        );
        setCalendarSynced(data.connected);
        setCalendarLabel(data.accountLabel);
      } catch (err) {
        console.error("Error cargando estado de Google Calendar:", err);
      }
    }
    loadCalendarStatus();
  }, []);

  useEffect(() => {
    // Import de eventos del Calendar del owner para el rango visible del grid
    // (con margen de una semana a cada lado, cubre transiciones de vista).
    if (!calendarSynced || !visibleRange) return;
    async function loadGoogleEvents() {
      if (!visibleRange) return;
      try {
        const fromDate = parseDate(visibleRange.from);
        fromDate.setDate(fromDate.getDate() - 7);
        const toDate = parseDate(visibleRange.to);
        toDate.setDate(toDate.getDate() + 8);
        const from = fromDate.toISOString();
        const to = toDate.toISOString();
        const data = await api<{
          events: { id: string; title: string; start: string; end: string; allDay: boolean }[];
        }>(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        // Evitar duplicados: las citas manuales ya replicadas en Google
        // (gcalEventId) se pintan como cita de AA, no otra vez como evento importado.
        const knownGcalIds = new Set(
          appointmentsRef.current.map((a) => a.gcalEventId).filter(Boolean),
        );
        setGoogleEvents(
          (data.events ?? [])
            .filter((e) => !knownGcalIds.has(e.id))
            .map((e) => {
              const start = new Date(e.start);
              return {
                id: `gcal-${e.id}`,
                date: e.allDay
                  ? e.start.slice(0, 10)
                  : dateKey(start.getFullYear(), start.getMonth(), start.getDate()),
                time: e.allDay
                  ? "00:00"
                  : `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
                client: e.title,
                service: "Google Calendar",
                owner: calendarLabel ?? "Google",
                status: "Confirmada" as const,
                source: "google" as const,
              };
            }),
        );
      } catch (err) {
        // Degradación amable: la agenda sigue mostrando las citas de AA
        console.error("Error cargando eventos de Google Calendar:", err);
      }
    }
    loadGoogleEvents();
  }, [calendarSynced, calendarLabel, visibleRange, calendarRefreshTick]);

  // Citas de AA + eventos importados del Google Calendar del owner
  const allEntries = [...appointments, ...googleEvents];

  const addAppointment = async (appt: DemoAppointment): Promise<boolean> => {
    // Persiste siempre en PlatformAppointment (BD); el back además la replica
    // en Google si el Calendar de plataforma está conectado (gcalEventId).
    // Devuelve true/false para que el modal decida si cerrar o mostrar error:
    // en fallo NO se añade la cita localmente (evita citas fantasma sin BD)
    // y NO se cierra el modal (T5: mantener datos y avisar del error).
    try {
      // El POST del back NO acepta `status` en el body (agenda-appointments.ts):
      // la cita nace con el default de BD ("Confirmada"). Se omite del payload.
      let created = await api<DemoAppointment>("/api/agenda/appointments", {
        method: "POST",
        body: JSON.stringify({
          date: appt.date,
          time: appt.time,
          client: appt.client,
          service: appt.service,
          notes: appt.notes,
          email: appt.email,
          phone: appt.phone,
        }),
      });
      // Si el usuario eligió un estado distinto al que fijó el back, se alinea
      // con un PATCH inmediato (el PATCH sí acepta `status`; backend intacto).
      if (appt.status && created.status !== appt.status) {
        try {
          const updated = await api<DemoAppointment>(
            `/api/agenda/appointments/${created.id}`,
            { method: "PATCH", body: JSON.stringify({ status: appt.status }) },
          );
          created = { ...created, ...updated };
        } catch (e) {
          // La cita ya existe en BD: no se falla el alta; la UI muestra el
          // estado realmente persistido (nunca el optimista).
          console.error("[agenda] cita creada pero sin ajustar estado:", e);
        }
      }
      setAppointments((prev) => [...prev, created]);
      if (created.gcalEventId) setCalendarRefreshTick((t) => t + 1);
    } catch (e) {
      console.error("[agenda] no se pudo guardar la cita:", e);
      return false;
    }
    // Éxito de esta ocurrencia: NO cerramos aquí. El modal decide cuándo cerrar
    // (recurrencia: tras crear todas las ocurrencias; puntual: al terminar). Devuelve
    // true para que el modal cuente el éxito. El grid conserva su selección.
    return true;
  };

  const patchAppointment = async (
    id: string,
    patch: Partial<Pick<DemoAppointment, "date" | "time" | "client" | "service" | "notes" | "status" | "email" | "phone">>,
  ): Promise<DemoAppointment | null> => {
    // Actualización parcial vía PATCH. El estado local se alimenta SIEMPRE de
    // la respuesta del back (no del payload optimista): si la llamada falla
    // devolvemos null y la UI conserva los datos persistidos, sin desincronizar.
    try {
      const updated = await api<DemoAppointment>(`/api/agenda/appointments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...updated } : a)));
      // El modal abierto refleja la cita actualizada sin cerrarse.
      setActiveModalAppointment((prev) =>
        prev && prev.id === id ? { ...prev, ...updated } : prev,
      );
      return updated;
    } catch (e) {
      console.error("[agenda] no se pudo actualizar la cita:", e);
      return null;
    }
  };

  const deleteAppointment = async (id: string): Promise<boolean> => {
    // Hard-delete real: en éxito la cita sale de la lista y el modal se
    // cierra; en fallo la cita se conserva y el modal muestra el error.
    try {
      await api(`/api/agenda/appointments/${id}`, { method: "DELETE" });
      setAppointments((prev) => prev.filter((a) => a.id !== id));
      setActiveModalAppointment(null);
      return true;
    } catch (e) {
      console.error("[agenda] no se pudo eliminar la cita:", e);
      return false;
    }
  };

  // Eliminar desde RowActions de la tarjeta (sin pasar por el detalle): abre
  // el modal de confirmación; el borrado real ocurre al confirmar.
  const deleteFromCard = (appt: DemoAppointment) => {
    setDeletingAppt(appt);
  };

  // h-full: recibe la altura real de <main> (flex-1 en AppShell) y se la pasa
  // al shell (.panel-fill-equivalente) para que el calendario ocupe el espacio
  // disponible, igual que /citas en OperaOS.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className={agendaStyles.shell}>
        <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[var(--accent-1)]/20 blur-[90px]" />
        <div className="pointer-events-none absolute bottom-8 left-1/2 h-60 w-60 rounded-full bg-[var(--accent-2)]/10 blur-[80px]" />

        <AgendaHeader
          onAddTask={() => setShowCreateModal(true)}
          showDemoNotice={usingDemoData}
          calendarSynced={calendarSynced}
          calendarLabel={calendarLabel}
          onDisconnectCalendar={async () => {
            try {
              await api("/api/calendar/status", { method: "DELETE" });
            } catch (e) {
              console.error("[agenda] error desconectando Google Calendar:", e);
            }
            setCalendarSynced(false);
            setCalendarLabel(null);
            setGoogleEvents([]);
          }}
        />

        {loadError && (
          <div
            data-testid="agenda-error"
            className="relative z-10 mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300"
          >
            No se pudieron cargar las citas. Reintenta más tarde.
          </div>
        )}

        {loading ? (
          <div
            data-testid="agenda-loading"
            className="relative z-10 flex flex-1 items-center justify-center py-20 text-sm text-slate-400"
          >
            Cargando agenda…
          </div>
        ) : (
          <div className="relative z-10 min-h-0 flex-1">
            {/* Motor de calendario OperaOS: mes/semana/día + panel del día
                (sidePanel). La vista día es el hour-grid puro (paridad OperaOS:
                sin day-list); el panel lateral vive en mes/semana. */}
            <AgendaGrid<DemoAppointment>
              items={allEntries}
              getKey={(a) => a.id}
              emptyLabel="Sin citas este día."
              sidePanel
              onSelectedChange={setSelectedDate}
              onRangeChange={(from, to) =>
                setVisibleRange((prev) =>
                  prev?.from === from && prev?.to === to ? prev : { from, to },
                )
              }
              renderCard={(appt, { compact }) => (
                <CitaAgendaCard
                  appt={appt}
                  compact={compact}
                  onOpenDetalle={() => {
                    setDetailStartEditing(false);
                    setActiveModalAppointment(appt);
                  }}
                  onOpenFicha={() => setClienteFicha(appt)}
                  // "Editar" de RowActions: mismo modal, directo al modo edición.
                  onEdit={() => {
                    setDetailStartEditing(true);
                    setActiveModalAppointment(appt);
                  }}
                  onDelete={() => void deleteFromCard(appt)}
                />
              )}
            />
          </div>
        )}
      </section>

      {/* Detalle de cita estilo OperaOS (P5): ficha dl/dt/dd + mapa embed de
          Google + anotaciones + edición inline + cambio de estado + borrado. */}
      {activeModalAppointment && (
        <CitaDetalleModal
          key={activeModalAppointment.id}
          appointment={activeModalAppointment}
          initialEditing={detailStartEditing}
          onClose={() => setActiveModalAppointment(null)}
          onPatch={patchAppointment}
          existingAppointments={appointments}
        />
      )}

      {clienteFicha && (
        <ClienteInfoModal appointment={clienteFicha} onClose={() => setClienteFicha(null)} />
      )}

      {/* Confirmación de borrado desde RowActions de la tarjeta (sustituye al
          window.confirm nativo). El DELETE real ocurre al confirmar. */}
      {deletingAppt && (
        <div
          className="opera-modal-backdrop"
          data-testid="agenda-delete-confirm"
          onClick={() => setDeletingAppt(null)}
        >
          <div className="opera-modal" onClick={(e) => e.stopPropagation()}>
            <div className="opera-modal-header">
              <h3 className="opera-modal-title">Eliminar cita</h3>
            </div>
            <div className="opera-modal-body">
              <p className="text-sm text-white">
                ¿Eliminar esta cita? Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="opera-modal-foot">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setDeletingAppt(null)}
                data-testid="agenda-delete-cancel"
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-outline text-red-300 hover:text-red-200"
                onClick={async () => {
                  await deleteAppointment(deletingAppt.id);
                  setDeletingAppt(null);
                }}
                data-testid="agenda-delete-confirm-btn"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de alta estilo OperaOS (P4): validación de obligatorios antes
          del POST, error sin cerrar en fallo, cierre gestionado por el padre. */}
      {showCreateModal && (
        <NuevaCitaModal
          defaultDate={selectedDate}
          onClose={() => setShowCreateModal(false)}
          onSave={addAppointment}
          existingAppointments={appointments}
        />
      )}
    </div>
  );
}

function AgendaHeader({
  onAddTask,
  showDemoNotice,
  calendarSynced,
  calendarLabel,
  onDisconnectCalendar,
}: {
  onAddTask: () => void;
  showDemoNotice: boolean;
  calendarSynced: boolean;
  calendarLabel: string | null;
  onDisconnectCalendar: () => void;
}) {
  return (
    <header className="relative z-10 mb-5 flex flex-none flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="kicker mb-2 text-neon-cyan">Área de Trabajo</div>
        <h1 className="text-4xl font-black tracking-tight text-white md:text-5xl">Agenda</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Vista operativa basada en la gramática de OperaOS.
          {/* Aviso demo solo mientras la vista usa el fallback DEMO_APPOINTMENTS */}
          {showDemoNotice && " Los datos son demostrativos hasta conectar citas reales del tenant."}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {calendarSynced ? (
          <button
            type="button"
            onClick={onDisconnectCalendar}
            className="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/20"
            data-testid="agenda-calendar-synced"
            title={calendarLabel ?? undefined}
          >
            ✕ Cancelar sincronización
          </button>
        ) : (
          <button
            type="button"
            onClick={async () => {
              // La navegación directa a /api/oauth/google no lleva Bearer y el
              // gate la corta con 401; se pide la URL autenticado y se navega.
              // Sin agentId: el back lo resuelve (AA single-tenant).
              try {
                const { url } = await api<{ url: string }>("/api/oauth/platform/google/url");
                window.location.href = url;
              } catch (err) {
                console.error("Error iniciando OAuth de Google Calendar:", err);
              }
            }}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-[var(--accent-1)] hover:text-white"
            data-testid="agenda-sync-calendar-btn"
          >
            📅 Sincronizar Calendar
          </button>
        )}

        <button
          type="button"
          className={`${agendaStyles.periodButton} flex items-center gap-1.5 text-xs font-bold`}
          onClick={onAddTask}
          data-testid="agenda-add-task-btn"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
          </svg>
          Añadir
        </button>
      </div>
    </header>
  );
}

