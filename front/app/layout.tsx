import type { Metadata } from "next";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import ThemeInitializer from "@/components/ThemeInitializer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adrich",
  description: "Plataforma para crear y desplegar agentes de IA para clientes",
  icons: {
    icon: "/3A_Logo.png",
    shortcut: "/3A_Logo.png",
    apple: "/3A_Logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-screen overflow-hidden">
      <body className="h-screen overflow-hidden bg-ink">
        <ThemeInitializer />
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
            <Suspense
              fallback={<div className="h-16 border-b border-edge bg-ink/80" />}
            >
              <Topbar />
            </Suspense>
            <div className="flex-1 overflow-y-auto">
              <Suspense
                fallback={<div className="p-8 text-slate-500">Cargando...</div>}
              >
                <main className="px-8 py-8 w-full max-w-6xl mx-auto">
                  {children}
                </main>
              </Suspense>
            </div>
          </div>
        </div>
        <script
          src="http://localhost:4000/widget.js"
          data-agent-key="cmqa4l1by0005hcfx82ornw72"
        ></script>
      </body>
    </html>
  );
}
