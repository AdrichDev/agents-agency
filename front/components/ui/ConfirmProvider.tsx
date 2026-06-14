"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  /** Heading shown at the top of the dialog. */
  title?: string;
  /** Body copy. Plain string or rich node. */
  message: ReactNode;
  /** Confirm button label. Defaults to "Aceptar". */
  confirmText?: string;
  /** Cancel button label. Defaults to "Cancelar". */
  cancelText?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

export interface NotifyOptions {
  title?: string;
  /** Visual tone of the notice. Defaults to "info". */
  tone?: "info" | "error" | "success";
  /** Dismiss button label. Defaults to "Entendido". */
  okText?: string;
}

interface DialogsApi {
  /** Replaces window.confirm — resolves true on accept, false on cancel/backdrop. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Replaces window.alert — resolves once dismissed. */
  notify: (message: ReactNode, opts?: NotifyOptions) => Promise<void>;
}

const DialogsContext = createContext<DialogsApi | null>(null);

type ConfirmState = ConfirmOptions & { resolve: (v: boolean) => void };
type NotifyState = NotifyOptions & { message: ReactNode; resolve: () => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [notifyState, setNotifyState] = useState<NotifyState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const notify = useCallback((message: ReactNode, opts?: NotifyOptions) => {
    return new Promise<void>((resolve) => {
      setNotifyState({ ...opts, message, resolve });
    });
  }, []);

  const settleConfirm = (value: boolean) => {
    if (!confirmState) return;
    confirmState.resolve(value);
    setConfirmState(null);
  };

  const settleNotify = () => {
    if (!notifyState) return;
    notifyState.resolve();
    setNotifyState(null);
  };

  const toneColor = (tone?: NotifyOptions["tone"]) =>
    tone === "error" ? "#f87171" : tone === "success" ? "#34d399" : "var(--accent-1)";

  return (
    <DialogsContext.Provider value={{ confirm, notify }}>
      {children}

      {/* Confirm (accept / cancel) */}
      <Modal
        open={!!confirmState}
        onClose={() => settleConfirm(false)}
        panelClassName="card w-full max-w-md p-6"
      >
        {confirmState && (
          <div>
            {confirmState.title && (
              <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-strong)" }}>
                {confirmState.title}
              </h3>
            )}
            <div className="text-sm mb-6" style={{ color: "var(--text)" }}>
              {confirmState.message}
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-dark" onClick={() => settleConfirm(false)}>
                {confirmState.cancelText ?? "Cancelar"}
              </button>
              <button
                type="button"
                className="btn-grad"
                style={
                  confirmState.danger
                    ? { background: "linear-gradient(135deg, #ef4444, #b91c1c)" }
                    : undefined
                }
                onClick={() => settleConfirm(true)}
                autoFocus
              >
                {confirmState.confirmText ?? "Aceptar"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Notice (alert) */}
      <Modal
        open={!!notifyState}
        onClose={settleNotify}
        panelClassName="card w-full max-w-md p-6"
      >
        {notifyState && (
          <div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: toneColor(notifyState.tone) }}>
              {notifyState.title ?? (notifyState.tone === "error" ? "Error" : "Aviso")}
            </h3>
            <div className="text-sm mb-6" style={{ color: "var(--text)" }}>
              {notifyState.message}
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn-grad" onClick={settleNotify} autoFocus>
                {notifyState.okText ?? "Entendido"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </DialogsContext.Provider>
  );
}

/** Access confirm/notify dialogs. Must be used under <ConfirmProvider>. */
export function useDialogs(): DialogsApi {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useDialogs must be used within <ConfirmProvider>");
  return ctx;
}
