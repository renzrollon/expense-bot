## Purpose

Categorization files each expense under a category from its description, so a member does not have to tap one. The category list and the seed keywords live in configuration files. Keywords learned later are stored in the database and take priority over the seeds.

## ADDED Requirements

### Requirement: Category list
The category list SHALL be kept in a configuration file. Each category SHALL have an id, a name, a short name used in replies, an emoji, a display order, and whether it counts as spending. Ids SHALL be unique and SHALL be made of the lower-case letters `a` to `z`, at most 12 of them. Display orders SHALL be unique. The list SHALL hold the category `other`, which is the fallback.

The default list SHALL be:

| Order | Id | Emoji | Name | Short name | Counts as spending |
|---|---|---|---|---|---|
| 1 | `groceries` | 🛒 | Groceries & Market | Groceries | yes |
| 2 | `dining` | 🍽 | Dining & Delivery | Dining | yes |
| 3 | `transport` | 🚗 | Transport | Transport | yes |
| 4 | `bills` | 💡 | Bills & Utilities | Bills | yes |
| 5 | `housing` | 🏠 | Housing | Housing | yes |
| 6 | `household` | 🧹 | Household | Household | yes |
| 7 | `health` | 💊 | Health | Health | yes |
| 8 | `kids` | 🎒 | Kids & Education | Kids | yes |
| 9 | `family` | 🤝 | Family Support | Family | yes |
| 10 | `gifts` | 🎁 | Gifts & Occasions | Gifts | yes |
| 11 | `personal` | 🛍 | Personal & Shopping | Personal | yes |
| 12 | `fun` | 🎬 | Fun & Subscriptions | Fun | yes |
| 13 | `other` | ❓ | Other | Other | yes |
| 14 | `transfer` | 🔁 | Transfers | Transfers | no |

#### Scenario: The default list
- **WHEN** the category list is read
- **THEN** it holds the 14 categories of the table, in display order, with the ids, emoji, names, short names and spending flags shown

#### Scenario: Transfers do not count as spending
- **WHEN** the category `transfer` is looked up
- **THEN** it does not count as spending, and every other default category does

#### Scenario: The list's invariants hold
- **WHEN** the configuration is checked
- **THEN** every id is unique and made of 1 to 12 lower-case letters, every display order is unique, and `other` is in the list

### Requirement: Category id validation
A category id SHALL be valid only when a category in the list has exactly that id. Looking up an id that is not in the list SHALL give no category, and SHALL NOT fail.

#### Scenario: A known id
- **WHEN** the id `dining` is checked
- **THEN** it is valid, and looking it up gives the category Dining & Delivery

#### Scenario: An id not in the list
- **WHEN** the id `snacks`, the id `Dining`, or an empty id is checked
- **THEN** it is not valid, and looking it up gives no category

### Requirement: Seed keywords
The seed keywords SHALL be kept in a configuration file that maps each category id to its keywords. Every keyword SHALL be written in its normalized form and SHALL NOT be empty. No keyword SHALL appear under two categories, or twice under one. Every category id in the file SHALL be in the category list. The category `other` SHALL have no keywords. Every other category SHALL have at least 5.

The seed keywords SHALL include at least these:

| Keywords | Category |
|---|---|
| `jollibee`, `lunch`, `kape`, `grab food` | `dining` |
| `palengke`, `puregold`, `ulam` | `groceries` |
| `grab`, `angkas`, `pamasahe`, `toll` | `transport` |
| `meralco`, `maynilad`, `pldt`, `load` | `bills` |
| `padala` | `family` |
| `regalo`, `pasalubong` | `gifts` |
| `cash in`, `withdraw` | `transfer` |

The payment word `gcash` SHALL NOT be a keyword.

#### Scenario: The examples are seeded
- **WHEN** the seed keywords are read
- **THEN** each keyword in the table above is listed under the category shown

#### Scenario: The seed file's invariants hold
- **WHEN** the configuration is checked
- **THEN** every keyword is non-empty and already normalized, no keyword is listed twice, every category id is in the list, `other` has no keywords, every other category has at least 5, and `gcash` is not a keyword

### Requirement: Learned keywords table
The database SHALL hold a table of learned keywords. Each row SHALL hold the keyword in its normalized form, a category id, a source (`learned` or `llm`), the user id of who taught it (absent for `llm`), a hit count of 0 or more, and the times it was created and last changed. A keyword SHALL appear in at most one row. The table SHALL start empty. This change SHALL NOT write to it. Later changes teach keywords.

The learned keywords SHALL be readable as a list of keyword, category id and source.

#### Scenario: The table starts empty
- **WHEN** the migrations have been applied to a new database
- **THEN** the learned keywords table exists and holds no rows, and reading the learned keywords gives an empty list

#### Scenario: A keyword appears once
- **WHEN** a row for the keyword `acai` exists, and a second row for `acai` is inserted
- **THEN** the database refuses the second row

#### Scenario: Read the learned keywords
- **WHEN** the table holds `acai` for `dining` from source `learned` and `bubble tea` for `dining` from source `llm`
- **THEN** reading the learned keywords gives both, with their category ids and sources

### Requirement: Text normalization
Keywords and descriptions SHALL be compared in one normalized form, and learned keywords SHALL be stored in it. To normalize a text:

1. Compose its characters (Unicode NFC).
2. Change it to lower case, and change the curly apostrophes `‘` and `’` to `'`.
3. Remove accents and other combining marks, so `ñ` becomes `n`.
4. Split it into words at white space.
5. Remove from both ends of each word every character that is not a letter or a digit. Characters inside a word stay.
6. Drop the words that are left empty.

A normalized keyword is its normalized words joined by single spaces.

#### Scenario: Normalized forms
- **WHEN** these texts are normalized
- **THEN** they give these words:

| Text | Words |
|---|---|
| `Lunch (Jollibee)!` | `lunch`, `jollibee` |
| `Piña  Colada` | `pina`, `colada` |
| `7-Eleven` | `7-eleven` |
| `S&R` | `s&r` |
| `🍔 burger` | `burger` |
| `Jollibee's` | `jollibee's` |
| `McDonald’s` | `mcdonald's` |
| `grab`, a tab, `food` | `grab`, `food` |
| three spaces | no words |

#### Scenario: A normalized keyword
- **WHEN** the text `  Grab   FOOD ` is normalized as a keyword
- **THEN** the keyword is `grab food`

### Requirement: Keyword matching
The matcher SHALL take a description and the learned keywords, and SHALL return a category id, a source, and the keyword that matched. It SHALL compare normalized words. A keyword SHALL match only whole words, and a keyword of several words SHALL match only when its words appear next to each other in the same order.

The match SHALL be chosen in this order:

1. Learned keywords, from either source, before seed keywords, whatever their length.
2. Within the same tier, the keyword with the most words.
3. Then the keyword that starts first in the description.

A learned keyword SHALL give its own source, `learned` or `llm`. A seed keyword SHALL give the source `keyword`. Learned keywords SHALL be normalized before they are compared, like descriptions. A learned keyword whose category id is not in the category list, or that normalizes to no words, SHALL be skipped. When two learned keywords normalize to the same words, the one given first SHALL win, and a learned match SHALL report the keyword as it is stored. When nothing matches, including when the description is empty, the result SHALL be the category `other` with the source `default` and no keyword. The matcher SHALL NOT read or write the database.

#### Scenario: A seed keyword
- **WHEN** the description is `lunch jollibee` and there are no learned keywords
- **THEN** the category is `dining`, the source is `keyword`, and the keyword is `lunch`

#### Scenario: Whole words only
- **WHEN** the learned keywords hold `book` for `kids`, and the description is `facebook ads`
- **THEN** `book` does not match, and the category is `other` with the source `default`

#### Scenario: A phrase beats a single word
- **WHEN** the description is `grab food`
- **THEN** the keyword `grab food` wins over `grab`, and the category is `dining` with the source `keyword`

#### Scenario: A tie goes to the first keyword
- **WHEN** the description is `grab to jollibee`
- **THEN** the keyword is `grab`, and the category is `transport`

#### Scenario: A phrase must be adjacent and in order
- **WHEN** the description is `food grab` or `grab some food`
- **THEN** the phrase `grab food` does not match, and the keyword is `grab`, so the category is `transport`

#### Scenario: Case and punctuation do not matter
- **WHEN** the description is `Lunch @ JOLLIBEE!`
- **THEN** the category is `dining`

#### Scenario: Nothing matches
- **WHEN** the description is `acai` and there are no learned keywords
- **THEN** the category is `other`, the source is `default`, and there is no keyword

#### Scenario: An empty description
- **WHEN** the description is empty
- **THEN** the category is `other`, the source is `default`, and there is no keyword

#### Scenario: A learned keyword wins over a seed keyword
- **WHEN** the learned keywords hold `lunch` for `kids` from source `learned`, and the description is `lunch jollibee`
- **THEN** the category is `kids`, the source is `learned`, and the keyword is `lunch`

#### Scenario: A learned word wins over a longer seed phrase
- **WHEN** the learned keywords hold `food` for `groceries`, and the description is `grab food`
- **THEN** the category is `groceries`, and the source is `learned`

#### Scenario: A keyword guessed by the LLM
- **WHEN** the learned keywords hold `acai` for `dining` from source `llm`, and the description is `acai bowl`
- **THEN** the category is `dining`, and the source is `llm`

#### Scenario: A learned keyword for a removed category is skipped
- **WHEN** the learned keywords hold `acai` for `snacks`, which is not in the category list, and the description is `acai lunch`
- **THEN** the category is `dining` from the seed keyword `lunch`

#### Scenario: A learned keyword with no words is skipped
- **WHEN** the learned keywords hold `!!` for `kids`, and the description is `lunch`
- **THEN** the category is `dining` from the seed keyword `lunch`

#### Scenario: A learned keyword is compared in normalized form
- **WHEN** the learned keywords hold `Açaí` for `dining`, and the description is `acai bowl`
- **THEN** the category is `dining` with the source `learned`

#### Scenario: Two learned keywords with the same words
- **WHEN** the learned keywords hold `Açaí` for `dining` and then `acai` for `kids`, in that order, and the description is `acai bowl`
- **THEN** the category is `dining`, and the keyword is `Açaí`

#### Scenario: Accents do not matter
- **WHEN** the learned keywords hold `pina` for `dining`, and the description is `Piña shake`
- **THEN** the category is `dining`
