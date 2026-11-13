// What the views read (D77): the money state always, and the spending, income, pot fills and foreign costs only when a view asks. Read only.
import { householdDate } from "@/db/account";
import { foreignCostInputs } from "@/db/fx-cost";
import { loadMoneyState, requireHousehold, withHousehold, type Db } from "@/db/household";
import { loadIncome } from "@/db/income";
import { loadPotFills } from "@/db/pot-fills";
import { loadSpending } from "@/db/spending";
import { foreignCosts } from "@/lib/money/fx-cost";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import type { MoneyState } from "@/lib/money/types";
import type { ViewContext, ViewNeed } from "./types";

/**
 * The context the views draw from: the money state (or the one the caller already has), and what `needs` names. Spending, income and pot fills cover the
 * last twelve months through this one, at the household's own date. One read-only transaction unless the caller is already inside one.
 */
export async function loadViewContext(db: Db, householdId: string, needs: readonly ViewNeed[], base?: { state?: MoneyState }): Promise<ViewContext> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const today = base?.state?.today ?? await householdDate(tx, hid);
    const current = today.slice(0, 7);
    const range = { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last };
    const want = new Set(needs);
    const [state, spending, income, potFills, fx] = await Promise.all([
      base?.state ?? loadMoneyState(tx, hid, today),
      want.has("spending") ? loadSpending(tx, hid, range) : undefined,
      want.has("income") ? loadIncome(tx, hid, range) : undefined,
      want.has("potFills") ? loadPotFills(tx, hid, range) : undefined,
      want.has("fx") ? foreignCostInputs(tx, hid, today).then(foreignCosts) : undefined,
    ]);
    return { state, ...(spending && { spending }), ...(income && { income }), ...(potFills && { potFills }), ...(fx && { foreignCosts: fx }) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
