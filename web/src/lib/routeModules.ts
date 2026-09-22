import type { Page } from "../stores/page";

export const loadTrade = () => import("../components/TradeWorkspace");
export const loadPortfolio = () => import("../components/Portfolio");
export const loadBrief = () => import("../components/Brief");
export const loadEconomicCalendar = () =>
  import("../components/EconomicCalendar");
export const loadChartsGrid = () => import("../components/ChartsGrid");
export const loadAdminDashboard = () => import("../components/AdminDashboard");

const pageLoaders: Partial<Record<Page, () => Promise<unknown>>> = {
  trade: loadTrade,
  portfolio: loadPortfolio,
  brief: loadBrief,
  calendar: loadEconomicCalendar,
  charts: loadChartsGrid,
  admin: loadAdminDashboard,
};

export const prefetchPage = (page: Page) => {
  void pageLoaders[page]?.();
};
