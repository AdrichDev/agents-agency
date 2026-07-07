export type AgendaView = "month" | "week" | "day";

export type DemoAppointment = {
  id: string;
  date: string;
  time: string;
  client: string;
  service: string;
  owner: string;
  status: "Confirmada" | "Pendiente" | "Completada" | "Cancelada";
  /** Origen del evento: los importados de Google Calendar se pintan distinto */
  source?: "google";
  phone?: string;
  email?: string;
  notes?: string;
  /** Id del evento replicado en Google (si el Calendar de plataforma estaba conectado al crearla) */
  gcalEventId?: string;
  contactSummary?: {
    commercialName: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
  };
};

export type CalendarCell = {
  date: string;
  day: number;
};

export const VIEWS: { id: AgendaView; label: string }[] = [
  { id: "month", label: "Mes" },
  { id: "week", label: "Semana" },
  { id: "day", label: "Día" },
];

export const WEEK_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const WEEK_DAYS_FULL = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
export const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
export const MONTHS_ABBR = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

export const DEMO_TODAY = "2026-07-05";

export const DEMO_APPOINTMENTS: DemoAppointment[] = [
  {
    id: "aa-001",
    date: "2026-07-05",
    time: "09:30",
    client: "Clínica Norte",
    service: "Revisión de automatización",
    owner: "Ariadna",
    status: "Confirmada",
    notes: "Revisar logs de WhatsApp y webhook de Telegram.",
    contactSummary: {
      commercialName: "Clínica Norte S.L.",
      contactPerson: "Dra. Elisa Martínez",
      phone: "+34 600 111 222",
      address: "Paseo de la Castellana 45, Madrid",
    },
  },
  {
    id: "aa-002",
    date: "2026-07-05",
    time: "12:00",
    client: "Innova Legal",
    service: "Onboarding de agente",
    owner: "Mateo",
    status: "Pendiente",
    notes: "Llamada inicial de presentación.",
    contactSummary: {
      commercialName: "Innova Legal",
      contactPerson: "Juan Gómez",
      phone: "+34 600 333 444",
      address: "", // sin dirección
    },
  },
  {
    id: "aa-003",
    date: "2026-07-07",
    time: "16:30",
    client: "Estudio Prisma",
    service: "Seguimiento comercial",
    owner: "Lara",
    status: "Completada",
  },
  {
    id: "aa-004",
    date: "2026-07-10",
    time: "10:00",
    client: "Blue Orbit",
    service: "Demo de Telegram UI",
    owner: "Noa",
    status: "Confirmada",
  },
  {
    id: "aa-005",
    date: "2026-07-15",
    time: "18:00",
    client: "Mercurio Labs",
    service: "Replanificación",
    owner: "Irene",
    status: "Cancelada",
  },
];

const DEFAULT_HOUR_MIN = 7;
const DEFAULT_HOUR_MAX = 22;

export const agendaStyles = {
  // h-full + min-h-0 + flex-1 (paridad con .panel-fill de OperaOS): el shell
  // absorbe TODA la altura que le pasa el layout (AppShell > <main> flex-1),
  // en vez de un min-height fijo que dejaba el calendario pequeño con hueco
  // libre debajo (bug reportado: /agenda mucho más chico que /citas).
  shell:
    "relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[color-mix(in_srgb,var(--panel),#ffffff_2%)] p-5 shadow-2xl md:p-7",
  periodButton:
    "rounded-xl border border-white/10 px-3 py-2 transition hover:border-[var(--accent-1)] hover:bg-white/5",
  periodLabel:
    "min-w-56 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-center capitalize",
  viewToggle: "ml-0 flex gap-1 rounded-2xl border border-white/10 bg-black/30 p-1 lg:ml-2",
  calendarPanel: "flex min-h-[520px] flex-col rounded-3xl border border-white/10 bg-black/30 p-4",
  dayPanel:
    "flex min-h-0 flex-col rounded-3xl border border-[color-mix(in_srgb,var(--accent-1),transparent_60%)] bg-black/30 p-4",
  emptyState:
    "rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500",
} as const;

export function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function buildMonthCells(year: number, month: number): (CalendarCell | null)[] {
  const first = new Date(year, month, 1);
  const firstMondayIndex = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (CalendarCell | null)[] = [];

  for (let i = 0; i < firstMondayIndex; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: dateKey(year, month, day), day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

export function buildWeekCells(cursor: Date): CalendarCell[] {
  const monday = new Date(cursor);
  monday.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return {
      date: dateKey(date.getFullYear(), date.getMonth(), date.getDate()),
      day: date.getDate(),
    };
  });
}

/** Celda de un único día (vista día del AgendaGrid). */
export function buildDayCell(date: Date): CalendarCell {
  return {
    date: dateKey(date.getFullYear(), date.getMonth(), date.getDate()),
    day: date.getDate(),
  };
}

// Firma ampliada a `{ time }` genérico: la usa AgendaGrid<T> además de la page.
export function buildHours(events: Array<{ time: string }>) {
  let min = DEFAULT_HOUR_MIN;
  let max = DEFAULT_HOUR_MAX;

  for (const event of events) {
    const hour = Number.parseInt(event.time.slice(0, 2), 10);
    if (Number.isNaN(hour)) continue;
    min = Math.min(min, hour);
    max = Math.max(max, hour);
  }

  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

export function periodLabel(view: AgendaView, cursor: Date, week: CalendarCell[]) {
  if (view === "month") return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  if (view === "day") {
    const weekday = WEEK_DAYS_FULL[(cursor.getDay() + 6) % 7];
    return `${weekday} ${cursor.getDate()} de ${MONTHS[cursor.getMonth()]}`;
  }

  const start = parseDate(week[0].date);
  const end = parseDate(week[6].date);
  const sameMonth = start.getMonth() === end.getMonth();

  return sameMonth
    ? `${start.getDate()}–${end.getDate()} ${MONTHS_ABBR[start.getMonth()]} ${end.getFullYear()}`
    : `${start.getDate()} ${MONTHS_ABBR[start.getMonth()]} – ${end.getDate()} ${MONTHS_ABBR[end.getMonth()]} ${end.getFullYear()}`;
}

export function statusTone(status: DemoAppointment["status"]) {
  if (status === "Completada") return "border-l-sky-400";
  if (status === "Cancelada") return "border-l-rose-500";
  if (status === "Pendiente") return "border-l-amber-400";
  return "border-l-[var(--accent-1)]";
}

export function countAppointmentsByDay(appointments: DemoAppointment[]) {
  const map = new Map<string, number>();
  for (const appointment of appointments) {
    map.set(appointment.date, (map.get(appointment.date) ?? 0) + 1);
  }
  return map;
}

export function appointmentsForDate(appointments: DemoAppointment[], date: string) {
  return appointments
    .filter((appointment) => appointment.date === date)
    .sort((a, b) => a.time.localeCompare(b.time));
}
