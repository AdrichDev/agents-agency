import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Emoji o nodo del recuadro superior. */
  icon: ReactNode;
  title: string;
  /** Texto secundario; admite markup (p.ej. comillas, <br/>). */
  subtitle: ReactNode;
}

/**
 * Bloque "sin datos" repetido en clientes / contactos / facturación.
 * Markup idéntico al original para preservar el estilo dark.
 */
export function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return (
    <div className="p-12 text-center flex flex-col items-center">
      <div className="w-16 h-16 bg-white/[0.02] border border-edge rounded-2xl flex items-center justify-center text-2xl mb-4">
        {icon}
      </div>
      <p className="text-slate-300 font-medium">{title}</p>
      <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
    </div>
  );
}
