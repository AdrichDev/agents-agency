# Tasks — Lead Message & CRM Actions

- [x] 1. Schema: `LandingLead.message` + `ProspectContact.peticion` + migración SQL + `prisma db push`
- [x] 2. Backend leads: `public.ts` recoge `message`; `notifications.ts` propaga `message`/`peticion`
- [x] 3. Backend contacts: default `contactado="no"`, `peticion` en schemas/handlers, endpoint `convert-to-clients`
- [x] 4. n8n: fila `message` + botón mailto "Responder al lead" en el workflow JSON
- [x] 5. Front: textarea opcional en `LeadForm.tsx`
- [x] 6. Front: columna Petición + modal (X gira 90°), modo selección "Añadir a cliente" + modal confirmación
- [x] 7. Tests + build: actualizar `contacts.test.ts` (default no), test convert, `vitest` + `tsc --noEmit`
