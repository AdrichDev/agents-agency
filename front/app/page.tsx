"use client";

import Image from "next/image";
import banner from "@/assets/3A_Estudio_Banner_FondoNegro_1024_WEB.png";
import logo from "@/assets/3A_Blanca_SinFondo_web.png";
import LandingHeader from "@/components/landing/LandingHeader";
import LeadForm from "@/components/landing/LeadForm";
import CookieBanner from "@/components/landing/CookieBanner";

const MARQUEE_ITEMS = [
  "Agentes IA",
  "Gmail",
  "Slack",
  "Jira",
  "Google Calendar",
  "WhatsApp",
  "Telegram",
  "OpenAI",
  "MCP",
  "Automatizaciones",
  "Widget web",
  "RAG",
  "n8n",
  "Leads 24/7",
];

const SERVICES = [
  {
    icon: "🤖",
    title: "Agentes IA por sector",
    desc: "Asistentes entrenados con el conocimiento de tu negocio, listos en días.",
    long: "Creamos agentes especializados por sector que aprenden de tu web, tus documentos y tu forma de trabajar para responder como lo haría tu mejor empleado.",
    example: "Una clínica dental resuelve dudas, filtra urgencias y agenda citas sin descolgar el teléfono.",
    art: "from-indigo-600 via-violet-600 to-fuchsia-600",
    glow: "from-indigo-500/40 to-fuchsia-500/40",
  },
  {
    icon: "💬",
    title: "Widget web a tu marca",
    desc: "Un chat embebible con tus colores, tu avatar y tu tono.",
    long: "Instalas una línea de código y tu web atiende 24/7: colores corporativos, avatar propio, posición y tamaño configurables desde el panel.",
    example: "Una inmobiliaria responde por chat a las visitas nocturnas y les pide email y teléfono.",
    art: "from-sky-500 via-cyan-500 to-blue-700",
    glow: "from-cyan-400/40 to-blue-600/40",
  },
  {
    icon: "⚡",
    title: "Automatizaciones 24/7",
    desc: "Reglas en lenguaje natural que trabajan solas cada 5 minutos.",
    long: "Defines la regla escribiéndola: el agente vigila tus canales y ejecuta el flujo completo sin intervención humana, día y noche.",
    example: "\"Si llega un email urgente, crea un ticket en Jira y avisa al equipo por Slack.\"",
    art: "from-amber-500 via-orange-500 to-red-600",
    glow: "from-amber-400/40 to-orange-600/40",
  },
  {
    icon: "🔌",
    title: "Integraciones 1-clic",
    desc: "Gmail, Slack, Jira y Google Calendar con OAuth en un clic.",
    long: "Conectamos tus herramientas corporativas con autorización segura OAuth. El agente lee, escribe y actúa donde tu equipo ya trabaja.",
    example: "El agente consulta tu Google Calendar y propone huecos reales para reuniones.",
    art: "from-emerald-500 via-teal-500 to-cyan-700",
    glow: "from-emerald-400/40 to-teal-600/40",
  },
  {
    icon: "📱",
    title: "WhatsApp y Telegram",
    desc: "Tu agente en los canales donde ya están tus clientes.",
    long: "Desplegamos el mismo agente en WhatsApp Business y Telegram, con captación de leads y traspaso a humano cuando hace falta.",
    example: "Un taller confirma citas y envía recordatorios por WhatsApp automáticamente.",
    art: "from-green-500 via-emerald-500 to-lime-600",
    glow: "from-green-400/40 to-lime-500/40",
  },
  {
    icon: "📈",
    title: "Leads y presupuestos",
    desc: "Cada conversación interesada se convierte en un contacto.",
    long: "El agente capta nombre, email y teléfono con consentimiento RGPD, y desde el panel generas presupuestos profesionales en PDF en minutos.",
    example: "De \"hola, ¿hacéis reformas?\" a lead con teléfono y presupuesto enviado el mismo día.",
    art: "from-fuchsia-600 via-pink-600 to-rose-600",
    glow: "from-fuchsia-500/40 to-pink-600/40",
  },
];

const STEPS = [
  {
    n: "01",
    t: "Análisis y consultoría",
    d: "Auditamos tus procesos, canales y objetivos de negocio para definir el alcance del proyecto y los indicadores de éxito.",
  },
  {
    n: "02",
    t: "Diseño y entrenamiento",
    d: "Configuramos el agente con tu base de conocimiento, tu tono de marca y las integraciones corporativas necesarias.",
  },
  {
    n: "03",
    t: "Validación y calidad",
    d: "Fase de pruebas junto a tu equipo: ajustamos flujos, límites y respuestas hasta cumplir los criterios acordados.",
  },
  {
    n: "04",
    t: "Despliegue y mejora continua",
    d: "Puesta en producción multicanal con métricas periódicas, soporte dedicado y optimización constante.",
  },
];

export default function Landing() {
  return (
    <div id="inicio" className="min-h-screen bg-[#030308] text-slate-300 overflow-x-hidden">
      <LandingHeader />

      {/* ── HERO ── */}
      <section className="relative pt-32 md:pt-40 pb-20 px-4">
        {/* Glows vibrantes difuminados */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[var(--neon-purple)]/25 rounded-full blur-[140px] animate-glow-pulse pointer-events-none" />
        <div className="absolute top-40 -left-32 w-[400px] h-[400px] bg-[var(--neon-blue)]/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 -right-32 w-[400px] h-[400px] bg-[var(--neon-orange)]/15 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-xs text-indigo-300 font-semibold mb-8 animate-fade-up">
            ✦ Agencia de agentes de IA para negocios
          </div>

          <h1
            className="text-4xl md:text-6xl font-black text-white leading-tight mb-6 animate-fade-up"
            style={{ animationDelay: "0.1s" }}
          >
            Tu negocio atendido por{" "}
            <span className="px-3 rounded-xl bg-neon-gradient text-white inline-block -rotate-1">
              IA
            </span>{" "}
            <br className="hidden md:block" />
            <span className="text-neon-gradient">{"{sin que tú hagas nada}"}</span>
          </h1>

          <p
            className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 animate-fade-up"
            style={{ animationDelay: "0.2s" }}
          >
            En 3A Estudio creamos agentes de inteligencia artificial que responden a tus clientes,
            captan leads y automatizan tu día a día. Directos, prácticos y sin relleno.
          </p>

          <div
            className="flex flex-wrap justify-center gap-4 mb-12 animate-fade-up"
            style={{ animationDelay: "0.3s" }}
          >
            <a href="#contacto" className="btn-neon !px-7 !py-3 text-sm">
              Quiero mi agente IA →
            </a>
            <a href="#servicios" className="btn-dark !px-7 !py-3 text-sm font-bold">
              Ver qué hacemos
            </a>
          </div>

          <div
            className="flex flex-wrap justify-center gap-3 text-xs text-slate-500 animate-fade-up"
            style={{ animationDelay: "0.4s" }}
          >
            <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10">
              ⚡ Listo en días
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10">
              🕐 Atención 24/7
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10">
              🔌 +6 integraciones
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10">
              🔒 RGPD y datos seguros
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10">
              📊 Métricas e informes
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10">
              🌐 Web · WhatsApp · Telegram
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10">
              🇪🇸 Soporte en español
            </span>
          </div>

          {/* Banner con difuminado vibrante */}
          <div className="relative mt-16 animate-float-slow">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/40 via-fuchsia-500/40 to-orange-500/40 blur-[60px] rounded-full" />
            <Image
              src={banner}
              alt="3A Estudio — Agentes de IA"
              className="relative w-full max-w-2xl mx-auto h-auto drop-shadow-[0_0_35px_rgba(157,0,255,0.45)]"
              priority
            />
          </div>
        </div>
      </section>

      {/* ── MARQUESINA (izquierda → derecha) ── */}
      <section className="relative py-6 border-y border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="flex w-max animate-marquee-ltr">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center gap-10 px-5" aria-hidden={dup === 1}>
              {MARQUEE_ITEMS.map((item, i) => (
                <span
                  key={`${dup}-${item}`}
                  className={`whitespace-nowrap text-sm font-bold uppercase tracking-widest ${
                    i % 4 === 0
                      ? "text-neon-cyan"
                      : i % 4 === 1
                        ? "text-neon-purple"
                        : i % 4 === 2
                          ? "text-neon-orange"
                          : "text-neon-pink"
                  }`}
                >
                  {item} <span className="text-slate-700 ml-8">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── SERVICIOS ── */}
      <section id="servicios" className="relative py-24 px-4">
        <div className="absolute top-1/3 -left-40 w-[450px] h-[450px] bg-[var(--neon-pink)]/15 rounded-full blur-[130px] pointer-events-none" />
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <div className="kicker mb-3">Empieza por donde quieras</div>
            <h2 className="text-3xl md:text-4xl font-black text-white">
              Todo lo que hacemos en <span className="text-neon-gradient">3A Estudio</span>
            </h2>
            <p className="text-sm text-slate-500 mt-3">
              De la idea al agente desplegado, pasando por la captación de cada lead.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {SERVICES.map((s, i) => (
              <div
                key={s.title}
                className="flip-card h-[380px] animate-fade-up"
                style={{ animationDelay: `${i * 0.07}s` }}
              >
                <div className="flip-inner">
                  {/* ── CARA FRONTAL ── */}
                  <div className="flip-face rounded-2xl border border-white/10 bg-[#0b0b12] overflow-hidden flex flex-col">
                    {/* Imagen vibrante difuminada del servicio */}
                    <div className={`relative h-44 bg-gradient-to-br ${s.art} overflow-hidden`}>
                      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.5)_1px,transparent_0)] [background-size:18px_18px]" />
                      <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/25 rounded-full blur-[50px]" />
                      <div className="absolute -top-10 -right-10 w-36 h-36 bg-black/35 rounded-full blur-[40px]" />
                      <div className="absolute inset-0 grid place-items-center">
                        <span className="text-6xl drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]">
                          {s.icon}
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0b0b12] to-transparent" />
                    </div>

                    <div className="p-5 flex-1 flex flex-col">
                      <h3 className="text-lg font-extrabold text-white mb-2">{s.title}</h3>
                      <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
                      <span className="mt-auto pt-3 text-[11px] uppercase tracking-widest text-indigo-400/80 font-bold">
                        Pasa el ratón ⟲
                      </span>
                    </div>
                  </div>

                  {/* ── CARA TRASERA (giro 180º) ── */}
                  <div className="flip-face flip-back rounded-2xl border border-indigo-500/40 bg-[#0b0b12] overflow-hidden">
                    <div
                      className={`absolute -top-16 -right-16 w-52 h-52 rounded-full bg-gradient-to-br ${s.glow} blur-[60px]`}
                    />
                    <div
                      className={`absolute -bottom-16 -left-16 w-44 h-44 rounded-full bg-gradient-to-br ${s.glow} blur-[60px] opacity-60`}
                    />
                    <div className="relative h-full p-6 flex flex-col justify-center">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="text-2xl">{s.icon}</span>
                        <h3 className="text-base font-extrabold text-white">{s.title}</h3>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed mb-5">{s.long}</p>
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[10px] uppercase tracking-widest text-neon-cyan font-bold mb-1.5">
                          Ejemplo real
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{s.example}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROCESO ── */}
      <section id="proceso" className="relative py-24 px-4 border-t border-white/5">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[var(--neon-blue)]/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="kicker mb-3">Metodología</div>
            <h2 className="text-3xl md:text-4xl font-black text-white">
              De cero a agente en <span className="text-neon-cyan">4 fases</span>
            </h2>
            <p className="text-sm text-slate-500 mt-3">
              Un proceso probado, con entregables claros y comunicación constante en cada fase.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="rounded-2xl border border-white/10 bg-[#0b0b12] p-6 hover:border-fuchsia-500/40 transition"
              >
                <div className="text-4xl font-black text-neon-gradient mb-3">{step.n}</div>
                <h3 className="text-white font-bold mb-2">{step.t}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTACTO / LEADS ── */}
      <section id="contacto" className="relative py-24 px-4">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[420px] bg-gradient-to-r from-indigo-600/15 via-fuchsia-600/15 to-orange-500/15 blur-[100px] pointer-events-none" />
        <div className="relative max-w-xl mx-auto">
          <div className="text-center mb-10">
            <div className="kicker mb-3">Hablemos</div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">
              ¿Le ponemos un agente de <span className="text-neon-gradient">IA</span> a tu negocio?
            </h2>
            <p className="text-sm text-slate-500">
              Déjanos tus datos y te contactamos con una propuesta a medida. Sin compromiso.
            </p>
          </div>

          <div className="relative rounded-2xl border border-white/10 bg-[#0b0b12]/90 backdrop-blur p-8 shadow-[0_0_60px_rgba(157,0,255,0.15)]">
            <LeadForm />
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/10 bg-[#05050a] px-4">
        <div className="max-w-6xl mx-auto py-12">
          <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-8">
            <div className="text-center md:text-left">
              <Image src={logo} alt="3A Estudio" className="h-10 w-auto mx-auto md:mx-0 mb-3" />
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                Agencia de agentes de inteligencia artificial. Creamos, desplegamos y mantenemos la
                IA que atiende tu negocio.
              </p>
            </div>

            <div className="flex gap-14 text-sm">
              <div>
                <h4 className="text-white font-bold mb-3 text-xs uppercase tracking-widest">
                  Secciones
                </h4>
                <ul className="space-y-2 text-slate-500 text-xs">
                  <li><a href="#servicios" className="hover:text-white transition">Servicios</a></li>
                  <li><a href="#proceso" className="hover:text-white transition">Proceso</a></li>
                  <li><a href="#contacto" className="hover:text-white transition">Contacto</a></li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-bold mb-3 text-xs uppercase tracking-widest">
                  Legal
                </h4>
                <ul className="space-y-2 text-slate-500 text-xs">
                  <li><a href="/aviso-legal" className="hover:text-white transition">Aviso legal</a></li>
                  <li><a href="/privacidad" className="hover:text-white transition">Política de privacidad</a></li>
                  <li><a href="/cookies" className="hover:text-white transition">Política de cookies</a></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-3 text-[11px] text-slate-600">
            <span>© 2026 3A Estudio. Todos los derechos reservados.</span>
            <span>
              Hecho con <span className="text-neon-pink">♥</span> e{" "}
              <span className="text-neon-gradient font-bold">IA</span> en España
            </span>
          </div>
        </div>
      </footer>

      <CookieBanner />
    </div>
  );
}
