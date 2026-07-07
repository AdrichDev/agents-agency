"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildDayCell,
  buildHours,
  buildMonthCells,
  buildWeekCells,
  dateKey,
  parseDate,
  periodLabel,
  VIEWS,
  WEEK_DAYS,
  type AgendaView,
  type CalendarCell,
} from "./agenda-fullscreen";

/**
 * Motor de calendario genérico portado 1:1 de OperaOS
 * (creador_CRM/front/components/panel/widgets/agenda-grid.tsx), adaptado a las
 * convenciones de AA: identificadores en inglés (`date`/`time`, vistas
 * month/week/day) y utilidades reutilizadas de `agenda-fullscreen.ts`.
 * La grilla solo resuelve navegación mes/semana/día y layout; cada consumidor
 * controla sus datos y el contenido de cada tarjeta (`renderCard`).
 */

/** Contrato mínimo de un item de agenda. */
export interface AgendaGridItem {
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm'
}

export interface AgendaGridProps<T extends AgendaGridItem> {
  items: T[];
  /** Mensaje cuando el día seleccionado no tiene eventos. */
  emptyLabel: string;
  getKey: (item: T) => string | number;
  /** Tarjeta completa del evento; `compact` indica vista semana/día. */
  renderCard: (item: T, ctx: { compact: boolean }) => ReactNode;
  /** Solo para tests: fija la fecha inicial en vez de `new Date()`. */
  initialDate?: Date;
  onSelectedChange?: (date: string) => void;
  /** Rango de fechas visible [from, to] inclusivo tras cada navegación o cambio
   * de vista. En AA la page trae todas las citas de una (sin paginación
   * server-side), así que hoy nadie lo cablea a la API — queda como punto de
   * extensión para un futuro fetch escopado por rango (patrón OperaOS). */
  onRangeChange?: (from: string, to: string) => void;
  /** Panel lateral con TODAS las citas del día seleccionado, a la derecha del
   * calendario en vista mes/semana (paridad con /citas de OperaOS). */
  sidePanel?: boolean;
}

/** Panel lateral "Citas del día" (paridad con DiaPanel de OperaOS). */
function DiaPanel<T extends AgendaGridItem>({ selected, events, emptyLabel, getKey, renderCard }: {
  selected: string;
  events: T[];
  emptyLabel: string;
  getKey: (item: T) => string | number;
  renderCard: (item: T, ctx: { compact: boolean }) => ReactNode;
}) {
  const dateLabel = selected ? selected.split("-").reverse().join("/") : "";
  return (
    <aside className="agenda-dia-panel" data-testid="agenda-day-list">
      <div className="agenda-dia-panel-head">
        <div className="agenda-dia-panel-kicker">Citas del día</div>
        <h3 className="agenda-dia-panel-fecha">{dateLabel}</h3>
      </div>
      <div className="agenda-dia-panel-lista">
        {events.length === 0
          ? <p className="empty-state">{emptyLabel}</p>
          : events.map((it) => <div key={getKey(it)}>{renderCard(it, { compact: false })}</div>)}
      </div>
    </aside>
  );
}

export function AgendaGrid<T extends AgendaGridItem>({
  items, emptyLabel, getKey, renderCard, initialDate, onSelectedChange, onRangeChange, sidePanel = false,
}: AgendaGridProps<T>) {
  const [view, setView] = useState<AgendaView>("month");
  const [cursor, setCursor] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string>("");

  // Fechas SOLO en cliente (evita mismatch de hidratación con el servidor).
  useEffect(() => {
    const today = initialDate ?? new Date();
    setCursor(today);
    setSelected(dateKey(today.getFullYear(), today.getMonth(), today.getDate()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) map.set(it.date, (map.get(it.date) ?? 0) + 1);
    return map;
  }, [items]);

  // Notifica el rango visible al consumidor tras cada cambio de vista o
  // navegación, por si quiere re-pedir datos escopados a ese rango.
  useEffect(() => {
    if (!cursor || !onRangeChange) return;
    if (view === "day") {
      const d = buildDayCell(cursor);
      onRangeChange(d.date, d.date);
      return;
    }
    if (view === "week") {
      const week = buildWeekCells(cursor);
      onRangeChange(week[0].date, week[6].date);
      return;
    }
    const monthCells = buildMonthCells(cursor.getFullYear(), cursor.getMonth());
    const nonNull = monthCells.filter((c): c is CalendarCell => c !== null);
    if (nonNull.length > 0) onRangeChange(nonNull[0].date, nonNull[nonNull.length - 1].date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cursor]);

  // Mantiene `selected` sincronizado con `cursor` tras navegar (</>) o cambiar
  // de vista. Sin esto, `navigate()` solo movía `cursor` — la lista del día
  // (filtrada por `selected`) y el resaltado "activo" quedaban anclados al día
  // clicado originalmente (bug reportado en OperaOS, patrón líneas 155-174).
  useEffect(() => {
    if (!cursor) return;
    if (view === "day") {
      // En día no hay ambigüedad: el único día visible ES el seleccionado.
      setSelected(buildDayCell(cursor).date);
      return;
    }
    const rangeCells: CalendarCell[] = view === "week"
      ? buildWeekCells(cursor)
      : buildMonthCells(cursor.getFullYear(), cursor.getMonth()).filter((c): c is CalendarCell => c !== null);
    setSelected((prev) => {
      if (rangeCells.some((c) => c.date === prev)) return prev;
      // Conserva el mismo día del mes/semana al navegar cuando existe (p.ej.
      // "día 15" del mes siguiente); si no (mes más corto), el primer día visible.
      const prevDay = prev ? Number(prev.slice(-2)) : null;
      const sameDay = prevDay != null ? rangeCells.find((c) => c.day === prevDay) : undefined;
      return (sameDay ?? rangeCells[0])?.date ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cursor]);

  if (!cursor) return <p className="empty-state">Cargando agenda…</p>;

  const weekCells = buildWeekCells(cursor);
  const cells: (CalendarCell | null)[] =
    view === "month" ? buildMonthCells(cursor.getFullYear(), cursor.getMonth())
    : view === "week" ? weekCells
    : [buildDayCell(cursor)];

  function changeView(v: AgendaView) {
    // Recentra el periodo en el día seleccionado al cambiar de vista (no se pierde la selección).
    setCursor(selected ? parseDate(selected) : new Date());
    setView(v);
  }

  function navigate(delta: number) {
    setCursor((c) => {
      const next = new Date(c ?? new Date());
      if (view === "month") {
        // Clamp del día antes de setMonth: sin él, 31 ene + 1 mes rueda a marzo.
        const targetMonth = next.getMonth() + delta;
        const daysInTarget = new Date(next.getFullYear(), targetMonth + 1, 0).getDate();
        next.setDate(Math.min(next.getDate(), daysInTarget));
        next.setMonth(targetMonth);
      } else if (view === "week") next.setDate(next.getDate() + delta * 7);
      else next.setDate(next.getDate() + delta);
      return next;
    });
  }

  function select(date: string) {
    setSelected(date);
    onSelectedChange?.(date);
  }

  const todayStr = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const dayEvents = items
    .filter((it) => it.date === selected)
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="agenda-widget">
      <div className="agenda-widget-head">
        <div className="agenda-widget-nav">
          <button type="button" className="btn btn-outline btn-sm" aria-label="Periodo anterior" onClick={() => navigate(-1)}>&lt;</button>
          <span className="capitalize" data-testid="agenda-period-label">{periodLabel(view, cursor, weekCells)}</span>
          <button type="button" className="btn btn-outline btn-sm" aria-label="Periodo siguiente" onClick={() => navigate(1)}>&gt;</button>
          <div className="agenda-widget-views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`btn btn-sm ${view === v.id ? "btn-primary" : "btn-outline"}`}
                aria-pressed={view === v.id}
                onClick={() => changeView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "month" && (
        <div className={sidePanel ? "agenda-mes-con-panel" : undefined} data-testid="agenda-month-view">
          <div className={sidePanel ? "agenda-mes-calendario" : undefined}>
            <div className="calendar-grid-header">{WEEK_DAYS.map((d) => <div key={d}>{d}</div>)}</div>
            <div className="calendar-days calendar-days-mes" data-testid="agenda-calendar-grid">
              {cells.map((cell, i) => {
                if (!cell) return <div key={`e${i}`} className="calendar-day empty" />;
                const n = byDay.get(cell.date) ?? 0;
                const cls = ["calendar-day"];
                if (cell.date === selected) cls.push("active");
                if (cell.date === todayStr) cls.push("today");
                return (
                  <div
                    key={cell.date}
                    role="button"
                    aria-label={`Seleccionar ${cell.date}`}
                    data-today={cell.date === todayStr ? "true" : undefined}
                    className={cls.join(" ")}
                    onClick={() => select(cell.date)}
                  >
                    <span>{cell.day}</span>
                    {n > 0 && <span className="appointment-dot" />}
                  </div>
                );
              })}
            </div>
          </div>

          {sidePanel ? (
            <DiaPanel selected={selected} events={dayEvents} emptyLabel={emptyLabel} getKey={getKey} renderCard={renderCard} />
          ) : (
            <div className="agenda-widget-day-list" data-testid="agenda-day-list">
              {dayEvents.length === 0
                ? <p className="empty-state">{emptyLabel}</p>
                : dayEvents.map((it) => <div key={getKey(it)}>{renderCard(it, { compact: false })}</div>)}
            </div>
          )}
        </div>
      )}

      {view === "week" && (
        <div className={sidePanel ? "agenda-semana-con-panel" : undefined} data-testid="agenda-week-view">
          <div className="agenda-week-grid">
            {weekCells.map((cell) => {
              const ofDay = items
                .filter((it) => it.date === cell.date)
                .sort((a, b) => a.time.localeCompare(b.time));
              const cls = ["agenda-week-col"];
              if (cell.date === selected) cls.push("active");
              if (cell.date === todayStr) cls.push("today");
              const dow = (parseDate(cell.date).getDay() + 6) % 7;
              return (
                <div
                  key={cell.date}
                  role="button"
                  aria-label={`Seleccionar ${cell.date}`}
                  data-testid="agenda-week-day"
                  data-today={cell.date === todayStr ? "true" : undefined}
                  className={cls.join(" ")}
                  onClick={() => select(cell.date)}
                >
                  <div className="agenda-week-col-head">
                    <span className="dow">{WEEK_DAYS[dow]}</span>
                    <span className="d">{cell.day}</span>
                  </div>
                  <div className="agenda-week-col-body">
                    {ofDay.map((it) => <div key={getKey(it)}>{renderCard(it, { compact: true })}</div>)}
                  </div>
                </div>
              );
            })}
          </div>
          {sidePanel && (
            <DiaPanel selected={selected} events={dayEvents} emptyLabel={emptyLabel} getKey={getKey} renderCard={renderCard} />
          )}
        </div>
      )}

      {view === "day" && (
        <div className="agenda-hour-grid" data-testid="agenda-day-view">
          {buildHours(dayEvents).map((h) => {
            const atThisHour = dayEvents.filter((it) => parseInt(it.time.slice(0, 2), 10) === h);
            return (
              <div key={h} className="agenda-hour-row">
                <div className="agenda-hour-label">{String(h).padStart(2, "0")}:00</div>
                <div className="agenda-hour-slot">
                  {atThisHour.map((it) => <div key={getKey(it)}>{renderCard(it, { compact: true })}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
