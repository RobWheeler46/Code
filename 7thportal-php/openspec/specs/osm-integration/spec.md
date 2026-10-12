# OSM Integration Specification

## Purpose

Read operational data from Online Scout Manager (the system of record) without hammering its rate limits, cache it locally so dashboards never call OSM live, and surface only what each role is permitted to see - with named member data read through to authorised viewers rather than stored.

## Requirements

### Requirement: Token resolution
The system SHALL resolve which OSM token reads for a request: a leader or admin uses their own OSM token; a parent (who has no OSM login) is read through the shared service connection; and when no live token is available the caller receives an "unavailable" result rather than an error.

#### Scenario: Parent dashboard read
- **WHEN** a parent dashboard needs OSM data
- **THEN** the shared service connection's token is used, or a clear "Live OSM information cannot currently be loaded" result is returned if it is unavailable

### Requirement: Correct OSM request parameters
The system SHALL call OSM's `/ext` endpoints with un-underscored integer parameters (`sectionid`, `termid`), and SHALL use `termid=-1` for sections that have no term (for example the waiting list).

#### Scenario: Programme read
- **WHEN** the portal reads a section's programme
- **THEN** it sends `sectionid` and `termid` and OSM returns the programme items

### Requirement: Cached section sync, not live reads
The system SHALL populate a local mirror of per-section data (member count, next programme item, next event) through a paced sync, and dashboards SHALL read only the mirror, never calling OSM during a page load.

#### Scenario: Admin runs the sync
- **WHEN** an administrator triggers the OSM sync
- **THEN** each accessible youth section's count and next programme item and next event are read once, written to the mirror, and the sync stops immediately if OSM blocks a read

#### Scenario: Dashboard render
- **WHEN** a leader opens their dashboard
- **THEN** section counts and the next meeting and next event are shown from the mirror with no live OSM call

### Requirement: Scheduled sync
The system SHALL expose a scheduled sync endpoint that runs through the service account with no logged-in user, gated by a secret key, so a cron job can refresh the mirror unattended.

#### Scenario: Cron hit with the key
- **WHEN** the scheduled endpoint is called with the configured key
- **THEN** the sync runs through the service account and returns how many sections were refreshed

#### Scenario: Missing or wrong key
- **WHEN** the key is not configured
- **THEN** the endpoint responds as not found; **AND WHEN** the key is wrong it responds forbidden

### Requirement: Degrade, never break
The system SHALL treat every OSM read as best-effort: a failure returns "data not available" and the page still renders.

#### Scenario: OSM unavailable
- **WHEN** an OSM read fails
- **THEN** the affected section shows an unavailable notice and the rest of the page renders normally

### Requirement: Capability discovery
The system SHALL provide an administrator-only, read-only probe that records which OSM capabilities the connection exposes, as immutable runs and a registry projection, and SHALL never enable a feature or broaden a permission from a probe.

#### Scenario: Run discovery
- **WHEN** an administrator runs discovery
- **THEN** each capability is classified from real evidence (or Unknown where no probe exists) and stored without tokens or personal response bodies

### Requirement: Badges awarded are catalogue-only until permitted
The system SHALL show the per-section badge catalogue (badges offered) as aggregate Tier A data, and SHALL NOT present awarded counts unless the connection has the OSM Badges permission that exposes member badge records; a section whose award data cannot be read is marked for check rather than shown as zero.

#### Scenario: Catalogue read only
- **WHEN** the badges summary refreshes and the connection lacks member badge-record permission
- **THEN** badges offered are shown and awarded counts are marked as pending rather than reported as zero
