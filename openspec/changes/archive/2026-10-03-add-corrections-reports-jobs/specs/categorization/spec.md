## MODIFIED Requirements

### Requirement: Learned keywords table
The database SHALL hold a table of learned keywords. Each row SHALL hold the keyword in its normalized form, a category id, a source (`learned` or `llm`), the user id of who taught it (absent for `llm`), a hit count of 0 or more, and the times it was created and last changed. A keyword SHALL appear in at most one row. The table SHALL start empty. It SHALL be written only by teaching a keyword, as the requirement "Teaching a keyword" defines.

The learned keywords SHALL be readable as a list of keyword, category id and source. They SHALL also be readable in full, with every field of every row, ordered by keyword, so that a backup can hold the whole table.

#### Scenario: The table starts empty
- **WHEN** the migrations have been applied to a new database
- **THEN** the learned keywords table exists and holds no rows, and reading the learned keywords gives an empty list

#### Scenario: A keyword appears once
- **WHEN** a row for the keyword `acai` exists, and a second row for `acai` is inserted
- **THEN** the database refuses the second row

#### Scenario: Read the learned keywords
- **WHEN** the table holds `acai` for `dining` from source `learned` and `bubble tea` for `dining` from source `llm`
- **THEN** reading the learned keywords gives both, with their category ids and sources

#### Scenario: Read the table in full
- **WHEN** the table holds `bubble tea` for `dining` from source `llm` with no teacher, and `acai` for `dining` from source `learned` taught by 1001
- **THEN** the full read gives `acai` first and then `bubble tea`, each with its category id, source, teacher, hit count, creation time and last-change time

## ADDED Requirements

### Requirement: Teaching a keyword

Teaching SHALL store a keyword for a category, given the keyword, the category id, the user id of the member who taught it, and a time. The keyword SHALL be stored in its normalized form, with the source `learned`, the teacher, a hit count of 0, and the time as both its creation time and its last-change time.

When a row for the keyword already exists, teaching SHALL replace its category id, set its source to `learned`, and record the teacher and the time of the last change. It SHALL keep the row's creation time and hit count. The latest teaching therefore wins. When the row already holds that category id from the source `learned`, teaching SHALL change nothing.

Teaching SHALL be rejected, and SHALL store nothing, when the keyword normalizes to no words or when the category id is not in the category list.

Nothing in this capability raises a hit count. It stays 0 until a later change gives it a reader.

Rationale: a category should need correcting only once, and the correction has to outlive a redeploy, so it is stored in the database.

#### Scenario: Happy path — a new keyword
- **GIVEN** the table holds no row for `acai`
- **WHEN** Ana (1001) teaches `acai` for `dining` at `2026-09-29T02:10:00.000Z`
- **THEN** the table holds `acai` for `dining` from source `learned`, taught by 1001, with hit count 0, created and last changed at that time
- **AND** a description `acai bowl` is then filed under `dining` with the source `learned`

#### Scenario: Happy path — the latest teaching wins
- **GIVEN** Ana taught `acai` for `dining` at `2026-09-29T02:10:00.000Z`
- **WHEN** Ben (1002) teaches `acai` for `groceries` at `2026-09-30T02:00:00.000Z`
- **THEN** the table holds one row for `acai`, for `groceries`, taught by 1002, last changed at `2026-09-30T02:00:00.000Z` and still created at `2026-09-29T02:10:00.000Z`

#### Scenario: Failure — a keyword or a category that cannot be taught
- **WHEN** the keyword `!!`, or an empty keyword, is taught for `dining`, or `acai` is taught for `snacks`, which is not in the category list
- **THEN** the teaching is rejected, and the table is unchanged

#### Scenario: Edge case — casing, spacing and accents give one row
- **GIVEN** `  AÇAÍ   Bowl ` is taught for `dining`
- **WHEN** `acai bowl` is taught for `dining` afterwards
- **THEN** the table holds exactly one row, with the keyword `acai bowl`

#### Scenario: Edge case — a manual teaching replaces a guess
- **GIVEN** the table holds `acai` for `fun` from source `llm`, with no teacher
- **WHEN** Ana teaches `acai` for `dining`
- **THEN** the row holds `dining`, the source `learned` and the teacher 1001

#### Scenario: Edge case — the same teaching again changes nothing
- **GIVEN** Ana taught `acai` for `dining` at `2026-09-29T02:10:00.000Z`
- **WHEN** Ben teaches `acai` for `dining` at `2026-09-30T02:00:00.000Z`
- **THEN** the row is unchanged: it is still taught by 1001 and last changed at `2026-09-29T02:10:00.000Z`

### Requirement: Which descriptions are learned

A description SHALL be learnable only when it normalizes to 1, 2 or 3 words, by the rules of the requirement "Text normalization". The keyword to teach for a learnable description SHALL be its normalized keyword. A description that normalizes to no words, or to more than 3 words, SHALL NOT be learnable.

Rationale: a short description names a thing, such as a shop or a dish, that will be typed again. A long one is a sentence that will not be typed again, and a keyword made from it would never match.

#### Scenario: Happy path — a short description
- **WHEN** the descriptions `Acai` and `Milk Tea` are checked
- **THEN** both are learnable, with the keywords `acai` and `milk tea`

#### Scenario: Failure — a description that cannot be learned
- **WHEN** an empty description, the description `!!`, or the description `lunch with ana at jollibee` is checked
- **THEN** none of them is learnable

#### Scenario: Edge case — exactly 3 words, and 4
- **WHEN** the descriptions `dinner for 2` and `dinner for 2 people` are checked
- **THEN** `dinner for 2` is learnable with the keyword `dinner for 2`, and `dinner for 2 people` is not learnable

#### Scenario: Edge case — only words count
- **WHEN** the description `🍔 Burger!!` is checked
- **THEN** it is learnable with the keyword `burger`

#### Scenario: Edge case — two spellings of one description
- **WHEN** the descriptions `Açaí  BOWL` and `acai bowl` are checked
- **THEN** both give the keyword `acai bowl`
