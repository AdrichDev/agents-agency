# Apply Progress ? aa-token-metering-crm

## Status

8/9 tasks complete. Implementation remains blocked only on the live CRM?AA browser/API smoke that requires a valid CRM operator session.

## Completed in this pass

- [x] Created missing OpenSpec artifacts:
  - `specs/crm-ai-generation/spec.md`
  - `design.md`
- [x] Added Review Workload Forecast to `tasks.md`.
- [x] Verified required server-side env variable names are present without printing secret values:
  - AA back: `AA_SERVICE_TOKEN`
  - CRM front server: `AA_SERVICE_TOKEN`, `AA_API_URL`
- [x] Re-ran AA backend verification:
  - `npm run typecheck` ? PASS
  - `npm test -- --reporter=basic` ? PASS, 45 files, 543 passed, 3 skipped

## Remaining

- [ ] Run live CRM?AA smoke for the "Generar con IA" flow with a valid CRM operator session.

## Notes

- No production source code was changed in this pass.
- The AA test suite still emits a `MaxListenersExceededWarning`; tests pass, but the warning remains a separate quality issue.
