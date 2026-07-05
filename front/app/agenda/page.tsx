"use client";

import { useEffect, useMemo, useState } from "react";
import { api, getToken } from "@/lib/api";

import {
  DEMO_APPOINTMENTS,
  DEMO_TODAY,
  VIEWS,
  WEEK_DAYS,
  agendaStyles,
  appointmentsForDate,
  buildHours,
  buildMonthCells,
  buildWeekCells,
  countAppointmentsByDay,
  dateKey,
  parseDate,
  periodLabel,
  statusTone,
  type AgendaView,
  type CalendarCell,
  type DemoAppointment,
} from "@/components/agenda/agenda-fullscreen";

export default function AgendaPage() {
  const [view, setView] = useState<AgendaView>("month");
  const [cursor, setCursor] = useState(() => parseDate(DEMO_TODAY));
  const [appointments, setAppointments] = useState<DemoAppointment[]>(DEMO_APPOINTMENTS);
  const [loading, setLoading] = useState(true);
  const [activeModalAppointment, setActiveModalAppointment] = useState<DemoAppointment | null>(null);

  const selectedDate = useMemo(
    () => dateKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
    [cursor],
  );

  useEffect(() => {
    async function loadAppointments() {
      const token = await getToken();
      if (!token) {
        setAppointments(DEMO_APPOINTMENTS);
        setLoading(false);
        return;
      }
      try {
        const data = await api<any[]>("/api/booking/appointments");
        if (data && Array.isArray(data)) {
          setAppointments(data);
        }
      } catch (err) {
        console.error("Error cargando citas de la agenda:", err);
        setAppointments(DEMO_APPOINTMENTS);
      } finally {
        setLoading(false);
      }
    }
    loadAppointments();
  }, []);

  const weekCells = useMemo(() => buildWeekCells(cursor), [cursor]);
  const monthCells = useMemo(
    () => buildMonthCells(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const appointmentCountByDay = useMemo(
    () => countAppointmentsByDay(appointments),
    [appointments],
  );
  const selectedAppointments = useMemo(
    () => appointmentsForDate(appointments, selectedDate),
    [appointments, selectedDate],
  );

  const navigate = (delta: number) => {
    setCursor((current) => {
      const next = new Date(current);
      if (view === "month") next.setMonth(next.getMonth() + delta);
      if (view === "week") next.setDate(next.getDate() + delta * 7);
      if (view === "day") next.setDate(next.getDate() + delta);
      return next;
    });
  };

  const changeView = (nextView: AgendaView) => {
    setView(nextView);
  };

  const selectDate = (date: string) => {
    setCursor(parseDate(date));
  };

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <section className={agendaStyles.shell}>
        <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[var(--accent-1)]/20 blur-[90px]" />
        <div className="pointer-events-none absolute bottom-8 left-1/2 h-60 w-60 rounded-full bg-[var(--accent-2)]/10 blur-[80px]" />

        <AgendaHeader
          cursor={cursor}
          onNavigate={navigate}
          onViewChange={changeView}
          view={view}
          weekCells={weekCells}
        />

        <div className="relative z-10 grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
          <div className={agendaStyles.calendarPanel}>
            {view === "month" && (
              <MonthView
                appointmentCountByDay={appointmentCountByDay}
                cells={monthCells}
                onSelectDate={selectDate}
                selectedDate={selectedDate}
              />
            )}

            {view === "week" && (
              <WeekView
                cells={weekCells}
                onSelectDate={selectDate}
                selectedDate={selectedDate}
                appointments={appointments}
                onSelectAppointment={setActiveModalAppointment}
              />
            )}

            {view === "day" && (
              <DayView
                appointments={selectedAppointments}
                onSelectAppointment={setActiveModalAppointment}
              />
            )}
          </div>

          <SelectedDayPanel
            appointments={selectedAppointments}
            selectedDate={selectedDate}
            onSelectAppointment={setActiveModalAppointment}
          />
        </div>
      </section>

      {activeModalAppointment && (
        <DetailModal
          appointment={activeModalAppointment}
          onClose={() => setActiveModalAppointment(null)}
        />
      )}
    </div>
  );
}

function AgendaHeader({
  cursor,
  onNavigate,
  onViewChange,
  view,
  weekCells,
}: {
  cursor: Date;
  onNavigate: (delta: number) => void;
  onViewChange: (view: AgendaView) => void;
  view: AgendaView;
  weekCells: CalendarCell[];
}) {
  return (
    <header className="relative z-10 mb-5 flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="kicker mb-2 text-neon-cyan">Área de Trabajo</div>
        <h1 className="text-4xl font-black tracking-tight text-white md:text-5xl">Agenda</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Vista operativa basada en la gramática de OperaOS. Los datos son demostrativos hasta
          conectar citas reales del tenant.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-200">
        <button
          type="button"
          className={agendaStyles.periodButton}
          aria-label="Periodo anterior"
          onClick={() => onNavigate(-1)}
        >
          &lt;
        </button>
        <span className={agendaStyles.periodLabel} data-testid="agenda-period-label">
          {periodLabel(view, cursor, weekCells)}
        </span>
        <button
          type="button"
          className={agendaStyles.periodButton}
          aria-label="Periodo siguiente"
          onClick={() => onNavigate(1)}
        >
          &gt;
        </button>

        <div className={agendaStyles.viewToggle}>
          {VIEWS.map((agendaView) => (
            <button
              key={agendaView.id}
              type="button"
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                view === agendaView.id
                  ? "bg-accent-gradient text-white shadow-lg shadow-indigo-950/30"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
              aria-pressed={view === agendaView.id}
              onClick={() => onViewChange(agendaView.id)}
            >
              {agendaView.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function MonthView({
  appointmentCountByDay,
  cells,
  onSelectDate,
  selectedDate,
}: {
  appointmentCountByDay: Map<string, number>;
  cells: (CalendarCell | null)[];
  onSelectDate: (date: string) => void;
  selectedDate: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agenda-month-view">
      <div className="mb-3 grid grid-cols-7 text-center text-xs font-black uppercase tracking-[0.14em] text-slate-500">
        {WEEK_DAYS.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 gap-1.5" data-testid="agenda-calendar-grid">
        {cells.map((cell, index) => {
          if (!cell) {
            return <div key={`empty-${index}`} className="rounded-xl border border-transparent" />;
          }

          const eventCount = appointmentCountByDay.get(cell.date) ?? 0;
          const isSelected = selectedDate === cell.date;
          const isToday = DEMO_TODAY === cell.date;

          return (
            <button
              key={cell.date}
              type="button"
              className={`relative flex min-h-16 flex-col items-center justify-center rounded-xl border text-sm transition ${
                isSelected
                  ? "border-[var(--accent-1)] bg-[color-mix(in_srgb,var(--accent-1),transparent_78%)] font-black text-white"
                  : "border-transparent bg-white/[0.03] text-slate-300 hover:border-[color-mix(in_srgb,var(--accent-1),transparent_65%)] hover:bg-white/[0.06]"
              } ${isToday ? "shadow-[inset_0_0_0_2px_var(--accent-1)]" : ""}`}
              aria-label={`Seleccionar ${cell.date}`}
              onClick={() => onSelectDate(cell.date)}
            >
              <span>{cell.day}</span>
              {eventCount > 0 && (
                <span className="absolute bottom-2 h-1.5 w-1.5 rounded-full bg-[var(--accent-2)] shadow-[0_0_10px_var(--accent-2)]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  cells,
  onSelectDate,
  selectedDate,
  appointments,
  onSelectAppointment,
}: {
  cells: CalendarCell[];
  onSelectDate: (date: string) => void;
  selectedDate: string;
  appointments: DemoAppointment[];
  onSelectAppointment: (app: DemoAppointment) => void;
}) {
  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-7"
      data-testid="agenda-week-view"
    >
      {cells.map((cell, index) => {
        const events = appointmentsForDate(appointments, cell.date);
        const isSelected = selectedDate === cell.date;

        return (
          <button
            key={cell.date}
            type="button"
            className={`flex min-h-40 min-w-0 flex-col rounded-2xl border bg-white/[0.03] text-left transition hover:border-[var(--accent-1)] ${
              isSelected ? "border-[var(--accent-1)]" : "border-white/10"
            }`}
            data-testid="agenda-week-day"
            onClick={() => onSelectDate(cell.date)}
          >
            <div className="border-b border-white/10 p-3 text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                {WEEK_DAYS[index]}
              </div>
              <div className="text-xl font-black text-white">{cell.day}</div>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {events.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  compact
                  onClick={() => onSelectAppointment(appointment)}
                />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DayView({
  appointments,
  onSelectAppointment,
}: {
  appointments: DemoAppointment[];
  onSelectAppointment: (app: DemoAppointment) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-2" data-testid="agenda-day-view">
      {buildHours(appointments).map((hour) => {
        const events = appointments.filter(
          (appointment) => Number.parseInt(appointment.time.slice(0, 2), 10) === hour,
        );

        return (
          <div
            key={hour}
            className="grid min-h-14 grid-cols-[4rem_minmax(0,1fr)] gap-3 border-t border-white/10 py-2 first:border-t-0"
          >
            <div className="pt-2 text-xs font-semibold text-slate-500">
              {String(hour).padStart(2, "0")}:00
            </div>
            <div className="flex flex-col gap-2">
              {events.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  compact
                  onClick={() => onSelectAppointment(appointment)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SelectedDayPanel({
  appointments,
  selectedDate,
  onSelectAppointment,
}: {
  appointments: DemoAppointment[];
  selectedDate: string;
  onSelectAppointment: (app: DemoAppointment) => void;
}) {
  return (
    <aside className={agendaStyles.dayPanel} data-testid="agenda-day-list">
      <div className="mb-4 border-b border-white/10 pb-3">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
          Citas del día
        </div>
        <h2 className="mt-1 text-xl font-black text-white">
          {selectedDate.split("-").reverse().join("/")}
        </h2>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {appointments.length === 0 ? (
          <p className={agendaStyles.emptyState}>Sin citas este día.</p>
        ) : (
          appointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              onClick={() => onSelectAppointment(appointment)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function AppointmentCard({
  appointment,
  compact = false,
  onClick,
}: {
  appointment: DemoAppointment;
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <article
      onClick={onClick}
      className={`cursor-pointer rounded-2xl border border-white/10 bg-white/[0.05] transition hover:bg-[color-mix(in_srgb,var(--accent-1),transparent_88%)] ${statusTone(
        appointment.status,
      )} border-l-4 ${compact ? "p-3" : "p-4"}`}
      data-testid="agenda-event-card"
    >
      <div className={`font-black text-[var(--accent-1)] ${compact ? "text-sm" : "text-lg"}`}>
        {appointment.time}
      </div>
      <div className={`font-bold text-white ${compact ? "truncate text-sm" : ""}`}>
        {appointment.client}
      </div>
      <div className={`${compact ? "text-xs" : "text-sm"} text-slate-500`}>
        {appointment.service} · {appointment.owner} · {appointment.status}
      </div>
    </article>
  );
}

interface DetailModalProps {
  appointment: any;
  onClose: () => void;
}

function DetailModal({ appointment, onClose }: DetailModalProps) {
  const summary = appointment.contactSummary || {
    commercialName: appointment.client,
  };

  const address = summary.address;
  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : "#";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      data-testid="agenda-detail-modal"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0c10]/95 p-6 shadow-2xl md:p-8 animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes scaleUp {
            from { transform: scale(0.95); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
          .animate-fade-in {
            animation: fadeIn 0.2s ease-out forwards;
          }
          .animate-scale-up {
            animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
        `}} />
        
        {/* Glow effect */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[var(--accent-1)]/25 blur-[50px]" />
        
        {/* Header */}
        <div className="mb-6 flex items-start justify-between border-b border-white/10 pb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Detalle de la Cita
            </span>
            <h3 className="mt-1 text-2xl font-black text-white" data-testid="modal-commercial-name">
              {summary.commercialName}
            </h3>
          </div>
          <button
            type="button"
            className="rounded-xl border border-white/10 p-2 text-slate-400 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
            onClick={onClose}
            data-testid="modal-close-button"
            aria-label="Cerrar modal"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6">
          {/* Seccion 1: Datos de Contacto Enriquecidos */}
          <div>
            <h4 className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400 mb-3">
              Información de Contacto
            </h4>
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Contacto</span>
                <span className="font-semibold text-slate-200" data-testid="modal-contact-person">
                  {summary.contactPerson || "No especificado"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Teléfono</span>
                <span className="font-semibold text-slate-200" data-testid="modal-phone">
                  {summary.phone || appointment.phone || "No especificado"}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-slate-500">Dirección</span>
                <span className="font-semibold text-slate-200" data-testid="modal-address">
                  {address || "Sin dirección física"}
                </span>
              </div>
            </div>
          </div>

          {/* Seccion 2: Datos actuales de la cita */}
          <div>
            <h4 className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400 mb-3">
              Datos de la Reserva
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <div className="text-xs text-slate-500">Fecha y Hora</div>
                <div className="mt-1 font-bold text-[var(--accent-1)]">
                  {appointment.date.split("-").reverse().join("/")} a las {appointment.time}
                </div>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <div className="text-xs text-slate-500">Estado</div>
                <div className="mt-1 font-bold text-slate-200">
                  <span className={`inline-block h-2 w-2 rounded-full mr-2 ${
                    appointment.status === "Completada" ? "bg-sky-400" :
                    appointment.status === "Cancelada" ? "bg-rose-500" :
                    appointment.status === "Pendiente" ? "bg-amber-400" :
                    "bg-[var(--accent-1)]"
                  }`} />
                  {appointment.status}
                </div>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <div className="text-xs text-slate-500">Servicio</div>
                <div className="mt-1 font-bold text-slate-200 truncate" title={appointment.service}>
                  {appointment.service}
                </div>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <div className="text-xs text-slate-500">Agente Responsable</div>
                <div className="mt-1 font-bold text-slate-200 truncate" title={appointment.owner}>
                  {appointment.owner}
                </div>
              </div>
            </div>
          </div>

          {/* Seccion 3: Anotaciones */}
          <div>
            <h4 className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400 mb-2">
              Anotaciones
            </h4>
            <p className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-sm text-slate-300 min-h-[60px]" data-testid="modal-notes">
              {appointment.notes || "Sin anotaciones adicionales."}
            </p>
          </div>

          {/* Seccion 4: Acciones - Ubicación */}
          <div className="pt-2">
            {address ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-gradient py-3 text-sm font-bold text-white shadow-lg shadow-indigo-950/30 transition hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                data-testid="location-button"
              >
                <span>📍</span> Ubicación en Google Maps
              </a>
            ) : (
              <button
                type="button"
                className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-white/5 bg-white/[0.02] py-3 text-sm font-bold text-slate-600"
                disabled
                data-testid="location-button"
              >
                <span>📍</span> Ubicación (sin dirección)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
