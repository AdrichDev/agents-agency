"use client";

import { useCallback, useState, type CSSProperties } from "react";

export interface IsolationApi {
  /** Currently isolated series key, or null when all series are visible. */
  isolated: string | null;
  /** Toggle isolation: same key restores all, a different key isolates it. */
  toggle: (key: string) => void;
  /** True when a series must be hidden (something else is isolated). */
  isHidden: (key: string) => boolean;
  /** Style for legend items: pointer cursor, dim non-isolated, highlight isolated. */
  legendStyle: (key: string) => CSSProperties;
}

export function useIsolation(): IsolationApi {
  const [isolated, setIsolated] = useState<string | null>(null);

  const toggle = useCallback((key: string) => {
    setIsolated((prev) => (prev === key ? null : key));
  }, []);

  const isHidden = useCallback(
    (key: string) => isolated !== null && isolated !== key,
    [isolated]
  );

  const legendStyle = useCallback(
    (key: string): CSSProperties => ({
      cursor: "pointer",
      opacity: isolated !== null && isolated !== key ? 0.35 : 1,
      fontWeight: isolated === key ? 700 : 400,
    }),
    [isolated]
  );

  return { isolated, toggle, isHidden, legendStyle };
}
