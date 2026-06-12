# Skills Execution Flow Specification

## Purpose

Define the behavior of executable skills: how a skill assigned to an agent translates into
real tool calls when the required integration is connected, and how the system behaves
honestly when it is not.

---

## Requirements

### Requirement: Skill-to-Capability Catalog

The system MUST maintain a deterministic, static catalog that maps each skill (matched by
`Skill.use` field, with optional override by `Skill.name`) to a set of logical provider
keys (e.g. `calendar`, `gmail`, `slack`) and the corresponding tool names from
`TOOLS_BY_PROVIDER`. A skill with no catalog entry remains informative: its name and
description appear in the system prompt as today, and it MUST NOT be treated as executable.

#### Scenario: Known skill mapped to provider

- GIVEN a skill with `use = "CALENDARIO"` exists in the catalog
- WHEN the catalog is queried for that skill
- THEN it returns `{ logicalProviders: ["calendar"], tools: ["list_calendar_events", "create_calendar_event"] }`

#### Scenario: Unknown skill has no catalog entry

- GIVEN a skill whose `use` value is not present in the catalog
- WHEN the catalog is queried
- THEN it returns no providers and no tools
- AND the skill is classified as informative

---

### Requirement: Tool Union in runAgent

When `runAgent` starts, the effective tool set MUST equal the union of:
(a) tools from connected integrations (existing `toolsForProviders` logic), and
(b) tools from assigned skills whose required physical provider appears in
`agent.integrations`. Duplicate tool names MUST be deduplicated; the first occurrence
(integrations-sourced) wins. A skill whose required provider is not connected MUST
contribute zero tools.

#### Scenario: Skill provider connected

- GIVEN an agent has skill `CALENDARIO` assigned and integration `google` connected
- WHEN `runAgent` builds the tool list
- THEN `list_calendar_events` and `create_calendar_event` appear exactly once

#### Scenario: Skill provider not connected

- GIVEN an agent has skill `CALENDARIO` assigned but no `google` integration
- WHEN `runAgent` builds the tool list
- THEN neither `list_calendar_events` nor `create_calendar_event` appears
- AND the system prompt contains a note that the calendar capability requires connecting the provider

#### Scenario: Two skills map to same provider (dedup)

- GIVEN two skills both map to logical provider `calendar`
- WHEN `runAgent` builds the tool list with `google` connected
- THEN each tool name appears exactly once

#### Scenario: Integration disconnected after skill assignment

- GIVEN skill `CALENDARIO` was assigned while `google` was connected, then `google` was removed
- WHEN `runAgent` is called next
- THEN the calendar tools are absent from the tool list
- AND the system prompt note about missing connection is present

---

### Requirement: Honest System Prompt for Unconnected Skills

For each skill assigned to an agent whose required provider is NOT connected, the system
prompt MUST include a machine-readable instruction stating the skill name and the missing
provider. The agent MUST NOT claim it can execute that skill, and MUST direct the user to
connect the provider.

#### Scenario: Agent asked about unavailable skill

- GIVEN skill `CALENDARIO` is assigned but `google` is not connected
- WHEN a user asks "can you book me an appointment?"
- THEN the agent replies explaining the calendar integration is not connected, without
  pretending to have created an event

---

### Requirement: Booking E2E Flow (Calendar)

An agent with skill `CALENDARIO` and `google` connected MUST support end-to-end appointment
booking via any channel that routes through `chatWithAgent` (widget, Telegram, WhatsApp).
The agent MUST confirm title, `startIso`, `endIso`, and optionally attendees before calling
`create_calendar_event`. The `startIso`/`endIso` values MUST be validated as ISO 8601 and
`endIso > startIso` before the tool call; an invalid value MUST return a legible error to
the model without crashing the loop. Contact data already captured by lead-flow MUST be
reused: the agent MUST NOT re-ask for name or email already present in the active `Lead`.

#### Scenario: Happy path booking

- GIVEN agent has `CALENDARIO` skill + `google` connected, lead-flow is in `assisting` state
- WHEN user says "I want an appointment on Thursday at 10 am"
- THEN agent calls `list_calendar_events` to check availability
- AND agent confirms missing fields (title, exact time range) before creating
- AND agent calls `create_calendar_event` with valid ISO times
- AND the tool calls are recorded in `Message.toolCalls`

#### Scenario: Invalid datetime provided by model

- GIVEN `create_calendar_event` is about to be called with `endIso` earlier than `startIso`
- WHEN the validator runs
- THEN the tool call is rejected with a descriptive error string returned to the model
- AND the agent retries by asking the user to clarify the time

#### Scenario: Lead data reuse

- GIVEN a Lead with `customerName` and `email` exists for the conversation
- WHEN the agent confirms a booking
- THEN the booking includes the existing contact data without asking the user again
- AND the Lead record is updated via upsert (no duplicate Lead created)

---

### Requirement: Skill Status in Agent Panel

The agent detail panel MUST display, for each assigned skill, one of three states:

| State | Condition | Display |
|-------|-----------|---------|
| Executable | Catalog entry found AND required provider connected | Badge "Ejecutable" |
| Requires connection | Catalog entry found AND required provider not connected | Badge "Conecta {provider}" + CTA to Integraciones tab |
| Informative | No catalog entry | Badge "Informativa" |

The SkillsStep wizard component MUST show the same badge alongside each skill card without
blocking selection.

#### Scenario: Skill shows executable state

- GIVEN agent has `CALENDARIO` assigned and `google` integration is connected
- WHEN the agent detail panel loads
- THEN the calendar skill badge reads "Ejecutable"

#### Scenario: Skill shows requires-connection state

- GIVEN agent has `CALENDARIO` assigned but no `google` integration
- WHEN the agent detail panel loads
- THEN the calendar skill badge reads "Conecta google" with a link to Integraciones

#### Scenario: Informative skill

- GIVEN a skill with no catalog entry is assigned
- WHEN the agent detail panel loads
- THEN the skill badge reads "Informativa"

---

### Requirement: Tool Call Traceability

Every tool call originating from a skill MUST be recorded in `Message.toolCalls` using the
existing `ToolCallRecord` structure. No new schema columns are required. The LogsPanel
MUST render skill-originated tool calls identically to integration-originated ones.

#### Scenario: Tool calls persisted

- GIVEN a booking flow executes `list_calendar_events` and `create_calendar_event`
- WHEN `chatWithAgent` persists the reply message
- THEN `Message.toolCalls` contains both records with `tool`, `input`, and `output`

---

### Requirement: Deleted Marketplace Skill

If a skill is deleted from the marketplace while an agent still holds an `AgentSkill`
reference, `runAgent` MUST NOT crash. The orphaned `AgentSkill` row MUST be treated as
informative (no tools exposed, no prompt note about missing integration).

#### Scenario: Orphaned AgentSkill at runtime

- GIVEN a skill is deleted from the Skill table after being assigned to an agent
- WHEN `runAgent` is called for that agent
- THEN the run completes without error
- AND no tools from the deleted skill are included

---

### Requirement: Zero Regression for Agentless Skills

An agent with no assigned skills MUST behave exactly as today: `toolsForProviders` is the
sole source of tools, and the system prompt contains no skill notes section.

#### Scenario: Agent without skills

- GIVEN an agent has zero assigned skills
- WHEN `runAgent` is called
- THEN the tool list equals the output of `toolsForProviders(agent.integrations)`
- AND the system prompt contains no "Skills instaladas" section
