import {
  Component,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import {
  MARKETS,
  currentMarketLeverage,
  currentMarketType,
  currentSymbol,
} from "../stores/market";
import {
  Collateral,
  getAvailableBalance,
  getBalance,
  getMarkPriceForSymbol,
  getPositionForSymbol,
  getTotalMarginUsed,
  getTotalPerpsBalance,
  getTotalUnrealizedPnl,
  getWeightedSpotEquity,
  isPortfolioMarginEnabled,
  placeOrder,
  positions,
  togglePortfolioMargin,
  updatePositionTpsl,
} from "../stores/clob";
import { adminReady, isAdmin, isAuthenticated, login } from "../stores/auth";
import {
  getSpotBalance,
  getSpotTotalBalance,
  placeSpotOrder,
  resolveSpotAssetAlias,
} from "../stores/wallet";
import AdminDepositModal from "./AdminDepositModal";
import {
  hyperliquidAccountMode,
  hyperliquidAccountModeLabel,
  hyperliquidPortfolioMarginSummary,
  isHyperliquidExecution,
} from "../stores/hyperliquidExecution";
import { openConnect } from "../stores/connect";
import { hyperliquidConnection } from "../stores/hyperliquidExecution";
import { openSettings } from "../stores/settings";

type OrderSide = "long" | "short";
type OrderType = "market" | "limit";

const DEFAULT_LEVERAGE = 10;
const BASE_LEVERAGE_OPTIONS = [2, 5, 10, 15, 20, 25, 35, 50, 75, 100];

const PortfolioMarginGauge: Component<{ ratio?: number }> = (props) => {
  const normalizedRatio = createMemo(() =>
    Math.min(1, Math.max(0, props.ratio ?? 0)),
  );
  const riskClass = createMemo(() => {
    const ratio = props.ratio;
    if (ratio === undefined) return "text-brand-slate-600";
    if (ratio >= 0.95) return "text-brand-red-400";
    if (ratio >= 0.75) return "text-amber-300";
    return "text-brand-accent";
  });

  return (
    <svg
      viewBox="0 0 38 22"
      class={`h-4 w-7 shrink-0 ${riskClass()}`}
      role="img"
      aria-label={
        props.ratio === undefined
          ? "Portfolio margin ratio unavailable"
          : `Portfolio margin ratio ${(props.ratio * 100).toFixed(2)} percent`
      }
    >
      <path
        d="M3 19a16 16 0 0 1 32 0"
        fill="none"
        stroke="currentColor"
        stroke-opacity="0.2"
        stroke-width="6"
        stroke-linecap="butt"
        pathLength="100"
      />
      <path
        d="M3 19a16 16 0 0 1 32 0"
        fill="none"
        stroke="currentColor"
        stroke-width="6"
        stroke-linecap="butt"
        pathLength="100"
        stroke-dasharray={`${normalizedRatio() * 100} 100`}
      />
    </svg>
  );
};

const OrderForm: Component = () => {
  const [side, setSide] = createSignal<OrderSide>("long");
  const [orderType, setOrderType] = createSignal<OrderType>("market");
  const [leverage, setLeverage] = createSignal(DEFAULT_LEVERAGE);
  const [leverageMenuOpen, setLeverageMenuOpen] = createSignal(false);
  const [marginType, setMarginType] = createSignal<"isolated" | "cross">(
    "cross",
  );
  const [amount, setAmount] = createSignal("");
  const [limitPrice, setLimitPrice] = createSignal("");
  const [sliderValue, setSliderValue] = createSignal(0);
  const [reduceOnly, setReduceOnly] = createSignal(false);
  const [tpsl, setTpsl] = createSignal(false);
  const [takeProfit, setTakeProfit] = createSignal("");
  const [stopLoss, setStopLoss] = createSignal("");
  const [collateral] = createSignal<Collateral>("USDC");
  const [spotError, setSpotError] = createSignal("");
  const [orderError, setOrderError] = createSignal("");
  const [orderNotice, setOrderNotice] = createSignal("");
  const [marginModeOpen, setMarginModeOpen] = createSignal(false);
  const [marginModeLoading, setMarginModeLoading] = createSignal(false);
  const [adminDepositOpen, setAdminDepositOpen] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const livePortfolioSummary = createMemo(() =>
    hyperliquidPortfolioMarginSummary(),
  );
  const canAdminDeposit = createMemo(
    () => isAuthenticated() && adminReady() && isAdmin(),
  );
  const depositButtonClass = createMemo(() => {
    if (!isAuthenticated() || canAdminDeposit()) {
      return "border border-brand-border text-slate-200 hover:bg-brand-border/40";
    }
    return "bg-brand-border text-brand-slate-500 cursor-not-allowed";
  });
  const depositButtonDisabled = createMemo(
    () => isAuthenticated() && !canAdminDeposit(),
  );

  const isLong = () => side() === "long";
  const isSpot = createMemo(() => currentMarketType() === "spot");
  const spotAsset = createMemo(() => resolveSpotAssetAlias(currentSymbol()));
  const liveLimitTpslUnavailable = createMemo(
    () => isHyperliquidExecution() && !isSpot() && orderType() === "limit",
  );
  const effectiveLeverage = createMemo(() => (isSpot() ? 1 : leverage()));
  const maxLeverage = createMemo(() => {
    if (isSpot()) return 1;
    const symbol = currentSymbol();
    const market =
      MARKETS().find(
        (item) => item.symbol === symbol && item.type === "perps",
      ) ?? MARKETS().find((item) => item.symbol === symbol);
    const leverageLabel = market?.leverage ?? currentMarketLeverage();
    const parsed = Number.parseFloat(leverageLabel);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LEVERAGE;
  });
  const leverageOptions = createMemo(() => {
    const max = maxLeverage();
    const filtered = BASE_LEVERAGE_OPTIONS.filter((option) => option <= max);
    if (max > 1 && !filtered.includes(max)) {
      filtered.push(max);
    }
    return filtered.sort((a, b) => a - b);
  });
  const currentPosition = createMemo(() =>
    getPositionForSymbol(currentSymbol()),
  );
  const mark = createMemo(() => getMarkPriceForSymbol(currentSymbol()));
  const displaySymbol = createMemo(() => {
    const symbol = currentSymbol().trim();
    if (!symbol) return "";
    const core = symbol.toLowerCase().startsWith("xyz:")
      ? symbol.slice(symbol.indexOf(":") + 1)
      : symbol;
    const upper = core.toUpperCase();
    if (upper === "100" || upper === "XYZ100") return "NDX";
    return core;
  });
  const parsedAmount = createMemo(() => parseFloat(amount()));
  const parsedLimitPrice = createMemo(() => parseFloat(limitPrice()));
  const availableBalance = createMemo(() => {
    if (!isSpot()) return getAvailableBalance(collateral());
    if (isLong()) return getSpotBalance("USDC");
    const asset = spotAsset();
    return asset ? getSpotBalance(asset) : 0;
  });
  const orderPrice = createMemo(() => {
    if (orderType() === "limit" && Number.isFinite(parsedLimitPrice())) {
      return parsedLimitPrice();
    }
    return mark();
  });
  const canReduceOnly = createMemo(() => !isSpot());
  const reduceMaxSize = createMemo(() => {
    if (isSpot()) return 0;
    const position = currentPosition();
    if (!position) return 0;
    const isReducing = isLong() ? position.size < 0 : position.size > 0;
    return isReducing ? Math.abs(position.size) : 0;
  });
  const baseMaxSize = createMemo(() => {
    const price = orderPrice();
    if (!Number.isFinite(price) || price <= 0) return 0;
    if (isSpot()) {
      return isLong() ? availableBalance() / price : availableBalance();
    }
    if (effectiveLeverage() <= 0) return 0;
    return (availableBalance() * effectiveLeverage()) / price;
  });
  const maxSize = createMemo(() =>
    canReduceOnly() && reduceOnly() ? reduceMaxSize() : baseMaxSize(),
  );
  const orderSize = createMemo(() =>
    Number.isFinite(parsedAmount()) && parsedAmount() > 0 ? parsedAmount() : 0,
  );
  const orderValue = createMemo(() => {
    if (orderSize() <= 0) return 0;
    const price = orderPrice();
    return Number.isFinite(price) ? orderSize() * price : 0;
  });

  const marginRequired = createMemo(() => {
    if (isSpot()) return 0;
    if (orderValue() <= 0 || effectiveLeverage() <= 0) return 0;
    return orderValue() / effectiveLeverage();
  });
  const calculateMarginUsed = (
    size: number,
    leverageValue: number,
    price: number,
  ) => {
    if (!Number.isFinite(price) || price <= 0 || leverageValue <= 0) return 0;
    return (Math.abs(size) * price) / leverageValue;
  };

  const normalizeAssetSymbol = (symbol: string) => {
    const trimmed = String(symbol ?? "").trim();
    if (!trimmed) return "";
    if (trimmed.toLowerCase().startsWith("xyz:")) {
      return trimmed.slice(trimmed.indexOf(":") + 1).toUpperCase();
    }
    return trimmed.toUpperCase();
  };

  const getSpotBalanceForSymbol = (symbol: string) => {
    const normalized = normalizeAssetSymbol(symbol);
    const asset = resolveSpotAssetAlias(normalized);
    return asset ? getSpotBalance(asset) : 0;
  };

  const getEffectiveAbsSize = (
    size: number,
    symbol: string,
    positionMarginType?: "isolated" | "cross",
  ) => {
    const absSize = Math.abs(size);
    if (!isPortfolioMarginEnabled()) return absSize;
    if ((positionMarginType ?? "cross") === "isolated") return absSize;
    if (size >= 0) return absSize;
    const spotBalance = getSpotBalanceForSymbol(symbol);
    if (!Number.isFinite(spotBalance) || spotBalance <= 0) return absSize;
    return Math.max(0, absSize - Math.min(absSize, spotBalance));
  };

  const signedOrderSize = createMemo(() => {
    const size = orderSize();
    if (!Number.isFinite(size) || size <= 0) return 0;
    return isLong() ? size : -size;
  });

  const currentMarginUsed = createMemo(() => {
    if (isSpot()) return 0;
    const usePortfolio = isPortfolioMarginEnabled();
    const relevantPositions = usePortfolio
      ? positions()
      : positions().filter((pos) => pos.collateral === collateral());
    return relevantPositions.reduce((sum, pos) => {
      if (pos.leverage <= 0) return sum;
      const price = getMarkPriceForSymbol(pos.symbol);
      const effectiveSize = getEffectiveAbsSize(
        pos.size,
        pos.symbol,
        pos.marginType ?? "cross",
      );
      return sum + calculateMarginUsed(effectiveSize, pos.leverage, price);
    }, 0);
  });

  const nextMarginUsed = createMemo(() => {
    if (isSpot()) return 0;
    const signedSize = signedOrderSize();
    const markPrice = mark();
    const nextLeverage = leverage();
    let marginUsed = 0;
    let applied = false;
    const usePortfolio = isPortfolioMarginEnabled();
    const relevantPositions = usePortfolio
      ? positions()
      : positions().filter((pos) => pos.collateral === collateral());

    for (const position of relevantPositions) {
      let nextSize = position.size;
      let leverageValue = position.leverage;
      let nextMarginType = position.marginType ?? "cross";

      if (position.symbol === currentSymbol()) {
        applied = true;
        nextSize = position.size + signedSize;
        leverageValue = nextLeverage;
        nextMarginType = marginType();
      }

      if (nextSize === 0 || leverageValue <= 0) continue;
      const price =
        position.symbol === currentSymbol()
          ? markPrice
          : getMarkPriceForSymbol(position.symbol);
      const effectiveSize = getEffectiveAbsSize(
        nextSize,
        position.symbol,
        nextMarginType,
      );
      marginUsed += calculateMarginUsed(effectiveSize, leverageValue, price);
    }

    if (!applied && signedSize !== 0) {
      if (nextLeverage > 0 && Number.isFinite(markPrice) && markPrice > 0) {
        const effectiveSize = getEffectiveAbsSize(
          signedSize,
          currentSymbol(),
          marginType(),
        );
        marginUsed += (effectiveSize * markPrice) / nextLeverage;
      }
    }

    return marginUsed;
  });

  const unrealizedByCollateral = createMemo(() => {
    const totals: Record<Collateral, number> = { USDC: 0, USDT: 0 };
    for (const position of positions()) {
      const currentMark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(currentMark) || currentMark <= 0) continue;
      totals[position.collateral] +=
        (currentMark - position.entryPrice) * position.size;
    }
    return totals;
  });
  const totalUnrealized = createMemo(() => getTotalUnrealizedPnl());
  const totalMarginUsed = createMemo(() => getTotalMarginUsed());
  const totalPerpsBalance = createMemo(() => getTotalPerpsBalance());
  const weightedSpotEquity = createMemo(() => getWeightedSpotEquity());

  const currentPositionUnrealized = createMemo(() => {
    const position = currentPosition();
    if (!position) return 0;
    const currentMark = getMarkPriceForSymbol(position.symbol);
    if (!Number.isFinite(currentMark) || currentMark <= 0) return 0;
    return (currentMark - position.entryPrice) * position.size;
  });

  const otherMarginUsedByCollateral = createMemo(() => {
    const totals: Record<Collateral, number> = { USDC: 0, USDT: 0 };
    const current = currentSymbol();
    for (const position of positions()) {
      if (position.symbol === current) continue;
      const price = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(price) || price <= 0) continue;
      const effectiveSize = getEffectiveAbsSize(
        position.size,
        position.symbol,
        position.marginType ?? "cross",
      );
      totals[position.collateral] += calculateMarginUsed(
        effectiveSize,
        position.leverage,
        price,
      );
    }
    return totals;
  });
  const otherMarginUsedTotal = createMemo(() => {
    const current = currentSymbol();
    return positions().reduce((sum, position) => {
      if (position.symbol === current) return sum;
      const price = getMarkPriceForSymbol(position.symbol);
      const effectiveSize = getEffectiveAbsSize(
        position.size,
        position.symbol,
        position.marginType ?? "cross",
      );
      return sum + calculateMarginUsed(effectiveSize, position.leverage, price);
    }, 0);
  });

  const previewPosition = createMemo(() => {
    if (isSpot()) return null;
    const position = currentPosition();
    const signedSize = signedOrderSize();
    if (!position && signedSize === 0) return null;
    if (position && signedSize === 0) {
      return {
        size: position.size,
        entryPrice: position.entryPrice,
        leverage: position.leverage,
        marginType: position.marginType ?? "cross",
        collateral: position.collateral,
      };
    }
    const price = orderPrice();
    if (!Number.isFinite(price) || price <= 0) return null;

    if (!position) {
      return {
        size: signedSize,
        entryPrice: price,
        leverage: leverage(),
        marginType: marginType(),
        collateral: collateral(),
      };
    }

    const nextSize = position.size + signedSize;
    const sameDirection =
      Math.sign(position.size) === Math.sign(signedSize) || signedSize === 0;

    if (sameDirection) {
      const totalAbs = Math.abs(position.size) + Math.abs(signedSize);
      const entryPrice =
        totalAbs === 0
          ? price
          : (position.entryPrice * Math.abs(position.size) +
              price * Math.abs(signedSize)) /
            totalAbs;
      return {
        size: nextSize,
        entryPrice,
        leverage: leverage(),
        marginType: marginType(),
        collateral: collateral(),
      };
    }

    const absSigned = Math.abs(signedSize);
    const absExisting = Math.abs(position.size);
    if (absSigned < absExisting) {
      return {
        size: nextSize,
        entryPrice: position.entryPrice,
        leverage: position.leverage,
        marginType: position.marginType ?? "cross",
        collateral: position.collateral,
      };
    }

    if (absSigned === absExisting) return null;
    return {
      size: nextSize,
      entryPrice: price,
      leverage: leverage(),
      marginType: marginType(),
      collateral: collateral(),
    };
  });

  const realizedPnlDelta = createMemo(() => {
    const position = currentPosition();
    const signedSize = signedOrderSize();
    if (!position || signedSize === 0) return 0;
    const price = orderPrice();
    if (!Number.isFinite(price) || price <= 0) return 0;
    const sameDirection =
      Math.sign(position.size) === Math.sign(signedSize) || signedSize === 0;
    if (sameDirection) return 0;
    const closedSize = Math.min(Math.abs(position.size), Math.abs(signedSize));
    if (closedSize <= 0) return 0;
    return position.size > 0
      ? (price - position.entryPrice) * closedSize
      : (position.entryPrice - price) * closedSize;
  });

  const baseEquity = createMemo(() => {
    const position = previewPosition();
    const col = position?.collateral ?? collateral();
    const realizedDelta = realizedPnlDelta();
    if (isPortfolioMarginEnabled()) {
      return (
        totalPerpsBalance() +
        weightedSpotEquity() +
        totalUnrealized() -
        currentPositionUnrealized() +
        realizedDelta -
        otherMarginUsedTotal()
      );
    }
    const collateralUnrealized = unrealizedByCollateral()[col] ?? 0;
    const otherMarginUsed = otherMarginUsedByCollateral()[col] ?? 0;
    return (
      getBalance(col) +
      (collateralUnrealized - currentPositionUnrealized()) +
      realizedDelta -
      otherMarginUsed
    );
  });

  const liquidationPreview = createMemo(() => {
    if (isSpot()) return "--";
    const position = previewPosition();
    if (!position || position.size === 0) return "--";
    const entryPrice = position.entryPrice;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return "--";

    const isShort = position.size < 0;
    if (position.marginType === "isolated") {
      if (!Number.isFinite(position.leverage) || position.leverage <= 0) {
        return "--";
      }
      const liqFactor = 1 / position.leverage;
      const liq = isShort
        ? entryPrice * (1 + liqFactor)
        : entryPrice * (1 - liqFactor);
      return liq > 0 ? liq.toFixed(3) : "--";
    }

    const equity = baseEquity();
    const denom = getEffectiveAbsSize(
      position.size,
      currentSymbol(),
      position.marginType ?? "cross",
    );
    if (!Number.isFinite(equity) || denom <= 0) return "--";
    const liq = isShort
      ? entryPrice + equity / denom
      : entryPrice - equity / denom;
    return Number.isFinite(liq) && liq > 0 ? liq.toFixed(3) : "--";
  });
  const reduceOnlyError = createMemo(() => {
    if (!canReduceOnly() || !reduceOnly()) return "";
    if (reduceMaxSize() <= 0) {
      return "Reduce-only requires an opposing position.";
    }
    if (orderSize() > reduceMaxSize()) {
      return "Reduce-only size exceeds position.";
    }
    return "";
  });
  const isOrderValid = createMemo(() => {
    if (orderSize() <= 0) return false;
    if (orderType() === "limit") {
      return (
        Number.isFinite(parsedLimitPrice()) &&
        parsedLimitPrice() > 0 &&
        !reduceOnlyError()
      );
    }
    return !reduceOnlyError();
  });

  const insufficientMargin = createMemo(() => {
    if (isHyperliquidExecution()) return false;
    if (isSpot()) return false;
    if (!isOrderValid()) return false;
    const collateralPool = isPortfolioMarginEnabled()
      ? totalPerpsBalance() + weightedSpotEquity() + totalUnrealized()
      : getBalance(collateral());
    const nextUsed = nextMarginUsed();
    const currentUsed = currentMarginUsed();
    if (!Number.isFinite(collateralPool)) return false;
    if (!Number.isFinite(nextUsed) || !Number.isFinite(currentUsed)) {
      return false;
    }
    return nextUsed > collateralPool && nextUsed >= currentUsed;
  });

  const insufficientSpotBalance = createMemo(() => {
    if (isHyperliquidExecution()) return false;
    if (!isSpot() || !isOrderValid()) return false;
    if (isLong()) {
      return orderValue() > availableBalance();
    }
    return orderSize() > availableBalance();
  });

  const canSubmitOrder = createMemo(() => {
    if (!isOrderValid()) return false;
    if (isHyperliquidExecution()) return true;
    if (isSpot()) return !insufficientSpotBalance();
    return !insufficientMargin();
  });

  const formatUsd = (value: number) => {
    if (!Number.isFinite(value)) return "--";
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatSignedUsd = (value: number) => {
    if (!Number.isFinite(value)) return "--";
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${formatUsd(Math.abs(value))}`;
  };

  const formatOptionalUsd = (value: number | undefined) =>
    value === undefined ? "--" : formatUsd(value);

  const formatOptionalPercent = (value: number | undefined) =>
    value === undefined ? "--" : `${(value * 100).toFixed(2)}%`;

  const formatAmount = (value: number, decimals: number) =>
    value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  const spotDecimals = (symbol: string | null) => (symbol === "BTC" ? 6 : 4);

  const marginModeLabel = createMemo(() =>
    isHyperliquidExecution()
      ? hyperliquidAccountModeLabel()
      : isPortfolioMarginEnabled()
        ? "Portfolio"
        : "Classic",
  );

  const marginModeButtonLabel = createMemo(() =>
    isHyperliquidExecution() && hyperliquidAccountMode() === "portfolioMargin"
      ? "PM"
      : marginModeLabel(),
  );

  const marginModeButtonDescription = createMemo(() =>
    isHyperliquidExecution()
      ? `Account mode: ${hyperliquidAccountModeLabel()}`
      : `Paper margin mode: ${marginModeLabel()}`,
  );

  // Sanitize a free-text numeric input: strip any non-numeric characters,
  // collapse to a single decimal point, reject scientific notation (e/E),
  // and clamp the fractional part to `precision` decimals. Returns a string
  // safe to commit to state (never NaN / scientific / multi-dot).
  const sanitizeNumericInput = (value: string, precision: number) => {
    // Drop everything except digits and dots (this also removes e/E/+/-).
    let cleaned = String(value ?? "").replace(/[^0-9.]/g, "");
    // Collapse to a single decimal point (keep the first one).
    const firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned =
        cleaned.slice(0, firstDot + 1) +
        cleaned.slice(firstDot + 1).replace(/\./g, "");
    }
    // Clamp the fractional part to the asset precision.
    if (firstDot !== -1 && precision >= 0) {
      const [intPart, fracPart = ""] = cleaned.split(".");
      cleaned =
        precision === 0
          ? intPart
          : `${intPart}.${fracPart.slice(0, precision)}`;
    }
    return cleaned;
  };

  const parsePriceInput = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  };

  const handleToggleMarginMode = async () => {
    if (isHyperliquidExecution()) {
      openSettings();
      setMarginModeOpen(false);
      return;
    }
    if (!isAuthenticated()) return;
    setMarginModeLoading(true);
    const newEnabled = !isPortfolioMarginEnabled();
    const result = await togglePortfolioMargin(newEnabled);
    setMarginModeLoading(false);
    if (result.ok) {
      setMarginModeOpen(false);
    }
  };

  const availableLabel = createMemo(() => {
    if (!isSpot()) return "Available to Trade";
    if (isLong()) return "Available USDC";
    const asset = spotAsset();
    return `Available ${asset ?? displaySymbol()}`;
  });

  const availableDisplay = createMemo(() => {
    if (!isSpot()) {
      return `${formatUsd(availableBalance())} ${collateral()}`;
    }
    if (isLong()) return `${formatUsd(availableBalance())} USDC`;
    const asset = spotAsset();
    return `${formatAmount(
      availableBalance(),
      spotDecimals(asset),
    )} ${asset ?? displaySymbol()}`;
  });

  const positionLabel = createMemo(() =>
    isSpot() ? "Spot Balance" : "Current Position",
  );

  const positionDisplay = createMemo(() => {
    if (isSpot()) {
      const asset = spotAsset();
      const balance = asset ? getSpotTotalBalance(asset) : 0;
      return `${formatAmount(balance, spotDecimals(asset))} ${
        asset ?? displaySymbol()
      }`;
    }
    return currentPosition()
      ? `${currentPosition()!.size.toFixed(4)} ${displaySymbol()}`
      : `0 ${displaySymbol()}`;
  });
  const positionValueClass = createMemo(() => {
    if (isSpot()) {
      const asset = spotAsset();
      const balance = asset ? getSpotTotalBalance(asset) : 0;
      return balance > 0 ? "text-slate-100" : "text-brand-slate-400";
    }
    const position = currentPosition();
    if (!position || position.size === 0) return "text-brand-slate-400";
    return position.size > 0 ? "text-brand-green-400" : "text-brand-red-400";
  });

  const sizePrecision = createMemo(() =>
    isSpot() ? spotDecimals(spotAsset()) : 4,
  );
  const longLabel = createMemo(() => (isSpot() ? "Buy" : "Buy / Long"));
  const shortLabel = createMemo(() => (isSpot() ? "Sell" : "Sell / Short"));
  const perpsBalance = createMemo(() => totalPerpsBalance());
  const spotCollateralValue = createMemo(() =>
    isPortfolioMarginEnabled() ? weightedSpotEquity() : 0,
  );
  const unrealizedPnl = createMemo(() => totalUnrealized());
  const marginUsed = createMemo(() => totalMarginUsed());
  const collateralPool = createMemo(
    () => perpsBalance() + spotCollateralValue() + unrealizedPnl(),
  );
  const crossMarginRatio = createMemo(() => {
    const equity = collateralPool();
    if (!Number.isFinite(equity) || equity <= 0) return 0;
    return (marginUsed() / equity) * 100;
  });
  const orderValueDisplay = createMemo(() =>
    orderValue() > 0 ? formatUsd(orderValue()) : "N/A",
  );
  const marginRequiredDisplay = createMemo(() =>
    marginRequired() > 0 ? formatUsd(marginRequired()) : "N/A",
  );

  const clampPercent = (value: number) =>
    Math.min(100, Math.max(0, Math.round(value)));

  const updateAmountInput = (rawValue: string) => {
    const value = sanitizeNumericInput(rawValue, sizePrecision());
    setAmount(value);
    const max = maxSize();
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || max <= 0) {
      setSliderValue(0);
      return;
    }
    const percent = clampPercent((parsed / max) * 100);
    setSliderValue(percent);
  };

  const updateFromSlider = (value: number) => {
    const percent = clampPercent(Number.isFinite(value) ? value : 0);
    const max = maxSize();
    if (!Number.isFinite(max) || max <= 0) {
      setSliderValue(0);
      setAmount("");
      return;
    }
    setSliderValue(percent);
    const size = (max * percent) / 100;
    setAmount(size > 0 ? size.toFixed(sizePrecision()) : "");
  };

  createEffect(() => {
    if (isSpot() && reduceOnly()) {
      setReduceOnly(false);
    }
  });

  createEffect(() => {
    if (liveLimitTpslUnavailable() && tpsl()) {
      setTpsl(false);
    }
  });

  createEffect(() => {
    if (isSpot()) return;
    const max = maxLeverage();
    if (!Number.isFinite(max) || max <= 0) return;
    setLeverage((current) => {
      const next = current > max ? max : current;
      if (next > 0) return next;
      return Math.min(DEFAULT_LEVERAGE, max);
    });
  });

  createEffect(() => {
    if (!isSpot()) {
      setSpotError("");
    }
  });
  createEffect(() => {
    if (isSpot()) {
      setOrderError("");
    }
  });
  createEffect(() => {
    if (!isSpot()) return;
    if (!isOrderValid()) {
      setSpotError("");
      return;
    }
    if (insufficientSpotBalance()) {
      setSpotError(
        isLong()
          ? "Not enough spot USDC. Transfer from Perps to Spot."
          : "Not enough spot balance to sell.",
      );
      return;
    }
    setSpotError("");
  });

  createEffect(() => {
    const max = maxSize();
    const size = orderSize();
    if (size <= 0 || max <= 0) {
      setSliderValue(0);
      return;
    }
    const next = clampPercent((size / max) * 100);
    if (next !== sliderValue()) {
      setSliderValue(next);
    }
  });

  const submitOrder = async () => {
    if (!isOrderValid()) return;
    // Guard against double-firing while a mutation is in flight.
    if (isSubmitting()) return;
    if (!isAuthenticated() && !isHyperliquidExecution()) {
      const message = "Sign in or connect a Hyperliquid API wallet to trade.";
      if (isSpot()) {
        setSpotError(message);
      } else {
        setOrderError(message);
      }
      return;
    }
    if (liveLimitTpslUnavailable() && tpsl()) {
      setOrderError(
        "Live TP/SL cannot be attached to a limit parent order because it may remain unfilled. Place the limit order first, then add protection from Positions after it fills.",
      );
      return;
    }

    setIsSubmitting(true);
    setOrderNotice("");
    try {
      if (isSpot()) {
        const asset = spotAsset();
        if (!asset) {
          setSpotError("Spot asset unavailable.");
          return;
        }
        const result = await placeSpotOrder({
          symbol: asset,
          side: isLong() ? "buy" : "sell",
          size: orderSize(),
          price: orderPrice(),
          type: orderType(),
        });
        if (!result.ok) {
          setSpotError(result.error ?? "Spot order failed.");
          return;
        }
        setSpotError("");
        setOrderError("");
        setOrderNotice(
          result.message ??
            (isHyperliquidExecution()
              ? "Hyperliquid accepted the order."
              : "Paper order placed."),
        );
        setAmount("");
        setSliderValue(0);
        return;
      }

      const tpValue = tpsl() ? parsePriceInput(takeProfit()) : null;
      const slValue = tpsl() ? parsePriceInput(stopLoss()) : null;
      if (tpValue !== null && Number.isNaN(tpValue)) {
        setOrderError("Enter a valid take profit price.");
        return;
      }
      if (slValue !== null && Number.isNaN(slValue)) {
        setOrderError("Enter a valid stop loss price.");
        return;
      }

      const result = await placeOrder({
        symbol: currentSymbol(),
        side: isLong() ? "buy" : "sell",
        type: orderType(),
        size: orderSize(),
        price: orderType() === "limit" ? parsedLimitPrice() : undefined,
        leverage: leverage(),
        collateral: collateral(),
        marginType: marginType(),
        reduceOnly: reduceOnly(),
      });
      if (!result.ok) {
        setOrderError(result.error ?? "Order failed.");
        return;
      }

      let tpslError = false;
      if (
        tpsl() &&
        (tpValue !== null || slValue !== null) &&
        !liveLimitTpslUnavailable()
      ) {
        const tpslResult = await updatePositionTpsl({
          symbol: currentSymbol(),
          takeProfit: tpValue,
          stopLoss: slValue,
        });
        if (!tpslResult.ok) {
          setOrderError(tpslResult.error ?? "Failed to update TP/SL.");
          tpslError = true;
        }
      }

      if (!tpslError) {
        setOrderError("");
        setOrderNotice(
          result.message ??
            (isHyperliquidExecution()
              ? "Hyperliquid accepted the order."
              : "Paper order placed."),
        );
      }
      setAmount("");
      setSliderValue(0);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDepositClick = () => {
    if (isHyperliquidExecution()) return;
    if (!isAuthenticated()) {
      login();
      return;
    }
    if (!adminReady() || !isAdmin()) {
      return;
    }
    setAdminDepositOpen(true);
  };

  return (
    <div class="order-ticket flex flex-col h-full">
      <div class="ticket-scroll">
        <div class="ticket-heading">
          <h2>Order</h2>
          <span class="execution-mode">
            {isHyperliquidExecution()
              ? hyperliquidConnection()?.network === "mainnet"
                ? "Mainnet"
                : "Testnet"
              : "Paper trading"}
          </span>
        </div>
        <div class="ticket-controls border-b border-brand-border p-4 space-y-4">
          <Show when={!isSpot()}>
            <div class="space-y-2">
              <div class="grid grid-cols-3 gap-2">
                <button
                  class="rounded-md border border-brand-border py-2 text-xs font-medium text-slate-200"
                  onClick={() =>
                    setMarginType(
                      marginType() === "isolated" ? "cross" : "isolated",
                    )
                  }
                >
                  {marginType() === "isolated" ? "Isolated" : "Cross"}
                </button>
                <button
                  class="rounded-md border border-brand-border py-2 text-xs font-medium text-slate-200"
                  onClick={() => setLeverageMenuOpen(!leverageMenuOpen())}
                >
                  {leverage()}x
                </button>
                <button
                  type="button"
                  aria-label={marginModeButtonDescription()}
                  title={marginModeButtonDescription()}
                  class="rounded-md border border-brand-border py-2 text-xs font-medium text-slate-200"
                  onClick={() => {
                    if (isHyperliquidExecution()) {
                      openSettings();
                    } else {
                      setMarginModeOpen(true);
                    }
                  }}
                >
                  {marginModeButtonLabel()}
                </button>
              </div>
              <Show when={leverageMenuOpen()}>
                <div class="rounded-md border border-brand-border bg-brand-surface p-2">
                  <div class="grid grid-cols-5 gap-2">
                    {leverageOptions().map((option) => (
                      <button
                        class={`rounded-md border px-2 py-1 text-xs ${
                          leverage() === option
                            ? "border-brand-accent text-brand-accent bg-brand-accent/10"
                            : "border-brand-border text-brand-slate-400 hover:text-slate-200"
                        }`}
                        onClick={() => {
                          setLeverage(option);
                          setLeverageMenuOpen(false);
                        }}
                      >
                        {option}x
                      </button>
                    ))}
                  </div>
                </div>
              </Show>

              {/* Portfolio Margin Modal */}
              <Show when={marginModeOpen() && !isHyperliquidExecution()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                  <div class="mx-4 w-full max-w-sm rounded-lg border border-brand-border bg-brand-surface shadow-xl">
                    <div class="flex items-center justify-between border-b border-brand-border p-4">
                      <h3 class="text-lg font-semibold text-slate-100">
                        Paper margin model
                      </h3>
                      <button
                        class="text-brand-slate-400 hover:text-slate-200 transition-colors"
                        onClick={() => setMarginModeOpen(false)}
                      >
                        <svg
                          class="w-5 h-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <div class="p-4 space-y-4">
                      {/* Standard paper mode */}
                      <button
                        class={`w-full rounded-md border p-4 text-left transition-all ${
                          !isPortfolioMarginEnabled()
                            ? "border-brand-accent bg-brand-accent/10"
                            : "border-brand-border hover:border-brand-slate-400"
                        }`}
                        onClick={() => {
                          if (isPortfolioMarginEnabled())
                            handleToggleMarginMode();
                        }}
                        disabled={marginModeLoading()}
                      >
                        <div class="flex items-center justify-between">
                          <span class="font-semibold text-slate-100">
                            Standard
                          </span>
                          <Show when={!isPortfolioMarginEnabled()}>
                            <span class="text-xs px-2 py-0.5 rounded-full bg-brand-accent/20 text-brand-accent">
                              Active
                            </span>
                          </Show>
                        </div>
                        <p class="mt-1 text-sm text-brand-slate-400">
                          Simulated perps balances are the only collateral used
                          by the paper ledger.
                        </p>
                      </button>

                      {/* Portfolio paper mode */}
                      <button
                        class={`w-full rounded-md border p-4 text-left transition-all ${
                          isPortfolioMarginEnabled()
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-brand-border hover:border-brand-slate-400"
                        }`}
                        onClick={() => {
                          if (!isPortfolioMarginEnabled())
                            handleToggleMarginMode();
                        }}
                        disabled={marginModeLoading()}
                      >
                        <div class="flex items-center justify-between">
                          <span class="font-semibold text-slate-100">
                            Portfolio Margin
                          </span>
                          <Show when={isPortfolioMarginEnabled()}>
                            <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                              Active
                            </span>
                          </Show>
                        </div>
                        <p class="mt-1 text-sm text-brand-slate-400">
                          Simulates eligible spot collateral in the local paper
                          ledger. This is not Hyperliquid account configuration.
                        </p>
                      </button>

                      <Show when={marginModeLoading()}>
                        <div class="flex items-center justify-center gap-2 text-sm text-brand-slate-400">
                          <svg
                            class="w-4 h-4 animate-spin"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <path d="M12 2v4m0 12v4m-8-10h4m12 0h4" />
                          </svg>
                          Updating margin mode...
                        </div>
                      </Show>
                    </div>

                    <div class="border-t border-brand-border p-4">
                      <button
                        class="w-full rounded-md bg-brand-border/70 py-2.5 text-sm font-semibold text-slate-100 hover:bg-brand-border transition-colors"
                        onClick={() => setMarginModeOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Order Type */}
          <div class="flex items-center gap-6 border-b border-brand-border/70">
            <button
              class={`relative pb-3 text-sm font-semibold transition-colors after:content-[''] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full ${
                orderType() === "market"
                  ? "text-slate-100 after:bg-brand-accent"
                  : "text-brand-slate-400 hover:text-slate-200 after:bg-transparent"
              }`}
              onClick={() => setOrderType("market")}
            >
              Market
            </button>
            <button
              class={`relative pb-3 text-sm font-semibold transition-colors after:content-[''] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full ${
                orderType() === "limit"
                  ? "text-slate-100 after:bg-brand-accent"
                  : "text-brand-slate-400 hover:text-slate-200 after:bg-transparent"
              }`}
              onClick={() => {
                setOrderType("limit");
                if (!limitPrice()) {
                  const price = mark();
                  if (Number.isFinite(price) && price > 0) {
                    setLimitPrice(price.toFixed(3));
                  }
                }
              }}
            >
              Limit
            </button>
            <div class="flex-1" />
          </div>

          {/* Long/Short Toggle */}
          <div class="ticket-side-switch rounded-md p-1">
            <div class="flex">
              <button
                class={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  isLong()
                    ? "bg-brand-green-400/12 text-brand-green-400"
                    : "text-brand-slate-400 hover:text-slate-200"
                }`}
                aria-pressed={isLong()}
                onClick={() => setSide("long")}
              >
                {longLabel()}
              </button>
              <button
                class={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  !isLong()
                    ? "bg-brand-red-400/12 text-brand-red-400"
                    : "text-brand-slate-400 hover:text-slate-200"
                }`}
                aria-pressed={!isLong()}
                onClick={() => setSide("short")}
              >
                {shortLabel()}
              </button>
            </div>
          </div>
        </div>

        <div class="ticket-body p-4 space-y-4">
          {/* Available & Position Info */}
          <div class="space-y-2">
            <div class="flex justify-between gap-4 text-sm">
              <span class="text-brand-slate-500">{availableLabel()}</span>
              <span class="text-slate-100 font-mono">{availableDisplay()}</span>
            </div>
            <div class="flex justify-between gap-4 text-sm">
              <span class="text-brand-slate-500">{positionLabel()}</span>
              <span class={`font-mono ${positionValueClass()}`}>
                {positionDisplay()}
              </span>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <div class="mb-2 text-xs text-brand-slate-400">Size</div>
            <div class="flex items-center rounded-md border border-brand-border bg-brand-screen px-3 py-3">
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                autocomplete="off"
                class="flex-1 bg-transparent text-sm text-slate-100 font-mono text-left"
                aria-label="Order size"
                placeholder="0.00"
                value={amount()}
                onInput={(e) => updateAmountInput(e.currentTarget.value)}
              />
              <span class="ml-3 text-xs font-medium text-brand-slate-400">
                {displaySymbol()}
              </span>
            </div>
          </div>

          <Show when={orderType() === "limit"}>
            <div>
              <div class="flex items-center rounded-md border border-brand-border bg-brand-screen px-3 py-3">
                <span class="text-sm text-brand-slate-400">Price</span>
                <input
                  type="text"
                  inputmode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  autocomplete="off"
                  class="flex-1 bg-transparent px-3 text-sm text-slate-100 font-mono text-right"
                  aria-label="Limit price"
                  placeholder={mark().toFixed(3)}
                  value={limitPrice()}
                  onInput={(e) =>
                    setLimitPrice(
                      sanitizeNumericInput(e.currentTarget.value, 3),
                    )
                  }
                />
                <span class="text-xs text-brand-slate-400">
                  {isSpot() ? "USDC" : collateral()}
                </span>
              </div>
            </div>
          </Show>

          {/* Slider */}
          <div class="flex items-center gap-3">
            <div class="relative flex-1">
              <div class="absolute inset-0 flex items-center">
                <div class="h-1.5 w-full rounded-full bg-brand-border/70" />
              </div>
              <div class="absolute inset-0 flex items-center">
                <div
                  class="h-1.5 rounded-full bg-brand-accent"
                  style={{ width: `${sliderValue()}%` }}
                />
              </div>
              <div class="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                <span class="h-2 w-2 rounded-full bg-brand-border/70" />
                <span class="h-2 w-2 rounded-full bg-brand-border/70" />
                <span class="h-2 w-2 rounded-full bg-brand-border/70" />
                <span class="h-2 w-2 rounded-full bg-brand-border/70" />
                <span class="h-2 w-2 rounded-full bg-brand-border/70" />
              </div>
              <input
                aria-label="Order size percentage"
                type="range"
                min="0"
                max="100"
                value={sliderValue()}
                onInput={(e) =>
                  updateFromSlider(parseInt(e.currentTarget.value, 10))
                }
                class="order-slider relative z-10 w-full"
              />
            </div>
            <div class="flex items-center rounded-md border border-brand-border bg-brand-screen px-3 py-2 text-sm">
              <input
                type="text"
                aria-label="Order percentage"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="off"
                class="w-10 bg-transparent text-right font-mono text-slate-100"
                value={sliderValue()}
                onInput={(e) =>
                  updateFromSlider(parseInt(e.currentTarget.value, 10) || 0)
                }
              />
              <span class="ml-1 text-brand-slate-400">%</span>
            </div>
          </div>

          {/* Checkboxes */}
          <Show when={!isSpot()}>
            <div class="space-y-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reduceOnly()}
                  onChange={(e) => setReduceOnly(e.currentTarget.checked)}
                  class="h-3.5 w-3.5 rounded border border-brand-border bg-brand-screen accent-brand-accent"
                />
                <span class="text-sm text-slate-100">Reduce Only</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tpsl()}
                  disabled={liveLimitTpslUnavailable()}
                  onChange={(e) => setTpsl(e.currentTarget.checked)}
                  class="h-3.5 w-3.5 rounded border border-brand-border bg-brand-screen accent-brand-accent disabled:cursor-not-allowed disabled:opacity-40"
                />
                <span
                  class={`text-sm ${
                    liveLimitTpslUnavailable()
                      ? "text-brand-slate-500"
                      : "text-slate-100"
                  }`}
                >
                  Take Profit / Stop Loss
                </span>
              </label>
              <Show when={liveLimitTpslUnavailable()}>
                <p class="text-xs leading-5 text-brand-slate-500">
                  Live TP/SL is available for market orders after their fill. A
                  limit ticket may remain unfilled, so it will not change
                  protection on an existing position.
                </p>
              </Show>
            </div>

            <Show when={reduceOnlyError()}>
              <div class="text-xs text-brand-red-400">{reduceOnlyError()}</div>
            </Show>

            <Show when={tpsl()}>
              <div class="space-y-2">
                <div class="flex items-center bg-brand-screen border border-brand-border rounded-lg overflow-hidden">
                  <span class="px-3 text-sm text-brand-slate-400">
                    Take Profit
                  </span>
                  <input
                    type="text"
                    inputmode="decimal"
                    pattern="[0-9]*[.]?[0-9]*"
                    autocomplete="off"
                    class="flex-1 bg-transparent px-3 py-3 text-sm text-slate-200 font-mono text-right"
                    aria-label="Take profit price"
                    placeholder="--"
                    value={takeProfit()}
                    onInput={(e) => setTakeProfit(e.currentTarget.value)}
                  />
                </div>
                <div class="flex items-center bg-brand-screen border border-brand-border rounded-lg overflow-hidden">
                  <span class="px-3 text-sm text-brand-slate-400">
                    Stop Loss
                  </span>
                  <input
                    type="text"
                    inputmode="decimal"
                    pattern="[0-9]*[.]?[0-9]*"
                    autocomplete="off"
                    class="flex-1 bg-transparent px-3 py-3 text-sm text-slate-200 font-mono text-right"
                    aria-label="Stop loss price"
                    placeholder="--"
                    value={stopLoss()}
                    onInput={(e) => setStopLoss(e.currentTarget.value)}
                  />
                </div>
              </div>
            </Show>
          </Show>

          <Show when={spotError()}>
            <div class="text-xs text-brand-red-400">{spotError()}</div>
          </Show>
          <Show when={orderError()}>
            <div class="text-xs text-brand-red-400">{orderError()}</div>
          </Show>
          <Show when={orderNotice()}>
            <div class="text-xs leading-5 text-brand-green-400" role="status">
              {orderNotice()}
            </div>
          </Show>

          {/* Order Details */}
          <Show
            when={!isSpot()}
            fallback={
              <div class="space-y-2 text-sm">
                <div class="flex justify-between gap-4">
                  <span class="text-brand-slate-500">Order Value</span>
                  <span class="text-slate-100 font-mono">
                    {orderValueDisplay()}
                  </span>
                </div>
                <div class="flex justify-between gap-4">
                  <span class="text-brand-slate-500">Estimated Fee</span>
                  <span class="text-slate-100 font-mono">
                    {isHyperliquidExecution() ? "Hyperliquid tier" : "0.10%"}
                  </span>
                </div>
              </div>
            }
          >
            <div class="space-y-2 text-sm">
              <div class="flex justify-between gap-4">
                <span class="text-brand-slate-500">Liquidation Price</span>
                <span class="font-mono text-slate-100">
                  {isHyperliquidExecution()
                    ? "Exchange calculated"
                    : liquidationPreview()}
                </span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-brand-slate-500">Order Value</span>
                <span class="text-slate-100 font-mono">
                  {orderValueDisplay()}
                </span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-brand-slate-500">Margin Required</span>
                <span class="text-slate-100 font-mono">
                  {isHyperliquidExecution()
                    ? "Exchange checks"
                    : marginRequiredDisplay()}
                </span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-brand-slate-500">Slippage</span>
                <span class="font-mono text-brand-accent">
                  {orderType() === "market" ? "1.00% max" : "Limit price"}
                </span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-brand-slate-500">Fees</span>
                <span class="font-mono text-brand-accent">
                  {isHyperliquidExecution() ? "Hyperliquid tier" : "0% / 0%"}
                </span>
              </div>
            </div>
          </Show>
        </div>

        {/* Portfolio Section */}
        <div class="ticket-account mt-auto border-t border-brand-border px-4 py-4 space-y-4">
          <Show when={!isHyperliquidExecution() && canAdminDeposit()}>
            <div class="flex gap-3">
              <button
                class={`flex-1 rounded-md py-2.5 text-sm font-semibold transition-colors ${depositButtonClass()}`}
                onClick={handleDepositClick}
                disabled={depositButtonDisabled()}
              >
                Add paper funds
              </button>
            </div>
          </Show>

          <Show
            when={
              isHyperliquidExecution() &&
              hyperliquidAccountMode() === "portfolioMargin"
            }
            fallback={
              <div class="space-y-2 border-t border-brand-border/70 pt-3">
                <div class="text-sm text-brand-slate-500">Account Overview</div>
                <div class="flex justify-between gap-4 text-sm">
                  <span class="text-brand-slate-500">
                    {isHyperliquidExecution() ? "Available USDC" : "Balance"}
                  </span>
                  <span class="font-mono text-slate-100">
                    {formatUsd(
                      isHyperliquidExecution()
                        ? getAvailableBalance("USDC")
                        : collateralPool(),
                    )}
                  </span>
                </div>
                <div class="flex justify-between gap-4 text-sm">
                  <span class="text-brand-slate-500">Unrealized PNL</span>
                  <span
                    class={`font-mono ${
                      unrealizedPnl() >= 0
                        ? "text-brand-green-400"
                        : "text-brand-red-400"
                    }`}
                  >
                    {formatSignedUsd(unrealizedPnl())}
                  </span>
                </div>
                <div class="flex justify-between gap-4 text-sm">
                  <span class="text-brand-slate-500">Cross margin ratio</span>
                  <span class="font-mono text-brand-accent">
                    {`${crossMarginRatio().toFixed(2)}%`}
                  </span>
                </div>
              </div>
            }
          >
            <div class="space-y-3">
              <div class="text-sm font-semibold text-slate-100">
                Portfolio Margin Summary
              </div>
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="text-brand-slate-400 underline decoration-dashed underline-offset-4">
                  Portfolio Margin Ratio
                </span>
                <span class="flex items-center gap-2 font-mono text-brand-accent">
                  <PortfolioMarginGauge
                    ratio={livePortfolioSummary()?.marginRatio}
                  />
                  {formatOptionalPercent(livePortfolioSummary()?.marginRatio)}
                </span>
              </div>
              <div class="flex justify-between gap-3 text-sm">
                <span class="text-brand-slate-400">Portfolio Value</span>
                <span class="font-mono text-slate-100">
                  {formatOptionalUsd(livePortfolioSummary()?.portfolioValue)}
                </span>
              </div>
              <div class="flex justify-between gap-3 text-sm">
                <span class="text-brand-slate-400">Unrealized PNL</span>
                <span
                  class={`font-mono ${
                    livePortfolioSummary() === undefined
                      ? "text-brand-slate-500"
                      : livePortfolioSummary()!.unrealizedPnl >= 0
                        ? "text-brand-green-400"
                        : "text-brand-red-400"
                  }`}
                >
                  {livePortfolioSummary() === undefined
                    ? "--"
                    : formatSignedUsd(livePortfolioSummary()!.unrealizedPnl)}
                </span>
              </div>
              <div class="flex justify-between gap-3 text-sm">
                <span class="text-brand-slate-400 underline decoration-dashed underline-offset-4">
                  Borrow Cap Used
                </span>
                <span class="font-mono text-slate-100">
                  {formatOptionalPercent(livePortfolioSummary()?.borrowCapUsed)}
                </span>
              </div>
              <div class="flex justify-between gap-3 text-sm">
                <span class="text-brand-slate-400 underline decoration-dashed underline-offset-4">
                  Perps Maintenance Margin
                </span>
                <span class="font-mono text-slate-100">
                  {formatOptionalUsd(
                    livePortfolioSummary()?.perpsMaintenanceMargin,
                  )}
                </span>
              </div>
              <div class="flex justify-between gap-3 text-sm">
                <span class="text-brand-slate-400 underline decoration-dashed underline-offset-4">
                  Portfolio Account Leverage
                </span>
                <span class="font-mono text-slate-100">
                  {livePortfolioSummary()?.accountLeverage === undefined
                    ? "--"
                    : `${livePortfolioSummary()!.accountLeverage!.toFixed(2)}x`}
                </span>
              </div>
            </div>
          </Show>
        </div>
      </div>
      <div class="ticket-submit">
        <button
          class={`w-full rounded-md py-3 text-sm font-semibold transition-colors ${
            (!isAuthenticated() && !isHyperliquidExecution()) ||
            (canSubmitOrder() && !isSubmitting())
              ? "bg-brand-accent text-brand-screen hover:brightness-105"
              : "bg-brand-border text-brand-slate-500 cursor-not-allowed"
          }`}
          onClick={() =>
            !isAuthenticated() && !isHyperliquidExecution()
              ? openConnect()
              : submitOrder()
          }
          disabled={
            (isAuthenticated() || isHyperliquidExecution()) &&
            (!canSubmitOrder() || isSubmitting())
          }
        >
          {!isAuthenticated() && !isHyperliquidExecution()
            ? "Connect to trade"
            : isSubmitting()
              ? "Placing..."
              : !isHyperliquidExecution() &&
                  isSpot() &&
                  insufficientSpotBalance()
                ? isLong()
                  ? "Not enough USDC"
                  : "Not enough balance"
                : !isHyperliquidExecution() && insufficientMargin()
                  ? "Not enough margin"
                  : "Place Order"}
        </button>
      </div>

      <AdminDepositModal
        open={adminDepositOpen()}
        onClose={() => setAdminDepositOpen(false)}
      />
    </div>
  );
};

export default OrderForm;
