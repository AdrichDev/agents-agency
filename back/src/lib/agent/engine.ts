import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { toolsForProviders, INTENT_TOOL, HANDOFF_TOOL, ECOMMERCE_TOOLS } from "@/lib/agent/tools";
import {
  capabilitiesForSkills,
  logicalProviderForSkill,
  toolsForSkillProviders,
} from "@/lib/agent/skill-capabilities";
import { executeTool } from "@/lib/agent/executor";
import type { AgentReply, ChatMessage, ToolCallRecord } from "@/lib/agent/types";
import {
  appendContactDetailsRequest,
  initialLeadFlowState,
  LeadFlowState,
  nextLeadFlowStep,
} from "@/lib/lead-flow";
import type { EcommerceConfig } from "@/lib/agent/handoff";
import { CONVERSATION_STYLE_GUIDE } from "@/lib/agent/style";

const MAX_ITERATIONS = 8;

/**
 * Agentic loop completo (OpenAI function calling):
 * mensaje → el modelo decide tools → executor llama APIs reales → el modelo procesa → respuesta.
 *
 * @param contextFacts - Hechos conocidos del contacto (nombre, email, teléfono) para no
 *   re-preguntar. Parámetro opcional: retrocompatible; si es undefined, no se añade sección.
 * @param conversationId - ID de la conversación activa. Opcional (retrocompatible). Necesario
 *   para que las tools record_lead_intent y request_human_handoff persistan metadata.
 */
export async function runAgent(
  agentId: string,
  userMessage: string,
  history: ChatMessage[] = [],
  contextFacts?: string,
  conversationId?: string
): Promise<AgentReply> {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { integrations: true, skills: { include: { skill: true } } },
  });

  const connectedProviders = agent.integrations.map((i: any) => i.provider); // físicos

  // R7: filtrar skills huérfanas (skill borrada del marketplace pero AgentSkill vivo)
  const skillInputs = (agent.skills as any[])
    .filter((s) => s.skill != null)
    .map((s) => ({ id: s.skillId, name: s.skill.name, use: s.skill.use ?? "" }));

  const caps = capabilitiesForSkills(skillInputs, connectedProviders);

  // AD5: unión integraciones ∪ skills ejecutables, dedup por tool.name (integraciones ganan)
  const baseTools = toolsForProviders(connectedProviders);
  const skillTools = toolsForSkillProviders(caps.executableProviders);
  const seen = new Set(baseTools.map((t) => t.name));
  const mergedDefs = [...baseTools];
  for (const t of skillTools) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      mergedDefs.push(t);
    }
  }

  // AD9: tools siempre disponibles (handoff + intención)
  for (const t of [INTENT_TOOL, HANDOFF_TOOL]) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      mergedDefs.push(t);
    }
  }

  // AD4/R5: tools de ecommerce — condicional a orderStatusUrl
  const ecomCfg = agent.ecommerceConfig as EcommerceConfig;
  if (ecomCfg?.orderStatusUrl) {
    for (const t of ECOMMERCE_TOOLS) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        mergedDefs.push(t);
      }
    }
  }

  const tools = mergedDefs.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  // --- System prompt diferenciado (AD6, R3, R8) ---
  const systemParts: string[] = [];

  if (skillInputs.length > 0) {
    // Skills ejecutables
    const execNames = skillInputs
      .filter((s) => caps.executableProviders.includes(logicalProviderForSkill(s) ?? ""))
      .map((s) => {
        const sk = (agent.skills as any[]).find((x) => x.skillId === s.id)?.skill;
        return `- ${sk?.name ?? s.name}: ${sk?.description ?? ""}`;
      });

    // Skills con conexión pendiente
    const missingNotes = caps.missingConnections.map(
      (m) =>
        `- ${m.name}: requiere conectar "${m.physical}" en Integraciones. ` +
        `Si el usuario te pide esta capacidad, explícale honestamente que falta esa conexión; NO inventes que la ejecutaste.`
    );

    // Skills informativas (sin capacidad ejecutable)
    const infoNotes = caps.informationalSkills.map((s) => {
      const sk = (agent.skills as any[]).find((x) => x.skillId === s.skillId)?.skill;
      return `- ${sk?.name ?? s.name}: ${sk?.description ?? ""}`;
    });

    if (execNames.length > 0) {
      systemParts.push(`Skills ejecutables (PUEDES usar sus herramientas ahora mismo):\n${execNames.join("\n")}`);
    }
    if (missingNotes.length > 0) {
      systemParts.push(`Capacidades que requieren conexión pendiente:\n${missingNotes.join("\n")}`);
    }
    if (infoNotes.length > 0) {
      systemParts.push(`Skills informativas (contexto, sin acción ejecutable):\n${infoNotes.join("\n")}`);
    }
  }

  // R1/R2: bloque RAG solo si el agente tiene knowledge chunks (R1-4, regresión cero)
  const knowledgeCount = await prisma.knowledgeChunk.count({ where: { agentId } });
  const hasKnowledge = knowledgeCount > 0;
  if (hasKnowledge) {
    systemParts.push(
      `Recomendación basada en conocimiento: usa search_knowledge para encontrar\n` +
      `productos, servicios o información del negocio relevantes a lo que pide el\n` +
      `usuario. Cada resultado incluye un campo "source" (URL o documento de origen).\n` +
      `- Cuando recomiendes un producto/servicio o respondas una FAQ basándote en un\n` +
      `  resultado, CITA la fuente al final con el formato (fuente: <source>).\n` +
      `- Si "source" viene vacío para un resultado, úsalo sin citar fuente (no inventes una).\n` +
      `- Si search_knowledge no devuelve resultados relevantes, responde con tus\n` +
      `  instrucciones base. NO inventes productos ni afirmes que tienes catálogo.\n` +
      `- NUNCA cites una fuente que search_knowledge no haya devuelto.\n` +
      `- Si el usuario quiere ampliar información o le puede ser útil, ofrécele el\n` +
      `  enlace de la web de origen (cuando "source" sea una URL) para que la visite.`
    );
  }

  // AD6: guía de booking solo si calendar es ejecutable
  if (caps.executableProviders.includes("calendar")) {
    systemParts.push(
      `Reserva de citas: cuando el usuario quiera una cita, sigue este flujo antes de crear nada:\n` +
        `1. Comprueba disponibilidad con list_calendar_events para el rango pedido.\n` +
        `2. Confirma con el usuario: título/motivo, fecha y hora exactas (inicio y fin).\n` +
        `3. NO vuelvas a pedir nombre ni email si ya los conoces (ver datos del contacto abajo).\n` +
        `4. Crea el evento con create_calendar_event usando ISO 8601 (startIso < endIso).\n` +
        `5. Confirma al usuario la cita creada con fecha y hora legibles.`
    );
  }

  // R3: captura de intención (siempre — el LLM decide cuándo llamar record_lead_intent)
  systemParts.push(
    `Cuando el usuario exprese interés en un producto, servicio, plan o categoría\n` +
    `concretos, llama a record_lead_intent con una descripción breve de su interés.\n` +
    `No preguntes datos de contacto que ya conoces (ver datos del contacto).`
  );

  // R4: escalado a humano (siempre disponible)
  systemParts.push(
    `Escalado a humano: si el usuario pide hablar con una persona/agente o no puedes\n` +
    `resolver su caso, llama a request_human_handoff. La herramienta te dirá si el\n` +
    `equipo está en horario (confirma que tomarán el caso) o fuera de horario\n` +
    `(informa del horario y di que contactarán en el próximo horario disponible).\n` +
    `Nunca prometas atención inmediata fuera de horario.`
  );

  // R5: estado de pedidos (solo si orderStatusUrl configurado)
  if (ecomCfg?.orderStatusUrl) {
    systemParts.push(
      `Estado de pedidos: cuando el usuario pregunte por un pedido, pídele el número y\n` +
      `llama a get_order_status. Comunica el estado según lo que devuelva la herramienta.\n` +
      `Si la herramienta indica que no está configurada o falla, dilo honestamente y\n` +
      `ofrece escalar a una persona con request_human_handoff. Nunca inventes un estado.`
    );
  }

  // AD7: datos de contacto conocidos (no re-preguntar)
  if (contextFacts) {
    systemParts.push(`Datos del contacto ya conocidos: ${contextFacts}. Úsalos, no los vuelvas a pedir.`);
  }

  const system = [
    `Te llamas "${agent.name}". Cuando te pregunten quién eres o cómo te llamas, preséntate con ese nombre.`,
    agent.systemPrompt,
    ...systemParts,
    "Usa search_knowledge antes de responder preguntas sobre el negocio del cliente.",
    "Responde siempre en el idioma del usuario.",
    CONVERSATION_STYLE_GUIDE,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: any[] = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const toolCalls: ToolCallRecord[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: agent.model,
      max_completion_tokens: 2048,
      // los modelos razonadores (gpt-5*) no aceptan temperature
      ...(agent.model.startsWith("gpt-4") ? { temperature: agent.temperature } : {}),
      tools,
      messages,
    });

    const msg = response.choices[0].message;

    if (!msg.tool_calls?.length) {
      return { text: msg.content ?? "", toolCalls };
    }

    messages.push(msg);

    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      let output: unknown;
      let error: string | undefined;
      try {
        const input = JSON.parse(tc.function.arguments || "{}");
        output = await executeTool(agentId, tc.function.name, input, conversationId);
        toolCalls.push({ tool: tc.function.name, input, output });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        output = { error };
        toolCalls.push({ tool: tc.function.name, input: tc.function.arguments, output, error });
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(output).slice(0, 12000),
      });
    }
  }

  return {
    text: "He alcanzado el límite de pasos de esta tarea. ¿Quieres que continúe?",
    toolCalls,
  };
}

/** Ejecuta el agente y persiste la conversación. */
export async function chatWithAgent(
  agentId: string,
  userMessage: string,
  conversationId?: string,
  channel = "widget"
) {
  const conversation = conversationId
    ? await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
      })
    : await prisma.conversation.create({
        data: { agentId, channel },
        include: { messages: true },
      });

  const metadata = (conversation.metadata ?? {}) as { leadFlow?: LeadFlowState };
  const leadFlow = metadata.leadFlow ?? initialLeadFlowState();
  const flowResult = nextLeadFlowStep(leadFlow, userMessage);

  if (flowResult.handled) {
    if (flowResult.createLead) {
      await prisma.lead.upsert({
        where: { conversationId: conversation.id },
        create: {
          agentId,
          conversationId: conversation.id,
          customerName: flowResult.createLead.customerName,
          email: flowResult.createLead.email,
          phone: flowResult.createLead.phone,
          consent: flowResult.createLead.consent,
        },
        update: {
          customerName: flowResult.createLead.customerName,
          email: flowResult.createLead.email,
          phone: flowResult.createLead.phone,
          consent: flowResult.createLead.consent,
          // status se conserva: un lead escalado (handoff) no debe volver a "new"
        },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { metadata: JSON.parse(JSON.stringify({ ...metadata, leadFlow: flowResult.nextState })) },
    });
    await prisma.message.createMany({
      data: [
        { conversationId: conversation.id, role: "user", content: userMessage },
        { conversationId: conversation.id, role: "assistant", content: flowResult.reply ?? "" },
      ],
    });

    return { conversationId: conversation.id, text: flowResult.reply ?? "", toolCalls: [] };
  }

  const history = conversation.messages.map((m: any) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // AD7: construir contextFacts a partir del Lead activo y leadFlow
  let contextFacts: string | undefined;
  const lead = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
  const knownParts = [
    leadFlow.customerName && `nombre: ${leadFlow.customerName}`,
    lead?.email && `email: ${lead.email}`,
    lead?.phone && `teléfono: ${lead.phone}`,
  ].filter(Boolean) as string[];
  if (knownParts.length > 0) contextFacts = knownParts.join(", ");

  // Pasar conversationId a runAgent para que las tools de metadata puedan persistir
  const reply = await runAgent(agentId, userMessage, history, contextFacts, conversation.id);
  // El contacto humano NO se ofrece de forma proactiva. Solo se piden datos cuando
  // el agente escaló vía request_human_handoff (no puede resolver o el usuario lo pidió)
  // y aún no tenemos email/teléfono del lead.
  const handoffRequested = reply.toolCalls.some((t) => t.tool === "request_human_handoff");
  const needsContactDetails = handoffRequested && (!lead?.email || !lead?.phone);
  const finalText = needsContactDetails ? appendContactDetailsRequest(reply.text) : reply.text;
  const nextLeadFlow = needsContactDetails
    ? { ...leadFlow, step: "awaiting_contact_details" as const }
    : flowResult.nextState;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { metadata: JSON.parse(JSON.stringify({ ...metadata, leadFlow: nextLeadFlow })) },
  });

  await prisma.message.createMany({
    data: [
      { conversationId: conversation.id, role: "user", content: userMessage },
      {
        conversationId: conversation.id,
        role: "assistant",
        content: finalText,
        toolCalls: JSON.parse(JSON.stringify(reply.toolCalls)),
      },
    ],
  });

  return { conversationId: conversation.id, ...reply, text: finalText };
}
