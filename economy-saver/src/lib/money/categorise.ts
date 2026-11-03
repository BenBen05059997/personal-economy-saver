// A small keyword table that proposes a category from a biller or merchant name (D46). Pure: the forms use it as the
// user types, the agent tools when they get no category. `sure` is false when no keyword matched; the form then pre-selects
// nothing and the user chooses. International names are welcome; keep the lists short and readable.
import type { CategoryKey } from "./categories";

// Whole words, case-insensitive, with an optional plural s. A word with a non-ASCII character (café, 家賃) matches inside the name.
// The first category with a matching word wins.
const KEYWORDS: [CategoryKey, string[]][] = [
  ["housing", ["rent", "mortgage", "landlord", "housing", "家賃", "管理費"]],
  ["utilities", ["electric", "electricity", "power", "energy", "heating", "denki", "gas", "water", "utility", "utilities", "sewer", "電気", "水道", "ガス"]],
  ["phone_internet", ["mobile", "mobaile", "phone", "telecom", "tsushin", "internet", "broadband", "fiber", "fibre", "wifi", "携帯"]],
  ["business_tools", ["hosting", "adobe", "github", "domain", "server", "figma"]],
  ["subscriptions", ["subscription", "netflix", "spotify", "cloudbox", "streaming", "membership"]],
  ["food", ["grocery", "groceries", "market", "supermarket", "restaurant", "cafe", "café", "kissa", "coffee", "bakery", "ramen", "lunch", "dinner", "izakaya"]],
  ["transport", ["commuter", "metro", "train", "subway", "bus", "taxi", "uber", "fuel", "petrol", "parking", "toll", "railway", "suica"]],
  ["health", ["pharmacy", "clinic", "hospital", "dental", "dentist", "doctor", "medical", "drugstore", "gym"]],
  ["insurance", ["insurance", "assurance", "保険"]],
  ["family_shared", ["school", "daycare", "kindergarten", "tuition", "childcare"]],
  ["government_tax", ["tax", "vat", "pension", "government", "税", "年金"]],
  ["debt", ["loan", "repayment", "debt", "installment", "instalment"]],
];

const words = (name: string) => name.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function guessCategory(name: string): { category: CategoryKey; sure: boolean } {
  const text = name.normalize("NFKC").toLowerCase();
  const tokens = words(name);
  for (const [category, list] of KEYWORDS) {
    const hit = list.some(word => /[^\x00-\x7f]/.test(word) ? text.includes(word) : tokens.some(token => token === word || token === `${word}s`));
    if (hit) return { category, sure: true };
  }
  return { category: "other", sure: false };
}
