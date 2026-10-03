## ADDED Requirements

### Requirement: The system SHALL catch up a late digest for a day or two

The job `weekly_digest` SHALL be registered with a catch-up window of 24 hours, and the job `monthly_recap` with a catch-up window of 48 hours, as the `job-scheduler` requirement "The system SHALL give each job its own catch-up window" defines. A run inside the window SHALL cover the period of its scheduled date, as any run does.

Rationale: a digest that is a day late, or a recap that is two days late, is still worth reading. With the scheduler's 3-hour default, an outage of a few hours on a Sunday evening lost the week's digest for good.

#### Scenario: Happy path — a digest a day late
- **GIVEN** one entry is dated 2026-10-04, and no tick fired from Sunday 2026-10-04 19:00 until Monday 19:00
- **WHEN** the tick of `2026-10-05T11:00:00Z`, Monday 19:00 household time, fires
- **THEN** the group receives the weekly digest for Sep 28 to Oct 4

#### Scenario: Failure — a digest more than a day late
- **GIVEN** no tick fired from Sunday 2026-10-04 19:00 until Monday 20:00
- **WHEN** the tick of `2026-10-05T12:00:00Z` fires
- **THEN** the group receives nothing, and the run record of `weekly_digest` for `2026-10-04` is `skipped`

#### Scenario: Happy path — a recap two days late
- **GIVEN** one entry is dated 2026-09-29, and no tick fired from 2026-10-01 08:00 until 2026-10-03 08:00
- **WHEN** the tick of `2026-10-03T00:00:00Z` fires
- **THEN** the group receives the monthly recap for September 2026

#### Scenario: Failure — a recap more than two days late
- **GIVEN** no tick fired from 2026-10-01 08:00 until 2026-10-03 09:00
- **WHEN** the tick of `2026-10-03T01:00:00Z` fires
- **THEN** the group receives nothing, and the run record of `monthly_recap` for `2026-10-01` is `skipped`

#### Scenario: Edge case — one tick catches up both
- **GIVEN** an entry dated 2027-02-10, and no tick fired from Sunday 2027-02-28 19:00 until Monday 2027-03-01 08:00
- **WHEN** the tick of `2027-03-01T00:00:00Z` fires
- **THEN** the group receives the recap for February 2027, and the weekly digest of Sunday Feb 28 as well
