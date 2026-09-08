import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { MARKETS } from "../stores/market";
import { getSpotBalance } from "../stores/wallet";
import { isAuthenticated, login } from "../stores/auth";

type OptionType = "call" | "put";
type OrderSide = "buy" | "sell";
type OrderType = "limit" | "market";

type Expiry = {
  id: string;
  label: string;
  date: Date;
};

type OptionQuote = {
  bidSize: number;
  bidIv: number;
  bid: number;
  mark: number;
  ask: number;
  askIv: number;
  askSize: number;
  delta: number;
  markIv: number;
};

type ChainRow = {
  strike: number;
  call: OptionQuote;
  put: OptionQuote;
};

type SelectedContract = {
  expiry: string;
  strike: number;
  type: OptionType;
};

type Prefill = {
  side?: OrderSide;
  price?: number;
} | null;

const UNDERLYING_SYMBOL = "HYPE";
const PRICE_FALLBACK = 23.63;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const parseNumber = (value: string | number | undefined) => {
  if (value == null) return 0;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pseudoRandom = (seed: number) => {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
};

const formatExpiryLabel = (date: Date) =>
  date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const formatExpiryLong = (date: Date) =>
  date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const formatCountdown = (target: Date, nowMs: number) => {
  const remaining = Math.max(0, target.getTime() - nowMs);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(
    minutes,
  ).padStart(2, "0")}m`;
};

const buildExpiries = () => {
  const base = new Date();
  base.setHours(8, 0, 0, 0);
  const day = base.getDay();
  const daysToFriday = (5 - day + 7) % 7 || 7;
  base.setDate(base.getDate() + daysToFriday);
  const weeks = [0, 1, 2, 3, 5, 8];
  return weeks.map((offset) => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset * 7);
    return {
      id: date.toISOString().slice(0, 10),
      label: formatExpiryLabel(date),
      date,
    };
  });
};

const getStrikeStep = (underlying: number) => {
  if (underlying >= 200) return 5;
  if (underlying >= 100) return 2.5;
  if (underlying >= 50) return 1;
  return 0.5;
};

const buildQuote = ({
  strike,
  underlying,
  daysToExpiry,
  isCall,
  seed,
}: {
  strike: number;
  underlying: number;
  daysToExpiry: number;
  isCall: boolean;
  seed: number;
}): OptionQuote => {
  const distance = Math.abs(strike - underlying);
  const time = Math.max(daysToExpiry / 365, 1 / 365);
  const intrinsic = isCall
    ? Math.max(0, underlying - strike)
    : Math.max(0, strike - underlying);
  const decay = Math.exp(-distance / (underlying * 0.25));
  const timeValue = underlying * 0.12 * Math.sqrt(time) * decay;
  const mark = Math.max(0.01, intrinsic + timeValue);
  const spread = Math.max(0.01, mark * (0.06 + 0.04 * pseudoRandom(seed + 1)));
  const bid = Math.max(0, mark - spread * 0.5);
  const ask = mark + spread * 0.5;

  const sizeStep = distance < 1.5 ? 500 : distance < 4 ? 100 : 10;
  const bidSize = sizeStep + Math.round(pseudoRandom(seed + 2) * 6) * 10;
  const askSize = sizeStep + Math.round(pseudoRandom(seed + 3) * 6) * 10;

  const skew = (strike - underlying) / Math.max(underlying, 1);
  const smile = 0.75 + Math.min(0.8, Math.abs(skew) * 1.5);
  const baseIv = clamp(smile + (isCall ? -0.05 * skew : 0.05 * skew), 0.6, 2);
  const markIv = baseIv * 100;
  const bidIv = Math.max(10, markIv - 4 - pseudoRandom(seed + 4) * 2);
  const askIv = markIv + 4 + pseudoRandom(seed + 5) * 2;

  const d = (underlying - strike) / Math.max(underlying * 0.08, 0.1);
  const callDelta = clamp(1 / (1 + Math.exp(-d)), 0.02, 0.98);
  const delta = isCall ? callDelta : callDelta - 1;

  return {
    bidSize,
    bidIv,
    bid,
    mark,
    ask,
    askIv,
    askSize,
    delta,
    markIv,
  };
};

const buildChain = (
  underlying: number,
  daysToExpiry: number,
  expirySeed: number,
) => {
  const safeUnderlying = underlying > 0 ? underlying : PRICE_FALLBACK;
  const step = getStrikeStep(safeUnderlying);
  const center = Math.round(safeUnderlying / step) * step;
  const rows: ChainRow[] = [];
  const half = 9;
  for (let i = -half; i <= half; i += 1) {
    const strike = Math.max(step, center + i * step);
    const seedBase = expirySeed + Math.round(strike * 100);
    rows.push({
      strike,
      call: buildQuote({
        strike,
        underlying: safeUnderlying,
        daysToExpiry,
        isCall: true,
        seed: seedBase + 1,
      }),
      put: buildQuote({
        strike,
        underlying: safeUnderlying,
        daysToExpiry,
        isCall: false,
        seed: seedBase + 2,
      }),
    });
  }
  return { rows, step, center };
};

const formatPrice = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return value >= 1 ? value.toFixed(2) : value.toFixed(3);
};

const formatIv = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return `${value.toFixed(1)}%`;
};

const formatDelta = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(2);
};

const formatSize = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return String(Math.round(value));
};

const OptionsOrderForm: Component<{
  contract: () => SelectedContract | null;
  quote: () => OptionQuote | undefined;
  underlyingPrice: () => number;
  prefill: () => Prefill;
  onUpdateContract: (next: SelectedContract) => void;
}> = (props) => {
  const [side, setSide] = createSignal<OrderSide>("buy");
  const [orderType, setOrderType] = createSignal<OrderType>("limit");
  const [size, setSize] = createSignal("");
  const [limitPrice, setLimitPrice] = createSignal("");
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [lastContractKey, setLastContractKey] = createSignal("");

  const contractKey = createMemo(() => {
    const contract = props.contract();
    if (!contract) return "";
    return `${contract.expiry}-${contract.type}-${contract.strike}`;
  });

  createEffect(() => {
    const nextKey = contractKey();
    if (nextKey === lastContractKey()) return;
    if (!nextKey) {
      setLimitPrice("");
      setLastContractKey("");
      setError("");
      setStatus("");
      return;
    }
    const quote = props.quote();
    if (quote) {
      setLimitPrice(quote.mark.toFixed(2));
    }
    setLastContractKey(nextKey);
    setError("");
    setStatus("");
  });

  createEffect(() => {
    const nextPrefill = props.prefill();
    if (!nextPrefill) return;
    if (nextPrefill.side) setSide(nextPrefill.side);
    if (Number.isFinite(nextPrefill.price)) {
      setOrderType("limit");
      setLimitPrice(Number(nextPrefill.price).toFixed(2));
    }
  });

  const parsedSize = createMemo(() => parseNumber(size()));
  const selectedQuote = createMemo(() => props.quote());
  const priceValue = createMemo(() => {
    if (orderType() === "market") {
      return selectedQuote()?.mark ?? 0;
    }
    return parseNumber(limitPrice());
  });

  const contract = createMemo(() => props.contract());
  const underlying = createMemo(() => props.underlyingPrice());

  const collateralAsset = createMemo(() => {
    const current = contract();
    if (!current) return "USDC";
    if (side() === "buy") return "USDC";
    return current.type === "call" ? UNDERLYING_SYMBOL : "USDC";
  });

  const collateralRequired = createMemo(() => {
    const current = contract();
    if (!current) return 0;
    const sizeValue = parsedSize();
    if (sizeValue <= 0) return 0;
    if (side() === "buy") {
      return sizeValue * priceValue();
    }
    if (current.type === "call") {
      return sizeValue;
    }
    return sizeValue * current.strike;
  });

  const availableCollateral = createMemo(() => {
    return collateralAsset() === UNDERLYING_SYMBOL
      ? getSpotBalance(UNDERLYING_SYMBOL)
      : getSpotBalance("USDC");
  });

  const isCovered = createMemo(() => {
    const current = contract();
    if (!current) return false;
    if (side() !== "sell" || current.type !== "call") return false;
    return availableCollateral() >= collateralRequired();
  });

  const canSubmit = createMemo(() => {
    if (!contract()) return false;
    if (!Number.isFinite(parsedSize()) || parsedSize() <= 0) return false;
    if (orderType() === "limit" && priceValue() <= 0) return false;
    if (collateralRequired() > availableCollateral()) return false;
    return true;
  });
  const buttonEnabled = createMemo(() =>
    isAuthenticated() ? canSubmit() : true,
  );
  const buttonClass = createMemo(() => {
    if (!buttonEnabled()) {
      return "bg-brand-border text-brand-slate-500 cursor-not-allowed";
    }
    if (!isAuthenticated()) {
      return "bg-brand-accent text-brand-screen hover:brightness-105";
    }
    return side() === "buy"
      ? "bg-brand-accent text-brand-screen hover:brightness-105"
      : "bg-brand-red-400 text-brand-screen hover:brightness-105";
  });

  const handleSubmit = () => {
    setError("");
    setStatus("");
    if (!isAuthenticated()) {
      login();
      return;
    }
    if (!canSubmit()) {
      setError("Check size, price, and collateral.");
      return;
    }
    const current = contract();
    if (!current) return;
    const actionLabel = `${side() === "buy" ? "Bought" : "Sold"} ${
      current.type === "call" ? "Call" : "Put"
    }`;
    setStatus(`${actionLabel} ${parsedSize()} contracts (demo).`);
    setSize("");
  };

  const actionLabel = createMemo(() => {
    const current = contract();
    if (!current) return "Select Contract";
    return `${side() === "buy" ? "Buy" : "Sell"} ${
      current.type === "call" ? "Call" : "Put"
    }`;
  });

  const priceLabel = createMemo(() =>
    side() === "buy" ? "Premium" : "Credit",
  );

  const collateralLabel = createMemo(() =>
    contract() && contract()!.type === "call" && side() === "sell"
      ? "Covered Call Collateral"
      : "Collateral",
  );

  return (
    <div class="flex flex-col h-full bg-brand-surface">
      <div class="px-4 py-3 border-b border-brand-border">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-slate-100">Options Ticket</p>
            <p class="text-xs text-brand-slate-500">
              {contract()
                ? `${UNDERLYING_SYMBOL} ${contract()!.strike.toFixed(2)} ${
                    contract()!.type === "call" ? "Call" : "Put"
                  }`
                : "Select a contract"}
            </p>
          </div>
          <div class="text-right text-xs text-brand-slate-500">
            <p>{contract()?.expiry ?? "--"}</p>
            <p class="font-mono text-slate-100">${underlying().toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-auto px-4 py-4 space-y-4">
        <div class="grid grid-cols-2 gap-2">
          <button
            class={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              side() === "buy"
                ? "bg-brand-accent text-brand-screen"
                : "text-brand-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setSide("buy")}
          >
            Buy
          </button>
          <button
            class={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              side() === "sell"
                ? "bg-brand-red-400 text-brand-screen"
                : "text-brand-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setSide("sell")}
          >
            Sell
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            class={`rounded-lg py-2 text-xs font-semibold tracking-wide transition-colors ${
              contract()?.type === "call"
                ? "bg-brand-border text-slate-100"
                : "text-brand-slate-400 hover:text-slate-200"
            }`}
            onClick={() =>
              contract() &&
              props.onUpdateContract({ ...contract()!, type: "call" })
            }
            disabled={!contract()}
          >
            CALL
          </button>
          <button
            class={`rounded-lg py-2 text-xs font-semibold tracking-wide transition-colors ${
              contract()?.type === "put"
                ? "bg-brand-border text-slate-100"
                : "text-brand-slate-400 hover:text-slate-200"
            }`}
            onClick={() =>
              contract() &&
              props.onUpdateContract({ ...contract()!, type: "put" })
            }
            disabled={!contract()}
          >
            PUT
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            class={`rounded-lg py-2 text-xs font-semibold transition-colors ${
              orderType() === "market"
                ? "bg-brand-border text-slate-100"
                : "text-brand-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setOrderType("market")}
          >
            Market
          </button>
          <button
            class={`rounded-lg py-2 text-xs font-semibold transition-colors ${
              orderType() === "limit"
                ? "bg-brand-border text-slate-100"
                : "text-brand-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setOrderType("limit")}
          >
            Limit
          </button>
        </div>

        <div class="space-y-2">
          <div class="flex items-center rounded-xl border border-brand-border bg-brand-screen px-3 py-3">
            <input
              type="text"
              inputmode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              autocomplete="off"
              class="flex-1 bg-transparent text-sm text-slate-100 font-mono text-left"
              placeholder="Contracts"
              value={size()}
              onInput={(event) => setSize(event.currentTarget.value)}
            />
            <span class="text-xs text-brand-slate-400">Contracts</span>
          </div>

          <Show when={orderType() === "limit"}>
            <div class="flex items-center rounded-xl border border-brand-border bg-brand-screen px-3 py-3">
              <span class="text-sm text-brand-slate-400">Price</span>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                autocomplete="off"
                class="flex-1 bg-transparent px-3 text-sm text-slate-100 font-mono text-right"
                placeholder={selectedQuote()?.mark.toFixed(2) ?? "0.00"}
                value={limitPrice()}
                onInput={(event) => setLimitPrice(event.currentTarget.value)}
              />
              <span class="text-xs text-brand-slate-400">USDC</span>
            </div>
          </Show>
        </div>

        <div class="rounded-xl border border-brand-border bg-brand-screen px-3 py-3 text-xs space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-brand-slate-500">{priceLabel()}</span>
            <span class="text-slate-100 font-mono">
              ${priceValue().toFixed(2)}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-brand-slate-500">{collateralLabel()}</span>
            <span class="text-slate-100 font-mono">
              {collateralRequired().toFixed(2)} {collateralAsset()}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-brand-slate-500">Available</span>
            <span class="text-slate-100 font-mono">
              {availableCollateral().toFixed(2)} {collateralAsset()}
            </span>
          </div>
          <Show
            when={
              contract() && contract()!.type === "call" && side() === "sell"
            }
          >
            <div class="flex items-center justify-between">
              <span class="text-brand-slate-500">Coverage</span>
              <span
                class={`font-mono ${
                  isCovered() ? "text-brand-green-400" : "text-brand-red-400"
                }`}
              >
                {isCovered() ? "Covered" : "Uncovered"}
              </span>
            </div>
          </Show>
        </div>

        <Show when={error()}>
          <div class="rounded-lg border border-brand-red-400/30 bg-brand-red-400/10 px-3 py-2 text-xs text-brand-red-400">
            {error()}
          </div>
        </Show>
        <Show when={status()}>
          <div class="rounded-lg border border-brand-accent/30 bg-brand-accent/10 px-3 py-2 text-xs text-brand-accent">
            {status()}
          </div>
        </Show>
      </div>

      <div class="px-4 pb-4">
        <button
          class={`w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${buttonClass()}`}
          onClick={handleSubmit}
          disabled={!buttonEnabled()}
        >
          {isAuthenticated() ? actionLabel() : "Connect to Trade"}
        </button>
      </div>
    </div>
  );
};

const OptionsTrade: Component = () => {
  const expiries = buildExpiries();
  const [selectedExpiry, setSelectedExpiry] = createSignal<Expiry>(
    expiries[2] ?? expiries[0],
  );
  const [selectedContract, setSelectedContract] =
    createSignal<SelectedContract | null>(null);
  const [prefill, setPrefill] = createSignal<Prefill>(null);
  const [nowMs, setNowMs] = createSignal(Date.now());

  const underlyingPrice = createMemo(() => {
    const markets = MARKETS();
    const perps = markets.find(
      (market) =>
        market.symbol === UNDERLYING_SYMBOL && market.type === "perps",
    );
    const spot = markets.find(
      (market) => market.symbol === UNDERLYING_SYMBOL && market.type === "spot",
    );
    return (
      parseNumber(perps?.price) || parseNumber(spot?.price) || PRICE_FALLBACK
    );
  });

  const daysToExpiry = createMemo(() => {
    const remaining = selectedExpiry().date.getTime() - nowMs();
    return Math.max(remaining / (1000 * 60 * 60 * 24), 1);
  });

  const chain = createMemo(() =>
    buildChain(
      underlyingPrice(),
      daysToExpiry(),
      parseNumber(selectedExpiry().id.replace(/-/g, "")),
    ),
  );

  const strikeDecimals = 2;

  const selectedQuote = createMemo(() => {
    if (!selectedContract()) return undefined;
    const row = chain().rows.find(
      (item) => item.strike === selectedContract()!.strike,
    );
    if (!row) return undefined;
    return selectedContract()!.type === "call" ? row.call : row.put;
  });

  createEffect(() => {
    const current = selectedContract();
    if (!current) return;
    const rows = chain().rows;
    if (rows.length === 0) return;
    const match = rows.find((row) => row.strike === current.strike);
    if (match) return;
    setSelectedContract({
      ...current,
      strike: rows[Math.floor(rows.length / 2)].strike,
    });
  });

  createEffect(() => {
    const expiry = selectedExpiry();
    setSelectedContract((prev) =>
      prev ? { ...prev, expiry: expiry.id } : prev,
    );
  });

  const handleStrikeSelect = (row: ChainRow, type: OptionType) => {
    const current = selectedContract();
    if (current && current.strike === row.strike && current.type === type) {
      setSelectedContract(null);
      setPrefill(null);
      return;
    }
    setSelectedContract({
      expiry: selectedExpiry().id,
      strike: row.strike,
      type,
    });
    setPrefill(null);
  };

  const handleQuotePrefill = (side?: OrderSide, price?: number) => {
    const hasPrice = Number.isFinite(price) && (price ?? 0) > 0;
    const nextPrefill =
      side || hasPrice ? { side, price: hasPrice ? price : undefined } : null;
    setPrefill(nextPrefill);
  };

  const expiryCountdown = createMemo(() =>
    formatCountdown(selectedExpiry().date, nowMs()),
  );

  const expiryLabel = createMemo(() => formatExpiryLong(selectedExpiry().date));

  const priceRowIndex = createMemo(() => {
    const rows = chain().rows;
    if (rows.length === 0) return -1;
    const price = underlyingPrice();
    const firstHigher = rows.findIndex((row) => row.strike >= price);
    return firstHigher === -1 ? rows.length : firstHigher;
  });

  createEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <div class="flex flex-col h-full">
      <div class="border-b border-brand-border bg-brand-surface">
        <div class="flex items-center justify-between px-4 py-3">
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-2">
              <div class="h-8 w-8 rounded-full bg-brand-screen flex items-center justify-center border border-brand-border text-xs font-semibold text-slate-100">
                {UNDERLYING_SYMBOL}
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-100">
                  {UNDERLYING_SYMBOL} Options
                </p>
              </div>
            </div>
          </div>
          <div class="text-right">
            <p class="text-xs text-brand-slate-500">{expiryLabel()}</p>
            <p class="text-xs font-mono text-slate-100">{expiryCountdown()}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 px-4 pb-3 overflow-x-auto">
          <For each={expiries}>
            {(expiry) => (
              <button
                class={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  expiry.id === selectedExpiry().id
                    ? "bg-brand-accent text-brand-screen"
                    : "bg-brand-screen text-brand-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setSelectedExpiry(expiry)}
              >
                {expiry.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="flex flex-1 flex-col md:flex-row overflow-hidden">
        <div class="flex-1 min-w-0 overflow-hidden bg-brand-screen">
          <div class="h-full flex flex-col">
            <div class="px-4 py-2 border-b border-brand-border bg-brand-surface/70">
              <div class="grid grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] items-center text-xs uppercase tracking-wider text-brand-slate-500">
                <div class="text-center">Calls</div>
                <div class="text-center">Strike</div>
                <div class="text-center">Puts</div>
              </div>
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] gap-0 px-4 py-2 text-[10px] uppercase tracking-wider text-brand-slate-500 border-b border-brand-border bg-brand-surface/50">
              <div class="grid grid-cols-9 gap-2">
                <For
                  each={[
                    "Bid Size",
                    "Bid IV",
                    "Bid",
                    "Mark",
                    "Ask",
                    "Ask IV",
                    "Ask Size",
                    "Delta",
                    "Mark IV",
                  ]}
                >
                  {(label) => <div class="text-right">{label}</div>}
                </For>
              </div>
              <div />
              <div class="grid grid-cols-9 gap-2">
                <For
                  each={[
                    "Bid Size",
                    "Bid IV",
                    "Bid",
                    "Mark",
                    "Ask",
                    "Ask IV",
                    "Ask Size",
                    "Delta",
                    "Mark IV",
                  ]}
                >
                  {(label) => <div class="text-right">{label}</div>}
                </For>
              </div>
            </div>

            <div class="flex-1 overflow-auto">
              <For each={chain().rows}>
                {(row, index) => {
                  const selectedCall = () =>
                    !!selectedContract() &&
                    selectedContract()!.type === "call" &&
                    selectedContract()!.strike === row.strike;
                  const selectedPut = () =>
                    !!selectedContract() &&
                    selectedContract()!.type === "put" &&
                    selectedContract()!.strike === row.strike;
                  const selectedRow = () => selectedCall() || selectedPut();
                  return (
                    <>
                      <Show when={index() === priceRowIndex()}>
                        <div class="relative px-4 py-1">
                          <div class="absolute left-4 right-4 top-1/2 border-t border-dashed border-sky-400/70" />
                          <div class="relative flex justify-center">
                            <span class="rounded-full border border-sky-400/70 bg-brand-screen px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                              Current ${underlyingPrice().toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </Show>
                      <div
                        class={`grid grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] px-4 py-1 text-xs font-mono border-b border-brand-border/40 hover:bg-brand-border/20 ${
                          selectedRow() ? "bg-brand-border/30" : ""
                        }`}
                      >
                        <div
                          class={`grid grid-cols-9 gap-2 text-right ${
                            selectedCall() ? "bg-brand-border/40" : ""
                          }`}
                          onClick={() => handleStrikeSelect(row, "call")}
                        >
                          <div>{formatSize(row.call.bidSize)}</div>
                          <div>{formatIv(row.call.bidIv)}</div>
                          <button
                            class="text-brand-green-400 hover:text-brand-accent"
                            onClick={() =>
                              handleQuotePrefill("sell", row.call.bid)
                            }
                          >
                            {formatPrice(row.call.bid)}
                          </button>
                          <button
                            class="text-slate-200"
                            onClick={() =>
                              handleQuotePrefill(undefined, row.call.mark)
                            }
                          >
                            {formatPrice(row.call.mark)}
                          </button>
                          <button
                            class="text-brand-red-400 hover:text-brand-red-300"
                            onClick={() =>
                              handleQuotePrefill("buy", row.call.ask)
                            }
                          >
                            {formatPrice(row.call.ask)}
                          </button>
                          <div>{formatIv(row.call.askIv)}</div>
                          <div>{formatSize(row.call.askSize)}</div>
                          <div>{formatDelta(row.call.delta)}</div>
                          <div>{formatIv(row.call.markIv)}</div>
                        </div>

                        <div class="flex items-center justify-center">
                          <div class="flex flex-col items-center gap-1">
                            <button
                              class={`px-2 py-1 rounded-lg text-xs font-semibold ${
                                selectedRow()
                                  ? "bg-brand-accent text-brand-screen"
                                  : "bg-brand-screen text-slate-200"
                              }`}
                              onClick={() => handleStrikeSelect(row, "call")}
                            >
                              {row.strike.toFixed(strikeDecimals)}
                            </button>
                          </div>
                        </div>

                        <div
                          class={`grid grid-cols-9 gap-2 text-right ${
                            selectedPut() ? "bg-brand-border/40" : ""
                          }`}
                          onClick={() => handleStrikeSelect(row, "put")}
                        >
                          <div>{formatSize(row.put.bidSize)}</div>
                          <div>{formatIv(row.put.bidIv)}</div>
                          <button
                            class="text-brand-green-400 hover:text-brand-accent"
                            onClick={() =>
                              handleQuotePrefill("sell", row.put.bid)
                            }
                          >
                            {formatPrice(row.put.bid)}
                          </button>
                          <button
                            class="text-slate-200"
                            onClick={() =>
                              handleQuotePrefill(undefined, row.put.mark)
                            }
                          >
                            {formatPrice(row.put.mark)}
                          </button>
                          <button
                            class="text-brand-red-400 hover:text-brand-red-300"
                            onClick={() =>
                              handleQuotePrefill("buy", row.put.ask)
                            }
                          >
                            {formatPrice(row.put.ask)}
                          </button>
                          <div>{formatIv(row.put.askIv)}</div>
                          <div>{formatSize(row.put.askSize)}</div>
                          <div>{formatDelta(row.put.delta)}</div>
                          <div>{formatIv(row.put.markIv)}</div>
                        </div>
                      </div>
                    </>
                  );
                }}
              </For>
              <Show when={priceRowIndex() === chain().rows.length}>
                <div class="relative px-4 py-1">
                  <div class="absolute left-4 right-4 top-1/2 border-t border-dashed border-sky-400/70" />
                  <div class="relative flex justify-center">
                    <span class="rounded-full border border-sky-400/70 bg-brand-screen px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                      Current ${underlyingPrice().toFixed(2)}
                    </span>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>

        <div class="w-full md:w-80 border-t md:border-t-0 md:border-l border-brand-border">
          <OptionsOrderForm
            contract={selectedContract}
            quote={selectedQuote}
            underlyingPrice={underlyingPrice}
            prefill={prefill}
            onUpdateContract={(next) => setSelectedContract(next)}
          />
        </div>
      </div>
    </div>
  );
};

export default OptionsTrade;
