## MODIFIED Requirements

### Requirement: Numbers that are not amounts
The parser SHALL NOT read the following as an amount:

- a time, written as `5pm`, `5 pm`, `10:30` or `10:30am`, in any letter case,
- an ordinal, such as `15th`,
- a percentage, written as `20%` or `20 %`,
- a number of 8 or more digits that has no currency mark, no thousands separator, no decimal part and no suffix `k`,
- a number with more than 2 decimal places, counted as written after the suffix `k` has moved the decimal point 3 places,
- a number written in digits other than `0` to `9`,
- a number joined to letters or symbols other than a currency mark in front and the suffix `k`, such as `5kg`, `x2`, `1/2`, `+1`, a tag or a link,
- a plain number of two or more digits that starts with `0`, such as `007` or `0917`,
- a plain number directly after one of the words `at`, `alas`, `otp`, `pin`, `code`, `ref`, `reference`, `no`, `number`, `acct`, `account` and `year`, in any letter case, or after one of them and one linking word, which is `is` or a word made only of hyphens, dashes or colons,
- a plain number in a digit group, which is a row of plain numbers that is three or more long, or that holds a plain number of two or more digits that starts with `0`.

A plain number is a word made only of the digits `0` to `9`, after the punctuation around it is ignored. A number with a currency mark, a thousands separator, a decimal part or the suffix `k` is not a plain number, so the last three rules never apply to it.

Such a number SHALL stay in the description in its original text. It SHALL NOT count as one of several numbers, so it sets no flag. A message that holds no amount SHALL be "not an expense".

#### Scenario: Time joined to am or pm
- **WHEN** the message is `see you at 5pm`
- **THEN** the result is "not an expense"

#### Scenario: Time with a space
- **WHEN** the message is `see you at 5 pm` or `see you at 5 PM`
- **THEN** the result is "not an expense"

#### Scenario: Clock time
- **WHEN** the message is `meet 10:30` or `meet 10:30am`
- **THEN** the result is "not an expense"

#### Scenario: Ordinal
- **WHEN** the message is `pay meralco on the 15th`
- **THEN** the result is "not an expense"

#### Scenario: Percentage
- **WHEN** the message is `sale 20% off` or `sale 20 % off`
- **THEN** the result is "not an expense"

#### Scenario: Eight digits
- **WHEN** the message is `gcash ref 12345678`
- **THEN** the result is "not an expense"

#### Scenario: Phone number
- **WHEN** the message is `call 09171234567`
- **THEN** the result is "not an expense"

#### Scenario: Seven digits is an amount
- **WHEN** the message is `car 1234567`
- **THEN** the amount is 123456700 centavos and the description is `car`

#### Scenario: Three decimal places
- **WHEN** the message is `gas 45.678`
- **THEN** the result is "not an expense"

#### Scenario: Extra decimal places that are zeros
- **WHEN** the message is `lunch 250.500` or `groceries 1.500`
- **THEN** the result is "not an expense"

#### Scenario: Suffix k with up to five decimal places
- **WHEN** the message is `grab 1.2345k` or `grab 1.50000k`
- **THEN** the amounts are 123450 centavos and 150000 centavos

#### Scenario: Suffix k with six decimal places
- **WHEN** the message is `grab 1.234567k` or `grab 1.500000k`
- **THEN** the result is "not an expense"

#### Scenario: Full-width digits
- **WHEN** the message is `lunch ２５０`
- **THEN** the result is "not an expense"

#### Scenario: Number joined to a unit
- **WHEN** the message is `rice 5kg 300`
- **THEN** the result is one item with the amount 30000 centavos, the description `rice 5kg`, no flags and the confidence `high`

#### Scenario: Fraction
- **WHEN** the message is `1/2 kilo pork 180`
- **THEN** the result is one item with the amount 18000 centavos, the description `1/2 kilo pork` and no flags

#### Scenario: Time next to an amount
- **WHEN** the message is `lunch 250 at 5pm`
- **THEN** the result is one item with the amount 25000 centavos, the description `lunch at 5pm` and no flags

#### Scenario: Link
- **WHEN** the message is `https://shop.example/item/12345 500`
- **THEN** the result is one item with the amount 50000 centavos and the description `https://shop.example/item/12345`

#### Scenario: Time after a word
- **WHEN** the message is `see you at 7` or `alas 7 ng gabi`
- **THEN** the result is "not an expense"

#### Scenario: Code after a reference word
- **WHEN** the message is `OTP: 123456`, `otp is 123456`, `Your OTP - 4821`, `pin 4821` or `acct no. 1234567`
- **THEN** the result is "not an expense"

#### Scenario: Reference next to an amount
- **WHEN** the message is `groceries 2340 gcash ref 12345`
- **THEN** the result is one item with the amount 234000 centavos, the description `groceries gcash ref 12345` and no flags

#### Scenario: Marked or formatted amount after a reference word
- **WHEN** the message is `tickets at ₱500`, `bought at 1,500` or `sold at 1.5k`
- **THEN** the amounts are 50000, 150000 and 150000 centavos, and the descriptions are `tickets at`, `bought at` and `sold at`

#### Scenario: Year after the word year
- **WHEN** the message is `Happy New Year 2026!`
- **THEN** the result is "not an expense"

#### Scenario: Number with a leading zero
- **WHEN** the message is `room 007`
- **THEN** the result is "not an expense"

#### Scenario: Number written in groups
- **WHEN** the message is `call me 0917 123 4567`, `0917 1234567` or `1234 5678 9012 3456`
- **THEN** the result is "not an expense"

#### Scenario: Number in groups next to an amount
- **WHEN** the message is `load 0917 123 4567 ₱100`
- **THEN** the result is one item with the amount 10000 centavos and the description `load 0917 123 4567`

#### Scenario: Number with a plus sign in front
- **WHEN** the message is `+1` or `+63 917 123 4567`
- **THEN** the result is "not an expense"

### Requirement: Several expenses in one message
The parser SHALL split a message into parts at each new line, comma, semicolon, plus sign, and at the word `and` in any letter case. A plus sign that starts a word and is directly followed by a digit SHALL be part of that word, and not a separator. A comma SHALL be part of a number, and not a separator, only in the pattern of 1 to 3 digits followed by groups of exactly 3 digits, with no digit directly before or after.

Each part that holds an amount SHALL become one item, in the order of the message. A part that holds no amount SHALL join the next part, or the previous part when it is the last, and this SHALL repeat until every part holds an amount. An empty part SHALL be dropped. Each item SHALL have its own flags and confidence.

A message SHALL hold at most 10 items. When it holds more, the parser SHALL reject it with the reason `too_many_items`.

#### Scenario: Comma
- **WHEN** the message is `grab 180, groceries 2340 gcash`
- **THEN** the result is a list of two items, in this order
- **AND** the first has the amount 18000 centavos and the description `grab`
- **AND** the second has the amount 234000 centavos and the description `groceries gcash`

#### Scenario: New line
- **WHEN** the message is `grab 180`, a new line, and `lunch 250`
- **THEN** the result is two items: 18000 centavos `grab`, then 25000 centavos `lunch`

#### Scenario: Semicolon
- **WHEN** the message is `grab 180; lunch 250`
- **THEN** the result is two items: 18000 centavos `grab`, then 25000 centavos `lunch`

#### Scenario: The word and
- **WHEN** the message is `grab 180 and lunch 250` or `grab 180 AND lunch 250`
- **THEN** the result is two items: 18000 centavos `grab`, then 25000 centavos `lunch`

#### Scenario: Plus sign
- **WHEN** the message is `grab 180 + lunch 250`
- **THEN** the result is two items: 18000 centavos `grab`, then 25000 centavos `lunch`

#### Scenario: Plus sign joined to a number
- **WHEN** the message is `grab 180 +50 tip`
- **THEN** the result is one item with the amount 18000 centavos and the description `grab +50 tip`

#### Scenario: Separator without spaces
- **WHEN** the message is `grab 180,lunch 250`
- **THEN** the result is two items: 18000 centavos `grab`, then 25000 centavos `lunch`

#### Scenario: Comma inside a number
- **WHEN** the message is `groceries 1,500, grab 180`
- **THEN** the result is two items: 150000 centavos `groceries`, then 18000 centavos `grab`

#### Scenario: Comma followed by fewer than three digits
- **WHEN** the message is `snacks 50,75`
- **THEN** the result is two items: 5000 centavos `snacks`, then 7500 centavos with an empty description

#### Scenario: The word and inside a description
- **WHEN** the message is `mac and cheese 250`
- **THEN** the result is one item with the amount 25000 centavos and the description `mac and cheese`

#### Scenario: Comma inside a description
- **WHEN** the message is `lunch, coffee 330`
- **THEN** the result is one item with the amount 33000 centavos and the description `lunch coffee`

#### Scenario: Last part without an amount
- **WHEN** the message is `groceries 2340, gcash`
- **THEN** the result is one item with the amount 234000 centavos and the description `groceries gcash`

#### Scenario: Middle part without an amount
- **WHEN** the message is `grab 180, lunch, coffee 330`
- **THEN** the result is two items: 18000 centavos `grab`, then 33000 centavos `lunch coffee`

#### Scenario: Several parts in a row without an amount
- **WHEN** the message is `rice, eggs, milk 450`
- **THEN** the result is one item with the amount 45000 centavos and the description `rice eggs milk`

#### Scenario: Empty parts
- **WHEN** the message is `lunch 250,, grab 180,`
- **THEN** the result is two items: 25000 centavos `lunch`, then 18000 centavos `grab`

#### Scenario: Flags belong to one item
- **WHEN** the message is `dinner for 2 600, grab 180`
- **THEN** the first item has the flag `ambiguous_amount` and the confidence `low`
- **AND** the second item has no flags and the confidence `high`

#### Scenario: Ten items
- **WHEN** the message holds ten parts, each with a description and an amount
- **THEN** the result is a list of ten items in the order of the message

#### Scenario: Eleven items
- **WHEN** the message holds eleven parts, each with a description and an amount
- **THEN** the result is a rejection with the reason `too_many_items`

### Requirement: Entry date
Every item SHALL carry a date as `YYYY-MM-DD` text. The date SHALL be a calendar date in the household timezone. When the message names no date, the date SHALL be today in that timezone.

The parser SHALL understand these forms, in any letter case and anywhere in the message:

- `today`, `ngayon` and `kanina`, which mean today,
- `yesterday`, `kahapon` and `kagabi`, which mean yesterday,
- `N days ago` and `N day ago`, where N is a whole number from 1 to 9999,
- a month name next to a day number, in either order, such as `sep 27` and `27 sep`,
- a month name next to a day number, followed by a year, as the requirement "Date with a year" defines,
- `YYYY-MM-DD`.

A month name SHALL be an English month written in full, as its first three letters, or as `sept`. A day number SHALL be a whole number from 1 to 31 written as plain digits. A month name that is not next to a day number SHALL be an ordinary word. When a month name has a day number on both sides, the one before it SHALL be the day.

The words `may` and `jan` are also everyday Tagalog words. They SHALL be a month name only directly after a day number, as in `2 may`. Before a day number they SHALL be ordinary words, and the number after them SHALL be read as any other number. `january` SHALL be a month name in either order.

One date SHALL apply to every item in the message. The words and numbers of a date SHALL be removed from the description and SHALL NOT be read as an amount. Punctuation around a date word SHALL be ignored as it is for a number.

#### Scenario: No date named
- **WHEN** the message is `lunch 250`
- **THEN** the date is `2026-09-29`

#### Scenario: Last second of the day
- **WHEN** the current time is `2026-09-29T15:59:59Z` and the message is `lunch 250`
- **THEN** the date is `2026-09-29`

#### Scenario: First second of the next day
- **WHEN** the current time is `2026-09-29T16:00:00Z` and the message is `lunch 250`
- **THEN** the date is `2026-09-30`

#### Scenario: Another timezone
- **WHEN** the timezone is `America/Los_Angeles` and the message is `lunch 250`
- **THEN** the date is `2026-09-28`

#### Scenario: Words for today
- **WHEN** the message is `today lunch 250`, `ngayon lunch 250` or `kanina lunch 250`
- **THEN** the date is `2026-09-29` and the description is `lunch`

#### Scenario: Words for yesterday
- **WHEN** the message is `yesterday lunch 250`, `kahapon lunch 250` or `kagabi lunch 250`
- **THEN** the date is `2026-09-28` and the description is `lunch`

#### Scenario: Days ago
- **WHEN** the message is `3 days ago lunch 250`
- **THEN** the result is one item with the amount 25000 centavos, the description `lunch`, the date `2026-09-26` and no flags

#### Scenario: One day ago
- **WHEN** the message is `1 day ago lunch 250`
- **THEN** the date is `2026-09-28` and the description is `lunch`

#### Scenario: Days ago across a month boundary
- **WHEN** the message is `30 days ago lunch 250`
- **THEN** the date is `2026-08-30`

#### Scenario: Largest number of days ago
- **WHEN** the message is `9999 days ago lunch 250`
- **THEN** the date is `1999-05-15` and the description is `lunch`

#### Scenario: Zero days ago is not a date
- **WHEN** the message is `0 days ago lunch 250`
- **THEN** the result is one item with the amount 25000 centavos, the description `0 days ago lunch`, the date `2026-09-29` and the flag `ambiguous_amount`

#### Scenario: More days ago than the limit is not a date
- **WHEN** the message is `10000 days ago lunch ₱250`
- **THEN** the result is one item with the amount 25000 centavos, the description `10000 days ago lunch`, the date `2026-09-29`, no flags and the confidence `high`

#### Scenario: Month then day
- **WHEN** the message is `sep 27 meralco 3200`
- **THEN** the result is one item with the amount 320000 centavos, the description `meralco`, the date `2026-09-27` and no flags

#### Scenario: Day then month
- **WHEN** the message is `27 sep meralco 3200`
- **THEN** the result is one item with the amount 320000 centavos, the description `meralco` and the date `2026-09-27`

#### Scenario: Other spellings of the month
- **WHEN** the message is `september 27 meralco 3200` or `Sept 27 meralco 3200`
- **THEN** the date is `2026-09-27` and the description is `meralco`

#### Scenario: Date with a year
- **WHEN** the message is `2026-09-27 meralco 3200`
- **THEN** the result is one item with the amount 320000 centavos, the description `meralco` and the date `2026-09-27`

#### Scenario: Date after the amount
- **WHEN** the message is `lunch 250 kahapon`
- **THEN** the date is `2026-09-28` and the description is `lunch`

#### Scenario: Capital letters
- **WHEN** the message is `KAHAPON lunch 250` or `SEP 28 lunch 250`
- **THEN** the date is `2026-09-28` and the description is `lunch`

#### Scenario: Punctuation around a date word
- **WHEN** the message is `kahapon: lunch 250` or `(kahapon) lunch 250`
- **THEN** the date is `2026-09-28` and the description is `lunch`

#### Scenario: One date for every item
- **WHEN** the message is `kahapon grab 180, lunch 250`
- **THEN** the result is two items, and both have the date `2026-09-28`

#### Scenario: Yesterday across a year boundary
- **WHEN** the current time is `2026-12-31T16:30:00Z` and the message is `kahapon lunch 250`
- **THEN** the date is `2026-12-31`

#### Scenario: Month name without a day number
- **WHEN** the message is `jan 500`
- **THEN** the result is one item with the amount 50000 centavos, the description `jan` and the date `2026-09-29`

#### Scenario: Day number on both sides of a month name
- **WHEN** the message is `12 may 13`
- **THEN** the result is one item with the amount 1300 centavos, an empty description and the date `2026-05-12`

#### Scenario: Month name takes the only number
- **WHEN** the message is `jun 20`
- **THEN** the result is "not an expense"

#### Scenario: The words may and jan before a day number
- **WHEN** the message is `may 2 kape 300` or `jan 2 rent 12000`
- **THEN** the result is one item with the date `2026-09-29` and the flag `ambiguous_amount`
- **AND** the amounts are 30000 and 1200000 centavos, and the descriptions are `may 2 kape` and `jan 2 rent`

#### Scenario: The months May and January
- **WHEN** the message is `2 may kape 300`, `2 jan kape 300` or `january 2 kape 300`
- **THEN** the result is one item with the amount 30000 centavos, the description `kape` and no flags
- **AND** the dates are `2026-05-02`, `2026-01-02` and `2026-01-02`

### Requirement: Several numbers in one item
When one item holds several amounts, the parser SHALL choose one. When exactly one of them carries a currency mark, the parser SHALL choose it and set no flag. When several carry a mark, it SHALL choose the last marked amount. When none carries a mark, it SHALL choose among the amounts in range: among those written as money, with a thousands separator, a decimal part or the suffix `k`, when there is one, and otherwise among all of them. Of these it SHALL choose the largest amount, and of equal amounts the last. When no amount is in range, it SHALL choose the last amount. Whenever there was a choice to make and no single mark decided it, the parser SHALL flag the item `ambiguous_amount`. The amounts that were not chosen SHALL stay in the description in their original text.

Rationale: next to a price, a quantity is usually the smaller number, and a number written as money is the price. The last number gave `grab 180 (2 rides)` the amount ₱2 and `Paid 1,500 for 3 shirts` the amount ₱3. The flag stays, because the choice is still a guess.

#### Scenario: Two numbers without a mark
- **WHEN** the message is `dinner for 2 600`
- **THEN** the result is one item with the amount 60000 centavos and the description `dinner for 2`
- **AND** the item has the flag `ambiguous_amount` and the confidence `low`

#### Scenario: Quantity before the amount
- **WHEN** the message is `2 shirts 1500`
- **THEN** the result is one item with the amount 150000 centavos, the description `2 shirts`, the flag `ambiguous_amount` and the confidence `low`

#### Scenario: Quantity after the amount
- **WHEN** the message is `grab 180 (2 rides)`
- **THEN** the result is one item with the amount 18000 centavos, the description `grab (2 rides)`, the flag `ambiguous_amount` and the confidence `low`

#### Scenario: Amount written as money before a quantity
- **WHEN** the message is `Paid 1,500 for 3 shirts`
- **THEN** the result is one item with the amount 150000 centavos, the description `Paid for 3 shirts`, the flag `ambiguous_amount` and the confidence `low`

#### Scenario: An amount written as money wins over a larger plain number
- **WHEN** the message is `1.5k shoes for 2000`
- **THEN** the result is one item with the amount 150000 centavos, the description `shoes for 2000` and the flag `ambiguous_amount`

#### Scenario: An amount out of range is not chosen while another is in range
- **WHEN** the message is `lunch 250 10,000,000`
- **THEN** the result is one item with the amount 25000 centavos, the description `lunch 10,000,000` and the flag `ambiguous_amount`

#### Scenario: Marked amount comes first
- **WHEN** the message is `₱600 dinner for 2`
- **THEN** the result is one item with the amount 60000 centavos, the description `dinner for 2`, no flags and the confidence `high`

#### Scenario: Marked amount comes last
- **WHEN** the message is `dinner for 2 ₱600` or `dinner for 2 php 600`
- **THEN** the result is one item with the amount 60000 centavos, the description `dinner for 2`, no flags and the confidence `high`

#### Scenario: Two marked amounts
- **WHEN** the message is `₱100 ₱200 snacks`
- **THEN** the result is one item with the amount 20000 centavos, the description `₱100 snacks`, the flag `ambiguous_amount` and the confidence `low`

#### Scenario: The same number twice
- **WHEN** the message is `250 lunch 250`
- **THEN** the result is one item with the amount 25000 centavos, the description `250 lunch` and the flag `ambiguous_amount`

## ADDED Requirements

### Requirement: Date with a year
A month name next to a day number, in either order, MAY be followed by a year. A year SHALL be a number of exactly four digits that is the current year in the household timezone, the year before it or the year after it. It SHALL directly follow the month and day, or follow one comma after them. Any other number there SHALL NOT be a year, and SHALL be read as any other number.

A date with a year SHALL be exactly that year, month and day. It SHALL NOT be moved to the nearest year. When that date is not a real date, or is after today, the rejections of the requirement "Date rejections" SHALL apply. The year SHALL be removed from the description with the rest of the date and SHALL NOT be read as an amount.

#### Scenario: Month, day and year
- **WHEN** the message is `sep 27 2026 meralco 3200`, `27 sep 2026 meralco 3200` or `meralco 3200 Sep 27, 2026`
- **THEN** the result is one item with the amount 320000 centavos, the description `meralco`, the date `2026-09-27` and no flags

#### Scenario: The year is not read as an amount
- **WHEN** the message is `lunch 250 on Sep 27, 2026`
- **THEN** the result is one item with the amount 25000 centavos, the description `lunch on` and the date `2026-09-27`

#### Scenario: The year before
- **WHEN** the message is `sep 30 2025 meralco 3200`
- **THEN** the date is `2025-09-30`, although `2026-09-30` is nearer

#### Scenario: The year after
- **WHEN** the message is `5 jan 2027 rent 12000`
- **THEN** the result is a rejection with the reason `future_date`

#### Scenario: A date that does not exist in that year
- **WHEN** the message is `feb 29 2025 lunch 250`
- **THEN** the result is a rejection with the reason `invalid_date`

#### Scenario: A number outside the three years is not a year
- **WHEN** the message is `sep 27 2000 meralco`
- **THEN** the result is one item with the amount 200000 centavos, the description `meralco` and the date `2026-09-27`

#### Scenario: A date with a year and no amount
- **WHEN** the message is `see you sep 27 2026`
- **THEN** the result is "not an expense"
