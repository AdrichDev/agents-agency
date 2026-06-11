"use client";

import { useEffect } from "react";
import { applyTheme, loadTheme } from "@/lib/theme";

/** Aplica el tema guardado (modo, colores de marca y fuente) al cargar la app. */
export default function ThemeProvider() {
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);
  return null;
}
