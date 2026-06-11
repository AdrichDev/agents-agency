import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { toolsForProviders } from "@/lib/agent/tools";
import { executeTool } from "@/lib/agent/executor";
import type { AgentReply, ChatMessage, ToolCallRecord } from "@/lib/agent/types";
import {
  appendContactQuestion,
  initialLeadFlowState,
  LeadFlowState,
  nextLeadFlowStep,
} from "@/lib/lead-flow";

const MAX_ITERATIONS = 8;

/**
 * Agentic loop completo (OpenAI function calling):
 * mensaje → el modelo decide tools → executor llama APIs reales → el modelo procesa → respuesta.
 */
export async function runAgent(
  agentId: string,
  userMessage: string,
  history: ChatMessage[] = []
): Promise<AgentReply> {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { integrations: true, skills: { include: { skill: true } } },
  });

  const tools = toolsForProviders(agent.integrations.map((i: any) => i.provider)).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const skillNotes = agent.skills
    .map((s: any) => `- ${s.skill.name}: ${s.skill.description}`)
    .join("\n");

  const system = [
    `Te llamas "${agent.name}". Cuando te pregunten quién eres o cómo te llamas, preséntate con ese nombre.`,
    agent.systemPrompt,
    skillNotes && `Skills instaladas:\n${skillNotes}`,
    "Usa search_knowledge antes de responder preguntas sobre el negocio del cliente.",
    "Responde siempre en el idioma del usuario.",
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
        output = await executeTool(agentId, tc.function.name, input);
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
          status: "new",
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

  const reply = await runAgent(agentId, userMessage, history);
  const shouldAskContact = leadFlow.step === "assisting";
  const finalText = shouldAskContact ? appendContactQuestion(reply.text) : reply.text;
  const nextLeadFlow = shouldAskContact
    ? { ...leadFlow, step: "awaiting_contact_consent" as const }
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
