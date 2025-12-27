import React, { useEffect, useMemo, useState } from "react";

type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAtISO: string;
  snippet: string;
};

const CACHE_KEY = "latestReports_cache_v3";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_DATE = "2015-01-01";

const POWER_TERMS = [
  "power",
  "electricity",
  "grid",
  "demand",
  "supply",
  "renewable",
  "solar",
  "wind",
  "coal",
  "transmission",
  "discom",
  "energy",
  "tariff",
];

const REPORT_TERMS = [
  "report",
  "research",
  "initiation",
  "coverage",
  "update",
  "analyst",
  "note",
  "target price",
  "rating",
  "buy",
  "sell",
  "hold",
  "outperform",
  "underperform",
  "upgrade",
  "downgrade",
];

const COMPANY_FILTERS: { label: string; patterns: string[] }[] = [
  { label: "All", patterns: [] },
  { label: "NTPC", patterns: ["ntpc"] },
  { label: "Tata Power", patterns: ["tata power", "tatapower"] },
  { label: "Power Grid", patterns: ["power grid", "powergrid", "pgcil"] },
  { label: "Adani Power", patterns: ["adani power", "adanipower"] },
  { label: "Adani Green", patterns: ["adani green", "adanigreen", "adani renew"] },
  { label: "REC", patterns: ["rec", "rural electrification corporation"] },
  { label: "PFC", patterns: ["pfc", "power finance corporation"] },
  { label: "NHPC", patterns: ["nhpc"] },
  { label: "JSW Energy", patterns: ["jsw energy", "jswenergy"] },
  { label: "Torrent Power", patterns: ["torrent power", "torrentpower"] },
  { label: "SJVN", patterns: ["sjvn"] },
  { label: "NLC India", patterns: ["nlc india", "nlc"] },
  { label: "CESC", patterns: ["cesc"] },
  { label: "IREDA", patterns: ["ireda"] },
];

const BROKER_TERMS = [
  "icici securities",
  "motilal oswal",
  "jefferies",
  "jp morgan",
  "goldman",
  "citi",
  "hsbc",
  "nomura",
  "axis securities",
  "iifl",
  "hdfc securities",
  "kotak",
  "jm financial",
  "elara",
  "ambit",
  "nuvama",
  "sharekhan",
  "edelweiss",
  "antique",
  "yes securities",
  "emkay",
  "dam capital",
];

function isoDate(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function todayISODate() {
  return isoDate(new Date());
}

function daysBeforeISO(endISO: string, days: number) {
  const d = new Date(endISO + "T00:00:00");
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

function formatDDMMYYYY(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

function clamp(text = "", n = 180) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n) + "…";
}

function isRelevantReport(item: NewsItem) {
  const hay = `${item.title} ${item.snippet} ${item.source}`.toLowerCase();
  const mentionsIndia = hay.includes("india") || hay.includes("indian");
  const mentionsPower = POWER_TERMS.some((t) => hay.includes(t));
  const mentionsReport =
    REPORT_TERMS.some((t) => hay.includes(t)) ||
    BROKER_TERMS.some((t) => hay.includes(t));
  return mentionsIndia && mentionsPower && mentionsReport;
}

function loadCache(): NewsItem[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.ts !== "number" || !Array.isArray(obj.items)) return null;
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return obj.items as NewsItem[];
  } catch {
    return null;
  }
}

function saveCache(items: NewsItem[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items }));
  } catch {
    // ignore
  }
}

function normalizeUrl(u: string) {
  try {
    const url = new URL(u);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(
      (k) => url.searchParams.delete(k)
    );
    return url.toString();
  } catch {
    return u;
  }
}

async function fetchRSSQuery(query: string): Promise<NewsItem[]> {
  const rss =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=en-IN&gl=IN&ceid=IN:en";

  const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(rss)}`;

  const res = await fetch(proxy);
  if (!res.ok) throw new Error("RSS fetch failed");

  const xmlText = await res.text();
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  const items = Array.from(xml.querySelectorAll("item"));

  return items
    .map((item, i) => {
      const title = item.querySelector("title")?.textContent?.trim() || "";
      const link = item.querySelector("link")?.textContent?.trim() || "";
      const pubDate = item.querySelector("pubDate")?.textContent?.trim() || "";
      const source = item.querySelector("source")?.textContent?.trim() || "Google News";
      const desc = (item.querySelector("description")?.textContent || "").replace(/<[^>]+>/g, "");

      const publishedAtISO = pubDate ? new Date(pubDate).toISOString() : "";
      if (!title || !link || !publishedAtISO) return null;

      return {
        id: `${publishedAtISO}_${i}_${title.slice(0, 20)}`,
        title,
        url: normalizeUrl(link),
        source,
        publishedAtISO,
        snippet: clamp(desc, 200),
      } as NewsItem;
    })
    .filter(Boolean) as NewsItem[];
}

async function fetchReportsMultiQuery(): Promise<NewsItem[]> {
  const queries: string[] = [
    // broad brokerage report query
    '(India (power OR electricity OR energy OR renewable OR grid) (report OR research OR initiation OR coverage OR analyst OR "target price" OR rating OR upgrade OR downgrade))',
    // company-oriented
    '(India (NTPC OR "Tata Power" OR "Power Grid" OR "Adani Power" OR REC OR PFC OR NHPC OR IREDA OR "JSW Energy") (report OR research OR analyst OR "target price" OR rating))',
    // broker mentions (publicly indexed)
    '(India (power OR energy) ("Motilal Oswal" OR "ICICI Securities" OR "JM Financial" OR "Nuvama" OR "Ambit" OR "Elara" OR "Axis Securities") (report OR research OR note))',
    // renewables focus
    '(India (renewable OR solar OR wind OR storage OR battery) (report OR research OR initiation OR coverage) (power OR energy))',
  ];

  const results = await Promise.allSettled(queries.map((q) => fetchRSSQuery(q)));

  const merged: NewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }

  const map = new Map<string, NewsItem>();
  for (const item of merged) {
    const key = item.url;
    const existing = map.get(key);
    if (!existing) map.set(key, item);
    else if (existing.publishedAtISO < item.publishedAtISO) map.set(key, item);
  }

  return Array.from(map.values());
}

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        {right ? <div className="text-sm text-slate-600">{right}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ExternalIcon() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-600">
      ↗
    </span>
  );
}

export default function LatestReports() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [endDate, setEndDate] = useState<string>(() => todayISODate());
  const [startDate, setStartDate] = useState<string>(() => {
    const end = todayISODate();
    return daysBeforeISO(end, 7);
  });

  const [company, setCompany] = useState<string>("All");
  const todayMax = todayISODate();

  useEffect(() => {
    if (endDate > todayMax) setEndDate(todayMax);
    if (startDate > endDate) setStartDate(endDate);
    if (startDate < MIN_DATE) setStartDate(MIN_DATE);
    if (endDate < MIN_DATE) setEndDate(MIN_DATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endDate]);

  const filtered = useMemo(() => {
    const fromT = new Date(startDate + "T00:00:00Z").getTime();
    const toT = new Date(endDate + "T23:59:59Z").getTime();

    const chosen = COMPANY_FILTERS.find((c) => c.label === company) || COMPANY_FILTERS[0];
    const patterns = chosen.patterns.map((p) => p.toLowerCase());

    return items
      .filter((n) => {
        const t = new Date(n.publishedAtISO).getTime();
        if (!Number.isFinite(t) || t < fromT || t > toT) return false;

        if (patterns.length === 0) return true;

        const hay = `${n.title} ${n.snippet} ${n.source}`.toLowerCase();
        return patterns.some((p) => hay.includes(p));
      })
      .sort((a, b) => (a.publishedAtISO < b.publishedAtISO ? 1 : -1));
  }, [items, startDate, endDate, company]);

  async function load(force = false) {
    setLoading(true);
    setError(null);

    try {
      if (!force) {
        const cached = loadCache();
        if (cached) {
          setItems(cached);
          setLoading(false);
          return;
        }
      }

      const raw = await fetchReportsMultiQuery();
      const relevant = raw.filter(isRelevantReport);

      relevant.sort((a, b) => (a.publishedAtISO < b.publishedAtISO ? 1 : -1));
      const limited = relevant.slice(0, 200);

      setItems(limited);
      saveCache(limited);
    } catch {
      setError("Unable to load reports – please try again later");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
  }, []);

  function setLast7DaysPreset() {
    const end = todayISODate();
    const start = daysBeforeISO(end, 7);
    setEndDate(end);
    setStartDate(start);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-2xl font-semibold text-slate-900">Latest Reports</div>
            <div className="mt-1 text-sm text-slate-600">
              Brokerage research, initiations, and analyst notes on Indian power & energy.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => load(true)}
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <Card
            title="Filter"
            right={
              <div className="flex items-center gap-2">
                <button
                  onClick={setLast7DaysPreset}
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  Last 7 Days
                </button>
                <button
                  onClick={() => {
                    setLast7DaysPreset();
                    setCompany("All");
                  }}
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  Reset
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
              <div>
                <div className="text-xs font-medium text-slate-600">Start date</div>
                <input
                  type="date"
                  value={startDate}
                  min={MIN_DATE}
                  max={endDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setStartDate(v < MIN_DATE ? MIN_DATE : v > endDate ? endDate : v);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-600">End date</div>
                <input
                  type="date"
                  value={endDate}
                  min={MIN_DATE}
                  max={todayMax}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const clamped = v > todayMax ? todayMax : v < MIN_DATE ? MIN_DATE : v;
                    setEndDate(clamped);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-600">Company</div>
                <select
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                >
                  {COMPANY_FILTERS.map((c) => (
                    <option key={c.label} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-sm text-slate-600">
                Showing{" "}
                <span className="font-semibold text-slate-900">{filtered.length}</span>{" "}
                reports
              </div>
            </div>
          </Card>
        </div>

        {/* ✅ Show error only when nothing to display */}
        {error && filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-rose-800 ring-1 ring-rose-200">
            <div className="font-semibold">{error}</div>
            <button
              onClick={() => load(true)}
              className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="mt-6">
          {loading && !items.length ? (
            <div className="text-sm text-slate-600">Loading reports…</div>
          ) : null}

          {!loading && !error && filtered.length === 0 ? (
            <div className="text-sm text-slate-600">No reports found for this range.</div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((a) => (
              <div
                key={a.id}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-base font-semibold text-slate-900 hover:underline"
                  >
                    {a.title}
                  </a>
                  <a href={a.url} target="_blank" rel="noreferrer" title="Open">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                      ↗
                    </span>
                  </a>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span className="font-medium">{a.source}</span>
                  <span>•</span>
                  <span>{formatDDMMYYYY(a.publishedAtISO)}</span>
                </div>

                <div className="mt-3 text-sm text-slate-700">{a.snippet}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 text-xs text-slate-500">
          Cached for up to 1 hour. Refresh to fetch latest.
        </div>
      </div>
    </div>
  );
}
