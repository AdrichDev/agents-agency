-- aa-agent-skills-install-execute F2b / Nivel 2 (T6.1)
-- Migracion ADITIVA: añade las tools externas MCP curadas por skill y el secreto
-- MCP per-agente-per-skill (cifrado enc:v1:). NO altera ni borra columnas existentes.
-- null permitido en todas: una skill sigue instalable y ejecutable a nivel instruccion
-- sin MCP; una AgentSkill sin secreto queda en estado "MCP pendiente" (degrada al
-- baseline de instruccion, kill switch cerrado por defecto). El secreto es per-agente:
-- JAMAS un token global (anti-patron OPERATOR_SERVICE_TOKEN).

-- AlterTable skill: servidor MCP curado (url + transporte http|sse)
ALTER TABLE "skill" ADD COLUMN "mcp_url" TEXT;
ALTER TABLE "skill" ADD COLUMN "mcp_transport" TEXT;

-- AlterTable agente_skill: secreto MCP per-agente cifrado (enc:v1:)
ALTER TABLE "agente_skill" ADD COLUMN "secreto_cifrado" TEXT;
