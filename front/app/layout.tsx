import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import ThemeInitializer from "@/components/ThemeInitializer";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "3A Estudio",
  description: "Plataforma para crear y desplegar agentes de IA para clientes",
  icons: {
    icon: "/3A_sin_fondo.png",
    shortcut: "/3A_sin_fondo.png",
    apple: "/3A_sin_fondo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: el script de <head> fija data-theme/style en <html>
    // antes de hidratar (anti-flash de tema). El mismatch es intencional.
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme') || 'dark';
                  document.documentElement.setAttribute('data-theme', theme);
                  
                  var primary = localStorage.getItem('color-primary') || '#6366f1';
                  var secondary = localStorage.getItem('color-secondary') || '#d946ef';
                  var font = localStorage.getItem('font-family') || 'ui-sans-serif, system-ui, -apple-system, sans-serif';
                  
                  document.documentElement.style.setProperty('--accent-1', primary);
                  document.documentElement.style.setProperty('--accent-2', secondary);
                  document.documentElement.style.setProperty('--font-app', font);
                  
                  var sidebarBg = localStorage.getItem('color-sidebar-bg');
                  var pageBg = localStorage.getItem('color-page-bg');
                  
                  var defaultSidebar = theme === 'light' ? '#ffffff' : '#05050A';
                  var defaultBg = theme === 'light' ? '#f8fafc' : '#030308';
                  
                  var activeSidebarBg = (sidebarBg && sidebarBg !== '') ? sidebarBg : defaultSidebar;
                  var activePageBg = (pageBg && pageBg !== '') ? pageBg : defaultBg;
                  
                  document.documentElement.style.setProperty('--sidebar', activeSidebarBg);
                  document.documentElement.style.setProperty('--bg', activePageBg);
                } catch (e) {}
              })();
            `
          }}
        />
      </head>
      <body className="bg-ink">
        <ThemeInitializer />
        <ConfirmProvider>
          <AppShell>{children}</AppShell>
        </ConfirmProvider>
        {process.env.NEXT_PUBLIC_WIDGET_AGENT_KEY && (
          <script
            src={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/widget.js`}
            data-agent-key={process.env.NEXT_PUBLIC_WIDGET_AGENT_KEY}
          ></script>
        )}
      </body>
    </html>
  );
}
