"use client";

import { useEffect } from "react";

export default function ThemeInitializer() {
  useEffect(() => {
    // 1. Inicializar Tema Claro / Oscuro
    const storedTheme = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", storedTheme);

    // 2. Inicializar Color Primario y Secundario
    const primary = localStorage.getItem("color-primary");
    if (primary) {
      document.documentElement.style.setProperty("--accent-1", primary);
    }
    const secondary = localStorage.getItem("color-secondary");
    if (secondary) {
      document.documentElement.style.setProperty("--accent-2", secondary);
    }

    // 3. Inicializar Fuente
    const font = localStorage.getItem("font-family");
    if (font) {
      document.documentElement.style.setProperty("--font-app", font);
      
      // Asegurarse de cargar las Google Fonts si no son del sistema
      if (font.includes("Outfit") && !document.getElementById("font-outfit")) {
        const link = document.createElement("link");
        link.id = "font-outfit";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap";
        document.head.appendChild(link);
      } else if (font.includes("Space Grotesk") && !document.getElementById("font-space")) {
        const link = document.createElement("link");
        link.id = "font-space";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap";
        document.head.appendChild(link);
      } else if (font.includes("Playfair Display") && !document.getElementById("font-playfair")) {
        const link = document.createElement("link");
        link.id = "font-playfair";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap";
        document.head.appendChild(link);
      } else if (font.includes("Inter") && !document.getElementById("font-inter")) {
        const link = document.createElement("link");
        link.id = "font-inter";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap";
        document.head.appendChild(link);
      }
    }
  }, []);

  return null;
}
