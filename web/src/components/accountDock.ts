export type AccountTab =
  | "balances"
  | "positions"
  | "openOrders"
  | "twap"
  | "chase"
  | "tradeHistory"
  | "fundingHistory"
  | "orderHistory";

export type AccountSideFilter =
  | "all"
  | "buy"
  | "sell"
  | "long"
  | "short";

export const ACCOUNT_TABS: { id: AccountTab; label: string }[] = [
  { id: "balances", label: "Balances" },
  { id: "positions", label: "Positions" },
  { id: "openOrders", label: "Open Orders" },
  { id: "twap", label: "TWAP" },
  { id: "chase", label: "Chase" },
  { id: "tradeHistory", label: "Trade History" },
  { id: "fundingHistory", label: "Funding History" },
  { id: "orderHistory", label: "Order History" },
];

export const isAccountActivityTab = (tab: AccountTab) =>
  tab === "twap" ||
  tab === "tradeHistory" ||
  tab === "fundingHistory" ||
  tab === "orderHistory";

export const accountTabHasSideFilter = (tab: AccountTab) =>
  tab !== "balances" && tab !== "chase";

export const accountTabHasMarketFilter = (tab: AccountTab) =>
  tab !== "balances";

export const accountSideOptions = (tab: AccountTab) =>
  tab === "positions" || tab === "fundingHistory"
    ? ([
        { value: "all", label: "Side" },
        { value: "long", label: "Long" },
        { value: "short", label: "Short" },
      ] as const)
    : ([
        { value: "all", label: "Side" },
        { value: "buy", label: "Buy" },
        { value: "sell", label: "Sell" },
      ] as const);

export const formatAccountMarket = (symbol: string) => {
  const trimmed = symbol.trim();
  const separator = trimmed.indexOf(":");
  return separator > 0 ? trimmed.slice(separator + 1) : trimmed;
};

export const formatAccountTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

export const formatAccountSize = (value: number) => {
  const absolute = Math.abs(value);
  return absolute.toLocaleString("en-US", {
    minimumFractionDigits: absolute >= 100 ? 2 : absolute >= 1 ? 3 : 4,
    maximumFractionDigits: absolute >= 100 ? 2 : absolute >= 1 ? 3 : 4,
  });
};

export const formatAccountUsd = (value: number, signed = false) => {
  if (!Number.isFinite(value)) return "--";
  const sign = signed
    ? value > 0
      ? "+"
      : value < 0
        ? "-"
        : ""
    : value < 0
      ? "-"
      : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const formatAccountStatus = (status: string) =>
  status
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Rejected$/u, " rejected")
    .replace(/Canceled$/u, " canceled")
    .replace(/^./u, (character) => character.toUpperCase());

export const annualizeHourlyFundingRate = (hourlyRate: number) =>
  hourlyRate * 24 * 365;

export const formatAnnualizedFundingRate = (hourlyRate: number) => {
  if (!Number.isFinite(hourlyRate)) return "--";
  const percentage = annualizeHourlyFundingRate(hourlyRate) * 100;
  const fractionDigits = Math.abs(percentage) < 1 ? 4 : 2;
  return `${percentage.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
};

const csvCell = (value: string | number | boolean) =>
  `"${String(value).replaceAll('"', '""')}"`;

export const downloadAccountCsv = (
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean>>,
) => {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
