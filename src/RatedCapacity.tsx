import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Rated Capacity Tab
 * - Top card: "Rated Capacity" (editable Installed Capacity + PLF, computed Rated Capacity)
 * - Historical Capacity card below (monthly picker)
 * - Daily card (same UX/structure as RTM Daily card) below Historical Capacity
 *
 * IMPORTANT:
 * - Does NOT change formatting/behavior of the Rated Capacity card above (manual inputs still allowed)
 * - Uses localStorage keys:
 *    - ratedCapacity_installed
 *    - ratedCapacity_plf
 * - Reads initial installed capacities from /data/Capacity.csv (single-row CSV)
 * - Reads historical monthly capacities from /data/capacity.csv (or /data/Capacity.csv fallback)
 * - Daily card uses its own storage key:
 *    - tusk_rated_capacity_daily_v1
 */

type SourceKey =
  | "Coal"
  | "Oil & Gas"
  | "Nuclear"
  | "Hydro"
  | "Solar"
  | "Wind"
  | "Small-Hydro"
  | "Bio Power";

const SOURCES: SourceKey[] = [
  "Coal",
  "Oil & Gas",
  "Nuclear",
  "Hydro",
  "Solar",
  "Wind",
  "Small-Hydro",
  "Bio Power",
];

/* -----------------------------
   Generic helpers
----------------------------- */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function fmt2(n: number) {
  const v = round2(n);
  return v.toFixed(2);
}
function safeNum(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function sumSources(obj: Record<string, number>, keys: string[]) {
  return keys.reduce((acc, k) => acc + safeNum(obj[k]), 0);
}

function parseCSVSimple(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return { header: [], rows: [] as string[][] };

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const header = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { header, rows };
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

function numberInputClass() {
  return "w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 tabular-nums";
}

function compareMonthKey(a: string, b: string) {
  // MM/YYYY
  const [am, ay] = a.split("/").map((x) => Number(x));
  const [bm, by] = b.split("/").map((x) => Number(x));
  if (ay !== by) return ay - by;
  return am - bm;
}

function minusMonths(monthKey: string, monthsBack: number) {
  const [mm, yyyy] = monthKey.split("/").map((x) => Number(x));
  let m = mm;
  let y = yyyy;
  let left = monthsBack;

  while (left > 0) {
    m -= 1;
    if (m <= 0) {
      m = 12;
      y -= 1;
    }
    left -= 1;
  }
  return `${String(m).padStart(2, "0")}/${String(y)}`;
}

function clampMonthKeyToOptions(target: string, options: string[]) {
  if (!options.length) return target;
  if (options.includes(target)) return target;

  const sorted = options.slice().sort(compareMonthKey);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (compareMonthKey(sorted[i], target) <= 0) return sorted[i];
  }
  return sorted[0];
}

function netColorClass(v: number) {
  if (v > 0) return "text-emerald-600";
  if (v < 0) return "text-rose-600";
  return "text-slate-700";
}

function normalizeHeader(h: string) {
  return (h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/–/g, "-")
    .replace(/—/g, "-");
}

/**
 * Month normalization:
 * Accepts:
 *  - MM/YYYY
 *  - M/YYYY
 *  - DD/MM/YYYY (extracts MM/YYYY)
 *  - DD-MM-YYYY (extracts MM/YYYY)
 *  - YYYY-MM-DD (extracts MM/YYYY)
 */
function normalizeMonth(raw: string) {
  const t = (raw || "").trim();
  if (!t) return null;

  // MM/YYYY or M/YYYY
  const m1 = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) {
    const mm = String(Number(m1[1])).padStart(2, "0");
    const yyyy = m1[2];
    return `${mm}/${yyyy}`;
  }

  // DD/MM/YYYY
  const dmy1 = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy1) {
    const mm = dmy1[2];
    const yyyy = dmy1[3];
    return `${mm}/${yyyy}`;
  }

  // DD-MM-YYYY
  const dmy2 = t.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy2) {
    const mm = dmy2[2];
    const yyyy = dmy2[3];
    return `${mm}/${yyyy}`;
  }

  // YYYY-MM-DD
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2];
    return `${mm}/${yyyy}`;
  }

  return null;
}

async function fetchTextWithFallback(paths: string[]) {
  let lastErr: any = null;
  for (const p of paths) {
    try {
      const res = await fetch(`${p}?v=${Date.now()}`);
      if (!res.ok) {
        lastErr = new Error(`${p} HTTP ${res.status}`);
        continue;
      }
      const txt = await res.text();
      if (!txt || !txt.trim()) {
        lastErr = new Error(`${p} empty`);
        continue;
      }
      return { path: p, text: txt };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All fallbacks failed");
}

/* -----------------------------
   Month picker helpers (input type="month")
   - input value: YYYY-MM
   - internal value: MM/YYYY
----------------------------- */

function monthKeyToInputValue(mk: string) {
  if (!mk || !/^\d{2}\/\d{4}$/.test(mk)) return "";
  const [mm, yyyy] = mk.split("/");
  return `${yyyy}-${mm}`;
}

function inputValueToMonthKey(v: string) {
  // YYYY-MM -> MM/YYYY
  if (!v || !/^\d{4}-\d{2}$/.test(v)) return "";
  const [yyyy, mm] = v.split("-");
  return `${mm}/${yyyy}`;
}

/* -----------------------------
   Daily card helpers (isolated)
----------------------------- */

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseISOKey(s: string) {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : s;
}

// Parse DD/MM/YYYY -> ISO; also accept DD-MM-YYYY and ISO.
function parseInputDate(s: unknown) {
  if (typeof s !== "string") return null;
  const t = s.trim();

  // dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
    const [dd, mm, yyyy] = t.split("/").map(Number);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (Number.isNaN(d.getTime())) return null;
    if (
      d.getUTCFullYear() !== yyyy ||
      d.getUTCMonth() !== mm - 1 ||
      d.getUTCDate() !== dd
    )
      return null;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  // dd-mm-yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(t)) {
    const [dd, mm, yyyy] = t.split("-").map(Number);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (Number.isNaN(d.getTime())) return null;
    if (
      d.getUTCFullYear() !== yyyy ||
      d.getUTCMonth() !== mm - 1 ||
      d.getUTCDate() !== dd
    )
      return null;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return parseISOKey(t);
  return null;
}

function formatDDMMYYYY(iso: string) {
  if (!iso || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// CSV standard output: dd/mm/yyyy
function formatDDMMYYYYForCSV(iso: string) {
  if (!iso || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatDDMMYY(iso: string) {
  if (!iso || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function isoMinusDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoPlusDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function safeDiv(n: number, d: number | null | undefined) {
  if (d == null || d === 0) return null;
  return n / d;
}

function growthPct(curr: number, prev: number) {
  const r = safeDiv(curr - prev, prev);
  return r == null ? null : r * 100;
}

function sortISO(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeDomain(values: Array<number | null | undefined>, padPct = 0.05, minAbsPad = 1) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return undefined;
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    const pad = Math.max(minAbsPad, Math.abs(min) * padPct);
    return [min - pad, max + pad] as [number, number];
  }
  const range = max - min;
  const pad = Math.max(minAbsPad, range * padPct);
  return [min - pad, max + pad] as [number, number];
}

function pctColorClass(x: number | null | undefined) {
  if (x == null || Number.isNaN(x)) return "text-slate-500";
  if (x > 0) return "text-emerald-700";
  if (x < 0) return "text-rose-700";
  return "text-slate-600";
}

function csvParseDaily(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: string[][] = [];
  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length >= 2) rows.push(cols);
  }

  // Optional header: if col0 contains "date", drop it.
  if (rows.length) {
    const h0 = (rows[0][0] || "").toLowerCase();
    if (h0.includes("date")) rows.shift();
  }

  const parsed: Array<{ date: string; value: number }> = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const [dRaw, vRaw] = rows[i];
    const date = parseInputDate(dRaw);
    const v = Number(String(vRaw).replace(/,/g, ""));

    if (!date) {
      errors.push(`Row ${i + 1}: invalid date '${dRaw}' (expected DD/MM/YYYY)`);
      continue;
    }
    if (!Number.isFinite(v)) {
      errors.push(`Row ${i + 1}: invalid value '${vRaw}'`);
      continue;
    }
    parsed.push({ date, value: v });
  }

  return { parsed, errors };
}

function sampleDailyCSV(valueColumnKey: string) {
  return [
    `date,${valueColumnKey}`,
    "18/12/2025,261.72",
    "19/12/2025,262.10",
    "20/12/2025,260.95",
  ].join("\n");
}

function downloadCSV(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function mergeRecords(existingMap: Map<string, number>, incoming: Array<{ date: string; value: number }>) {
  const next = new Map(existingMap);
  for (const r of incoming) next.set(r.date, r.value);
  return next;
}

/* -----------------------------
   Main
----------------------------- */

export default function RatedCapacity() {
  // ----------------------------
  // Rated Capacity (top card)
  // ----------------------------
  const INSTALLED_KEY = "ratedCapacity_installed";
  const PLF_KEY = "ratedCapacity_plf";

  const [installed, setInstalled] = useState<Record<SourceKey, number>>(() => {
    const base = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<SourceKey, number>;
    try {
      const raw = localStorage.getItem(INSTALLED_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const s of SOURCES) base[s] = safeNum(obj?.[s]);
      }
    } catch {}
    return base;
  });

  const [plf, setPlf] = useState<Record<SourceKey, number>>(() => {
    const base = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<SourceKey, number>;
    try {
      const raw = localStorage.getItem(PLF_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const s of SOURCES) base[s] = safeNum(obj?.[s]);
      }
    } catch {}
    return base;
  });

  const [capacityCsvMissing, setCapacityCsvMissing] = useState(false);
  const [capacityCsvMsg, setCapacityCsvMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCapacitySingleRow() {
      try {
        const res = await fetch(`/data/Capacity.csv?v=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const { header, rows } = parseCSVSimple(text);
        if (!header.length || !rows.length) throw new Error("Empty CSV");

        const row = rows[0] || [];
        const map: Record<string, string> = {};
        header.forEach((h, i) => {
          map[h] = row[i] ?? "";
        });

        const next = { ...installed };
        let any = false;
        for (const s of SOURCES) {
          const v = safeNum(map[s]);
          if (Number.isFinite(v)) {
            next[s] = v;
            any = true;
          }
        }

        if (!cancelled && any) {
          setInstalled(next);
          setCapacityCsvMissing(false);
          setCapacityCsvMsg(null);
        }
      } catch {
        if (!cancelled) {
          setCapacityCsvMissing(true);
          setCapacityCsvMsg("Capacity.csv not loaded – enter values manually.");
        }
      }
    }

    const hasNonZeroLocal = Object.values(installed).some((v) => Number(v) !== 0);
    if (!hasNonZeroLocal) loadCapacitySingleRow();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(INSTALLED_KEY, JSON.stringify(installed));
    } catch {}
  }, [installed]);

  useEffect(() => {
    try {
      localStorage.setItem(PLF_KEY, JSON.stringify(plf));
    } catch {}
  }, [plf]);

  const installedTotal = useMemo(() => {
    return sumSources(installed as unknown as Record<string, number>, SOURCES);
  }, [installed]);

  const ratedBySource = useMemo(() => {
    const out: Record<SourceKey, number> = {} as any;
    for (const s of SOURCES) {
      out[s] = round2(safeNum(installed[s]) * (safeNum(plf[s]) / 100));
    }
    return out;
  }, [installed, plf]);

  const ratedTotal = useMemo(() => {
    return sumSources(ratedBySource as unknown as Record<string, number>, SOURCES);
  }, [ratedBySource]);

  // ----------------------------
  // Historical Capacity (monthly, from capacity.csv)
  // ----------------------------
  type MonthRow = { month: string; values: Record<SourceKey, number> };

  const [history, setHistory] = useState<MonthRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoadedFrom, setHistoryLoadedFrom] = useState<string | null>(null);

  const monthOptions = useMemo(() => {
    const opts = history.map((r) => r.month).filter(Boolean);
    return opts.slice().sort(compareMonthKey);
  }, [history]);

  const latestMonth = useMemo(() => {
    if (!monthOptions.length) return null;
    return monthOptions[monthOptions.length - 1];
  }, [monthOptions]);

  const defaultStartMonth = useMemo(() => {
    if (!latestMonth) return null;
    const candidate = minusMonths(latestMonth, 12);
    return clampMonthKeyToOptions(candidate, monthOptions);
  }, [latestMonth, monthOptions]);

  const [startMonth, setStartMonth] = useState<string>("");
  const [endMonth, setEndMonth] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        setHistoryError(null);

        // Try both lowercase and uppercase filenames (case-sensitive on Vercel)
        const { path, text } = await fetchTextWithFallback([
          "/data/capacity.csv",
          "/data/Capacity.csv",
        ]);

        const { header, rows } = parseCSVSimple(text);
        if (!header.length || !rows.length) throw new Error("Empty CSV");

        const normHeaders = header.map(normalizeHeader);

        const monthIdx = normHeaders.findIndex((h) => h === "month");
        if (monthIdx === -1) throw new Error(`Missing "Month" column`);

        const sourceIdx: Record<SourceKey, number> = {} as any;
        for (const s of SOURCES) {
          const want = normalizeHeader(s);
          const idx = normHeaders.findIndex((h) => h === want);
          sourceIdx[s] = idx;
        }

        const parsed: MonthRow[] = [];
        for (const row of rows) {
          const mkRaw = row[monthIdx] ?? "";
          const mk = normalizeMonth(mkRaw);
          if (!mk) continue;

          const values: Record<SourceKey, number> = {} as any;
          for (const s of SOURCES) {
            const idx = sourceIdx[s];
            values[s] = idx >= 0 ? safeNum(row[idx]) : 0;
          }
          parsed.push({ month: mk, values });
        }

        parsed.sort((a, b) => compareMonthKey(a.month, b.month));

        if (!cancelled) {
          setHistory(parsed);
          setHistoryLoadedFrom(path);
          setHistoryError(
            parsed.length
              ? null
              : `Loaded ${path} but found 0 valid Month rows. Ensure Month is MM/YYYY or DD/MM/YYYY.`
          );
        }
      } catch {
        if (!cancelled) {
          setHistory([]);
          setHistoryLoadedFrom(null);
          setHistoryError(
            "capacity.csv not loaded – ensure /public/data/capacity.csv (served at /data/capacity.csv) exists with Month + source columns."
          );
        }
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!monthOptions.length) return;

    const end = latestMonth || monthOptions[monthOptions.length - 1];
    const start =
      defaultStartMonth ||
      monthOptions[Math.max(0, monthOptions.length - 13)] ||
      monthOptions[0];

    setEndMonth((prev) => (prev ? clampMonthKeyToOptions(prev, monthOptions) : end));
    setStartMonth((prev) => (prev ? clampMonthKeyToOptions(prev, monthOptions) : start));
  }, [monthOptions, latestMonth, defaultStartMonth]);

  useEffect(() => {
    if (!startMonth || !endMonth) return;
    if (compareMonthKey(startMonth, endMonth) > 0) {
      setStartMonth(endMonth);
    }
  }, [startMonth, endMonth]);

  const startRow = useMemo(() => {
    if (!startMonth) return null;
    return history.find((r) => r.month === startMonth) || null;
  }, [history, startMonth]);

  const endRow = useMemo(() => {
    if (!endMonth) return null;
    return history.find((r) => r.month === endMonth) || null;
  }, [history, endMonth]);

  const startTotals = useMemo(() => {
    const vals = startRow?.values;
    if (!vals) return null;
    return { per: vals, total: sumSources(vals as any, SOURCES) };
  }, [startRow]);

  const endTotals = useMemo(() => {
    const vals = endRow?.values;
    if (!vals) return null;
    return { per: vals, total: sumSources(vals as any, SOURCES) };
  }, [endRow]);

  const netAdditions = useMemo(() => {
    const out: Record<SourceKey, number> = {} as any;
    for (const s of SOURCES) {
      const a = startTotals?.per?.[s];
      const b = endTotals?.per?.[s];
      if (a == null || b == null) out[s] = 0;
      else out[s] = round2(b - a);
    }
    const total = startTotals && endTotals ? round2(endTotals.total - startTotals.total) : 0;
    return { per: out, total };
  }, [startTotals, endTotals]);

  // ----------------------------
  // Daily Card (for Rated Capacity tab only)
  // ----------------------------
  const DAILY_KEY = "tusk_rated_capacity_daily_v1";
  const DAILY_VALUE_COL = "RatedCapacity_GW";

  const [dailyMap, setDailyMap] = useState<Map<string, number>>(() => {
    try {
      const raw = localStorage.getItem(DAILY_KEY);
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      const m = new Map<string, number>();
      for (const [k, v] of Object.entries(obj || {})) {
        const d = parseISOKey(k);
        const n = Number(v);
        if (d && Number.isFinite(n)) m.set(d, n);
      }
      return m;
    } catch {
      return new Map();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DAILY_KEY, JSON.stringify(Object.fromEntries(dailyMap.entries())));
    } catch {}
  }, [dailyMap]);

  const dailySorted = useMemo(() => {
    return Array.from(dailyMap.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => sortISO(a.date, b.date));
  }, [dailyMap]);

  const hasDaily = dailySorted.length > 0;

  const [dailyDateText, setDailyDateText] = useState(() => {
    const t = new Date();
    const dd = String(t.getDate()).padStart(2, "0");
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const yyyy = t.getFullYear();
    return `${dd}-${mm}-${yyyy}`; // keep same UI behavior
  });
  const [dailyValueText, setDailyValueText] = useState("");
  const [dailyMsg, setDailyMsg] = useState<string | null>(null);
  const [dailyErrors, setDailyErrors] = useState<string[]>([]);
  const dailyFileRef = useRef<HTMLInputElement | null>(null);

  const [rangeDays, setRangeDays] = useState(730);
  const [fromIso, setFromIso] = useState("");
  const [toIso, setToIso] = useState("");

  const dailyLookup = useMemo(() => new Map(dailySorted.map((d) => [d.date, d.value] as const)), [dailySorted]);

  useEffect(() => {
    if (!dailySorted.length) return;
    const lastIso = dailySorted[dailySorted.length - 1].date;
    if (!toIso) setToIso(lastIso);
    if (!fromIso) setFromIso(isoMinusDays(lastIso, clamp(rangeDays, 7, 3650)));
  }, [dailySorted, toIso, fromIso, rangeDays]);

  const fmtDailyValue = (x: number | null | undefined) => {
    if (x == null || Number.isNaN(x)) return "—";
    const rounded = Number(x.toFixed(2));
    return `${new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(rounded)}`;
  };

  const fmtPct = (x: number | null | undefined) => {
    if (x == null || Number.isNaN(x)) return "—";
    const sign = x > 0 ? "+" : "";
    return `${sign}${Number(x.toFixed(2)).toFixed(2)}%`;
  };

  const dailyChart = useMemo(() => {
    if (!dailySorted.length) return [];
    const lastIso = dailySorted[dailySorted.length - 1].date;
    const effectiveTo = toIso || lastIso;
    const effectiveFrom = fromIso || isoMinusDays(lastIso, clamp(rangeDays, 7, 3650));
    const f = effectiveFrom <= effectiveTo ? effectiveFrom : effectiveTo;
    const t = effectiveFrom <= effectiveTo ? effectiveTo : effectiveFrom;

    const out: Array<{
      label: string;
      units: number;
      prev_year_units: number | null;
      yoy_pct: number | null;
    }> = [];

    let cur = f;
    while (cur <= t) {
      const v = dailyLookup.get(cur);
      if (v != null) {
        const py = `${Number(cur.slice(0, 4)) - 1}${cur.slice(4)}`;
        const pyVal = dailyLookup.get(py) ?? null;
        out.push({
          label: formatDDMMYYYY(cur),
          units: v,
          prev_year_units: pyVal,
          yoy_pct: pyVal != null ? growthPct(v, pyVal) : null,
        });
      }
      cur = isoPlusDays(cur, 1);
      if (out.length > 5000) break;
    }

    return out;
  }, [dailySorted, dailyLookup, fromIso, toIso, rangeDays]);

  const leftAxisDomain = useMemo(() => {
    const vals: Array<number | null> = [];
    for (const p of dailyChart) {
      vals.push(p.units);
      vals.push(p.prev_year_units);
    }
    return computeDomain(vals, 0.05, 0.5);
  }, [dailyChart]);

  const rightAxisDomain = useMemo(() => {
    const vals: Array<number | null> = [];
    for (const p of dailyChart) vals.push(p.yoy_pct);
    return computeDomain(vals, 0.05, 1);
  }, [dailyChart]);

  function upsertDaily() {
    setDailyMsg(null);
    setDailyErrors([]);

    const iso = parseInputDate(dailyDateText);
    if (!iso) {
      setDailyErrors(["Please enter a valid date (DD-MM-YYYY or DD/MM/YYYY)."]);
      return;
    }
    const v = Number(String(dailyValueText).replace(/,/g, ""));
    if (!Number.isFinite(v)) {
      setDailyErrors(["Please enter a valid number."]);
      return;
    }

    setDailyMap((prev) => {
      const next = new Map(prev);
      next.set(iso, v);
      return next;
    });

    setDailyMsg(`Saved ${formatDDMMYYYY(iso)}: ${fmtDailyValue(v)} GW`);
    setDailyValueText("");
  }

  function removeDaily(isoDate: string) {
    setDailyMap((prev) => {
      const next = new Map(prev);
      next.delete(isoDate);
      return next;
    });
  }

  function clearDaily() {
    if (!confirm(`Clear all stored daily data for Rated Capacity from this browser?`)) return;
    setDailyMap(new Map());
    setDailyMsg("Cleared all daily data.");
  }

  async function importDailyCSV(file?: File) {
    setDailyMsg(null);
    setDailyErrors([]);
    if (!file) return;

    try {
      const text = await file.text();
      const { parsed, errors } = csvParseDaily(text);
      if (errors.length) setDailyErrors(errors.slice(0, 12));
      if (!parsed.length) {
        setDailyErrors((e) => (e.length ? e : ["No valid rows found in CSV."]));
        return;
      }
      setDailyMap((prev) => mergeRecords(prev, parsed));
      setDailyMsg(`Imported ${parsed.length} rows${errors.length ? ` (with ${errors.length} issues)` : ""}.`);
    } catch {
      setDailyErrors(["Could not read CSV."]);
    } finally {
      if (dailyFileRef.current) dailyFileRef.current.value = "";
    }
  }

  function exportDailyCSV() {
    const header = `date,${DAILY_VALUE_COL}`;
    const lines = dailySorted.map((d) => `${formatDDMMYYYYForCSV(d.date)},${d.value}`);
    downloadCSV(
      `rated_capacity_daily_${new Date().toISOString().slice(0, 10)}.csv`,
      [header, ...lines].join("\n")
    );
  }

  function downloadSampleDailyCSV() {
    downloadCSV(`sample_rated_capacity_daily.csv`, sampleDailyCSV(DAILY_VALUE_COL));
  }

  // ----------------------------
  // Render
  // ----------------------------
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-1 gap-6">
          {/* ===========================
              Rated Capacity (existing)
              =========================== */}
          <Card title="Rated Capacity" right={<div className="text-xs text-slate-500">GW</div>}>
            {capacityCsvMissing && capacityCsvMsg ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {capacityCsvMsg}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
              <table className="w-full border-collapse bg-white text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-700">
                      <span className="font-bold text-slate-900">Capacity (GW)</span>
                    </th>
                    {SOURCES.map((s) => (
                      <th
                        key={s}
                        className="px-3 py-2 text-xs font-semibold text-slate-700 text-right"
                      >
                        {s}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-xs font-semibold text-slate-700 text-right">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">
                      Capacity as on current date
                    </td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={installed[s]}
                          onChange={(e) => {
                            const v = safeNum(e.target.value);
                            setInstalled((prev) => ({ ...prev, [s]: v }));
                          }}
                          className={numberInputClass()}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {fmt2(installedTotal)}
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">PLF %</td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          max={100}
                          value={plf[s]}
                          onChange={(e) => {
                            const v = safeNum(e.target.value);
                            setPlf((prev) => ({ ...prev, [s]: v }));
                          }}
                          className={numberInputClass()}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-500">
                      —
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">Rated Capacity</td>
                    {SOURCES.map((s) => (
                      <td
                        key={s}
                        className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900"
                      >
                        {fmt2(ratedBySource[s])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {fmt2(ratedTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              Rated Capacity (GW) = Installed Capacity × (PLF / 100). Values are editable and saved locally in your browser.
            </div>
          </Card>

          {/* ===========================
              Historical Capacity (MONTH PICKERS)
              =========================== */}
          <Card title="Historical Capacity" right={<div className="text-xs text-slate-500">GW</div>}>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-slate-600">Start Month/Year</div>
                <input
                  type="month"
                  value={monthKeyToInputValue(startMonth)}
                  onChange={(e) => {
                    const mk = inputValueToMonthKey(e.target.value);
                    if (!mk) return;
                    // clamp to available months
                    setStartMonth(clampMonthKeyToOptions(mk, monthOptions));
                  }}
                  min={monthOptions.length ? monthKeyToInputValue(monthOptions[0]) : undefined}
                  max={endMonth ? monthKeyToInputValue(endMonth) : undefined}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-600">End Month/Year</div>
                <input
                  type="month"
                  value={monthKeyToInputValue(endMonth)}
                  onChange={(e) => {
                    const mk = inputValueToMonthKey(e.target.value);
                    if (!mk) return;
                    setEndMonth(clampMonthKeyToOptions(mk, monthOptions));
                  }}
                  min={startMonth ? monthKeyToInputValue(startMonth) : undefined}
                  max={latestMonth ? monthKeyToInputValue(latestMonth) : undefined}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            </div>

            {historyError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {historyError}
              </div>
            ) : historyLoadedFrom ? (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Loaded from: <span className="font-semibold">{historyLoadedFrom}</span>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
              {/* ✅ make numbers same size as Rated Capacity table: text-sm */}
              <table className="w-full table-fixed border-collapse bg-white text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="w-[170px] px-3 py-2 text-xs font-semibold text-slate-700">
                      <span className="font-bold text-slate-900">Capacity (GW)</span>
                    </th>
                    {SOURCES.map((s) => (
                      <th
                        key={s}
                        className="px-3 py-2 text-xs font-semibold text-slate-700 text-right whitespace-normal break-words"
                      >
                        {s}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-xs font-semibold text-slate-700 text-right">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">
                      Capacity as on Start Date ({startMonth || "—"})
                    </td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {startTotals ? fmt2(startTotals.per[s]) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {startTotals ? fmt2(startTotals.total) : "—"}
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">
                      Capacity as on End Date ({endMonth || "—"})
                    </td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {endTotals ? fmt2(endTotals.per[s]) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {endTotals ? fmt2(endTotals.total) : "—"}
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">Net Addition (GW)</td>
                    {SOURCES.map((s) => {
                      const v = netAdditions.per[s];
                      const cls = netColorClass(v);
                      const sign = v > 0 ? "+" : "";
                      return (
                        <td
                          key={s}
                          className={`px-3 py-2 text-right font-semibold tabular-nums ${cls}`}
                        >
                          {startTotals && endTotals ? `${sign}${fmt2(v)}` : "—"}
                        </td>
                      );
                    })}
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        startTotals && endTotals ? netColorClass(netAdditions.total) : "text-slate-700"
                      }`}
                    >
                      {startTotals && endTotals
                        ? `${netAdditions.total > 0 ? "+" : ""}${fmt2(netAdditions.total)}`
                        : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              Net Addition (GW) = Capacity at End Date − Capacity at Start Date. Data sourced from monthly capacity.csv.
            </div>
          </Card>

          {/* ===========================
              Daily Card (copied UX structure from RTM Daily card)
              =========================== */}
          <Card
            title="Daily Rated Capacity"
            right={
              hasDaily ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Range</span>
                  <select
                    value={rangeDays}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRangeDays(v);
                      if (dailySorted.length) {
                        const lastIso = dailySorted[dailySorted.length - 1].date;
                        setToIso(lastIso);
                        setFromIso(isoMinusDays(lastIso, clamp(v, 7, 3650)));
                      }
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
                  >
                    <option value={60}>Last 60 days</option>
                    <option value={120}>Last 120 days</option>
                    <option value={365}>Last 12 months</option>
                    <option value={730}>Last 24 months</option>
                    <option value={1825}>Last 5 years</option>
                    <option value={3650}>Last 10 years</option>
                  </select>
                </div>
              ) : null
            }
          >
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={downloadSampleDailyCSV}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Download sample CSV
              </button>

              <button
                onClick={exportDailyCSV}
                disabled={!hasDaily}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
              >
                Export CSV
              </button>

              <button
                onClick={clearDaily}
                disabled={!hasDaily}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-rose-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
              >
                Clear data
              </button>
            </div>

            {!hasDaily ? (
              <div className="text-sm text-slate-600">
                Add datapoints or import a CSV to view the daily chart.
              </div>
            ) : (
              <>
                {/* Controls */}
                <div className="mb-3 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-slate-600">From</div>
                      <input
                        type="date"
                        value={fromIso}
                        onChange={(e) => setFromIso(e.target.value)}
                        className="mt-1 w-full min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                      />
                      <div className="mt-1 text-[12px] font-medium text-slate-600 tabular-nums">
                        {fromIso ? formatDDMMYY(fromIso) : ""}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-slate-600">To</div>
                      <input
                        type="date"
                        value={toIso}
                        onChange={(e) => setToIso(e.target.value)}
                        className="mt-1 w-full min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                      />
                      <div className="mt-1 text-[12px] font-medium text-slate-600 tabular-nums">
                        {toIso ? formatDDMMYY(toIso) : ""}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-[380px] sm:h-[460px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyChart} margin={{ top: 12, right: 42, bottom: 12, left: 42 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={24} />

                      <YAxis
                        yAxisId="left"
                        width={92}
                        tickMargin={10}
                        domain={leftAxisDomain ?? ["auto", "auto"]}
                        padding={{ top: 10, bottom: 10 }}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => {
                          const n = asFiniteNumber(v);
                          if (n == null) return "—";
                          return new Intl.NumberFormat("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }).format(Number(n.toFixed(2)));
                        }}
                      />

                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        width={84}
                        tickMargin={10}
                        domain={rightAxisDomain ?? ["auto", "auto"]}
                        padding={{ top: 10, bottom: 10 }}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => {
                          const n = asFiniteNumber(v);
                          return n == null ? "—" : `${Number(n.toFixed(2)).toFixed(2)}%`;
                        }}
                      />

                      <Tooltip
                        wrapperStyle={{ outline: "none" }}
                        formatter={(v: any, name: any, item: any) => {
                          const key = (item && (item.dataKey as string)) || (name as string);
                          const num = asFiniteNumber(v);
                          if (key === "units") return [`${fmtDailyValue(num)} GW`, "Rated Capacity"];
                          if (key === "prev_year_units") return [`${fmtDailyValue(num)} GW`, "Previous year"];
                          if (key === "yoy_pct") return [fmtPct(num), "YoY %"];
                          return [v, String(name)];
                        }}
                      />
                      <Legend />

                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="units"
                        name="Rated Capacity"
                        dot={false}
                        strokeWidth={2}
                        stroke="#dc2626"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="prev_year_units"
                        name="Previous year"
                        dot={false}
                        strokeWidth={2}
                        stroke="#6b7280"
                        connectNulls
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="yoy_pct"
                        name="YoY %"
                        dot={false}
                        strokeWidth={2}
                        stroke="#16a34a"
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {/* Add/Update + Import */}
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                  <div className="text-sm font-semibold text-slate-800">Add / Update a day</div>

                  <div className="mt-3 grid grid-cols-1 gap-3">
                    <label className="text-xs font-medium text-slate-600">Date (DD-MM-YYYY)</label>
                    <input
                      type="text"
                      placeholder="DD-MM-YYYY"
                      value={dailyDateText}
                      onChange={(e) => setDailyDateText(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                    />

                    <label className="mt-1 text-xs font-medium text-slate-600">Rated Capacity (GW)</label>
                    <input
                      inputMode="decimal"
                      placeholder="e.g., 261.72"
                      value={dailyValueText}
                      onChange={(e) => setDailyValueText(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                    />

                    <button
                      onClick={upsertDaily}
                      className="mt-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Save day
                    </button>

                    <div className="mt-2">
                      <div className="text-xs font-medium text-slate-600">Import CSV</div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          ref={dailyFileRef}
                          type="file"
                          accept=".csv,text/csv"
                          onChange={(e) => importDailyCSV(e.target.files?.[0])}
                          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
                        />
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        Supported: <span className="font-mono">date,VALUE</span> (DD/MM/YYYY, number)
                      </div>
                    </div>

                    {dailyMsg ? (
                      <div className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
                        {dailyMsg}
                      </div>
                    ) : null}

                    {dailyErrors.length ? (
                      <div className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
                        <div className="font-semibold">Import / input issues</div>
                        <ul className="mt-1 list-disc pl-5">
                          {dailyErrors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Recent entries */}
              <div className="lg:col-span-2">
                <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">Recent entries</div>
                    <div className="text-xs text-slate-500">
                      {hasDaily ? `Records: ${dailySorted.length}` : "No data"}
                    </div>
                  </div>

                  {!hasDaily ? (
                    <div className="mt-3 text-sm text-slate-600">
                      Once you add data, the most recent entries will appear here.
                    </div>
                  ) : (
                    <div className="mt-3 max-h-[420px] overflow-auto rounded-xl ring-1 ring-slate-200">
                      <table className="w-full border-collapse bg-white text-left text-sm">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-600">Date</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-600">Rated Capacity (GW)</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-600"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailySorted
                            .slice(-25)
                            .reverse()
                            .map((r) => (
                              <tr key={r.date} className="border-t border-slate-100">
                                <td className="px-3 py-2 font-medium text-slate-900">
                                  {formatDDMMYYYY(r.date)}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {fmtDailyValue(r.value)} GW
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() => removeDaily(r.date)}
                                    className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="mt-3 text-xs text-slate-500">
                    Tip: Use this for daily snapshots (manual or CSV). This does not affect any other tab.
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
