import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineData,
} from "lightweight-charts";
import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  Time,
  createChart,
} from "lightweight-charts";
import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createLatestAnimationFrameBatcher } from "../lib/animationFrameBatcher";
import { resolutionToMs, type Candle } from "../lib/candles";
import {
  fetchHyperliquidCandles,
  resolveHyperliquidMarketCoin,
  toHyperliquidInterval,
  type HyperliquidMarketType,
} from "../lib/hyperliquid";
import {
  hyperliquidDataNetwork,
  hyperliquidWsUrl,
} from "../lib/hyperliquidNetwork";
import {
  getCachedCandles,
  updateCachedCandles,
  updateLastCandle,
} from "../stores/chartCache";
import { getPositionForSymbol } from "../stores/clob";
import {
  MARKETS,
  currentMarketType,
  currentSymbol,
  dataProvider,
  getWatchlistCoreSymbol,
  isTickerWatchlisted,
  selectMarket,
  showChartGrid,
  showChartVolume,
  tickerWatchlistSymbols,
  type DataProvider,
} from "../stores/market";

const RESOLUTIONS = ["1", "5", "15", "60", "240", "1D", "1W"] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const DEFAULT_RESOLUTION: Resolution = "5";
const RESOLUTION_STORAGE_KEY = "trade-xyz-chart-resolution";
const MA_STORAGE_KEY = "trade-xyz-chart-ma";
const CHART_GRID_COLOR = "rgba(38, 42, 47, 0.6)";

const RESOLUTION_LABELS: Record<Resolution, string> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "60": "1H",
  "240": "4H",
  "1D": "1D",
  "1W": "1W",
};

const isResolution = (value: string): value is Resolution =>
  RESOLUTIONS.includes(value as Resolution);

const loadResolution = (): Resolution => {
  try {
    const stored = localStorage.getItem(RESOLUTION_STORAGE_KEY);
    if (stored && isResolution(stored)) {
      return stored;
    }
  } catch (error) {
    // Ignore storage errors
  }
  return DEFAULT_RESOLUTION;
};

const MA_PERIODS = [20, 50, 200] as const;
type MaPeriod = (typeof MA_PERIODS)[number];

const DEFAULT_MA_ENABLED: Record<MaPeriod, boolean> = {
  20: false,
  50: false,
  200: true,
};

const MA_COLORS: Record<MaPeriod, string> = {
  20: "#f59e0b",
  50: "#38bdf8",
  200: "#b0a079",
};

const TICKER_ORDER_TYPES = new Set(["perps", "spot", "equities"]);

const normalizeTickerOrderSymbol = (entry: string): string => {
  const parts = entry.split(":");
  const last = parts[parts.length - 1];
  const raw = TICKER_ORDER_TYPES.has(last)
    ? parts.slice(0, -1).join(":")
    : entry;
  return getWatchlistCoreSymbol(raw);
};

const MAX_LOCAL_CANDLES = 1000;
const CANDLE_LOAD_DEBOUNCE_MS = 400;

const formatExposure = (size: number) => {
  if (!Number.isFinite(size) || size === 0) return "";
  const abs = Math.abs(size);
  let formatted = abs.toFixed(4);
  if (abs >= 100) {
    formatted = abs.toFixed(2);
  } else if (abs >= 1) {
    formatted = abs.toFixed(3);
  }
  return `${size > 0 ? "+" : "-"}${formatted}`;
};

const loadMaSettings = (): Record<MaPeriod, boolean> => {
  try {
    const stored = localStorage.getItem(MA_STORAGE_KEY);
    if (!stored) return DEFAULT_MA_ENABLED;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const next: Record<MaPeriod, boolean> = { ...DEFAULT_MA_ENABLED };
    MA_PERIODS.forEach((period) => {
      const value = parsed?.[String(period)];
      if (typeof value === "boolean") {
        next[period] = value;
      }
    });
    return next;
  } catch (error) {
    // Ignore storage errors
  }
  return DEFAULT_MA_ENABLED;
};

const TradingViewChart: Component = () => {
  let containerRef: HTMLDivElement | undefined;
  let chart: IChartApi | undefined;
  let candleSeries: ISeriesApi<"Candlestick"> | undefined;
  let volumeSeries: ISeriesApi<"Histogram"> | undefined;
  let streamSocket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let streamTimer: number | undefined;
  let streamGeneration = 0;
  let loadController: AbortController | undefined;
  let loadTimer: number | undefined;
  let loadGeneration = 0;
  let lastLoadedKey: string | undefined;
  const maSeries = new Map<MaPeriod, ISeriesApi<"Line">>();
  let localCandles: Candle[] = [];
  let entryPriceLine: IPriceLine | undefined;
  let takeProfitLine: IPriceLine | undefined;
  let stopLossLine: IPriceLine | undefined;

  const [resolution, setResolution] =
    createSignal<Resolution>(loadResolution());
  const [isLoading, setIsLoading] = createSignal(true);
  const [chartReady, setChartReady] = createSignal(false);
  const [maMenuOpen, setMaMenuOpen] = createSignal(false);
  const [isTabVisible, setIsTabVisible] = createSignal(!document.hidden);
  const [maEnabled, setMaEnabled] =
    createSignal<Record<MaPeriod, boolean>>(loadMaSettings());
  const [contextMenu, setContextMenu] = createSignal<{
    x: number;
    y: number;
  } | null>(null);

  const watchlistMarkets = createMemo(() => {
    const list = MARKETS();
    if (list.length === 0) return [];
    const order = tickerWatchlistSymbols();
    const orderIndex = new Map<string, number>();
    order.forEach((entry, index) => {
      const key = normalizeTickerOrderSymbol(entry);
      if (!orderIndex.has(key)) {
        orderIndex.set(key, index);
      }
    });
    const deduped = new Map<string, (typeof list)[number]>();

    for (const market of list) {
      if (!isTickerWatchlisted(market.symbol, market.type)) continue;
      const existing = deduped.get(market.symbol);
      if (!existing || (existing.type !== "perps" && market.type === "perps")) {
        deduped.set(market.symbol, market);
      }
    }

    const result = [...deduped.values()];
    result.sort((a, b) => {
      const aKey = getWatchlistCoreSymbol(a.symbol);
      const bKey = getWatchlistCoreSymbol(b.symbol);
      const aIndex = orderIndex.get(aKey);
      const bIndex = orderIndex.get(bKey);
      if (aIndex != null && bIndex != null) return aIndex - bIndex;
      if (aIndex != null) return -1;
      if (bIndex != null) return 1;
      return a.symbol.localeCompare(b.symbol);
    });
    return result;
  });

  const inactiveResolutions = createMemo(() =>
    RESOLUTIONS.filter((res) => res !== resolution()),
  );

  const handleVisibilityChange = () => {
    setIsTabVisible(!document.hidden);
  };

  onMount(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  onCleanup(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  const toggleMa = (period: MaPeriod) => {
    setMaEnabled((prev) => ({ ...prev, [period]: !prev[period] }));
  };

  const hasMa = () => MA_PERIODS.some((period) => maEnabled()[period]);

  const formatWatchlistChange = (value: number) => {
    if (!Number.isFinite(value)) return "--";
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const watchlistChangeColor = (value: number) => {
    if (!Number.isFinite(value)) return "text-brand-slate-500";
    return value >= 0 ? "text-brand-green-400" : "text-brand-red-400";
  };

  // Convert candle data to lightweight-charts format
  const formatCandleData = (candles: Candle[]): CandlestickData<Time>[] => {
    return candles.map((c) => ({
      time: (c.time / 1000) as Time, // Convert ms to seconds
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  };

  const formatVolumeData = (candles: Candle[]) => {
    return candles.map((c) => ({
      time: (c.time / 1000) as Time,
      value: c.volume,
      color:
        c.close >= c.open
          ? "rgba(80, 227, 171, 0.5)"
          : "rgba(255, 85, 114, 0.5)",
    }));
  };

  const calculateSma = (
    candles: Candle[],
    period: MaPeriod,
  ): LineData<Time>[] => {
    if (candles.length < period) return [];
    const data: LineData<Time>[] = [];
    let sum = 0;

    for (let i = 0; i < candles.length; i += 1) {
      sum += candles[i].close;
      if (i >= period) {
        sum -= candles[i - period].close;
      }
      if (i >= period - 1) {
        data.push({
          time: (candles[i].time / 1000) as Time,
          value: sum / period,
        });
      }
    }

    return data;
  };

  const refreshMovingAveragesFull = (candles: Candle[]) => {
    if (!chartReady()) return;
    const enabled = maEnabled();

    MA_PERIODS.forEach((period) => {
      const series = maSeries.get(period);
      if (!series || !enabled[period]) return;
      series.setData(calculateSma(candles, period));
    });
  };

  const refreshMovingAveragesIncremental = () => {
    if (!chartReady()) return;
    const enabled = maEnabled();
    const candles = localCandles;

    MA_PERIODS.forEach((period) => {
      const series = maSeries.get(period);
      if (!series || !enabled[period]) return;
      if (candles.length < period) {
        series.setData([]);
        return;
      }

      let sum = 0;
      for (let i = candles.length - period; i < candles.length; i += 1) {
        sum += candles[i].close;
      }

      const last = candles[candles.length - 1];
      series.update({
        time: (last.time / 1000) as Time,
        value: sum / period,
      });
    });
  };

  type CandleUpdateMode = "appended" | "updated" | "outOfOrder";

  const upsertLocalCandle = (candle: Candle): CandleUpdateMode => {
    if (localCandles.length === 0) {
      localCandles = [candle];
      return "appended";
    }

    const lastIndex = localCandles.length - 1;
    const last = localCandles[lastIndex];

    if (candle.time === last.time) {
      localCandles[lastIndex] = candle;
      return "updated";
    }

    if (candle.time > last.time) {
      localCandles = [...localCandles, candle].slice(-MAX_LOCAL_CANDLES);
      return "appended";
    }

    const matchIndex = localCandles.findIndex(
      (existing) => existing.time === candle.time,
    );
    if (matchIndex >= 0) {
      localCandles[matchIndex] = candle;
      return "outOfOrder";
    }

    return "outOfOrder";
  };

  const streamCandleBatcher = createLatestAnimationFrameBatcher(
    ({
      candle,
      marketType,
      provider,
      res,
      symbol,
    }: {
      candle: Candle;
      marketType: HyperliquidMarketType;
      provider: DataProvider;
      res: Resolution;
      symbol: string;
    }) => {
      updateLastCandle(provider, `${symbol}-${marketType}`, res, candle);
      const updateMode = upsertLocalCandle(candle);
      if (updateMode === "outOfOrder") {
        refreshMovingAveragesFull(localCandles);
      } else {
        refreshMovingAveragesIncremental();
      }

      candleSeries?.update({
        time: (candle.time / 1000) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      volumeSeries?.update({
        time: (candle.time / 1000) as Time,
        value: candle.volume,
        color:
          candle.close >= candle.open
            ? "rgba(80, 227, 171, 0.5)"
            : "rgba(255, 85, 114, 0.5)",
      });
    },
  );

  const fetchCandlesForProvider = async (
    resolvedCoin: string,
    res: Resolution,
    fromMs: number,
    toMs: number,
    priority?: "high" | "low",
    signal?: AbortSignal,
  ) => {
    return fetchHyperliquidCandles({
      coin: resolvedCoin,
      resolution: res,
      fromMs,
      toMs,
      signal,
      priority,
    });
  };

  // Load candle data with caching
  const loadCandles = async (
    symbol: string,
    resolvedCoin: string,
    marketType: HyperliquidMarketType,
    res: Resolution,
    provider: DataProvider,
    signal?: AbortSignal,
    requestId?: number,
  ) => {
    // Don't load if chart isn't ready
    if (!chartReady() || !candleSeries || requestId !== loadGeneration) {
      return;
    }

    const cacheSymbol = `${symbol}-${marketType}`;
    const cacheKey = `${provider}:${cacheSymbol}:${res}`;
    const cached = getCachedCandles(provider, cacheSymbol, res);
    const now = Date.now();
    const periodMs = resolutionToMs(res);
    const barsCount = 500;

    // If we have cached data, show it immediately (instant render)
    if (cached && cached.candles.length > 0) {
      // Only set loading if this is a different symbol/resolution
      if (lastLoadedKey !== cacheKey) {
        if (requestId !== loadGeneration) return;
        candleSeries.setData(formatCandleData(cached.candles));
        if (volumeSeries) {
          volumeSeries.setData(formatVolumeData(cached.candles));
        }
        lastLoadedKey = cacheKey;
      }
      localCandles = cached.candles;
      refreshMovingAveragesFull(localCandles);
      if (!signal?.aborted && requestId === loadGeneration) {
        setIsLoading(false);
      }

      // Fetch only new candles since last cached timestamp
      // Add a small overlap to ensure we don't miss any candles
      const fromMs = cached.lastTimestamp - periodMs * 2;

      try {
        const newCandles = await fetchCandlesForProvider(
          resolvedCoin,
          res,
          fromMs,
          now,
          "high",
          signal,
        );

        if (signal?.aborted || requestId !== loadGeneration) return;
        if (newCandles.length > 0) {
          // Merge with cache and update chart
          const mergedCandles = updateCachedCandles(
            provider,
            cacheSymbol,
            res,
            newCandles,
            false,
          );
          candleSeries.setData(formatCandleData(mergedCandles));
          if (volumeSeries) {
            volumeSeries.setData(formatVolumeData(mergedCandles));
          }
          localCandles = mergedCandles;
          refreshMovingAveragesFull(localCandles);
        }
      } catch (error) {
        console.error("Failed to fetch new candles:", error);
        // Still showing cached data, so no need to show error state
      }

      return;
    }

    // No cache - do a full load
    if (lastLoadedKey !== cacheKey) {
      if (requestId !== loadGeneration) return;
      candleSeries.setData([]);
      if (volumeSeries) {
        volumeSeries.setData([]);
      }
      localCandles = [];
      refreshMovingAveragesFull(localCandles);
    }

    setIsLoading(true);
    lastLoadedKey = cacheKey;

    try {
      const fromMs = now - periodMs * barsCount;

      const candles = await fetchCandlesForProvider(
        resolvedCoin,
        res,
        fromMs,
        now,
        "high",
        signal,
      );

      if (signal?.aborted || requestId !== loadGeneration) return;
      if (candles.length > 0) {
        // Cache the full data set
        updateCachedCandles(provider, cacheSymbol, res, candles, true);

        candleSeries.setData(formatCandleData(candles));
        if (volumeSeries) {
          volumeSeries.setData(formatVolumeData(candles));
        }
        localCandles = candles;
        refreshMovingAveragesFull(localCandles);
      } else {
        localCandles = [];
        refreshMovingAveragesFull(localCandles);
      }

      // Fit content after initial load
      if (chart) {
        chart.timeScale().fitContent();
      }
    } catch (error) {
      console.error("Failed to load candles:", error);
    } finally {
      if (!signal?.aborted && requestId === loadGeneration) {
        setIsLoading(false);
      }
    }
  };

  const stopStreaming = () => {
    streamGeneration += 1;
    streamCandleBatcher.cancel();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (streamTimer) {
      clearInterval(streamTimer);
      streamTimer = undefined;
    }
    if (streamSocket) {
      const socket = streamSocket;
      streamSocket = undefined;
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close(), { once: true });
      } else {
        socket.close();
      }
    }
  };

  // Stream updates with cache integration
  const startStreaming = (
    symbol: string,
    resolvedCoin: string,
    marketType: HyperliquidMarketType,
    res: Resolution,
    provider: DataProvider,
  ) => {
    stopStreaming();

    // Don't start streaming if chart isn't ready
    if (!chartReady() || !candleSeries) {
      return;
    }

    const generation = streamGeneration;
    const interval = toHyperliquidInterval(res);
    const streamUrl = hyperliquidWsUrl();
    let reconnectAttempt = 0;

    const scheduleReconnect = () => {
      if (generation !== streamGeneration) return;
      const base = Math.min(30000, 1500 * 2 ** reconnectAttempt);
      const delay = base / 2 + Math.random() * (base / 2);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay) as unknown as number;
    };

    const connect = () => {
      if (generation !== streamGeneration) return;

      const socket = new WebSocket(streamUrl);
      streamSocket = socket;

      socket.onopen = () => {
        if (generation !== streamGeneration) {
          socket.close();
          return;
        }
        reconnectAttempt = 0;
        if (provider === "hyperliquid") {
          socket.send(
            JSON.stringify({
              method: "subscribe",
              subscription: {
                type: "candle",
                coin: resolvedCoin,
                interval,
              },
            }),
          );
        }
      };

      socket.onmessage = (event) => {
        if (generation !== streamGeneration) return;

        try {
          const payload = JSON.parse(event.data);
          let candle: Candle | null = null;
          if (payload?.channel === "error") {
            socket.close();
            return;
          }
          if (payload?.channel !== "candle") return;
          const data = payload?.data;
          if (!data) return;
          candle = {
            time: Number(data.t),
            open: Number(data.o),
            high: Number(data.h),
            low: Number(data.l),
            close: Number(data.c),
            volume: Number(data.v),
          };
          if (!candle || !Number.isFinite(candle.time)) return;

          streamCandleBatcher.push({
            candle,
            marketType,
            provider,
            res,
            symbol,
          });
        } catch (error) {
          // Ignore malformed updates
        }
      };

      socket.onerror = () => {
        if (generation !== streamGeneration) return;
        if (socket.readyState === WebSocket.CONNECTING) return;
        socket.close();
      };

      socket.onclose = () => {
        if (generation !== streamGeneration) return;
        scheduleReconnect();
      };
    };

    connect();
  };

  // Reset chart view
  const resetChart = () => {
    if (chart) {
      chart.timeScale().fitContent();
    }
    setContextMenu(null);
  };

  // Handle right-click context menu
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Close context menu when clicking elsewhere
  const handleClick = () => {
    setContextMenu(null);
  };

  // Initialize chart
  onMount(() => {
    if (!containerRef) return;

    const chartInstance = createChart(containerRef, {
      layout: {
        background: { type: ColorType.Solid, color: "#101317" },
        textColor: "#6b7280",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: {
          color: showChartGrid() ? CHART_GRID_COLOR : "transparent",
        },
        horzLines: {
          color: showChartGrid() ? CHART_GRID_COLOR : "transparent",
        },
      },
      crosshair: {
        mode: 0, // Normal mode - follows cursor freely
        vertLine: {
          color: "#6b7280",
          width: 1,
          style: 2,
          labelBackgroundColor: "#262a2f",
        },
        horzLine: {
          color: "#6b7280",
          width: 1,
          style: 2,
          labelBackgroundColor: "#262a2f",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(38, 42, 47, 0.8)",
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: "rgba(38, 42, 47, 0.8)",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12,
        minBarSpacing: 6,
        rightOffset: 12,
        tickMarkFormatter: (time: number) => {
          const date = new Date(time * 1000);
          const hours = date.getHours().toString().padStart(2, "0");
          const minutes = date.getMinutes().toString().padStart(2, "0");
          return `${hours}:${minutes}`;
        },
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    chart = chartInstance;

    // Add candlestick series
    candleSeries = chartInstance.addSeries(CandlestickSeries, {
      upColor: "#43c6a1",
      downColor: "#e87887",
      borderUpColor: "#43c6a1",
      borderDownColor: "#e87887",
      wickUpColor: "#43c6a1",
      wickDownColor: "#e87887",
    });

    // Add volume series
    volumeSeries = chartInstance.addSeries(HistogramSeries, {
      visible: showChartVolume(),
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "",
    });

    MA_PERIODS.forEach((period) => {
      const series = chartInstance.addSeries(LineSeries, {
        color: MA_COLORS[period],
        lineWidth: period === 200 ? 2 : 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.applyOptions({ visible: maEnabled()[period] });
      maSeries.set(period, series);
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    });

    // Handle resize
    const handleResize = () => {
      if (chart && containerRef) {
        chart.applyOptions({
          width: containerRef.clientWidth,
          height: containerRef.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef);

    // Close context menu on click anywhere
    const closeContextMenu = () => setContextMenu(null);
    document.addEventListener("click", closeContextMenu);

    // Mark chart as ready - this will trigger the effect to load data
    setChartReady(true);

    onCleanup(() => {
      stopStreaming();
      if (loadTimer) clearTimeout(loadTimer);
      loadController?.abort();
      resizeObserver.disconnect();
      document.removeEventListener("click", closeContextMenu);
      chart?.remove();
    });
  });

  // React to symbol/resolution changes (and initial chart ready)
  createEffect(() => {
    const symbol = currentSymbol();
    const res = resolution();
    const ready = chartReady();
    const visible = isTabVisible();
    const provider = dataProvider();
    hyperliquidDataNetwork();
    // Track marketType so the stream restarts on perp/spot switch and candles
    // are not cached under the wrong key.
    const marketType = currentMarketType();

    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = undefined;
    }
    loadController?.abort();
    loadController = undefined;

    if (!ready) return;
    if (!visible) {
      stopStreaming();
      return;
    }

    stopStreaming();
    const requestId = (loadGeneration += 1);
    const controller = new AbortController();
    loadController = controller;

    loadTimer = setTimeout(() => {
      loadTimer = undefined;
      if (requestId !== loadGeneration) return;
      void (async () => {
        const resolvedCoin = await resolveHyperliquidMarketCoin({
          symbol,
          marketType,
          signal: controller.signal,
        });
        if (
          !resolvedCoin ||
          controller.signal.aborted ||
          requestId !== loadGeneration
        ) {
          if (!controller.signal.aborted && requestId === loadGeneration) {
            setIsLoading(false);
          }
          return;
        }
        void loadCandles(
          symbol,
          resolvedCoin,
          marketType,
          res,
          provider,
          controller.signal,
          requestId,
        );
        startStreaming(symbol, resolvedCoin, marketType, res, provider);
      })();
    }, CANDLE_LOAD_DEBOUNCE_MS) as unknown as number;
  });

  createEffect(() => {
    if (!chartReady()) return;
    const enabled = maEnabled();

    MA_PERIODS.forEach((period) => {
      const series = maSeries.get(period);
      if (!series) return;
      series.applyOptions({ visible: enabled[period] });
    });

    refreshMovingAveragesFull(localCandles);
  });

  createEffect(() => {
    if (!chartReady() || !chart) return;
    const gridColor = showChartGrid() ? CHART_GRID_COLOR : "transparent";
    chart.applyOptions({
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
    });
  });

  createEffect(() => {
    if (!chartReady() || !volumeSeries) return;
    volumeSeries.applyOptions({ visible: showChartVolume() });
  });

  createEffect(() => {
    const value = resolution();
    try {
      localStorage.setItem(RESOLUTION_STORAGE_KEY, value);
    } catch (error) {
      // Ignore storage errors
    }
  });

  createEffect(() => {
    const value = maEnabled();
    try {
      localStorage.setItem(MA_STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      // Ignore storage errors
    }
  });

  // Position entry + TP/SL lines
  createEffect(() => {
    if (!chartReady() || !candleSeries) return;

    const symbol = currentSymbol();
    const position = getPositionForSymbol(symbol);

    // Remove existing lines if any
    if (entryPriceLine) {
      candleSeries.removePriceLine(entryPriceLine);
      entryPriceLine = undefined;
    }
    if (takeProfitLine) {
      candleSeries.removePriceLine(takeProfitLine);
      takeProfitLine = undefined;
    }
    if (stopLossLine) {
      candleSeries.removePriceLine(stopLossLine);
      stopLossLine = undefined;
    }

    // Add lines if there's a position
    if (!position || position.size === 0) return;

    const isLong = position.size > 0;
    entryPriceLine = candleSeries.createPriceLine({
      price: position.entryPrice,
      color: isLong ? "#43c6a1" : "#e87887",
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: formatExposure(position.size),
    });

    const takeProfit = position.takeProfit ?? null;
    if (Number.isFinite(takeProfit ?? NaN) && (takeProfit as number) > 0) {
      takeProfitLine = candleSeries.createPriceLine({
        price: takeProfit as number,
        color: "#43c6a1",
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "TP",
      });
    }

    const stopLoss = position.stopLoss ?? null;
    if (Number.isFinite(stopLoss ?? NaN) && (stopLoss as number) > 0) {
      stopLossLine = candleSeries.createPriceLine({
        price: stopLoss as number,
        color: "#e87887",
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "SL",
      });
    }
  });

  return (
    <div class="chart-container trade-chart bg-brand-screen relative flex flex-col flex-1 min-h-0">
      {/* Watchlist toolbar */}
      <div class="market-ticker flex items-center border-b border-brand-border">
        <div class="flex-1 overflow-x-auto">
          <div class="flex items-center whitespace-nowrap divide-x divide-brand-border/70">
            <Show
              when={watchlistMarkets().length > 0}
              fallback={
                <span class="px-3 py-2 text-xs text-brand-slate-500">
                  Add symbols to your watchlist to show them here.
                </span>
              }
            >
              <For each={watchlistMarkets()}>
                {(market) => (
                  <button
                    class="ticker-item flex items-center gap-2 px-4 py-2 text-xs text-slate-200 hover:bg-brand-border/40"
                    aria-pressed={currentSymbol() === market.symbol}
                    onClick={() => selectMarket(market)}
                  >
                    <span>{market.name}</span>
                    <span class={watchlistChangeColor(market.change24h)}>
                      {formatWatchlistChange(market.change24h)}
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>

      {/* Chart container */}
      <div
        ref={containerRef}
        class="flex-1 relative"
        onContextMenu={handleContextMenu}
        onClick={handleClick}
      >
        <div class="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-full border border-brand-border/70 bg-brand-surface/80 px-2 py-1.5 shadow-sm backdrop-blur">
          <div class="group flex items-center gap-1">
            <button
              class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors bg-brand-border text-slate-100"
              onClick={() => setResolution(resolution())}
            >
              {RESOLUTION_LABELS[resolution()]}
            </button>
            <div class="flex items-center gap-1 overflow-hidden max-w-0 opacity-0 scale-95 pointer-events-none transition-all duration-200 group-hover:max-w-65 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto">
              <For each={inactiveResolutions()}>
                {(res) => (
                  <button
                    class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors text-brand-slate-400 hover:text-slate-200 hover:bg-brand-border/50"
                    onClick={() => setResolution(res)}
                  >
                    {RESOLUTION_LABELS[res]}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="mx-1 h-4 w-px bg-brand-border/70" />
          <div class="relative">
            <button
              class={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                hasMa()
                  ? "bg-brand-border text-slate-200"
                  : "text-brand-slate-400 hover:text-slate-200 hover:bg-brand-border/50"
              }`}
              onClick={() => setMaMenuOpen(!maMenuOpen())}
            >
              MA
            </button>
            {maMenuOpen() && (
              <>
                <div
                  class="fixed inset-0 z-40"
                  onClick={() => setMaMenuOpen(false)}
                />
                <div class="absolute left-0 top-full mt-2 w-44 bg-brand-surface border border-brand-border rounded-lg shadow-xl z-50 py-2">
                  <div class="px-3 py-2 border-b border-brand-border">
                    <span class="text-[11px] font-medium text-brand-slate-400 uppercase tracking-wider">
                      Moving Averages
                    </span>
                  </div>
                  {MA_PERIODS.map((period) => (
                    <label class="flex items-center justify-between px-3 py-2 text-sm text-slate-200 hover:bg-brand-border/30 cursor-pointer">
                      <span class="flex items-center gap-2">
                        <span
                          class="w-2.5 h-2.5 rounded-full"
                          style={{ "background-color": MA_COLORS[period] }}
                        />
                        {period} MA
                      </span>
                      <input
                        type="checkbox"
                        checked={maEnabled()[period]}
                        onChange={() => toggleMa(period)}
                        class="w-4 h-4 rounded border-brand-border bg-brand-screen"
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu() && (
        <div
          class="fixed z-50 bg-brand-surface border border-brand-border rounded-lg shadow-lg py-1 min-w-35"
          style={{
            left: `${contextMenu()!.x}px`,
            top: `${contextMenu()!.y}px`,
          }}
        >
          <button
            class="w-full px-3 py-1.5 text-left text-sm text-brand-slate-300 hover:bg-brand-border/50 transition-colors flex items-center gap-2"
            onClick={resetChart}
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Reset Chart
          </button>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading() && (
        <div class="absolute inset-0 flex items-center justify-center bg-brand-screen/80 z-10">
          <div class="flex items-center gap-2 text-brand-slate-400">
            <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
                fill="none"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span class="sr-only">Loading chart</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradingViewChart;
