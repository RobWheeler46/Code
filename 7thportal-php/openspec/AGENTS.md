# OpenSpec Conventions for 7thPortal

This repo uses Spec-Driven Development. The specs under `openspec/specs/` are the source of truth for what the application does; code should conform to them, and changes to behaviour start as a change proposal.

## Layout

- `openspec/project.md` - always-loaded project context (stack, architecture, conventions).
- `openspec/specs/<capability>/spec.md` - the current, agreed behaviour of one capability, as requirements and scenarios.
- `openspec/changes/<change-id>/` - a proposed change: `proposal.md` (why + what), `tasks.md` (checklist), and `specs/<capability>/spec.md` deltas (the requirements being added, changed, or removed). Archive into `specs/` once built and deployed.

## Workflow

1. **Propose** - create `changes/<change-id>/proposal.md` describing the why and the behaviour change, plus the spec delta. Do not edit code yet.
2. **Implement** - build to the proposal; keep `tasks.md` ticked; keep `php scripts/smoke-test.php` green.
3. **Archive** - fold the delta into the capability's `specs/<capability>/spec.md` and remove the change folder.

## Spec format

Each capability spec is Markdown:

```
# <Capability> Specification

## Purpose
One short paragraph: what this capability is for.

## Requirements

### Requirement: <short name>
The system SHALL <behaviour>. (One normative statement; use SHALL / MUST. Add constraints as further sentences.)

#### Scenario: <short name>
- **WHEN** <trigger / precondition>
- **THEN** <observable outcome>
- **AND** <further outcome, optional>
```

Rules:
- One requirement = one normative behaviour. Keep them testable and grounded in the actual code, not aspirational.
- Every requirement has at least one scenario.
- Describe behaviour (what a user or caller observes), not implementation. Reference files only where it genuinely aids navigation.
- Match the project copy conventions (no em/en dashes, no abbreviations) in user-facing strings quoted in scenarios.
