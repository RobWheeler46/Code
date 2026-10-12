# Activity Approval Specification

## Purpose

Let a leader submit an activity for approval, route it through the group's approval chain (and, where needed, an external District Lead Volunteer), hold private evidence, and on final approval create a draft calendar entry - with email and in-app notification at each stage.

## Requirements

### Requirement: Optional module
The system SHALL ship the activity approval module off by default and only expose it when enabled in settings.

#### Scenario: Module disabled
- **WHEN** the module is off and a user opens an activity-approval route
- **THEN** the feature is shown as unavailable

### Requirement: Fixed form with conditional fields
The system SHALL present one fixed activity approval form whose required fields adapt to the activity type: adventurous or water activities SHALL require relevant qualifications, and the insurance fields SHALL apply conditionally.

#### Scenario: Water activity
- **WHEN** a leader selects a water activity
- **THEN** the qualifications field becomes required before the form can be submitted

### Requirement: Private evidence uploads
The system SHALL store uploaded evidence (risk assessment, public liability, Unity Insurance, supporting documents) privately, served only through an authenticated proxy, and SHALL NOT involve child or emergency-contact data.

#### Scenario: Evidence access
- **WHEN** a non-authorised user requests an evidence file by URL
- **THEN** access is refused

### Requirement: GLV approval and calendar automation
The system SHALL treat a Group Leadership approval as final and, on approval, create a draft leaders-only calendar entry when the form opted in and the calendar module is enabled.

#### Scenario: Final approval
- **WHEN** the GLV approves a form that opted into the calendar
- **THEN** the form becomes approved and a draft calendar entry is created

#### Scenario: Calendar not opted in
- **WHEN** the form did not opt into the calendar
- **THEN** approval succeeds and no calendar entry is created

### Requirement: Default add-to-calendar
The system SHALL default a new activity approval form to "add to calendar" ticked, while preserving an existing form's choice on edit.

#### Scenario: New form
- **WHEN** a leader creates a new activity approval form
- **THEN** the add-to-calendar option is ticked by default

### Requirement: External DLV approval
When a GLV refers an activity for District approval, the system SHALL freeze an immutable versioned evidence pack as a PDF, email it with attachments to the District Lead Volunteer, and record their Approve or Reject vote through single-use, no-login links; the DLV SHALL NOT need a portal account.

#### Scenario: Refer to DLV
- **WHEN** a GLV refers a form with a reason and a DLV email is configured
- **THEN** an immutable pack is frozen, the DLV is emailed voting links, and the form moves to awaiting DLV

#### Scenario: DLV approves
- **WHEN** the DLV clicks approve
- **THEN** the form becomes approved, the same calendar automation runs, and the sibling vote link is voided

#### Scenario: DLV rejects
- **WHEN** the DLV clicks reject with a reason
- **THEN** the form returns to the leader as "more information needed" with that reason, rather than being hard-rejected

### Requirement: Stage-change notifications
The system SHALL notify the relevant people in-app at every stage change, and SHALL also send an email copy for activity-approval notifications, honouring each user's mute preference for both channels.

#### Scenario: Submitted for approval
- **WHEN** a form is submitted
- **THEN** the approvers are notified in-app and by email, unless a recipient muted activity-form notifications
