# Waiting List Specification

## Purpose

Let administrators see and add to the group's OSM waiting list (an OSM section of type `waiting`), reading named enquiry data through to the admin without storing it in the portal, and writing new enquiries straight to OSM.

## Requirements

### Requirement: View the waiting list
The system SHALL show administrators every person on the OSM waiting list, longest-waiting first, with each entry's name, date of birth, age, waiting-since date, parent/carer contacts, and any custom join-form answers. The data SHALL be read live from OSM, SHALL NOT be stored in the portal, and each view SHALL be audited.

#### Scenario: Admin opens the waiting list
- **WHEN** an administrator opens the waiting list screen
- **THEN** the current entries are read from OSM and shown with contacts and additional-information answers, ordered longest-waiting first

#### Scenario: Non-admin access
- **WHEN** a non-administrator requests the waiting list
- **THEN** access is refused

### Requirement: Custom fields are resolved by label
The system SHALL read every custom join-form field (for example preferred day, sibling, volunteer help) by resolving its group and column from the OSM field structure by label, so any custom question configured in OSM appears without code changes.

#### Scenario: New join-form question
- **WHEN** a new custom question is added to the waiting list in OSM
- **THEN** it appears on the admin screen under Additional info with no portal change

### Requirement: Field inventory inspector
The system SHALL let an administrator list every field OSM holds on the waiting-list grid, labelled, with masked sample values, so it is clear what data exists without exposing raw personal data.

#### Scenario: Show all fields
- **WHEN** an administrator opens the field inventory
- **THEN** each field's label and a masked sample are shown, with contact fields marked

### Requirement: Staff quick-add
The system SHALL let an administrator add a person to the waiting list from inside the portal - child name, date of birth, gender, join-form preferences, and parent contact - writing straight to OSM. Nothing SHALL be stored in the portal and the action SHALL be audited.

#### Scenario: Add a person
- **WHEN** an administrator submits the quick-add form with at least a first and last name
- **THEN** a member is created on the waiting list in OSM, the preferences and parent contact are written, and the new OSM id is reported

#### Scenario: A field does not save
- **WHEN** a custom field cannot be matched or written
- **THEN** the person is still added and the response lists which fields may not have saved

### Requirement: Write requires explicit permission scope
Writing to OSM SHALL require the `section:member:write` scope on a re-authorised connection; without it the write fails and the failure is reported, not silently swallowed.

#### Scenario: Missing write scope
- **WHEN** the connection has not been re-authorised with member-write access
- **THEN** the add fails and the error is surfaced to the administrator

### Requirement: Public submissions go through OSM's own form
The system SHALL direct public waiting-list sign-ups to OSM's hosted apply form rather than accepting unauthenticated writes, so children's personal data is not routed through the portal and junk entries are not createable without a login.

#### Scenario: Public join link
- **WHEN** a visitor wants to join the waiting list from the public site
- **THEN** they are sent to OSM's hosted apply form, which writes directly into OSM
