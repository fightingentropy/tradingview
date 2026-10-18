import type { Page } from "../stores/page";

export const loadTrade = () => import("../components/TradeWorkspace");
export const loadPortfolio = () => import("../components/Portfolio");
export const loadStats = () => import("../components/Stats");
export const loadBrief = () => import("../components/Brief");
export const loadNews = () => import("../components/News");
export const loadEconomicCalendar = () =>
  import("../components/EconomicCalendar");
export const loadChartsGrid = () => import("../components/ChartsGrid");
export const loadAdminDashboard = () => import("../components/AdminDashboard");

const pageLoaders: Partial<Record<Page, () => Promise<unknown>>> = {
  trade: loadTrade,
  portfolio: loadPortfolio,
  stats: loadStats,
  brief: loadBrief,
  news: loadNews,
  calendar: loadEconomicCalendar,
  charts: loadChartsGrid,
  admin: loadAdminDashboard,
};

export const prefetchPage = (page: Page) => {
  void pageLoaders[page]?.();
};
