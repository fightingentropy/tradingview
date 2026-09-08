import {
  Component,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CandlestickData,
  CrosshairMode,
  Time,
  ColorType,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { resolutionToMs, type Candle } from "../lib/candles";
import {
  fetchHyperliquidCandles,
  resolveHyperliquidMarketCoin,
  toHyperliquidInterval,
  type HyperliquidMarketType,
} from "../lib/hyperliquid";
import {
  getCachedCandles,
  updateCachedCandles,
  updateLastCandle,
} from "../stores/chartCache";
import {
  currentMarketType,
  dataProvider,
  showChartGrid,
  showChartVolume,
  type DataProvider,
} from "../stores/market";
import {
  hyperliquidDataNetwork,
  hyperliquidWsUrl,
} from "../lib/hyperliquidNetwork";
import { createLatestAnimationFrameBatcher } from "../lib/animationFrameBatcher";

interface SymbolChartProps {
  symbol: string;
  resolution: string;
}

const MAX_LOCAL_CANDLES = 1000;
const CANDLE_LOAD_DEBOUNCE_MS = 400;
const CHART_GRID_COLOR = "rgba(38, 42, 47, 0.6)";

const SymbolChart: Component<SymbolChartProps> = (props) => {
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
  let localCandles: Candle[] = [];

  const [isLoading, setIsLoading] = createSignal(true);
  const [chartReady, setChartReady] = createSignal(false);
  const [isTabVisible, setIsTabVisible] = createSignal(!document.hidden);
  const [contextMenu, setContextMenu] = createSignal<{
    x: number;
    y: number;
  } | null>(null);

  const handleVisibilityChange = () => {
    setIsTabVisible(!document.hidden);
  };

  onMount(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  onCleanup(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  const formatCandleData = (candles: Candle[]): CandlestickData<Time>[] => {
    return candles.map((c) => ({
      time: (c.time / 1000) as Time,
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
      resolution,
      symbol,
    }: {
      candle: Candle;
      marketType: HyperliquidMarketType;
      provider: DataProvider;
      resolution: string;
      symbol: string;
    }) => {
      updateLastCandle(
        provider,
        `${symbol}-${marketType}`,
        resolution,
        candle,
      );
      upsertLocalCandle(candle);
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
    resolution: string,
    fromMs: number,
    toMs: number,
    priority?: "high" | "low",
    signal?: AbortSignal,
  ) => {
    return fetchHyperliquidCandles({
      coin: resolvedCoin,
      resolution,
      fromMs,
      toMs,
      signal,
      priority,
    });
  };

  const loadCandles = async (
    symbol: string,
    resolvedCoin: string,
    marketType: HyperliquidMarketType,
    resolution: string,
    provider: DataProvider,
    signal?: AbortSignal,
    requestId?: number,
  ) => {
    if (!chartReady() || !candleSeries || requestId !== loadGeneration) return;

    const cacheSymbol = `${symbol}-${marketType}`;
    const cacheKey = `${provider}:${cacheSymbol}:${resolution}`;
    const cached = getCachedCandles(provider, cacheSymbol, resolution);
    const now = Date.now();
    const periodMs = resolutionToMs(resolution);
    const barsCount = 400;

    if (cached && cached.candles.length > 0) {
      if (lastLoadedKey !== cacheKey) {
        if (requestId !== loadGeneration) return;
        candleSeries.setData(formatCandleData(cached.candles));
        volumeSeries?.setData(formatVolumeData(cached.candles));
        lastLoadedKey = cacheKey;
      }
      localCandles = cached.candles;
      if (!signal?.aborted && requestId === loadGeneration) {
        setIsLoading(false);
      }

      const fromMs = cached.lastTimestamp - periodMs * 2;

      try {
        const newCandles = await fetchCandlesForProvider(
          resolvedCoin,
          resolution,
          fromMs,
          now,
          "high",
          signal,
        );

        if (signal?.aborted || requestId !== loadGeneration) return;
        if (newCandles.length > 0) {
          const mergedCandles = updateCachedCandles(
            provider,
            cacheSymbol,
            resolution,
            newCandles,
            false,
          );
          candleSeries.setData(formatCandleData(mergedCandles));
          volumeSeries?.setData(formatVolumeData(mergedCandles));
          localCandles = mergedCandles;
        }
      } catch (error) {
        console.error("Failed to fetch new candles:", error);
      }

      return;
    }

    if (lastLoadedKey !== cacheKey) {
      if (requestId !== loadGeneration) return;
      candleSeries.setData([]);
      volumeSeries?.setData([]);
      localCandles = [];
    }

    setIsLoading(true);
    lastLoadedKey = cacheKey;

    try {
      const fromMs = now - periodMs * barsCount;

      const candles = await fetchCandlesForProvider(
        resolvedCoin,
        resolution,
        fromMs,
        now,
        "high",
        signal,
      );

      if (signal?.aborted || requestId !== loadGeneration) return;
      if (candles.length > 0) {
        updateCachedCandles(provider, cacheSymbol, resolution, candles, true);
        candleSeries.setData(formatCandleData(candles));
        volumeSeries?.setData(formatVolumeData(candles));
        localCandles = candles;
      } else {
        localCandles = [];
      }

      chart?.timeScale().fitContent();
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

  const startStreaming = (
    symbol: string,
    resolvedCoin: string,
    marketType: HyperliquidMarketType,
    resolution: string,
    provider: DataProvider,
  ) => {
    stopStreaming();

    if (!chartReady() || !candleSeries) return;

    const generation = streamGeneration;
    const interval = toHyperliquidInterval(resolution);
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
            resolution,
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

  onMount(() => {
    if (!containerRef) return;

    chart = createChart(containerRef, {
      layout: {
        background: { type: ColorType.Solid, color: "#0e1013" },
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
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          color: "#6b7280",
          width: 1,
          style: 2,
          labelBackgroundColor: "#262a2f",
        },
        horzLine: {
          visible: true,
          color: "#6b7280",
          width: 1,
          style: 2,
          labelBackgroundColor: "#262a2f",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(38, 42, 47, 0.8)",
        scaleMargins: {
          top: 0.12,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: "rgba(38, 42, 47, 0.8)",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 10,
        minBarSpacing: 4,
        rightOffset: 8,
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

    candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#50e3ab",
      downColor: "#ff5572",
      borderUpColor: "#50e3ab",
      borderDownColor: "#ff5572",
      wickUpColor: "#50e3ab",
      wickDownColor: "#ff5572",
    });

    volumeSeries = chart.addSeries(HistogramSeries, {
      visible: showChartVolume(),
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    });

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

    const closeContextMenu = () => setContextMenu(null);
    document.addEventListener("click", closeContextMenu);

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
    const symbol = props.symbol;
    const resolution = props.resolution;
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
          resolution,
          provider,
          controller.signal,
          requestId,
        );
        startStreaming(
          symbol,
          resolvedCoin,
          marketType,
          resolution,
          provider,
        );
      })();
    }, CANDLE_LOAD_DEBOUNCE_MS) as unknown as number;
  });

  const resetChart = () => {
    chart?.timeScale().fitContent();
    setContextMenu(null);
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <div class="chart-container quad-chart relative flex flex-col">
      <div
        ref={containerRef}
        class="flex-1 relative"
        onContextMenu={handleContextMenu}
      />
      {contextMenu() && (
        <div
          class="fixed z-50 bg-brand-surface border border-brand-border rounded shadow-lg py-1 min-w-35"
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
      {isLoading() && (
        <div class="absolute inset-0 flex items-center justify-center bg-brand-screen/70 z-10">
          <div class="flex items-center gap-2 text-brand-slate-400">
            <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
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
            <span class="text-xs font-medium">Loading...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SymbolChart;
