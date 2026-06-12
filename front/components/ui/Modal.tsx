import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  /** Backdrop click handler. No-op while disabled (e.g. saving). */
  onClose: () => void;
  /** Block backdrop-close (e.g. mientras se guarda). */
  closeDisabled?: boolean;
  children: ReactNode;
  /** Panel classes. Defaults to the shared card scaffold. */
  panelClassName?: string;
}

/**
 * Backdrop + centered panel con stopPropagation, idéntico al scaffold que ya
 * usaban clientes y contactos. El panel cierra al pulsar el fondo salvo que
 * `closeDisabled` esté activo.
 */
export function Modal({
  open,
  onClose,
  closeDisabled = false,
  children,
  panelClassName = "card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto",
}: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !closeDisabled && onClose()}
    >
      <div className={panelClassName} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
