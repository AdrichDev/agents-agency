#!/usr/bin/env node
/**
 * Cliente de prueba: orden = "crea un chatbot para un cliente"
 * Usa las tools que mapean a service-operator de agents-agency.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "server.js");

function log(label, data) {
  console.log(`\n── ${label} ──`);
  if (typeof data === "string") console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const child = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let buffer = "";
  const pending = new Map();
  let nextId = 1;

  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id != null && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch { /* ignore */ }
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout en ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  function parseTool(msg) {
    const text = msg?.result?.content?.[0]?.text;
    return text ? JSON.parse(text) : msg;
  }

  try {
    const init = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.2.0" },
    });
    log("initialize", init.result);

    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
    );

    const tools = await request("tools/list");
    log(
      "tools/list",
      tools.result.tools.map((t) => t.name)
    );

    // 1. Estado de la plataforma (GET /service/operator/estado)
    log("agencia_estado", parseTool(await request("tools/call", { name: "agencia_estado", arguments: {} })));

    // 2. Listar clientes existentes
    log("listar_clientes", parseTool(await request("tools/call", { name: "listar_clientes", arguments: {} })));

    // 3. Crear chatbot SIN confirmación → debe fallar con confirmation_required
    log(
      "crear_agente_chatbot (sin confirmado)",
      parseTool(
        await request("tools/call", {
          name: "crear_agente_chatbot",
          arguments: {
            name: "Chatbot Web Jorjotas",
            sector: "peluqueria",
            systemPrompt:
              "Eres el recepcionista virtual de Barbería Jorjotas. Ayuda a reservar citas y responder dudas sobre servicios.",
          },
        })
      )
    );

    // 4. Orden real: crear chatbot CON confirmación
    //    → en LIVE esto ejecuta createAgent() en agents-agency
    log(
      "crear_agente_chatbot (CONFIRMADO) ★",
      parseTool(
        await request("tools/call", {
          name: "crear_agente_chatbot",
          arguments: {
            name: "Chatbot Web Jorjotas",
            sector: "peluqueria",
            systemPrompt:
              "Eres el recepcionista virtual de Barbería Jorjotas. Ayuda a reservar citas y responder dudas sobre servicios.",
            runtime: "openai",
            confirmado: true,
          },
        })
      )
    );

    // 5. Estado tras la creación
    log("agencia_estado (después)", parseTool(await request("tools/call", { name: "agencia_estado", arguments: {} })));

    console.log("\n✅ Orden ejecutada vía service-operator (createAgent), no generando código.\n");
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
}

main();
