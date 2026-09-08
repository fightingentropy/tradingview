import type { Page } from "../stores/page";

export const loadOptionsTrade = () => import("../components/OptionsTrade");
export const loadPortfolio = () => import("../components/Portfolio");
export const loadVaults = () => import("../components/Vaults");
export const loadBrief = () => import("../components/Brief");
export const loadEconomicCalendar = () =>
  import("../components/EconomicCalendar");
export const loadChartsGrid = () => import("../components/ChartsGrid");
export const loadAdminDashboard = () =>
  import("../components/AdminDashboard");

const pageLoaders: Partial<Record<Page, () => Promise<unknown>>> = {
  options: loadOptionsTrade,
  portfolio: loadPortfolio,
  vaults: loadVaults,
  brief: loadBrief,
  calendar: loadEconomicCalendar,
  charts: loadChartsGrid,
  admin: loadAdminDashboard,
};

export const prefetchPage = (page: Page) => {
  void pageLoaders[page]?.();
};
