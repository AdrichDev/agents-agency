"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface TokenSwitchProps {
  clientId: string;
  isActive: boolean;
  tokenBalance: number;
  tokensUsed: number;
  onToggle?: (newState: boolean) => void;
}

export function TokenSwitch({
  clientId,
  isActive,
  tokenBalance,
  tokensUsed,
  onToggle,
}: TokenSwitchProps) {
  const remaining = Math.max(0, tokenBalance - tokensUsed);
  const hasCredits = remaining > 0;

  // Estado real: isActive del servidor Y que tenga créditos.
  const [state, setState] = useState(isActive && hasCredits);
  const [loading, setLoading] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hasCredits) return; // sin créditos no se puede activar
    setLoading(true);
    try {
      await api(`/api/clients/${clientId}/credits`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !state }),
      });
      setState(!state);
      onToggle?.(!state);
    } catch (err) {
      console.error("Error toggling switch:", err);
    } finally {
      setLoading(false);
    }
  };

  // Sin créditos → siempre deshabilitado (rojo fijo).
  const disabled = loading || !hasCredits;

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      title={
        !hasCredits
          ? "Sin créditos — recarga desde /clientes"
          : state
            ? `Activo · ${remaining.toLocaleString("es")} tok restantes`
            : "Inactivo · clic para activar"
      }
      className={`
        relative w-10 h-6 rounded-full transition-colors
        ${state ? "bg-emerald-500/80 hover:bg-emerald-500" : "bg-red-500/80 hover:bg-red-500"}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        flex items-center px-0.5
      `}
    >
      <div
        className={`
          w-5 h-5 rounded-full bg-white shadow-md transition-transform
          ${state ? "translate-x-4" : "translate-x-0"}
        `}
      />
    </button>
  );
}
