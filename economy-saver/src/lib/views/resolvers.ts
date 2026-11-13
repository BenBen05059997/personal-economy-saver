// The views that are live (D77): each id and the pure function that draws it. A view not listed here is refused in words until it is built.
import type { Resolver, ViewId } from "./types";
import { forecastView } from "./v/forecast";
import { monthByCategoryView } from "./v/month-by-category";
import { monthTrendView } from "./v/month-trend";

export const LIVE: { [K in ViewId]?: Resolver<K> } = {
  forecast: forecastView,
  month_by_category: monthByCategoryView,
  month_trend: monthTrendView,
};
