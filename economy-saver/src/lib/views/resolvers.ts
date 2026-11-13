// The views that are live (D77): each id and the pure function that draws it. A view not listed here is refused in words until it is built.
import type { Resolver, ViewId } from "./types";
import { calendarView } from "./v/calendar";
import { cardCycleView } from "./v/card-cycle";
import { fixedCostsView } from "./v/fixed-costs";
import { forecastView } from "./v/forecast";
import { fxCostView } from "./v/fx-cost";
import { goalPaceView } from "./v/goal-pace";
import { clientPaceView, incomeMonthsView } from "./v/income";
import { bufferMonthsView, moneyFlowView, savingsRateView } from "./v/keep";
import { monthByCategoryView } from "./v/month-by-category";
import { monthPaceView } from "./v/month-pace";
import { monthTrendView } from "./v/month-trend";
import { positionView } from "./v/position";
import { taxAheadView } from "./v/tax-ahead";
import { searchMonthsView } from "./v/search-months";
import { whatChangedView } from "./v/what-changed";
import { whatIfView } from "./v/what-if";
import { whoOwesWhomView } from "./v/who-owes-whom";

export const LIVE: { [K in ViewId]?: Resolver<K> } = {
  forecast: forecastView,
  what_if: whatIfView,
  position: positionView,
  month_by_category: monthByCategoryView,
  month_trend: monthTrendView,
  month_pace: monthPaceView,
  fixed_costs: fixedCostsView,
  search_months: searchMonthsView,
  money_flow: moneyFlowView,
  savings_rate: savingsRateView,
  buffer_months: bufferMonthsView,
  income_months: incomeMonthsView,
  client_pace: clientPaceView,
  fx_cost: fxCostView,
  goal_pace: goalPaceView,
  bills_calendar: calendarView,
  card_cycle: cardCycleView,
  who_owes_whom: whoOwesWhomView,
  what_changed: whatChangedView,
  tax_ahead: taxAheadView,
};
