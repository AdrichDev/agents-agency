"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Great_Vibes } from "next/font/google";
import logo3A from "@/assets/3A_fondo_negro_web.png";
import LoginModal from "@/components/landing/LoginModal";
import { useAuthUser } from "@/hooks/useAuthUser";

// Caligrafía elegante, mismo espíritu que el lettering "Estudio" del banner
const scriptFont = Great_Vibes({ weight: "400", subsets: ["latin"] });

export default function LandingHeader() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, loading, refresh } = useAuthUser();

  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 inset-x-0 z-[70] transition-all duration-300 border-b ${
          scrolled
            ? "bg-[#030308]/65 backdrop-blur-xl border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
            : "bg-transparent backdrop-blur-0 border-transparent"
        }`}
      >
        <div className="relative max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">
          <a href="#inicio" className="flex items-center gap-2.5 shrink-0">
            <Image
              src={logo3A}
              alt="3A Estudio"
              className="h-11 w-11 rounded-full drop-shadow-[0_0_12px_rgba(157,0,255,0.6)]"
              priority
            />
            <span
              className={`${scriptFont.className} inline-block text-3xl leading-[1.4] px-2 -my-2 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-orange-300 bg-clip-text text-transparent drop-shadow-[0_0_14px_rgba(217,70,239,0.45)]`}
            >
              Estudio
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-1 text-sm absolute left-1/2 -translate-x-1/2">
            {[
              ["#servicios", "Servicios"],
              ["#proceso", "Proceso"],
              ["#contacto", "Contacto"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="px-4 py-2 rounded-xl text-slate-300 hover:bg-gradient-to-r hover:from-cyan-400 hover:via-fuchsia-400 hover:to-orange-300 hover:bg-clip-text hover:text-transparent hover:scale-105 transition font-semibold"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {!loading && (
              <button onClick={() => setLoginOpen(true)} className="btn-neon !py-2 !px-5 text-xs">
                Iniciar sesión
              </button>
            )}

            <button
              className="md:hidden text-slate-300 hover:text-white text-xl"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menú"
            >
              ☰
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="md:hidden border-t border-white/10 bg-[#030308]/90 backdrop-blur-xl px-6 py-4 flex flex-col gap-1 text-sm">
            {[
              ["#servicios", "Servicios"],
              ["#proceso", "Proceso"],
              ["#contacto", "Contacto"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition"
              >
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={refresh} />
    </>
  );
}
