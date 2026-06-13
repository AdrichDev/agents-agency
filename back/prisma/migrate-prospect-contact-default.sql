-- Migration: change default contactado from nc to no for new ProspectContact records
-- Existing records with nc are intentionally left unchanged (nc = no info = valid state)
-- Only new records will default to 'no' via the schema change

-- Update any existing leads (type='lead') that have nc to no, since a lead
-- that hasn't been called yet should be explicitly "no" (not contacted)
UPDATE "ProspectContact"
SET "contactado" = 'no'
WHERE "type" = 'lead' AND "contactado" = 'nc';
