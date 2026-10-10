# DomainData — Project Development Guidance

## Project Purpose

This file contains guidance specific to the DomainData repository.

Global Codex operating guidance is inherited separately. This file should describe the repository's actual structure, architecture, contracts, workflows, and verification requirements.

Do not duplicate global coordination policy here unless a DomainData-specific rule requires an exception.

----

## Repository Structure

Before making structural changes, inspect the repository and establish the current layout.

Use the repository's existing structure as the source of truth.

When `_folder_structure` exists:

* keep it synchronized with the actual repository
* update it after meaningful structural changes
* remove entries that no longer exist
* do not document speculative future structure as current structure

Do not reorganize directories merely for aesthetic reasons.

---

## Architecture

Understand the existing architecture before introducing new infrastructure.

Trace the actual execution path through relevant:

* entry points
* services
* APIs
* gateways
* queues
* workers
* processing stages
* storage
* databases
* external integrations
* clients
* orchestration
* configuration
* observability

Document the architecture that actually exists.

Do not create a new architectural layer until the limitation of the existing path has been established.

---

## Routing and Orchestration

When a change affects multiple execution stages, inspect the existing:

* routing
* dispatch
* queues
* workers
* orchestration
* concurrency
* prioritization
* batching
* caching
* backpressure
* retries
* idempotency
* failure handling
* service boundaries
* latency
* throughput
* workload distribution

Trace the current path before introducing a new routing or processing layer.

Prefer improving an existing path over creating a parallel path.

Do not introduce duplicate gateways, queues, workers, services, storage layers, processing stages, orchestration systems, or dependencies without concrete evidence that the existing implementation cannot satisfy the requirement.

---

## Contracts

Treat shared interfaces and contracts as controlled boundaries.

Relevant contracts may include:

* APIs
* schemas
* database structures
* serialized formats
* configuration
* storage formats
* service interfaces
* client/server expectations
* queue messages
* external integrations

Before changing a contract:

1. identify current consumers
2. identify historical consumers or stored artifacts
3. determine compatibility impact
4. identify migration requirements
5. identify rollback requirements
6. define verification

Shared contract changes should have one clear writer during a task.

When a contract changes, document the change and update affected consumers.

---

## Data and Schema

For database or schema work:

* inspect the existing schema before changing it
* identify current consumers
* preserve existing data unless deliberate migration requires otherwise
* verify serialization and deserialization behavior
* consider historical records
* identify migration and rollback requirements
* test compatibility with existing consumers

Do not introduce a duplicate schema, storage layer, or data-processing path without establishing why the existing one is insufficient.

---

## Domain-Specific Processing

Specialized processing must remain subordinate to the repository's general architecture.

Where relevant, this may include:

* data processing
* OCR
* image preprocessing
* computer vision
* confidence handling
* structured extraction
* review workflows
* external processing services
* object storage
* queues
* browser capture

Treat these as implementation concerns rather than independent architectural boundaries.

Do not assume a specialized workload exists unless repository evidence establishes that it does.

Do not allow a specialized workload to create unnecessary parallel infrastructure.

---

## Security and Trust Boundaries

When changes affect security-sensitive behavior, inspect:

* authentication
* authorization
* trust boundaries
* credentials
* secrets
* permissions
* external integrations
* input validation
* data exposure
* privileged operations

Preserve established security boundaries unless there is a documented reason to change them.

Do not expose secrets, credentials, tokens, or sensitive configuration in source, logs, tests, documentation, or generated artifacts.

Security-impacting changes require explicit verification.

---

## Testing and Regression

Verification must match the affected system.

Use the repository's existing tests and validation mechanisms whenever available.

For meaningful changes, consider applicable:

* unit tests
* integration tests
* regression tests
* API compatibility
* data compatibility
* client/browser behavior
* authentication/authorization
* failure handling
* retry behavior
* idempotency
* concurrency
* performance
* accessibility
* historical artifacts
* end-to-end behavior

Use independent regression or architectural review only when the change warrants it.

Do not invoke every possible reviewer for every change.

---

## Performance and Optimization

Optimize based on evidence.

For performance work:

1. establish a relevant baseline when practical
2. identify the actual bottleneck
3. make the smallest meaningful change
4. measure or otherwise verify the result

Prefer:

* measurement over intuition
* profiling over speculation
* reuse over duplication
* simplification over additional layers
* explicit contracts over implicit coupling
* measured improvements over theoretical improvements
* bounded changes over rewrites

Do not describe an implementation as optimized merely because it is cleaner.

---

## 2026 SEO, Lighthouse & Frontend Performance Standards

For frontend work, invoke the `frontend-review` Codex skill and read its canonical `SKILL.md` before planning implementation. Its installed location in the current environment is `C:\Users\bruck\.codex\skills\frontend-review\SKILL.md`; use the configured skill root on other machines. Apply it whenever work affects:

* HTML structure or metadata
* CSS or page layouts
* JavaScript delivery or execution
* frontend routing
* static assets or images
* Cloudflare Pages asset delivery
* SEO, accessibility, Lighthouse findings, or Core Web Vitals
* frontend build optimization

Do not activate it for backend-only changes without frontend impact.

Relevant frontend work must inspect the existing architecture before implementation, follow the skill’s standards, avoid unnecessary render-blocking resources, preserve efficient LCP resource discovery, minimize critical network dependency chains, and avoid shipping unnecessary JavaScript. Maintain semantic, crawlable HTML, accessibility, responsive behavior, appropriate caching, and security boundaries. Verify affected routes before completion.

Use existing build and test tooling before adding dependencies or checks. `npm run check:frontend` runs the Pages/assets build validation followed by route-health checks against the built public assets. These checks cover JavaScript/CSS build errors and minification, route metadata and sitemap privacy, and built CSS asset references. The asset build also emits `.wrangler/public-build-report.json` with aggregate source/output byte counts; it is a measurement report, not a size-budget gate. Do not add an arbitrary bundle budget without an agreed baseline and regression policy.

Choose verification depth proportionately:

* **Level 1 — Routine changes:** run relevant static checks, `npm run check:frontend`, and affected-route smoke tests.
* **Level 2 — Significant frontend changes:** run Level 1 checks, Lighthouse lab tests, desktop/mobile comparisons, critical-resource analysis, and accessibility/SEO checks.
* **Level 3 — Release verification:** cover representative site-wide routes, all four Lighthouse categories, Core Web Vitals, authentication and routing regressions, and produce a final issue report.

Do not run an expensive site-wide audit for every edit. Lighthouse and browser checks are verification steps; this standard does not change deployment behavior or authorize deployment.

---

## Implementation

For meaningful implementation work, identify:

* objective
* affected files
* dependencies
* expected behavior
* compatibility considerations
* verification method

Prefer small, measurable phases.

Preserve existing behavior unless a deliberate compatibility-breaking change is required.

Avoid unrelated refactoring while implementing a focused requirement.

If unrelated technical debt is discovered, record it separately rather than expanding the current change without justification.

---

## Documentation

After meaningful changes:

* update affected architecture documentation
* update ownership documentation
* update affected-file documentation
* synchronize `_folder_structure` when it exists
* document changed contracts
* remove obsolete documentation
* ensure documentation describes the implementation that actually exists

Do not preserve documentation that describes an architecture that has been removed.

Do not create documentation for speculative architecture that does not exist.

Documentation is part of the implementation surface when it describes repository structure, contracts, architecture, or operational behavior.

---

## Code Review

When reviewing DomainData changes, prioritize:

1. correctness
2. regressions
3. compatibility
4. security
5. contract integrity
6. architecture
7. performance
8. maintainability

Review actual system impact, not only the files directly changed.

Flag:

* duplicated infrastructure
* broken contracts
* unsafe migrations
* hidden compatibility breaks
* unnecessary complexity
* missing failure handling
* unverified performance claims
* insufficient tests
* stale documentation

For every substantive finding, provide concrete evidence and a safe path to address it.

---

## Change Boundaries

A change should remain within the requested scope unless expanding the scope is necessary to:

* preserve correctness
* preserve compatibility
* satisfy a contract
* complete required verification
* remove a directly created inconsistency

Do not broaden a task merely because adjacent improvements are available.

Prefer follow-up work for unrelated improvements.

---

## DomainData Decision Rule

When multiple implementations can satisfy the requirement, prefer the one that:

1. fits the existing DomainData architecture
2. preserves compatibility
3. reuses existing infrastructure
4. minimizes new files and abstractions
5. minimizes operational complexity
6. has clear ownership
7. is straightforward to test
8. can be incrementally changed later

Do not introduce a new subsystem when an existing component can safely perform the required function.

---

## DomainData Completion Standard

A meaningful DomainData change is complete when:

* the requested behavior is implemented
* affected contracts remain valid or are deliberately migrated
* relevant tests or verification have been performed
* no unnecessary duplicate infrastructure was introduced
* affected documentation is current
* `_folder_structure` is synchronized when applicable
* compatibility implications are understood
* the final implementation matches the repository's actual architecture

The repository documentation, implementation, and actual runtime behavior should describe the same system.
