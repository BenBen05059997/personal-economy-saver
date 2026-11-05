// A small keyword table that proposes a category from a biller or merchant name (D46). Pure: the forms use it as the
// user types, the agent tools when they get no category. `sure` is false when no keyword matched; the form then pre-selects
// nothing and the user chooses. International names are welcome; keep the lists short and readable.
import type { CategoryKey } from "./categories";
import { normalise } from "./spending";

// Whole words, case-insensitive, with an optional plural s. A word with a non-ASCII character (café, 家賃) matches inside the name;
// one with punctuation (booking.com) matches as the same words in a row.
// The first category with a matching word wins.
const KEYWORDS: [CategoryKey, string[]][] = [
  ["housing", ["rent", "mortgage", "landlord", "housing", "家賃", "管理費"]],
  ["utilities", ["electric", "electricity", "power", "energy", "heating", "denki", "gas", "water", "utility", "utilities", "sewer", "電気", "水道", "ガス"]],
  ["phone_internet", ["mobile", "mobaile", "phone", "telecom", "tsushin", "internet", "broadband", "fiber", "fibre", "wifi", "携帯"]],
  ["business_tools", ["hosting", "adobe", "github", "domain", "server", "figma", "software", "coworking"]],
  ["subscriptions", ["subscription", "netflix", "spotify", "cloudbox", "streaming", "membership"]],
  ["food", ["grocery", "groceries", "market", "supermarket", "restaurant", "cafe", "café", "kissa", "coffee", "bakery", "ramen", "lunch", "dinner", "izakaya",
    "noodle", "udon", "soba", "curry", "bento", "sushi", "konbini", "deli", "bistro", "takeout", "ラーメン", "弁当", "コンビニ"]],
  ["transport", ["commuter", "metro", "train", "subway", "bus", "taxi", "uber", "fuel", "petrol", "parking", "toll", "railway", "suica", "pasmo", "shinkansen", "定期", "定期券", "地下鉄"]],
  // D53: trips (hotels, flights, booking sites). Commuting (Suica, Pasmo, Shinkansen) stays in transport above.
  ["travel", ["hotel", "ホテル", "ryokan", "旅館", "airbnb", "hostel", "flight", "airline", "ana", "jal", "peach", "jetstar", "skymark", "expedia", "booking.com", "agoda", "航空"]],
  ["health", ["pharmacy", "clinic", "hospital", "dental", "dentist", "doctor", "medical", "drugstore", "gym", "薬局"]],
  ["insurance", ["insurance", "assurance", "保険"]],
  ["family_shared", ["school", "daycare", "kindergarten", "tuition", "childcare"]],
  ["government_tax", ["tax", "vat", "pension", "government", "税", "年金"]],
  ["debt", ["loan", "repayment", "debt", "installment", "instalment"]],
];

const words = (name: string) => normalise(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A keyword in a name: inside it when the keyword has a non-ASCII character, as consecutive whole words when it has punctuation (booking.com), else a whole word with an optional plural s. */
function hasKeyword(word: string, text: string, tokens: string[]): boolean {
  if (/[^\x00-\x7f]/.test(word)) return text.includes(word);
  const parts = words(word);
  if (parts.length > 1) return tokens.some((_, i) => parts.every((part, k) => tokens[i + k] === part));
  return tokens.some(token => token === word || token === `${word}s`);
}

export function guessCategory(name: string): { category: CategoryKey; sure: boolean } {
  const text = normalise(name);
  const tokens = words(name);
  for (const [category, list] of KEYWORDS) {
    if (list.some(word => hasKeyword(word, text, tokens))) return { category, sure: true };
  }
  return { category: "other", sure: false };
}

// How often a bill of this name usually comes (D51 prefill). Only the obvious names; everything else is one-off and the user can change it.
const MONTHLY = ["rent", "phone", "mobile", "internet", "broadband", "gym", "subscription", "netflix", "spotify", "streaming", "membership", "家賃", "携帯"];
const YEARLY = ["insurance", "domain", "annual", "yearly", "保険"];

export function guessRepeat(name: string): "" | "month" | "year" {
  const text = normalise(name);
  const tokens = words(name);
  const hit = (list: string[]) => list.some(word => hasKeyword(word, text, tokens));
  if (hit(YEARLY)) return "year";
  return hit(MONTHLY) ? "month" : "";
}
