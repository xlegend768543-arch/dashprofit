import {
  DEFAULT_SETTINGS,
  computeDailySummary,
  evaluateOffer,
  getLocalDateKey,
  sanitizeSettings,
} from './calculator.js';

const SETTINGS_KEY = 'dashprofit_settings_v1';
const ORDERS_KEY = 'dashprofit_orders_v1';
const DAILY_MILEAGE_KEY = 'dashprofit_daily_mileage_v1';
const EXPENSES_KEY = 'dashprofit_expenses_v1';
const LIVE_SESSION_KEY = 'dashprofit_live_session_v1';

const debounceTimers = new Map();

function getStorage() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function debounceWrite(key, fn, delayMs = 300) {
  if (debounceTimers.has(key)) {
    clearTimeout(debounceTimers.get(key));
  }
  const t = setTimeout(() => {
    debounceTimers.delete(key);
    fn();
  }, delayMs);
  debounceTimers.set(key, t);
}

export function loadSettings() {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
}

export function saveSettingsDebounced(settings, delayMs = 300) {
  debounceWrite(SETTINGS_KEY, () => saveSettings(settings), delayMs);
}

export function migrateOrder(order) {
  if (!order || typeof order !== 'object') return order;
  const isSample = Boolean(order.isSample) || String(order.id || '').startsWith('sample-');
  return { ...order, isSample };
}

export function loadOrders() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let migrated = false;
    const result = parsed.map((o) => {
      const m = migrateOrder(o);
      if (m.isSample !== Boolean(o && o.isSample)) migrated = true;
      return m;
    });
    if (migrated) saveOrders(result);
    return result;
  } catch {
    return [];
  }
}

export function saveOrders(orders) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

export function saveOrdersDebounced(orders, delayMs = 300) {
  debounceWrite(ORDERS_KEY, () => saveOrders(orders), delayMs);
}

export function emptyDailyRecord() {
  return {
    entries: [],
    gpsSavedMiles: 0,
    startOdometer: null,
    endOdometer: null,
    shiftSeconds: 0,
  };
}

export function normalizeDailyRecord(raw, dateKey = getLocalDateKey()) {
  const base = emptyDailyRecord();
  if (!raw || typeof raw !== 'object') return base;

  let entries = Array.isArray(raw.entries)
    ? raw.entries
        .filter((e) => e && Number.isFinite(Number(e.miles)) && Number(e.miles) > 0)
        .map((e) => ({
          id: String(e.id || `man-${Date.now()}`),
          timestamp: Number(e.timestamp) || Date.now(),
          miles: Number(e.miles),
          kind: ['quick', 'custom', 'odometer'].includes(e.kind) ? e.kind : 'custom',
        }))
    : [];

  // Migrate legacy scalar manualMiles -> entry list
  if (!Array.isArray(raw.entries) && Number(raw.manualMiles) > 0) {
    entries = [
      {
        id: `migrated-${dateKey}`,
        timestamp: Date.now(),
        miles: Number(raw.manualMiles),
        kind: 'custom',
      },
    ];
  }

  return {
    entries,
    gpsSavedMiles: Math.max(0, Number(raw.gpsSavedMiles) || 0),
    startOdometer:
      raw.startOdometer !== null && raw.startOdometer !== undefined && Number.isFinite(Number(raw.startOdometer))
        ? Number(raw.startOdometer)
        : null,
    endOdometer:
      raw.endOdometer !== null && raw.endOdometer !== undefined && Number.isFinite(Number(raw.endOdometer))
        ? Number(raw.endOdometer)
        : null,
    shiftSeconds: Math.max(0, Math.round(Number(raw.shiftSeconds) || 0)),
  };
}

export function loadAllDailyMileage() {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(DAILY_MILEAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = normalizeDailyRecord(v, k);
    }
    return out;
  } catch {
    return {};
  }
}

export function loadDailyMileage(dateKey) {
  const all = loadAllDailyMileage();
  return all[dateKey] || emptyDailyRecord();
}

export function saveDailyMileage(dateKey, data) {
  const storage = getStorage();
  if (!storage) return;
  try {
    const all = loadAllDailyMileage();
    all[dateKey] = normalizeDailyRecord(data, dateKey);
    storage.setItem(DAILY_MILEAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage quota errors
  }
}

export function saveDailyMileageDebounced(dateKey, data, delayMs = 300) {
  debounceWrite(`${DAILY_MILEAGE_KEY}:${dateKey}`, () => saveDailyMileage(dateKey, data), delayMs);
}

export function addManualEntryToRecord(record, miles, kind = 'quick') {
  const val = Number(miles);
  if (!(val > 0)) return record;
  const entry = {
    id: `man-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    miles: val,
    kind,
  };
  return {
    ...record,
    entries: [...(record.entries || []), entry],
  };
}

export function undoLastManualEntryInRecord(record) {
  const entries = [...(record.entries || [])];
  if (entries.length === 0) return { nextRecord: record, removed: null };
  const removed = entries.pop();
  const hasOdo = entries.some((e) => e.kind === 'odometer');
  return {
    nextRecord: {
      ...record,
      entries,
      startOdometer: hasOdo ? record.startOdometer : null,
      endOdometer: hasOdo ? record.endOdometer : null,
    },
    removed,
  };
}

export function removeManualEntryById(record, id) {
  const entries = (record.entries || []).filter((e) => e.id !== id);
  const hasOdo = entries.some((e) => e.kind === 'odometer');
  return {
    ...record,
    entries,
    startOdometer: hasOdo ? record.startOdometer : null,
    endOdometer: hasOdo ? record.endOdometer : null,
  };
}

export function applyOdometerToRecord(record, start, end) {
  const diff = Math.max(0, end - start);
  const withoutOldOdo = (record.entries || []).filter((e) => e.kind !== 'odometer');
  const odoEntry = {
    id: `odo-${Date.now()}`,
    timestamp: Date.now(),
    miles: diff,
    kind: 'odometer',
  };
  return {
    ...record,
    entries: [...withoutOldOdo, odoEntry],
    startOdometer: start,
    endOdometer: end,
  };
}

export function saveLiveSessionDraft(draft) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(LIVE_SESSION_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage errors
  }
}

export function clearLiveSessionDraft() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(LIVE_SESSION_KEY);
}

/**
 * Recovers an unfinished GPS / shift draft from an earlier crash or tab close.
 * Folds its GPS miles and elapsed shift seconds into the draft's dateKey.
 */
export function recoverLiveSessionDraft() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LIVE_SESSION_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    storage.removeItem(LIVE_SESSION_KEY);
    if (!draft || typeof draft !== 'object' || !draft.dateKey) return null;

    const gpsMiles = Math.max(0, Number(draft.gpsSessionMiles) || 0);
    const shiftStartedAt = Number(draft.shiftStartedAt) || 0;
    const lastSavedAt = Number(draft.updatedAt) || Date.now();
    const extraShiftSecs =
      draft.isShiftTiming && shiftStartedAt > 0
        ? Math.max(0, Math.round((lastSavedAt - shiftStartedAt) / 1000))
        : 0;

    if (gpsMiles <= 0 && extraShiftSecs <= 0) return null;

    const record = loadDailyMileage(draft.dateKey);
    record.gpsSavedMiles += gpsMiles;
    record.shiftSeconds += extraShiftSecs;
    saveDailyMileage(draft.dateKey, record);
    return { dateKey: draft.dateKey, gpsMiles, extraShiftSecs };
  } catch {
    storage.removeItem(LIVE_SESSION_KEY);
    return null;
  }
}

export function loadExpenses() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(EXPENSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExpenses(expenses) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(EXPENSES_KEY, JSON.stringify(expenses));
}

export function createSampleOrders(settings) {
  const now = Date.now();
  const samples = [
    { payout: 11.50, miles: 3.1, minutes: 17, deadheadMultiplier: 1, waitMinutes: 0, orderType: 'food', merchant: 'Chipotle', decision: 'take', offsetMin: 180 },
    { payout: 18.25, miles: 6.4, minutes: 32, deadheadMultiplier: 1, waitMinutes: 5, orderType: 'shop', merchant: 'Target (6 items)', decision: 'take', offsetMin: 140 },
    { payout: 4.50, miles: 5.8, minutes: 22, deadheadMultiplier: 1.5, waitMinutes: 5, orderType: 'food', merchant: 'Popeyes', decision: 'pass', offsetMin: 115 },
    { payout: 14.00, miles: 4.2, minutes: 24, deadheadMultiplier: 1, waitMinutes: 0, orderType: 'stack', merchant: 'Panera + Starbucks', decision: 'take', offsetMin: 95 },
    { payout: 9.75, miles: 2.3, minutes: 15, deadheadMultiplier: 1, waitMinutes: 0, orderType: 'food', merchant: 'Chick-fil-A', decision: 'take', offsetMin: 60 },
    { payout: 13.00, miles: 9.4, minutes: 34, deadheadMultiplier: 2, waitMinutes: 0, orderType: 'food', merchant: 'Outback', decision: 'pass', offsetMin: 35 },
    { payout: 16.50, miles: 4.9, minutes: 26, deadheadMultiplier: 1, waitMinutes: 0, orderType: 'food', merchant: 'Sushi Bar', decision: 'take', offsetMin: 15 },
  ];

  return samples.map((s, idx) => {
    const metrics = evaluateOffer(s, settings);
    return {
      id: `sample-${now}-${idx}`,
      timestamp: now - s.offsetMin * 60000,
      merchant: s.merchant,
      orderType: s.orderType,
      deadheadMultiplier: s.deadheadMultiplier,
      waitMinutes: s.waitMinutes,
      decision: s.decision,
      isSample: true,
      ...metrics,
    };
  });
}

function escapeCsv(val) {
  const str = String(val ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function buildOrdersCsv(orders) {
  const headers = [
    'Date',
    'Decision',
    'Merchant',
    'OrderType',
    'Payout',
    'ShownMiles',
    'EffectiveMiles',
    'EffectiveMinutes',
    'VehicleCost',
    'NetProfit',
    'NetHourly',
    'EffectivePerMile',
    'TaxDeduction',
    'Score',
    'IsSample',
  ];

  const rows = orders.map((o) => [
    new Date(o.timestamp).toISOString(),
    o.decision,
    o.merchant || '',
    o.orderType,
    Number(o.payout).toFixed(2),
    Number(o.shownMiles).toFixed(1),
    Number(o.effectiveMiles).toFixed(1),
    o.effectiveMinutes,
    Number(o.vehicleCost).toFixed(2),
    Number(o.netProfit).toFixed(2),
    Number(o.netHourly).toFixed(2),
    Number(o.effectivePerMile).toFixed(2),
    Number(o.taxDeduction).toFixed(2),
    o.score,
    o.isSample ? 'true' : 'false',
  ]);

  return [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
}

export function buildMileageLogCsv({
  orders = [],
  dailyDataByDate = {},
  expenses = [],
  settings = DEFAULT_SETTINGS,
}) {
  const headers = [
    'Date',
    'StartOdometer',
    'EndOdometer',
    'TripEstMiles',
    'GPSMiles',
    'ManualMiles',
    'BusinessMiles',
    'MilesSource',
    'StandardRate',
    'MileageDeduction',
    'OtherExpenses',
    'TotalDeductions',
    'BusinessPurpose',
  ];

  const dateKeys = new Set();
  for (const o of orders) {
    if (o && !o.isSample && o.decision === 'take') {
      dateKeys.add(getLocalDateKey(o.timestamp));
    }
  }
  for (const k of Object.keys(dailyDataByDate || {})) {
    dateKeys.add(k);
  }
  for (const e of expenses) {
    if (e) dateKeys.add(getLocalDateKey(e.timestamp));
  }

  const sortedDates = Array.from(dateKeys).sort();
  const rows = [];

  for (const dateKey of sortedDates) {
    const rec = normalizeDailyRecord((dailyDataByDate && dailyDataByDate[dateKey]) || null, dateKey);
    const summary = computeDailySummary({
      orders,
      manualEntries: rec.entries,
      gpsMiles: rec.gpsSavedMiles,
      expenses,
      settings,
      dateKey,
    });
    if (summary.totalMiles <= 0 && summary.otherExpenses <= 0 && summary.grossEarnings <= 0) {
      continue;
    }
    rows.push([
      dateKey,
      rec.startOdometer !== null ? rec.startOdometer.toFixed(1) : '',
      rec.endOdometer !== null ? rec.endOdometer.toFixed(1) : '',
      summary.tripMiles.toFixed(2),
      summary.gpsMiles.toFixed(2),
      summary.manualMiles.toFixed(2),
      summary.totalMiles.toFixed(2),
      summary.milesSource,
      summary.irsRate.toFixed(2),
      summary.taxDeduction.toFixed(2),
      summary.otherExpenses.toFixed(2),
      summary.totalDeductions.toFixed(2),
      'DoorDash delivery',
    ]);
  }

  return [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
}

export function buildExpensesCsv(expenses = []) {
  const headers = ['Date', 'Category', 'Amount', 'Note'];
  const rows = expenses.map((e) => [
    getLocalDateKey(e.timestamp),
    e.category || 'Other',
    Number(e.amount).toFixed(2),
    e.note || '',
  ]);
  return [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
}

function triggerCsvDownload(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportOrdersToCsv(orders) {
  const csv = buildOrdersCsv(orders);
  triggerCsvDownload(csv, `dashprofit-orders-${getLocalDateKey()}.csv`);
}

export function exportMileageLogToCsv(params) {
  const csv = buildMileageLogCsv(params);
  triggerCsvDownload(csv, `dashprofit-mileage-log-${getLocalDateKey()}.csv`);
}

export function exportExpensesToCsv(expenses) {
  const csv = buildExpensesCsv(expenses);
  triggerCsvDownload(csv, `dashprofit-expenses-${getLocalDateKey()}.csv`);
}
