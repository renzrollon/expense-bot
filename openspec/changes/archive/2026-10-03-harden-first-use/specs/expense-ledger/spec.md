## ADDED Requirements

### Requirement: Active entries in a period

Given a period of two `YYYY-MM-DD` dates, both included, the ledger SHALL return the number of active entries whose spent-on date is in the period, from the whole ledger, whatever chat an entry came from. A date that is not written as `YYYY-MM-DD` SHALL be rejected.

Rationale: `/export all` checks the size of the ledger before it reads it.

#### Scenario: Happy path — entries inside the period, both end dates included
- **GIVEN** active entries dated `2026-08-31`, `2026-09-01`, `2026-09-30` and `2026-10-01`
- **WHEN** the active entries from `2026-09-01` to `2026-09-30` are counted
- **THEN** the count is 2

#### Scenario: Failure — a malformed date is rejected
- **WHEN** the active entries from `2026-09-01` to `30 Sep 2026` are counted
- **THEN** the request is rejected

#### Scenario: Edge case — removed entries are not counted
- **GIVEN** one removed entry dated `2026-09-03` and one active entry dated `2026-09-10`
- **WHEN** the active entries in September 2026 are counted
- **THEN** the count is 1

#### Scenario: Edge case — an empty ledger
- **WHEN** the active entries are counted and the ledger holds none
- **THEN** the count is 0
