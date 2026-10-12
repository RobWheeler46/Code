# Finance Specification

## Purpose

Let leaders raise multi-item expense and mileage claims, route them through per-account approval (with a second approval over a threshold), let a treasurer pay them in batches, and give trustees a read-only finance overview - without ever holding bank details in the portal.

## Requirements

### Requirement: Optional module
The system SHALL ship the finance module off by default and expose it only when enabled in settings.

### Requirement: No bank details stored
The system SHALL NOT store any bank account details; payment is recorded with a reference and date only.

#### Scenario: Marking paid
- **WHEN** a treasurer records a payment
- **THEN** a bank reference and date are captured and no account number is stored

### Requirement: Multi-item claims with derived status
The system SHALL model a claim as a header with multiple line items (mixed accounts, categories, and receipts), and the claim status SHALL be derived from its item statuses, never set directly.

#### Scenario: Partially approved claim
- **WHEN** one item of a multi-item claim is approved and another rejected
- **THEN** the claim status reflects partial approval and updates as items change

### Requirement: Approval routing and thresholds
The system SHALL route each item to its account's approver, and SHALL require a second approval (treasurer or chair) for amounts over the configured tier-two threshold.

#### Scenario: Over-threshold item
- **WHEN** an item exceeds the tier-two threshold and the account approver approves it
- **THEN** it moves to pending second approval before it can be paid

### Requirement: No self-approval
The system SHALL prevent a claimant from acting on the approval of their own claim, enforced on the server even if the claimant is also an administrator.

#### Scenario: Claimant is the approver
- **WHEN** the claimant attempts to approve their own item
- **THEN** the action is refused and a deputy or other eligible approver must act instead

### Requirement: Mileage calculation with HMRC tiering
The system SHALL calculate mileage from the rate effective on the journey date, applying the annual-mileage tier (a reduced rate after the threshold miles within the UK tax year).

#### Scenario: Over the annual threshold
- **WHEN** a car mileage claim takes the claimant past the threshold miles in the tax year
- **THEN** miles above the threshold are paid at the reduced rate

### Requirement: Payment batches
The system SHALL let a treasurer mark several ready-for-payment items paid in one batch with a single bank reference and date.

#### Scenario: Batch payment
- **WHEN** a treasurer selects several ready items and submits one reference and date
- **THEN** all selected items are marked paid under that batch

### Requirement: Trustee overview without names by default
The system SHALL give trustee-viewer, chair, and treasurer roles a read-only finance dashboard (KPIs, spend by account, pipeline, exceptions), and SHALL NOT show individual claimant names on the trustee dashboard by default.

#### Scenario: Trustee dashboard
- **WHEN** a trustee viewer opens the finance dashboard
- **THEN** aggregate figures are shown and individual claimant names are not

### Requirement: Retention, not deletion
The system SHALL retain claims rather than hard-delete them, archiving past the configured retention window, so a financial record survives for audit.

#### Scenario: Old claim
- **WHEN** a claim passes the retention window
- **THEN** it is archived (soft), not removed
