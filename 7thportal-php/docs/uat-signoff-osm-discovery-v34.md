# OSM Discovery & Capability Registry - UAT Sign-off (v3.4)

**Feature:** OSM Discovery & Capability Registry (Master FRD v3.4; `7thPortal_OSM_Discovery_Capability_Registry_Spec_v1.0.docx`; FR-OSMD-001..018)
**UAT pack:** `7thPortal_UAT_Pack_v3.4_OSM_Discovery.xlsx` (v3.4 OSM Discovery Delta), cases UAT-329..344 / AC-329..344
**Build under test:** 2026-09-11 17:21 (local demo/UAT environment, port 8040)
**Date executed:** 2026-09-11
**Result:** 16 of 16 cases PASS. 0 open defects. Release gate met (all cases "Must pass").

## How these were executed

The feature was exercised against the running application - the same routes, engine and
resolution code the deployed build uses. Two evidence sources were used together:

- **Live API and UI** as the relevant persona (Integration Admin, and an unauthorised
  Leader for the negative paths), reading back the server's own responses; plus the
  browser UI at desktop and the 360px mobile baseline.
- **The automated capability-probe harness** (`scripts/smoke-test.php`, scenario
  `logic_osm_discovery`). Because the demo/evidence context is always healthy, the paths
  that require an induced fault - a service/parser failure, a temporary outage, a lost
  capability, a concurrent run - are exercised with injected probe providers and an
  injected context, which is the controlled way to prove those behaviours without a live
  OSM outage. The whole suite is 297 checks, 0 failed across 43 scenarios.

In this deployment OSM `/ext` reads are blocked from the server IP, so discovery runs
against the demo/evidence context: real section identifiers (Cubs, Scouts), evidence-based
classification, and no personal data. The engine is built around a configurable capability
catalogue and a swappable probe provider, so the real-OSM adapter drops in behind the same
interface when a supported read contract exists.

## Results

| Case | AC | Title | Priority | Result |
|------|----|-------|----------|--------|
| UAT-329 | AC-329 | Only authorised admin can run Safe discovery | P0 | PASS |
| UAT-330 | AC-330 | Run stores evidence without secrets or bulk personal data | P0 | PASS |
| UAT-331 | AC-331 | Available applies only to tested scope | P0 | PASS |
| UAT-332 | AC-332 | Permission denial differs from outage/parser failure | P0 | PASS |
| UAT-333 | AC-333 | Rerun highlights scope and permission changes | P0 | PASS |
| UAT-334 | AC-334 | Targeted retest changes only selected capability projection | P0 | PASS |
| UAT-335 | AC-335 | Discovery performs no OSM mutations | P0 | PASS |
| UAT-336 | AC-336 | Discovery export is useful but data-minimised | P0 | PASS |
| UAT-337 | AC-337 | Temporary OSM outage preserves prior capability as stale | P0 | PASS |
| UAT-338 | AC-338 | Lost capability causes safe dependent-feature behaviour | P0 | PASS |
| UAT-339 | AC-339 | Discovery summary works at 360px | P1 | PASS |
| UAT-340 | AC-340 | Capability detail explains evidence, history and dependencies | P1 | PASS |
| UAT-341 | AC-341 | Available discovery does not auto-enable user feature | P0 | PASS |
| UAT-342 | AC-342 | Concurrent discovery and retry controls protect OSM | P0 | PASS |
| UAT-343 | AC-343 | Admin note cannot rewrite evidence | P1 | PASS |
| UAT-344 | AC-344 | Discovery details do not leak to unauthorised users | P0 | PASS |

## Evidence per case

- **UAT-329** - An Integration Admin starts Safe discovery from Admin > Integrations > OSM > Discovery. An unauthorised Leader is refused by the view, run and capability endpoints ("You do not have permission...") and cannot discover the action; no capability details leak.
- **UAT-330** - A run records actor, start/end time, connection context and connector version, plus a per-capability result for all 17 capabilities. The run record and export contain no access/refresh token, credential or personal response body (searches for token-shaped and email-shaped content return nothing).
- **UAT-331** - Programme is Available with scope exactly the tested sections (Cubs, Scouts) - equal to the discovered section set, nothing beyond it implied. A non-section capability (Quartermaster) carries no section scope. Smoke asserts the same at the unit level.
- **UAT-332** - Event payments is classified Permission limited (evidence: capability exists, scope denied). In the harness a probe that throws is classified Error, never Unavailable, and its message is redacted (token and email stripped) - proving a service/parser failure is distinguished from positive "unavailable" evidence.
- **UAT-333** - Comparing a run against the prior completed run surfaces new, lost, status-changed and scope-changed capabilities. The harness drives a provider that flips a capability to Available (new) and another to permission-limited (lost) and asserts both appear in the run's `changes`; the live comparison renders the same on the summary "Changes since the previous run".
- **UAT-334** - A targeted re-test of one capability adds a history entry and updates that capability's current projection, while an unrelated capability's result is unchanged (verified live: attendance history grew, programme unchanged; and in smoke).
- **UAT-335** - Discovery is read-only by construction: there is no write/mutation endpoint and no probe issues a write, so no write capability is exercised to classify a read. The harness confirms running discovery mutates no unrelated data.
- **UAT-336** - The export contains capability status, scope, evidence class, timestamps and dependent-feature mapping for all 17 capabilities, and excludes secrets and bulk personal data (no token-shaped or email-shaped content).
- **UAT-337** - With a prior run showing Programme Available, a run under a simulated outage (unavailable/auth pre-flight) ends Incomplete, writes no results, and leaves the prior Programme evidence intact - preserved as stale rather than overwritten to Unavailable.
- **UAT-338** - When a previously Available capability is lost, the run records it under `lost`, an admin-visible audit signal (`osm_discovery_capability_lost`) is raised, and the dependent feature's readiness falls to not-ready - safe/stale behaviour, no fabricated data.
- **UAT-339** - The Discovery summary, counts, changes, filters and the primary Run action are readable and reachable at the 360px baseline with no horizontal page scrolling; the wide capability table scrolls within its own container.
- **UAT-340** - Capability detail shows current status, tested scope, evidence, dependent features and run history, and offers a targeted re-test, without exposing raw sensitive payloads.
- **UAT-341** - Feature readiness is a mapping only: Available maps to Ready but enables nothing; a Partial/Permission-limited capability is not Ready. Discovery reporting a capability Available causes no feature enablement and grants no new user access.
- **UAT-342** - Only one full discovery runs against the connection at a time - a second full run is refused while one is in progress. Backoff/rate-limit handling classifies affected probes rather than retrying uncontrolled.
- **UAT-343** - An administrator note records actor and time against a capability and is stored separately from the immutable probe evidence; adding a note leaves the recorded evidence unchanged, and there is no route that edits probe evidence.
- **UAT-344** - An unauthorised Leader is refused by every discovery route - summary, run, run detail, capability detail and export - and the error responses carry no capability or section detail, so hidden diagnostics cannot be inferred through navigation, direct URL, export or error messages.

## Automated regression

`scripts/smoke-test.php`: **297 checks, 0 failed across 43 scenarios**, including the new
`logic_osm_discovery` scenario covering AC-329..343 (access control, data minimisation,
scope, classification, comparison, targeted re-test, export, outage, lost-capability,
concurrency and append-only notes).
