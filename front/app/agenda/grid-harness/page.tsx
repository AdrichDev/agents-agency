"use client";
import { AgendaGrid } from "@/components/agenda/agenda-grid";
import { DEMO_APPOINTMENTS, type DemoAppointment } from "@/components/agenda/agenda-fullscreen";
import { estadoTone, tone, toneClass } from "@/components/agenda/status";

/**
 * Harness de pruebas del motor AgendaGrid (aa-agenda-operaos-parity P1/P2).
 * Monta el grid aislado con los datos demo para que `tests/agenda-grid.spec.ts`
 * pueda ejercitar navegación/selección/estados sin depender de la page real de
 * /agenda (que se reescribe en P3 consumiendo este mismo componente).
 * No se renderiza en producción.
 */
export default function AgendaGridHarnessPage() {
  if (process.env.NODE_ENV === "production") return null;

  const renderCard = (item: DemoAppointment, { compact }: { compact: boolean }) => (
    <div
      className={`cita-full-card${compact ? " cita-full-card-compact" : ""}`}
      style={{ borderLeftColor: estadoTone(item.status) }}
      data-testid="agenda-event-card"
      data-tone={tone(item.status)}
    >
      <div className="time">{item.time}</div>
      <div className="client">{item.client}</div>
      {!compact && <div className="meta">{item.service} · {item.owner}</div>}
      <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass(item.status)}`}>
        {item.status}
      </span>
    </div>
  );

  return (
    <main className="flex min-h-screen flex-col p-6">
      <AgendaGrid<DemoAppointment>
        items={DEMO_APPOINTMENTS}
        emptyLabel="Sin citas este día."
        getKey={(item) => item.id}
        renderCard={renderCard}
        sidePanel
      />
    </main>
  );
}
