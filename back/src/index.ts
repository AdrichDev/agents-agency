import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "@/lib/swagger";
import path from "path";
import { assertAuthSecrets, verifySupabaseToken } from "@/lib/auth";
import { apiLimiter } from "@/lib/limiters";
import { startAutomationsCron } from "@/lib/cron";
import { logger } from "@/lib/logger";
import {
  httpLogger,
  healthHandler,
  readyHandler,
  notFoundHandler,
  errorHandler,
  setDraining,
} from "@/lib/observability";
import { prisma } from "@/lib/db";
import { refreshModelConfig } from "@/lib/openai";
import { applyOAuthEnvFromConfig } from "@/routes/config";
import { initSentry } from "@/lib/sentry";
import { channelsRouter } from "@/routes/channels";
import { isPublic, isServiceCall } from "@/lib/public-routes";
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
import { calendarRouter } from "@/routes/calendar";
import { agendaAppointmentsRouter } from "@/routes/agenda-appointments";
import { automationsRouter, cronRouter } from "@/routes/automations";
import { knowledgeRouter } from "@/routes/knowledge";
import { configRouter } from "@/routes/config";
import { clientsRouter } from "@/routes/clients";
import { budgetsRouter } from "@/routes/budgets";
import { invoicesRouter } from "@/routes/invoices";
import { statsRouter } from "@/routes/stats";
import { bookingRouter } from "@/routes/booking";
import { operatorChatRouter } from "@/routes/operator-chat";
import { serviceOperatorRouter } from "@/routes/service-operator";
import { serviceTelegramRouter } from "@/routes/service-telegram";

// Fail-closed: aborta el arranque si falta SUPABASE_JWT_SECRET.
assertAuthSecrets();

// Sentry: no-op si SENTRY_DSN no está definido.
initSentry();

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

// Documentación interactiva OpenAPI. Solo fuera de producción.
if (process.env.NODE_ENV !== "production") {
  app.get("/api/docs/swagger.json", (_req, res) => res.json(swaggerSpec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// CORS con credenciales: SOLO orígenes en la allowlist (no se refleja arbitrario).
app.use(
  cors({
    origin: (origin, cb) => {
      // En desarrollo o sin origin (server-to-server), permitir.
      if (!origin || process.env.NODE_ENV !== "production" || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
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
      // `req` aquí es http.IncomingMessage (no Express.Request) → cast puntual.
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.static(path.join(process.cwd(), "public")));

// Limitador global moderado para toda la API.
app.use("/api", apiLimiter);

// Router del Operator Agent (F1 aa-operator-agent): montado FUERA de /api, por
// lo que NO pasa por el gate de usuario de abajo. Se protege únicamente con el
// service token (x-service-token) que aplica su propio middleware interno.
app.use("/service/operator", serviceOperatorRouter);

// Contrato TELEGRAM_SEND_URL del CRM (5.4b aa-centro-mando-agenda-telegram):
// respuestas manuales del CRM salen por AA (único escritor a la Bot API).
// Mismo esquema de auth: service token propio, fuera del gate de usuario.
app.use("/service/telegram", serviceTelegramRouter);

/* ---------- Gate de autenticación (allowlist de rutas públicas) ---------- */
// Reglas en src/lib/public-routes.ts (testeable sin arrancar el server).

// Gate central: protege todo /api salvo la allowlist.
// Verifica el token Supabase (Bearer en Authorization header), carga aa.User por
// id = sub, e inyecta req.user = { id, email, role } con el rol de la app.
// AA es single-tenant — no hay Membership join. Diseño D8.
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  const fullPath = req.originalUrl.split("?")[0];

  // Defensa en profundidad: ninguna ruta /api legítima contiene "..". Rechazar
  // traversal antes de evaluar allowlist/service-auth (el routing de Express ya impide
  // cruzar mounts, esto es coherencia + cierre explícito).
  if (fullPath.includes("..")) return res.status(400).json({ error: "Ruta inválida" });

  // Auth de servicio (CRM→AA): token estático para los endpoints de generación.
  // No falsea req.user (esos handlers no lo usan). Atajo antes de la verificación JWT.
  const authHeader = req.headers.authorization;
  if (isServiceCall(req.method, fullPath, authHeader)) return next();

  // Try to resolve the user from the Supabase token before checking publicness,
  // so that req.user is available even on technically-public endpoints.
  if (authHeader?.startsWith("Bearer ")) {
    // (a) Token verification: an invalid/expired token just leaves req.user undefined
    // (the gate 401s below for protected routes). NOT mixed with DB errors.
    let sub: string | undefined;
    let email = "";
    try {
      ({ sub, email } = await verifySupabaseToken(authHeader.slice(7)));
    } catch {
      sub = undefined;
    }

    if (sub) {
      // (b) Profile lookup. A DB fault here is a SERVER error, not an auth error:
      // on a protected route return 500 (don't mask an outage as "no autenticado");
      // on a public route continue without req.user.
      try {
        const aaUser = await prisma.user.findUnique({ where: { id: sub } });
        if (aaUser) {
          req.user = {
            id: aaUser.id,
            firstName: aaUser.firstName,
            lastName: aaUser.lastName,
            email: email || aaUser.email,
            phone: aaUser.phone,
            role: aaUser.role,
          };
        }
      } catch (e) {
        logger.error({ err: e }, "[auth gate] error consultando aa.User:");
        if (!isPublic(req.method, fullPath)) {
          return res.status(500).json({ error: "Error interno" });
        }
        // public route → continue without user
      }
    }
  }

  if (isPublic(req.method, fullPath)) return next();
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
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

// Google Calendar de plataforma para la agenda (aa-agenda-google-import)
app.use("/api/calendar", calendarRouter);
app.use("/api/agenda", agendaAppointmentsRouter);

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

// Facturas (generadas automáticamente al aceptar un presupuesto)
app.use("/api/invoices", invoicesRouter);

// Stats
app.use("/api/stats", statsRouter);

// Booking / Citas y Disponibilidad
app.use("/api/booking", bookingRouter);

// Chat del operador (5.5a): proxy autenticado al gateway OpenClaw. El token
// del gateway NUNCA sale del backend; protegido por el gate central de /api.
app.use("/api/operator-chat", operatorChatRouter);

// 404 JSON para rutas /api desconocidas + manejador de errores centralizado (último).
app.use("/api", notFoundHandler);
app.use(errorHandler);

// Cron de automatizaciones (cada 5 min) — guardamos el handle para pararlo al cerrar.
// Kill-switch: ENABLE_CRONS=false lo apaga (util en demo/pre-launch para no consumir
// egress de Supabase en vacio). Default: habilitado.
const cronHandle = process.env.ENABLE_CRONS === "false" ? null : startAutomationsCron();
if (cronHandle === null) logger.info("[cron] deshabilitado via ENABLE_CRONS=false");

// Errores no capturados: log estructurado en vez de crash silencioso.
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.fatal({ err }, "uncaughtException"));

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, `agent-agency back en http://localhost:${PORT}`);
  logger.info(`widget: http://localhost:${PORT}/widget.js`);
  // Carga el effort de razonamiento global desde SystemConfig (override del env).
  void refreshModelConfig();
  // Carga credenciales OAuth de Google desde SystemConfig a process.env.
  void applyOAuthEnvFromConfig();
});

// Apagado ordenado: drena readiness, para el cron, cierra el server y la BD.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10000);
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "graceful shutdown iniciado");
  setDraining(true); // /ready -> 503: el balanceador deja de enrutar
  if (cronHandle) clearInterval(cronHandle);

  // Timeout de seguridad: si el drenado se cuelga, forzar salida.
  const force = setTimeout(() => {
    logger.error("shutdown timeout — salida forzada");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.error({ err }, "error al desconectar Prisma");
    }
    logger.info("graceful shutdown completado");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// migración skills: type (enum) + use (uppercase) — ver prisma/manual/migrate-skill-type-use.sql
