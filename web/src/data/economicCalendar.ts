export type CalendarCountry = "US" | "CA";
export type CalendarCategory = "Labour" | "Growth" | "Central bank";
export type CalendarImpact = 1 | 2 | 3;

export type CalendarSource = {
  label: string;
  href: string;
};

export type EconomicCalendarEvent = {
  id: string;
  date: string;
  time: string;
  country: CalendarCountry;
  currency: "USD" | "CAD";
  category: CalendarCategory;
  impact: CalendarImpact;
  event: string;
  period: string;
  actual?: string;
  forecast?: string;
  prior?: string;
  description: string;
  marketRead: string;
  source: CalendarSource;
};

export const calendarSources = {
  blsSeptember: {
    label: "BLS · September 2026 release schedule",
    href: "https://www.bls.gov/schedule/2026/09_sched.htm",
  },
  ism: {
    label: "ISM · 2026 PMI release calendar",
    href: "https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/",
  },
  boc: {
    label: "Bank of Canada · 2 September decision",
    href: "https://www.bankofcanada.ca/2026/09/interest-rate-announcement-september-2-2026/",
  },
  weekAhead: {
    label: "Reuters · Week-ahead consensus",
    href: "https://www.investing.com/news/economy-news/take-five-summers-over-buckle-up-4880557",
  },
} satisfies Record<string, CalendarSource>;

export const calendarDays = [
  { date: "2026-08-31", weekday: "MON", day: "31", month: "AUG" },
  { date: "2026-09-01", weekday: "TUE", day: "01", month: "SEP" },
  { date: "2026-09-02", weekday: "WED", day: "02", month: "SEP" },
  { date: "2026-09-03", weekday: "THU", day: "03", month: "SEP" },
  { date: "2026-09-04", weekday: "FRI", day: "04", month: "SEP" },
] as const;

export const economicCalendarEvents: EconomicCalendarEvent[] = [
  {
    id: "us-ism-manufacturing-2026-09",
    date: "2026-09-01",
    time: "15:00",
    country: "US",
    currency: "USD",
    category: "Growth",
    impact: 3,
    event: "ISM Manufacturing PMI",
    period: "AUG",
    description:
      "The monthly ISM survey tracks activity across U.S. manufacturers through new orders, production, employment and prices.",
    marketRead:
      "A stronger print would reinforce the higher-yield, firmer-dollar setup; weakness would favour duration and gold relief.",
    source: calendarSources.ism,
  },
  {
    id: "us-jolts-2026-07",
    date: "2026-09-01",
    time: "15:00",
    country: "US",
    currency: "USD",
    category: "Labour",
    impact: 2,
    event: "JOLTS Job Openings",
    period: "JUL",
    description:
      "The Job Openings and Labor Turnover Survey covers vacancies, hires, quits and layoffs across the U.S. economy.",
    marketRead:
      "Lower openings would support a softer labour-demand read; resilience would keep pressure on front-end yields.",
    source: calendarSources.blsSeptember,
  },
  {
    id: "ca-boc-rate-2026-09",
    date: "2026-09-02",
    time: "14:45",
    country: "CA",
    currency: "CAD",
    category: "Central bank",
    impact: 3,
    event: "Bank of Canada Rate Decision",
    period: "SEP",
    description:
      "The Bank of Canada publishes its scheduled policy-rate decision and accompanying assessment of inflation and growth.",
    marketRead:
      "Watch CAD and the Canadian front end first, then the read-through to global duration and risk appetite.",
    source: calendarSources.boc,
  },
  {
    id: "us-metro-employment-2026-07",
    date: "2026-09-02",
    time: "15:00",
    country: "US",
    currency: "USD",
    category: "Labour",
    impact: 1,
    event: "Metropolitan Area Employment",
    period: "JUL",
    description:
      "BLS publishes local employment and unemployment estimates for U.S. metropolitan areas.",
    marketRead:
      "Usually lower sensitivity than the national payroll report, but useful for checking whether labour weakness is broadening.",
    source: calendarSources.blsSeptember,
  },
  {
    id: "us-productivity-2026-q2-r",
    date: "2026-09-03",
    time: "13:30",
    country: "US",
    currency: "USD",
    category: "Growth",
    impact: 2,
    event: "Nonfarm Productivity & Unit Labour Costs",
    period: "Q2 · R",
    description:
      "The revised quarterly release measures output per hour and the labour cost required to produce a unit of output.",
    marketRead:
      "The unit-labour-cost revision matters most: an upside surprise would challenge the benign inflation narrative.",
    source: calendarSources.blsSeptember,
  },
  {
    id: "us-ism-services-2026-09",
    date: "2026-09-03",
    time: "15:00",
    country: "US",
    currency: "USD",
    category: "Growth",
    impact: 3,
    event: "ISM Services PMI",
    period: "AUG",
    description:
      "The ISM services survey covers the larger, more labour-intensive side of the U.S. economy.",
    marketRead:
      "Prices and employment details may matter more than the headline for the inflation and policy-rate path.",
    source: calendarSources.ism,
  },
  {
    id: "us-employment-situation-2026-08",
    date: "2026-09-04",
    time: "13:30",
    country: "US",
    currency: "USD",
    category: "Labour",
    impact: 3,
    event: "U.S. Employment Situation",
    period: "AUG",
    forecast: "+45K",
    prior: "−23K",
    description:
      "The monthly employment report includes nonfarm payrolls, unemployment, participation and average hourly earnings.",
    marketRead:
      "The highest-sensitivity input for the 15–16 September FOMC meeting. Consensus and prior shown are for headline payrolls.",
    source: calendarSources.weekAhead,
  },
];
