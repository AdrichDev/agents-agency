-- T9 aa-agenda-crm-parity: contacto opcional en citas manuales del owner.
-- Permite cruzar email/telefono contra Tenant/ProspectContact (contactSummary).
ALTER TABLE "cita_agenda_plataforma"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "telefono" TEXT;
