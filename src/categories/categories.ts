/** One spending category (design Decision 7). */
export interface Category {
  id: string;
  name: string;
  shortName: string;
  emoji: string;
  order: number;
  countsAsSpending: boolean;
}

/** The categories in display order (the `categorization` spec). No emoji carries U+FE0F. */
export const CATEGORIES: readonly Category[] = [
  { id: "groceries", name: "Groceries & Market", shortName: "Groceries", emoji: "🛒", order: 1, countsAsSpending: true },
  { id: "dining", name: "Dining & Delivery", shortName: "Dining", emoji: "🍽", order: 2, countsAsSpending: true },
  { id: "transport", name: "Transport", shortName: "Transport", emoji: "🚗", order: 3, countsAsSpending: true },
  { id: "bills", name: "Bills & Utilities", shortName: "Bills", emoji: "💡", order: 4, countsAsSpending: true },
  { id: "housing", name: "Housing", shortName: "Housing", emoji: "🏠", order: 5, countsAsSpending: true },
  { id: "household", name: "Household", shortName: "Household", emoji: "🧹", order: 6, countsAsSpending: true },
  { id: "health", name: "Health", shortName: "Health", emoji: "💊", order: 7, countsAsSpending: true },
  { id: "kids", name: "Kids & Education", shortName: "Kids", emoji: "🎒", order: 8, countsAsSpending: true },
  { id: "family", name: "Family Support", shortName: "Family", emoji: "🤝", order: 9, countsAsSpending: true },
  { id: "gifts", name: "Gifts & Occasions", shortName: "Gifts", emoji: "🎁", order: 10, countsAsSpending: true },
  { id: "personal", name: "Personal & Shopping", shortName: "Personal", emoji: "🛍", order: 11, countsAsSpending: true },
  { id: "fun", name: "Fun & Subscriptions", shortName: "Fun", emoji: "🎬", order: 12, countsAsSpending: true },
  { id: "other", name: "Other", shortName: "Other", emoji: "❓", order: 13, countsAsSpending: true },
  { id: "transfer", name: "Transfers", shortName: "Transfers", emoji: "🔁", order: 14, countsAsSpending: false },
];
