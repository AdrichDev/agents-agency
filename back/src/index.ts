import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { assertAuthSecrets, getSessionUser } from "@/lib/auth";
import { apiLimiter } from "@/lib/limiters";
import { startAutomationsCron } from "@/lib/cron";
import { logger } from "@/lib/logger";
import {
  httpLogger,
  healthHandler,
  readyHandler,
  notFoundHandler,
  errorHandler,
} from "@/lib/observability";
import { channelsRouter } from "@/routes/channels";
import { landingRouter } from "@/routes/landing";
import { marketStudiesRouter } from "@/routes/market-studies";
import { contactsRouter } from "@/routes/contacts";
import { authRouter } from "@/routes/auth";
import { publicRouter } from "@/routes/public";
import { agentsRouter } from "@/routes/agents";
import { aiRouter } from "@/routes/ai";
import { sectorsRouter } from "@/routes/sectors";
import { skillsRouter } from "@/routes/skills";
import { integrationsRouter } from "@/routes/integrations";
import { automationsRouter, cronRouter } from "@/routes/automations";
import { knowledgeRouter } from "@/routes/knowledge";
import { configRouter } from "@/routes/config";
import { clientsRouter } from "@/routes/clients";
import { budgetsRouter } from "@/routes/budgets";
import { statsRouter } from "@/routes/stats";

// Fail-closed: aborta el arranque si faltan secretos de auth críticos (JWT_SECRET).
assertAuthSecrets();

const PORT = Number(process.env.PORT ?? 4000);
const FRONT_URL = process.env.FRONT_URL ?? "http://localhost:3000";

// Allowlist de orígenes para CORS: FRONT_URL + CORS_ORIGINS (coma-separado).
const ALLOWED_ORIGINS = new Set(
  [FRONT_URL, ...(process.env.CORS_ORIGINS?.split(",") ?? [])]
    .map((o) => o.trim())
    .filter(Boolean)
);

const app = express();
app.set("trust proxy", 1); // detrás de proxy/CDN: necesario para rate-limit por IP real
app.use(helmet());

// Observabilidad: log estructurado por request + correlation id (x-request-id).
app.use(httpLogger);

// Sondas de salud (públicas, fuera de /api): liveness + readiness (ping a BD).
app.get("/health", healthHandler);
app.get("/ready", readyHandler);

// CORS con credenciales: SOLO orígenes en la allowlist (no se refleja arbitrario).
app.use(
  cors({
    origin: (origin, cb) => {
      // Permite herramientas sin Origin (curl, server-to-server, same-origin)
      if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      cb(new Error("Origin no permitido por CORS"));
    },
    credentials: true,
  })
);

// Body limit global 2MB. La captura de rawBody (HMAC WhatsApp) se mantiene.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.static(path.join(process.cwd(), "public")));

// Limitador global moderado para toda la API.
app.use("/api", apiLimiter);

/* ---------- Gate de autenticación (allowlist de rutas públicas) ---------- */

/**
 * Rutas públicas explícitas. Todo lo demás bajo /api exige sesión válida.
 * Las entradas son (método, matcher). El matcher puede ser string exacto,
 * prefijo (acaba en "*") o RegExp sobre el path (sin querystring).
 */
type PublicRule = { method: string; match: (path: string) => boolean };
const exact = (m: string, p: string): PublicRule => ({ method: m, match: (x) => x === p });
const prefix = (m: string, p: string): PublicRule => ({ method: m, match: (x) => x.startsWith(p) });

const PUBLIC_RULES: PublicRule[] = [
  exact("POST", "/api/auth/login"),
  exact("POST", "/api/auth/logout"),
  exact("GET", "/api/auth/me"),
  exact("POST", "/api/public/leads"), // GET /api/public/leads queda protegido
  exact("POST", "/api/chat"),
  exact("GET", "/api/widget/config"),
  // Webhooks de mensajería: autentican con su propio secret/HMAC de proveedor
  prefix("ANY", "/api/channels"),
  // Cron / webhook de automatizaciones: usan CRON_SECRET / AUTOMATION_WEBHOOK_SECRET
  exact("GET", "/api/cron/automations"),
  { method: "POST", match: (x) => /^\/api\/automations\/[^/]+\/execute$/.test(x) },
];

function isPublic(method: string, path: string): boolean {
  return PUBLIC_RULES.some(
    (r) => (r.method === "ANY" || r.method === method) && r.match(path)
  );
}

// Gate central: protege todo /api salvo la allowlist. Inyecta req.user si hay sesión.
// Nota: montado en "/api", req.path es relativo al mount; usamos originalUrl
// (sin querystring) para casar contra las reglas con prefijo /api completo.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const fullPath = req.originalUrl.split("?")[0];
  const user = getSessionUser(req);
  if (user) (req as any).user = user;
  if (isPublic(req.method, fullPath)) return next();
  if (!user) return res.status(401).json({ error: "No autenticado" });
  next();
});

/* ---------- Montaje de routers ---------- */

// Rutas de canales de mensajería (Telegram / WhatsApp) — públicas (HMAC propio)
app.use("/api/channels", channelsRouter);

// Rutas del Landing Builder
app.use("/api/landing", landingRouter);

// Rutas de Estudios de Mercado
app.use("/api/market-studies", marketStudiesRouter);

// Rutas de Contactos (leads / prospectos)
app.use("/api/contacts", contactsRouter);

// Auth (login de la landing 3A Estudio / dashboard)
app.use("/api/auth", authRouter);

// Leads de la landing pública 3A Estudio
app.use("/api/public", publicRouter);

// Agentes
app.use("/api/agents", agentsRouter);

// IA y widget público (prompt/improve, chat, widget/config)
app.use("/api", aiRouter);

// Sectores
app.use("/api/sectors", sectorsRouter);

// Skills
app.use("/api/skills", skillsRouter);

// Integraciones / OAuth
app.use("/api", integrationsRouter);

// Automatizaciones
app.use("/api/automations", automationsRouter);

// Conocimiento (RAG)
app.use("/api/knowledge", knowledgeRouter);

// Cron de automatizaciones
app.use("/api/cron", cronRouter);

// Configuración del Sistema
app.use("/api/config", configRouter);

// Clientes
app.use("/api/clients", clientsRouter);

// Presupuestos
app.use("/api/budgets", budgetsRouter);

// Stats
app.use("/api/stats", statsRouter);

// 404 JSON para rutas /api desconocidas + manejador de errores centralizado (último).
app.use("/api", notFoundHandler);
app.use(errorHandler);

// Cron de automatizaciones (cada 5 min)
startAutomationsCron();

// Errores no capturados: log estructurado en vez de crash silencioso.
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.fatal({ err }, "uncaughtException"));

app.listen(PORT, () => {
  logger.info({ port: PORT }, `agent-agency back en http://localhost:${PORT}`);
  logger.info(`widget: http://localhost:${PORT}/widget.js`);
});
// migración skills: type (enum) + use (uppercase) — ver prisma/migrate-skill-type-use.sql
