# Authentication Specification

## Purpose

Establish who a user is and what role they hold, supporting two sign-in paths (leader OSM OAuth and local parent accounts), a demo mode, and session handling, so every other capability can enforce access by role.

## Requirements

### Requirement: Local account sign-in
The system SHALL let a user with a local account sign in with an email and password, verified with PHP's native password hashing (bcrypt), and establish a server session on success.

#### Scenario: Correct credentials
- **WHEN** a user submits a valid email and the matching password
- **THEN** a session is established and the user is routed to the dashboard for their role

#### Scenario: Wrong password
- **WHEN** the password does not match
- **THEN** sign-in is refused with a generic failure message and no session is created

### Requirement: Leader OSM sign-in
The system SHALL let a leader authenticate through OSM's OAuth 2.0 flow, capturing their OSM roles and terms for section-scoped access, and SHALL never expose tokens to the browser.

#### Scenario: Leader authorises the app
- **WHEN** a leader completes the OSM authorisation and the callback exchanges the code for a token
- **THEN** the leader is signed in, their section roles and terms are stored, and the access token is held server-side only

### Requirement: Read-only OSM login diagnostic
The system SHALL provide a diagnostic sign-in that runs the real OSM authorisation and one startup call, then stops, storing nothing on the server beyond the session and showing the token-redacted payload once.

#### Scenario: Diagnostic run
- **WHEN** a user runs the OSM diagnostic
- **THEN** no portal session is created, no data is persisted, and the redacted startup payload is shown for a single view

### Requirement: Role-derived capabilities
The system SHALL derive capabilities from `portal_role` rather than merging roles, and a user who is both a leader and a parent SHALL be able to switch between a leader view and a parent view that shows only their own linked children.

#### Scenario: Dual-role switch
- **WHEN** a leader who also has linked children switches to the parent view
- **THEN** only their own children are shown and leader-only controls are not available in that view

### Requirement: Demo mode sign-in
The system SHALL allow demo sign-in as any role when demo mode is permitted, using fixtures, so the app is fully navigable without OSM credentials.

#### Scenario: Demo login
- **WHEN** a request is made to the demo login for a given role
- **THEN** a session for that role is established and all OSM-backed pages render from fixtures

### Requirement: Session timeout
The system SHALL expire sessions on a configurable idle timeout and refresh the cookie on activity (sliding expiry).

#### Scenario: Idle expiry
- **WHEN** the configured idle period passes with no activity
- **THEN** the session is no longer valid and the user must sign in again

### Requirement: Credential safety
The system SHALL NOT reset or generate a user's password without an explicit request, and SHALL NOT log raw tokens or passwords.

#### Scenario: No silent reset
- **WHEN** an admin manages a user account
- **THEN** no password is changed unless that change was explicitly requested
