import Link from "next/link";
import styles from "./legal.module.css";

// Wrapper de las páginas legales (públicas, sin auth ni chrome). Tema oscuro de AA:
// bg-ink, panel con borde de acento, header con wordmark y enlace de vuelta, y pie
// con enlaces cruzados entre los tres documentos.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink px-4 py-10 text-slate-300">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            aria-label="Ir al inicio"
            className="text-lg font-extrabold"
            style={{
              background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            3A Estudio
          </Link>
          <Link href="/" className="text-sm text-slate-400 transition hover:text-white">
            ← Volver al inicio
          </Link>
        </header>

        <div
          className="rounded-2xl border p-8 sm:p-10"
          style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
        >
          <article className={styles.prose}>{children}</article>

          <footer
            className="mt-12 border-t pt-6 text-sm text-slate-500"
            style={{ borderColor: "var(--edge)" }}
          >
            <nav className="flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/privacidad" className="transition hover:text-white">Política de Privacidad</Link>
              <Link href="/aviso-legal" className="transition hover:text-white">Aviso Legal</Link>
              <Link href="/cookies" className="transition hover:text-white">Política de Cookies</Link>
            </nav>
          </footer>
        </div>
      </div>
    </div>
  );
}
