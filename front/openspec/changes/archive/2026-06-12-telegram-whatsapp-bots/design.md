[ARCHIVED DESIGN]

This design has been integrated into the implementation. Key decisions documented in specs/channels.md.

Archive date: 2026-06-12
Original location: front/openspec/changes/telegram-whatsapp-bots/design.md

Decision records (ADR):
- AD1: ChannelConnection model separate from Integration (SRP)
- AD2: Router extract to back/src/routes/channels.ts (file size limit)
- AD3: Client libraries in back/src/lib/channels/ (reusability)
- AD4: Dedup via in-memory Map TTL, not DB table (low volume)
- AD5: Reuse chatWithAgent without signature change
- AD6: X-Hub-Signature-256 validation conditional to META_APP_SECRET
- AD7: META_GRAPH_VERSION default v21.0 (parametrized)
- AD8: PUBLIC_URL separate from BACK_URL (semantically distinct)
