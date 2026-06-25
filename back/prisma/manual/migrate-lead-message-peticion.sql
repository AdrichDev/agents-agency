-- Migration: voluntary message on leads + peticion on prospect contacts
-- LandingLead.message: comentario opcional que el lead deja en el formulario
-- ProspectContact.peticion: ese mensaje heredado al crear el contacto (o nota manual)
ALTER TABLE "LandingLead" ADD COLUMN IF NOT EXISTS "message" TEXT;
ALTER TABLE "ProspectContact" ADD COLUMN IF NOT EXISTS "peticion" TEXT;
