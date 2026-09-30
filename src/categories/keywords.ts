/**
 * Seed keywords by category id, each already normalized (design Decision 9).
 * `gcash` is a payment word and is left out. `gas` and `rice` are ambiguous and
 * are left out too (D60).
 */
export const SEED_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  groceries: [
    "palengke", "puregold", "ulam", "grocery", "groceries", "supermarket", "savemore", "s&r",
    "landers", "7-eleven", "bigas", "gulay", "karne", "isda", "prutas", "milk",
  ],
  dining: [
    "jollibee", "lunch", "dinner", "breakfast", "merienda", "kape", "coffee", "milk tea", "grab food",
    "grabfood", "foodpanda", "mcdo", "mcdonalds", "mcdonald's", "chowking", "mang inasal", "starbucks",
    "almusal", "hapunan", "tanghalian",
  ],
  transport: [
    "grab", "angkas", "pamasahe", "toll", "jeep", "jeepney", "tricycle", "taxi", "gasolina", "petron",
    "shell", "caltex", "parking", "mrt", "lrt", "bus",
  ],
  bills: [
    "meralco", "maynilad", "manila water", "pldt", "converge", "globe", "smart", "load", "internet",
    "wifi", "kuryente", "tubig",
  ],
  housing: ["rent", "upa", "renta", "association dues", "condo dues", "amortization", "hoa", "pag-ibig"],
  household: [
    "lpg", "gasul", "detergent", "sabon", "tissue", "laundry", "labada", "zonrox", "downy", "walis",
    "kasambahay",
  ],
  health: [
    "gamot", "medicine", "meds", "mercury drug", "watsons", "doctor", "check up", "checkup", "hospital",
    "clinic", "dentist", "vitamins",
  ],
  kids: [
    "tuition", "matrikula", "school", "baon", "diaper", "diapers", "school supplies", "laruan", "toys",
    "formula",
  ],
  family: ["padala", "remittance", "sustento", "allowance", "tulong", "bigay"],
  gifts: [
    "regalo", "pasalubong", "gift", "birthday", "wedding", "ninong", "ninang", "abuloy", "pamasko",
    "christmas",
  ],
  personal: [
    "shopee", "lazada", "clothes", "damit", "shoes", "sapatos", "haircut", "gupit", "salon", "uniqlo",
  ],
  fun: [
    "netflix", "spotify", "youtube premium", "disney", "movie", "sine", "concert", "steam", "resort",
    "outing",
  ],
  transfer: [
    "cash in", "cash-in", "withdraw", "withdrawal", "atm", "credit card", "cc payment", "bank transfer",
    "savings",
  ],
};
