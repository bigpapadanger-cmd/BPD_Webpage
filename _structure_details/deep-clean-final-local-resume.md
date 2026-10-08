# Deep Clean V2 — final local completion pause

Superseded: resumed and completed locally on 2026-10-07. See deep-clean-final-local.md and the current tracker. The remaining list below records the earlier pause.

Paused at the user's request on 2026-10-07 to conserve the remaining five-hour usage allowance. This is a safe implementation checkpoint, not final local completion or release approval.

## Current section

Final local completion pass, including remaining 1B/1C security/privacy hardening and Phases 5–8 verification. Supabase spectator and Admin Recovery acceptances are PASS; the database contract remains frozen. No deployment, push, Supabase change, production configuration change, or runtime activation has occurred.

## Implemented in this pass

- Task Board modal focus containment, nested-dialog focus restoration, background inert behavior and navigation cleanup; corrected successful Task Edit dismissal and underlying overlay scroll state.
- Bounded FAQ and Admin Suggestions response handling through body decoding.
- Sanitized legacy server logging using the existing diagnostic infrastructure; protected IDs, payloads, errors and secrets are excluded while allowlisted operational evidence remains.
- Removed redundant internal/provider identifiers from Rocket League session/profile projections and browser provider metadata. Internal canonical server identities remain unchanged.
- Staged report-only CSP/Trusted Types observation and short HTTPS HSTS policy; encoded Admin route origin checks remain enforced. Enforcement and production observation remain release gates.
- Corrected shell heading hierarchy and made OCR review policy load with its consumers.
- Removed proven orphan Links assets and empty Task History HTML; retained route stubs, legacy modules and other files with genuine consumers/contracts.

## Verification achieved, with limits

- Latest identity-focused run: 93 passed, zero failures/skips. Earlier focused modal, request-boundary and security runs passed; overlapping runs must not be summed.
- Intermediate Pages/assets compile passed; all seven repository Workers passed compile-only dry runs.
- Local unavailable/empty-data public preview: 20 routes across five viewport widths (100 checks), with no page overflow and one visible primary heading. Skip-link and nested modal keyboard behavior also checked.
- These checks do not prove populated/private production behavior. Final full regression and final builds after the latest edits have NOT run.
- Previous accepted complete regression remains 850 passed, zero failures/skips. Do not represent that historical result as verification of all current edits.

## Next work, in order

1. Complete the reviewed browser account-scope change: global auth session still serializes canonical userId. A deterministic versioned SHA-256 UI scope can replace that browser field while retaining server canonical identities. Scope is a correlatable UI namespace, not authorization or anonymization. Update global Auth, account presence, Rocket League auth adapters and registration draft ownership together.
2. Preserve registration drafts through narrowly matched legacy UUID-key migration. Match the legacy key hash to the current server scope, await migration before reads/writes, guard account switches, preserve existing scoped drafts and unrelated/unscoped drafts, and remove matching legacy data only after successful migration. Never use scope as a server RPC identity.
3. Add focused scope/session/account-switch/draft-migration tests and update browser DTO fixtures without changing internal server identity fixtures.
4. Run the complete test set across tests/ocr, rocketleague, suggestions, route_health, admin and every workers/*/tests suite; run final Pages production build and all seven Worker dry-run compiles. Resolve failures caused by this work.
5. Finish current local performance/dead-code/a11y/SEO reconciliation, synchronize System Map and folder inventories, and create deep-clean-final-local.md with every workstream classification, exact files, final counts, retained exceptions, live gates, release sequence and rollback considerations.
6. Stop before deployment and await approval. Keep Custom Match and new Discord runtime delivery disabled.

## Evidence and file accounting

Intermediate logs reside in .wrangler/health-validation/final-local-* (ignored local artifacts). The start-of-pass file/hash inventory is .wrangler/final-local-baseline.json; compare current files against it for the final-pass changed-file list. Sanitized logging file inventory is .wrangler/final-local-logging-files.json. Earlier authoritative records are deep-clean-progress.md, deep-clean-hardening.md and deep-clean-continuation.md; this pause supersedes their implication that the final local pass is already complete.

Production User Management, FAQ and Leaderboard root causes still require released diagnostics and authorized reproduction evidence. No speculative repair is authorized. Live Admin checks require a valid authorized session. Real Custom Match transport, populated graphs/Shop, Discord delivery, production security-header behavior and fresh production performance acceptance remain pending.
