"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

interface UseResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Envuelve `api()` en {data, loading, error, refetch}.
 *
 * Nota: `api()` lanza `ApiError` en respuestas no-OK (y redirige al landing en
 * 401), por lo que el error se captura del throw — no se asume un body de error
 * en la respuesta. `loading` arranca en true para reflejar el fetch inicial.
 */
export function useResource<T = any>(path: string): UseResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<T>(path);
      setData(result);
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Error de red";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
