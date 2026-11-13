#!/usr/bin/env node
/**
 * mcp-3a-plataforma — MCP aislado para 3A Estudio
 *
 * NO genera código de chatbots. Invoca las herramientas que YA existen en
 * agents-agency vía el router service-operator:
 *
 *   GET  /service/operator/estado
 *   GET  /service/operator/clientes
 *   POST /service/operator/clientes
 *   POST /service/operator/agentes   ← createAgent() real
 *   POST /service/operator/leads/:id/convertir
 *
 * Auth: header x-service-token = OPERATOR_SERVICE_TOKEN
 * Confirmación: escrituras exigen confirmado=true (409 si no).
 *
 * Modo:
 *   MCP_LIVE=false (default) → respuestas mock locales (sin backend)
 *   MCP_LIVE=true            → HTTP real contra AA_API_URL
 *
 * Aislado: no importa ni modifica agents-agency / crm_creator.
 */

import { createInterface } from "node:readline";
import { stdin as input, stdout as output, stderr } from "node:process";

const SERVER_INFO = { name: "mcp-3a-plataforma", version: "0.2.0" };

const CONFIG = {
  baseUrl: (process.env.AA_API_URL || "http://localhost:4000").replace(/\/$/, ""),
  token: process.env.OPERATOR_SERVICE_TOKEN || "",
  live: process.env.MCP_LIVE === "true",
  origin: process.env.MCP_OPERATOR_ORIGIN || "grok-bot",
};

// ─── HTTP al service-operator real ───────────────────────────────────────────

async function aa(method, path, body) {
  if (!CONFIG.live) {
    return mockCall(method, path, body);
  }
  if (!CONFIG.token) {
    return {
      status: 401,
      data: {
        error:
          "OPERATOR_SERVICE_TOKEN no configurado. Define la env para modo live.",
      },
    };
  }

  const url = `${CONFIG.baseUrl}/service/operator${path}`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-service-token": CONFIG.token,
    "x-operator-origin": CONFIG.origin,
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  } catch (err) {
    return {
      status: 503,
      data: {
        error: {
          code: "backend_unreachable",
          message: err instanceof Error ? err.message : String(err),
          hint: `No se pudo alcanzar ${url}. ¿Está agents-agency en ${CONFIG.baseUrl}?`,
        },
      },
    };
  }
}

// ─── Mock local (solo cuando MCP_LIVE=false) ─────────────────────────────────
// Replica el contrato del service-operator para poder probar el MCP sin backend.

const mockStore = {
  clients: [
    {
      id: "ten_demo_001",
      codigo: "JOR-001",
      name: "Barbería Jorjotas",
      sector: "peluqueria",
      isActive: true,
    },
    {
      id: "ten_demo_002",
      codigo: "CDS-002",
      name: "Clínica Dental Sonrisa",
      sector: "clinica",
      isActive: true,
    },
  ],
  agents: [
    {
      id: "agt_demo_001",
      name: "Recepcionista Jorjotas",
      sector: "peluqueria",
      runtime: "openai",
    },
  ],
  leads: [{ id: "lead_001", status: "new", customerName: "Lead Demo" }],
};

function mockCall(method, path, body = {}) {
  if (method === "GET" && path === "/estado") {
    return {
      status: 200,
      data: {
        tenantsActivos: mockStore.clients.filter((c) => c.isActive).length,
        agentes: [{ runtime: "openai", total: mockStore.agents.length }],
        leadsPendientes: mockStore.leads.filter((l) => l.status === "new").length,
        _mock: true,
      },
    };
  }

  if (method === "GET" && path === "/clientes") {
    return { status: 200, data: mockStore.clients };
  }

  const mGet = path.match(/^\/clientes\/([^/]+)$/);
  if (method === "GET" && mGet) {
    const c = mockStore.clients.find((x) => x.id === mGet[1]);
    return c
      ? { status: 200, data: c }
      : { status: 404, data: { error: "Cliente no encontrado" } };
  }

  if (method === "POST" && path === "/clientes") {
    if (body?.confirmado !== true) {
      return { status: 409, data: { error: { code: "confirmation_required" } } };
    }
    if (!body?.nombre) {
      return { status: 400, data: { error: "nombre obligatorio" } };
    }
    const id = `ten_${Date.now().toString(36)}`;
    const cliente = {
      id,
      codigo: `CLI-${mockStore.clients.length + 1}`,
      name: body.nombre,
      sector: body.sector || null,
      isActive: true,
    };
    mockStore.clients.push(cliente);
    return {
      status: 201,
      data: { id: cliente.id, codigo: cliente.codigo, name: cliente.name },
    };
  }

  // POST /agentes  ← en live llama a createAgent()
  if (method === "POST" && path === "/agentes") {
    if (body?.confirmado !== true) {
      return { status: 409, data: { error: { code: "confirmation_required" } } };
    }
    if (!body?.name || !body?.sector || !body?.systemPrompt) {
      return {
        status: 400,
        data: {
          error: "name, sector y systemPrompt son obligatorios (contrato service-operator)",
        },
      };
    }
    const id = `agt_${Date.now().toString(36)}`;
    const agent = {
      id,
      name: body.name,
      sector: body.sector,
      runtime: body.runtime || "openai",
      systemPrompt: body.systemPrompt,
    };
    mockStore.agents.push(agent);
    return {
      status: 201,
      data: {
        id: agent.id,
        name: agent.name,
        sector: agent.sector,
        runtime: agent.runtime,
        _note:
          "En modo LIVE esto llama a createAgent() de agents-agency (BD + OpenClaw/provisioning).",
      },
    };
  }

  const mLead = path.match(/^\/leads\/([^/]+)\/convertir$/);
  if (method === "POST" && mLead) {
    if (body?.confirmado !== true) {
      return { status: 409, data: { error: { code: "confirmation_required" } } };
    }
    const lead = mockStore.leads.find((l) => l.id === mLead[1]);
    if (!lead) return { status: 404, data: { error: "Lead no encontrado" } };
    if (lead.status === "converted") {
      return { status: 409, data: { error: { code: "already_converted" } } };
    }
    lead.status = "converted";
    const id = `ten_${Date.now().toString(36)}`;
    const cliente = {
      id,
      codigo: `CLI-${mockStore.clients.length + 1}`,
      name: lead.customerName,
      isActive: true,
    };
    mockStore.clients.push(cliente);
    return {
      status: 201,
      data: { id, codigo: cliente.codigo, name: cliente.name, leadId: lead.id },
    };
  }

  return {
    status: 404,
    data: { error: { code: "mock_route_not_found", path, method } },
  };
}

// ─── Tools MCP (mapeo 1:1 al service-operator) ───────────────────────────────

const TOOLS = [
  {
    name: "agencia_estado",
    description:
      "Estado de la plataforma 3A Estudio (tenants activos, agentes por runtime, leads pendientes). GET /service/operator/estado",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "listar_clientes",
    description:
      "Lista clientes (tenants) activos de agents-agency. GET /service/operator/clientes",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "crear_cliente",
    description:
      "Alta de cliente (tenant) en agents-agency. POST /service/operator/clientes. Exige confirmado=true.",
    inputSchema: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre del cliente (obligatorio)" },
        sector: { type: "string" },
        email: { type: "string" },
        telefono: { type: "string" },
        sitioWeb: { type: "string" },
        confirmado: {
          type: "boolean",
          description: "Debe ser true para ejecutar. Si no → confirmation_required",
        },
      },
      required: ["nombre"],
      additionalProperties: false,
    },
  },
  {
    name: "crear_agente_chatbot",
    description:
      "Crea un agente/chatbot en agents-agency usando createAgent() real (POST /service/operator/agentes). " +
      "NO escribe código: persiste el agente en BD, puede provisionar OpenClaw y dejar presupuesto borrador. " +
      "Campos obligatorios: name, sector, systemPrompt. Exige confirmado=true.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nombre del agente (ej. 'Recepcionista web Jorjotas')",
        },
        sector: {
          type: "string",
          description: "Sector de negocio (ej. peluqueria, clinica, restaurante)",
        },
        systemPrompt: {
          type: "string",
          description: "Instrucciones del sistema del chatbot",
        },
        runtime: {
          type: "string",
          enum: ["openai", "openclaw"],
          description: "Runtime del agente (default openai)",
        },
        confirmado: {
          type: "boolean",
          description: "Debe ser true para crear. Si no → 409 confirmation_required",
        },
      },
      required: ["name", "sector", "systemPrompt"],
      additionalProperties: false,
    },
  },
  {
    name: "convertir_lead",
    description:
      "Convierte un lead en cliente (tenant). POST /service/operator/leads/:id/convertir. Exige confirmado=true.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "ID del lead" },
        confirmado: { type: "boolean" },
      },
      required: ["leadId"],
      additionalProperties: false,
    },
  },
];

function toolResult(http) {
  const isError = http.status >= 400;
  const payload =
    http.data && typeof http.data === "object"
      ? { httpStatus: http.status, modo: CONFIG.live ? "live" : "mock", ...http.data }
      : { httpStatus: http.status, modo: CONFIG.live ? "live" : "mock", data: http.data };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

async function handleTool(name, args = {}) {
  switch (name) {
    case "agencia_estado":
      return toolResult(await aa("GET", "/estado"));

    case "listar_clientes":
      return toolResult(await aa("GET", "/clientes"));

    case "crear_cliente":
      return toolResult(
        await aa("POST", "/clientes", {
          nombre: args.nombre,
          sector: args.sector,
          email: args.email,
          telefono: args.telefono,
          sitioWeb: args.sitioWeb,
          confirmado: args.confirmado === true,
        })
      );

    case "crear_agente_chatbot":
      // Mapeo exacto al crearAgenteSchema + createAgent() del service-operator
      return toolResult(
        await aa("POST", "/agentes", {
          name: args.name,
          sector: args.sector,
          systemPrompt: args.systemPrompt,
          runtime: args.runtime || "openai",
          confirmado: args.confirmado === true,
        })
      );

    case "convertir_lead":
      return toolResult(
        await aa("POST", `/leads/${encodeURIComponent(args.leadId)}/convertir`, {
          confirmado: args.confirmado === true,
        })
      );

    default:
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: { code: "unknown_tool", message: name } }),
          },
        ],
        isError: true,
      };
  }
}

// ─── JSON-RPC / MCP protocol ─────────────────────────────────────────────────

function send(msg) {
  output.write(JSON.stringify(msg) + "\n");
}
function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function onMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;

  try {
    switch (method) {
      case "initialize":
        sendResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        break;
      case "tools/list":
        sendResult(id, { tools: TOOLS });
        break;
      case "tools/call": {
        const toolName = params?.name;
        if (!toolName) {
          sendError(id, -32602, "Falta params.name");
          break;
        }
        const result = await handleTool(toolName, params?.arguments ?? {});
        sendResult(id, result);
        break;
      }
      case "ping":
        sendResult(id, {});
        break;
      default:
        sendError(id, -32601, `Método no soportado: ${method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`[mcp-3a] ${message}\n`);
    sendError(id, -32603, message);
  }
}

const rl = createInterface({ input, terminal: false });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  try {
    onMessage(JSON.parse(t));
  } catch {
    stderr.write(`[mcp-3a] JSON inválido\n`);
  }
});
rl.on("close", () => process.exit(0));

stderr.write(
  `[mcp-3a-plataforma] v${SERVER_INFO.version} · modo=${CONFIG.live ? "LIVE→" + CONFIG.baseUrl : "MOCK"} · tools=${TOOLS.length}\n`
);
