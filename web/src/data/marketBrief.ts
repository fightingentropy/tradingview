export type BriefTone = "positive" | "negative" | "warning" | "neutral";

export type BriefSource = {
  label: string;
  href: string;
};

export const briefSources = {
  fedSpeech: {
    label: "Federal Reserve · Warsh at Jackson Hole",
    href: "https://www.federalreserve.gov/newsevents/speech/warsh20260828a.htm",
  },
  pce: {
    label: "BEA · July PCE",
    href: "https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026",
  },
  treasury: {
    label: "U.S. Treasury · Daily yield curve",
    href: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?field_tdr_date_value=202608&type=daily_treasury_yield_curve",
  },
  payrolls: {
    label: "BLS · July Employment Situation",
    href: "https://www.bls.gov/news.release/empsit.htm",
  },
  equityClose: {
    label: "Reuters · 28 August market close",
    href: "https://www.marketscreener.com/news/wall-street-ends-lower-after-fed-chair-warsh-reaffirms-inflation-fight-ce7858dfd08dfe26",
  },
  apMarket: {
    label: "AP · Rates and equities reaction",
    href: "https://apnews.com/article/stocks-markets-oil-ai-nvidia-0a655f1c042b059279343443d5802907",
  },
  vix: {
    label: "Cboe data via YCharts · VIX close",
    href: "https://ycharts.com/indices/%5EVIX/level",
  },
  dollarProxy: {
    label: "Yahoo Finance · UUP quote",
    href: "https://finance.yahoo.com/quote/UUP/",
  },
  goldProxy: {
    label: "Yahoo Finance · GLD quote",
    href: "https://finance.yahoo.com/quote/GLD/",
  },
  creditProxies: {
    label: "Yahoo Finance · HYG quote",
    href: "https://finance.yahoo.com/quote/HYG/",
  },
  investmentGradeProxy: {
    label: "Yahoo Finance · LQD quote",
    href: "https://finance.yahoo.com/quote/LQD/",
  },
  silverProxy: {
    label: "Yahoo Finance · SLV quote",
    href: "https://finance.yahoo.com/quote/SLV/",
  },
  oilClose: {
    label: "Reuters · 28 August oil close",
    href: "https://finance.yahoo.com/energy/articles/oil-track-weekly-loss-even-012216570.html",
  },
  iran: {
    label: "AP · Iran war, six months in",
    href: "https://apnews.com/article/dd9861bbb882b04e1680f6b2847b3495",
  },
  iranWeekend: {
    label: "AP · 30 August Middle East update",
    href: "https://apnews.com/article/49cf07bcd4f9166f93f51136892d76a6",
  },
  ism: {
    label: "ISM · PMI release calendar",
    href: "https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/",
  },
  blsCalendar: {
    label: "BLS · 2026 release calendar",
    href: "https://www.bls.gov/schedule/2026/home.htm",
  },
  boc: {
    label: "Bank of Canada · 2 September decision",
    href: "https://www.bankofcanada.ca/2026/09/interest-rate-announcement-september-2-2026/",
  },
  weekAhead: {
    label: "Reuters · Week-ahead setup",
    href: "https://www.investing.com/news/economy-news/take-five-summers-over-buckle-up-4880557",
  },
  hyperliquid: {
    label: "Hyperliquid · Info API",
    href: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint",
  },
} satisfies Record<string, BriefSource>;

export const marketSnapshots: Array<{
  label: string;
  value: string;
  change: string;
  tone: BriefTone;
  note: string;
  source: BriefSource;
}> = [
  {
    label: "S&P 500",
    value: "7,711.76",
    change: "−0.25%",
    tone: "negative",
    note: "+0.49% week",
    source: briefSources.equityClose,
  },
  {
    label: "Nasdaq",
    value: "26,402.42",
    change: "−0.52%",
    tone: "negative",
    note: "+0.85% week",
    source: briefSources.equityClose,
  },
  {
    label: "Russell 2000",
    value: "2,972.37",
    change: "−1.39%",
    tone: "negative",
    note: "−1.51% week",
    source: briefSources.equityClose,
  },
  {
    label: "U.S. 2-year",
    value: "4.34%",
    change: "+14 bp",
    tone: "warning",
    note: "28 Aug close",
    source: briefSources.treasury,
  },
  {
    label: "U.S. 10-year",
    value: "4.73%",
    change: "+6 bp",
    tone: "warning",
    note: "2s10s: +39 bp",
    source: briefSources.treasury,
  },
  {
    label: "VIX",
    value: "14.43",
    change: "−0.08",
    tone: "neutral",
    note: "Vol still suppressed",
    source: briefSources.vix,
  },
  {
    label: "Dollar proxy",
    value: "UUP 28.18",
    change: "+0.54%",
    tone: "warning",
    note: "28 Aug close",
    source: briefSources.dollarProxy,
  },
  {
    label: "Gold proxy",
    value: "GLD 408.89",
    change: "−3.26%",
    tone: "negative",
    note: "Hawkish unwind",
    source: briefSources.goldProxy,
  },
];

export const whatChanged: Array<{
  tag: string;
  headline: string;
  detail: string;
  implication: string;
  sources: BriefSource[];
}> = [
  {
    tag: "POLICY",
    headline: "The Fed put hikes back into the live distribution.",
    detail:
      "Warsh called 2% PCE a firm target and said rates remain the primary tool. The 2-year yield rose 14 bp to 4.34%, and the market moved to roughly even odds of a September hike.",
    implication:
      "Front-end duration, precious metals and weaker balance-sheet equities stay exposed until the data weaken decisively.",
    sources: [briefSources.fedSpeech, briefSources.apMarket],
  },
  {
    tag: "BREADTH",
    headline: "Headline resilience is masking a narrower, less comfortable tape.",
    detail:
      "The S&P 500 lost only 0.25%, but the Russell 2000 fell 1.39%; Nasdaq decliners beat advancers 2.19 to 1. The weekly index gain still leaned on AI earnings strength.",
    implication:
      "Prefer profitable secular growth over broad cyclicals until participation improves or yields reverse.",
    sources: [briefSources.equityClose],
  },
  {
    tag: "INFLATION",
    headline: "Inflation is sticky enough to constrain the policy put.",
    detail:
      "July PCE ran at 3.7% year on year and core PCE at 3.3%. Both rose 0.2% month on month, while real consumption was essentially flat.",
    implication:
      "A soft-growth print alone may not deliver an easy easing trade; the inflation side of the mix still matters.",
    sources: [briefSources.pce],
  },
  {
    tag: "STRESS",
    headline: "Rates repriced, but the rest of the system has not confirmed a break.",
    detail:
      "VIX closed at 14.43 and high-yield credit proxies slipped only modestly. That is a policy repricing, not yet a broad deleveraging event.",
    implication:
      "Keep hedges cheap while volatility is subdued, but do not label the tape full risk-off without credit and vol confirmation.",
    sources: [briefSources.vix, briefSources.creditProxies],
  },
  {
    tag: "WEEKEND",
    headline: "Hormuz remains the inflation tail the market cannot ignore.",
    detail:
      "Tanker movement is still severely restricted and Iran's leadership stayed confrontational on Sunday. Oil eased Friday, so the geopolitical risk is present without a fresh market-price confirmation yet.",
    implication:
      "A credible reopening is disinflationary; another shipping disruption would hit bonds and rate-sensitive equities first.",
    sources: [briefSources.iranWeekend, briefSources.iran],
  },
];

export const regime = [
  {
    label: "Growth",
    value: "Bifurcated",
    tone: "warning" as BriefTone,
    detail: "AI capex and profits are strong; labor and real consumption are soft.",
  },
  {
    label: "Inflation",
    value: "Sticky / shock-led",
    tone: "negative" as BriefTone,
    detail: "Headline PCE 3.7%, core 3.3%; energy remains the key tail.",
  },
  {
    label: "Liquidity",
    value: "Tightening at margin",
    tone: "warning" as BriefTone,
    detail: "Front-end yields and the dollar rose; broad conditions are not stressed.",
  },
  {
    label: "Volatility",
    value: "Suppressed",
    tone: "neutral" as BriefTone,
    detail: "VIX at 14.43 diverges from the sharper rates move.",
  },
];

export const crossAssetRead: Array<{
  asset: string;
  read: string;
  signal: string;
  tone: BriefTone;
  sources: BriefSource[];
}> = [
  {
    asset: "Rates",
    read: "Bear flattening",
    signal: "2Y +14 bp, 10Y +6 bp; the front end absorbed the Warsh shock.",
    tone: "negative",
    sources: [briefSources.treasury],
  },
  {
    asset: "FX",
    read: "Dollar firmer",
    signal: "UUP +0.54% is consistent with tighter U.S. policy pricing.",
    tone: "warning",
    sources: [briefSources.dollarProxy],
  },
  {
    asset: "Equities",
    read: "Rotational, narrow",
    signal: "Mega-cap resilience contrasts with small-cap and breadth weakness.",
    tone: "warning",
    sources: [briefSources.equityClose],
  },
  {
    asset: "Credit",
    read: "Orderly",
    signal: "HYG −0.18% and LQD −0.34%; duration hurt more than credit risk.",
    tone: "neutral",
    sources: [briefSources.creditProxies, briefSources.investmentGradeProxy],
  },
  {
    asset: "Commodities",
    read: "Real-rate unwind",
    signal: "GLD −3.26%, SLV −4.37%; oil was softer despite the war premium.",
    tone: "negative",
    sources: [briefSources.goldProxy, briefSources.silverProxy, briefSources.oilClose],
  },
  {
    asset: "Crypto",
    read: "Weekend stabilization",
    signal: "BTC and ETH recovered roughly 1.3% over the latest 24-hour mark.",
    tone: "positive",
    sources: [briefSources.hyperliquid],
  },
];

export const upsideRadar = [
  "A weak payrolls/JOLTS sequence reverses the 2-year yield spike and takes a September hike out of the base distribution.",
  "A verifiable Hormuz reopening pushes the oil risk premium lower and improves the inflation mix.",
  "AI earnings strength broadens beyond a handful of mega-caps while market breadth improves.",
];

export const downsideRadar = [
  "Firm jobs and services data validate Warsh's stance, lifting the dollar and front-end yields again.",
  "Fresh tanker disruption or failed diplomacy pushes energy higher and reaccelerates inflation expectations.",
  "Suppressed VIX and weak breadth resolve through an equity/credit break rather than a rates reversal.",
];

export const catalysts: Array<{
  date: string;
  time: string;
  event: string;
  setup: string;
  reaction: string;
  source: BriefSource;
}> = [
  {
    date: "TUE · 01 SEP",
    time: "15:00 BST",
    event: "U.S. ISM Manufacturing",
    setup: "First clean post-Jackson Hole activity test.",
    reaction: "Strength: yields/USD up. Weakness: duration and gold relief.",
    source: briefSources.ism,
  },
  {
    date: "TUE · 01 SEP",
    time: "15:00 BST",
    event: "U.S. JOLTS · July",
    setup: "Checks whether labor demand confirms July's payroll softness.",
    reaction: "Lower openings reduce hike pressure; resilience does the reverse.",
    source: briefSources.blsCalendar,
  },
  {
    date: "WED · 02 SEP",
    time: "14:45 BST",
    event: "Bank of Canada decision",
    setup: "A live G10 inflation-versus-growth read-through.",
    reaction: "Watch CAD, front-end curves and spillover into global duration.",
    source: briefSources.boc,
  },
  {
    date: "THU · 03 SEP",
    time: "15:00 BST",
    event: "U.S. ISM Services",
    setup: "Services carry more weight for sticky domestic inflation.",
    reaction: "Prices/employment details matter more than the headline alone.",
    source: briefSources.ism,
  },
  {
    date: "FRI · 04 SEP",
    time: "13:30 BST",
    event: "U.S. Employment Situation · August",
    setup: "Reuters consensus: +45k payrolls; prior: −23k.",
    reaction: "The highest-sensitivity input for the 15–16 September FOMC.",
    source: briefSources.weekAhead,
  },
];

export const scenarios: Array<{
  name: string;
  probability: number;
  tone: BriefTone;
  path: string;
  implication: string;
  confirmation: string;
}> = [
  {
    name: "Base case",
    probability: 55,
    tone: "warning",
    path: "Hawkish repricing persists, but equities consolidate rather than disorderly de-risk.",
    implication: "Quality growth over small caps; short duration over long duration; keep cheap convexity.",
    confirmation: "Front-end yields stay elevated while credit and VIX remain orderly.",
  },
  {
    name: "Alternative",
    probability: 30,
    tone: "positive",
    path: "Labor and activity data soften enough to unwind the September hike trade.",
    implication: "Add duration and rate-sensitive growth only after the yield reversal confirms.",
    confirmation: "2-year yield retraces Friday's move and the dollar weakens with broader equity participation.",
  },
  {
    name: "Tail case",
    probability: 15,
    tone: "negative",
    path: "Strong data or a Hormuz shock forces yields/oil higher and breaks the low-volatility equilibrium.",
    implication: "Underweight duration and small caps; favor energy exposure and explicit volatility hedges.",
    confirmation: "Credit weakens and VIX rises alongside—not instead of—the rates shock.",
  },
];

export const traderViews: Array<{
  handle: string;
  stance: string;
  view: string;
  href: string;
}> = [
  {
    handle: "@saxena_puru",
    stance: "Cautious / secular bullish",
    view: "Near-term policy chop, but AI demand and capex still support the larger cycle.",
    href: "https://x.com/saxena_puru/status/2093918125909753906",
  },
  {
    handle: "@WarrenPies",
    stance: "Contrarian dovish",
    view: "Questions the signal in long yields and argues that another hike would be a policy mistake.",
    href: "https://x.com/WarrenPies/status/2093772689928290413",
  },
  {
    handle: "@DonAlt",
    stance: "Constructive crypto",
    view: "Reads ETH consolidation after the breakout as the key near-term crypto tell.",
    href: "https://x.com/DonAlt/status/2093972436241023195",
  },
];

export const dataCaveats = [
  "Cash assets use the 28 August close; crypto marks refresh live and should not be blended with Friday closes.",
  "No verified dealer gamma, CTA threshold or direct fund-flow dataset was available; none is inferred.",
  "The refreshed social sample is crypto-heavy: 343 CT-list posts, 363 Following posts and 76 fresh For You posts. It is an attention lens, not consensus.",
  "The Digg Tech adapter returned no recognizable stories; material AI context instead uses the Fed speech and reported Nvidia results.",
];

export const sourceTrail: BriefSource[] = [
  briefSources.fedSpeech,
  briefSources.pce,
  briefSources.treasury,
  briefSources.payrolls,
  briefSources.equityClose,
  briefSources.vix,
  briefSources.dollarProxy,
  briefSources.goldProxy,
  briefSources.creditProxies,
  briefSources.investmentGradeProxy,
  briefSources.silverProxy,
  briefSources.oilClose,
  briefSources.iran,
  briefSources.ism,
  briefSources.blsCalendar,
  briefSources.boc,
  briefSources.hyperliquid,
];
