"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { API } from "@/lib/api";
import { isPublicPath } from "@/lib/public-paths";

/**
 * El agente de 3A Estudio, atendiendo la web de 3A Estudio.
 *
 * Solo en las rutas públicas. El snippet vivía en `RootLayout` sin condición, así que
 * activarlo habría dejado un bot comercial flotando también sobre el panel del operador,
 * el portal del cliente y las facturas.
 *
 * La `publicKey` NO es un secreto: identifica al agente en el HTML de la web de cada
 * cliente, y una `NEXT_PUBLIC_*` acaba embebida en el bundle de todas formas. Va como
 * constante con la variable de entorno por delante como override, no al revés: así el
 * despliegue no depende de una edición en el panel de Vercel.
 */
const AGENCY_AGENT_KEY = "cms7uyve40002i8fxlwx7ar7c";

const AGENT_KEY = process.env.NEXT_PUBLIC_WIDGET_AGENT_KEY ?? AGENCY_AGENT_KEY;

/** Nodos que `widget.js` deja en el documento, en el orden en que hay que retirarlos. */
const WIDGET_NODE_IDS = ["aa-panel", "aa-bubble", "aa-style"];

export default function SiteWidget() {
  const pathname = usePathname();
  const enabled = isPublicPath(pathname);

  useEffect(() => {
    if (!enabled) return;

    // Inyección con `document.createElement` y no renderizando un `<script>`: `widget.js`
    // lee `document.currentScript` en su primera línea para sacar su `data-agent-key` y la
    // base de la API de su propio `src`. Un elemento que inserta y ejecuta el navegador
    // tiene `currentScript`; delegarlo en el manejo de scripts de React sería apostar a que
    // lo conserva.
    const script = document.createElement("script");
    script.src = `${API}/widget.js`;
    script.async = true;
    script.setAttribute("data-agent-key", AGENT_KEY);
    script.setAttribute("data-aa-site-widget", "");
    document.body.appendChild(script);

    return () => {
      // Al salir de una ruta pública hay que retirar TODO lo que dejó el script, no solo el
      // script: si no, la burbuja sobrevive a la navegación de cliente y aparece encima del
      // panel, que es justo lo que este componente existe para evitar.
      script.remove();
      for (const id of WIDGET_NODE_IDS) document.getElementById(id)?.remove();
    };
  }, [enabled]);

  return null;
}
