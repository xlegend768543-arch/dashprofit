/**
 * Pure calculation engine for DoorDash offer profitability and efficiency.
 */

export const DEFAULT_SETTINGS = {
  minNetHourly: 22.0,
  minPerMile: 1.75,
  minPayout: 6.5,
  mpg: 28,
  gasPrice: 3.65,
  wearPerMile: 0.12,
  // Standard mileage rate. Default left at 0.70 (user-editable); verify the current rate at irs.gov.
  irsRate: 0.70,
  dailyGoal: 150,
  incomeTaxSetAsidePct: 0.10,
};

/**
 * Parses and clamps a numeric value, preserving 0 when min <= 0.
 * Empty, null, boolean, or non-finite values fall back to `fallback`.
 */
export function cleanNumber(val, fallback, min = 0, max = Infinity) {
  if (val === '' || val === null || val === undefined || typeof val === 'boolean') {
    return fallback;
  }
  const n = typeof val === 'number' ? val : Number(String(val).trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Single source of truth for sanitizing settings across load/save/UI/calculations.
 * Allows 0 for wearPerMile, gasPrice, irsRate, dailyGoal, incomeTaxSetAsidePct, minPayout.
 */
export function sanitizeSettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    minNetHourly: cleanNumber(src.minNetHourly, DEFAULT_SETTINGS.minNetHourly, 0),
    minPerMile: cleanNumber(src.minPerMile, DEFAULT_SETTINGS.minPerMile, 0),
    minPayout: cleanNumber(src.minPayout, DEFAULT_SETTINGS.minPayout, 0),
    mpg: cleanNumber(src.mpg, DEFAULT_SETTINGS.mpg, 1),
    gasPrice: cleanNumber(src.gasPrice, DEFAULT_SETTINGS.gasPrice, 0),
    wearPerMile: cleanNumber(src.wearPerMile, DEFAULT_SETTINGS.wearPerMile, 0),
    irsRate: cleanNumber(src.irsRate, DEFAULT_SETTINGS.irsRate, 0),
    dailyGoal: cleanNumber(src.dailyGoal, DEFAULT_SETTINGS.dailyGoal, 0),
    incomeTaxSetAsidePct: cleanNumber(src.incomeTaxSetAsidePct, DEFAULT_SETTINGS.incomeTaxSetAsidePct, 0, 0.5),
  };
}

/**
 * Computes total operating cost per mile (fuel + wear/maintenance).
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {number}
 */
export function getCostPerMile(settings) {
  const s = sanitizeSettings(settings);
  return s.gasPrice / s.mpg + s.wearPerMile;
}

/**
 * Evaluates a single DoorDash offer.
 * @param {Object} offer
 * @param {number} offer.payout
 * @param {number} offer.miles
 * @param {number} offer.minutes
 * @param {number} [offer.deadheadMultiplier=1]
 * @param {number} [offer.waitMinutes=0]
 * @param {string} [offer.orderType='food']
 * @param {typeof DEFAULT_SETTINGS} settings
 */
export function evaluateOffer(offer, settings) {
  const s = sanitizeSettings(settings);
  const payout = Number(offer.payout);
  const shownMiles = Number(offer.miles);
  const estMinutes = Number(offer.minutes);
  const deadheadMultiplier = cleanNumber(offer.deadheadMultiplier, 1, 1);
  const waitMinutes = cleanNumber(offer.waitMinutes, 0, 0);

  if (!(payout > 0) || !(shownMiles >= 0) || !(estMinutes > 0)) {
    return null;
  }

  const effectiveMiles = Math.max(0.1, shownMiles * deadheadMultiplier);
  const effectiveMinutes = Math.max(1, estMinutes + waitMinutes);

  const costPerMile = getCostPerMile(s);
  const vehicleCost = effectiveMiles * costPerMile;
  const netProfit = payout - vehicleCost;

  const grossHourly = (payout / effectiveMinutes) * 60;
  const netHourly = (netProfit / effectiveMinutes) * 60;

  const grossPerMile = shownMiles > 0 ? payout / shownMiles : payout;
  const effectivePerMile = payout / effectiveMiles;
  const taxDeduction = effectiveMiles * s.irsRate;

  // Efficiency Score (0 - 100)
  const hourlyRatio = netHourly / Math.max(1, s.minNetHourly);
  const mileRatio = effectivePerMile / Math.max(0.1, s.minPerMile);
  const payoutPenalty = payout < s.minPayout ? 18 : 0;

  const rawScore = (hourlyRatio * 55 + mileRatio * 45) - payoutPenalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Verdict
  const meetsHourly = netHourly >= s.minNetHourly;
  const meetsMile = effectivePerMile >= s.minPerMile;
  const meetsPayout = payout >= s.minPayout;

  let verdict = 'pass';
  let verdictLabel = 'PASS / DECLINE';
  let verdictTitle = 'Below your targets';

  if (meetsHourly && meetsMile && meetsPayout) {
    verdict = 'take';
    verdictLabel = 'STRONG TAKE';
    verdictTitle = score >= 90 ? 'High-efficiency order' : 'Meets all profit rules';
  } else if (
    netHourly >= s.minNetHourly * 0.85 &&
    effectivePerMile >= s.minPerMile * 0.85 &&
    payout >= s.minPayout * 0.85
  ) {
    verdict = 'maybe';
    verdictLabel = 'BORDERLINE';
    verdictTitle = 'Take only if slow or heading home';
  } else {
    verdict = 'pass';
    verdictLabel = 'PASS / DECLINE';
    if (!meetsPayout) {
      verdictTitle = `Below $${s.minPayout.toFixed(2)} minimum`;
    } else if (!meetsMile) {
      verdictTitle = 'Too many miles for the pay';
    } else {
      verdictTitle = 'Too slow for your hourly goal';
    }
  }

  const reasons = [];
  if (deadheadMultiplier > 1) {
    reasons.push(`${effectiveMiles.toFixed(1)} eff. mi`);
  }
  if (waitMinutes > 0) {
    reasons.push(`+${waitMinutes}m wait`);
  }
  const reasonPrefix = reasons.length ? `Includes ${reasons.join(', ')} • ` : '';
  const reason = `${reasonPrefix}Nets $${netProfit.toFixed(2)} after $${vehicleCost.toFixed(2)} car cost.`;

  return {
    payout,
    shownMiles,
    effectiveMiles,
    estMinutes,
    effectiveMinutes,
    costPerMile,
    vehicleCost,
    netProfit,
    grossHourly,
    netHourly,
    grossPerMile,
    effectivePerMile,
    taxDeduction,
    score,
    verdict,
    verdictLabel,
    verdictTitle,
    reason,
  };
}

/**
 * Groups logged taken (non-sample) orders into brackets to reveal most profitable patterns.
 * @param {Array} orders
 */
export function analyzePatterns(orders) {
  const taken = orders.filter((o) => o && o.decision === 'take' && !o.isSample);
  if (taken.length < 2) return [];

  const buckets = new Map();

  function addToBucket(key, label, order) {
    if (!buckets.has(key)) {
      buckets.set(key, { key, label, count: 0, netProfit: 0, minutes: 0, miles: 0, payout: 0 });
    }
    const b = buckets.get(key);
    b.count += 1;
    b.netProfit += order.netProfit;
    b.minutes += order.effectiveMinutes;
    b.miles += order.effectiveMiles;
    b.payout += order.payout;
  }

  for (const o of taken) {
    if (o.shownMiles < 3) addToBucket('dist-short', 'Short (< 3 mi)', o);
    else if (o.shownMiles <= 7) addToBucket('dist-med', 'Medium (3–7 mi)', o);
    else addToBucket('dist-long', 'Long (7+ mi)', o);

    const typeLabels = { food: 'Food Delivery', shop: 'Shop & Pay', stack: 'Stacked (2+)' };
    addToBucket(`type-${o.orderType}`, typeLabels[o.orderType] || 'Food Delivery', o);

    if (o.payout < 8) addToBucket('pay-low', 'Small (< $8)', o);
    else if (o.payout <= 15) addToBucket('pay-mid', 'Sweet Spot ($8–$15)', o);
    else addToBucket('pay-high', 'High Payout ($15+)', o);
  }

  return Array.from(buckets.values())
    .map((b) => ({
      ...b,
      netHourly: (b.netProfit / Math.max(1, b.minutes)) * 60,
      avgPerMile: b.payout / Math.max(0.1, b.miles),
    }))
    .sort((a, b) => b.netHourly - a.netHourly);
}

/**
 * Returns local calendar date key (YYYY-MM-DD) for a timestamp.
 * @param {number} [timestamp=Date.now()]
 * @returns {string}
 */
export function getLocalDateKey(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Computes distance in miles between two lat/lng coordinates using Haversine formula.
 */
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Validates a GPS segment by accuracy, minimum jitter floor, and implied speed (<= 100 mph).
 */
export function isValidGpsSegment({ prevLat, prevLon, prevTime, lat, lon, time, accuracy }) {
  if (typeof accuracy === 'number' && accuracy > 65) {
    return { valid: false, miles: 0, mph: 0 };
  }
  const miles = haversineMiles(prevLat, prevLon, lat, lon);
  if (miles < 0.005) {
    return { valid: false, miles, mph: 0 };
  }
  const dtHours = (Number(time) - Number(prevTime)) / 3600000;
  if (dtHours > 0) {
    const mph = miles / dtHours;
    return { valid: mph <= 100, miles, mph };
  }
  return { valid: miles <= 0.25, miles, mph: 0 };
}

/**
 * Estimates self-employment + income tax set-aside (estimate only, not tax advice).
 */
export function computeTaxSetAside({
  grossEarnings = 0,
  taxDeduction = 0,
  otherExpenses = 0,
  incomeTaxSetAsidePct = 0.10,
}) {
  const seBase = Math.max(0, grossEarnings - taxDeduction - otherExpenses);
  const seTax = seBase * 0.9235 * 0.153;
  const pct = cleanNumber(incomeTaxSetAsidePct, 0.10, 0, 0.5);
  const incomeTax = Math.max(0, seBase - seTax / 2) * pct;
  const setAside = seTax + incomeTax;
  return { seBase, seTax, incomeTax, setAside };
}

/**
 * Computes a single day's mileage, tax write-off, cash-flow net profit, and set-aside summary.
 * Prevents double counting via `totalMiles = max(gpsMiles, tripMiles) + manualMiles`.
 * Excludes orders marked `isSample: true`.
 */
export function computeDailySummary({
  orders = [],
  manualEntries = null,
  manualMiles = 0,
  gpsMiles = 0,
  expenses = [],
  shiftHours = 0,
  settings = DEFAULT_SETTINGS,
  dateKey = getLocalDateKey(),
}) {
  const s = sanitizeSettings(settings);
  const todaysTaken = orders.filter(
    (o) => o && !o.isSample && o.decision === 'take' && getLocalDateKey(o.timestamp) === dateKey
  );

  const tripMiles = todaysTaken.reduce((sum, o) => sum + (Number(o.effectiveMiles) || 0), 0);
  const grossEarnings = todaysTaken.reduce((sum, o) => sum + (Number(o.payout) || 0), 0);
  const orderMinutes = todaysTaken.reduce((sum, o) => sum + (Number(o.effectiveMinutes) || 0), 0);

  const safeManualMiles = Array.isArray(manualEntries)
    ? manualEntries.reduce((sum, e) => sum + Math.max(0, Number(e && e.miles) || 0), 0)
    : Math.max(0, Number(manualMiles) || 0);

  const safeGpsMiles = Math.max(0, Number(gpsMiles) || 0);
  const baseMiles = Math.max(safeGpsMiles, tripMiles);
  const totalMiles = baseMiles + safeManualMiles;
  const milesSource = safeGpsMiles >= tripMiles && safeGpsMiles > 0 ? 'gps' : 'trips';

  const otherExpenses = expenses
    .filter((e) => e && getLocalDateKey(e.timestamp) === dateKey)
    .reduce((sum, e) => sum + Math.max(0, Number(e.amount) || 0), 0);

  const costPerMile = getCostPerMile(s);
  const vehicleCost = totalMiles * costPerMile;
  const netProfit = grossEarnings - vehicleCost - otherExpenses;
  const taxDeduction = totalMiles * s.irsRate;
  const totalDeductions = taxDeduction + otherExpenses;

  const { setAside } = computeTaxSetAside({
    grossEarnings,
    taxDeduction,
    otherExpenses,
    incomeTaxSetAsidePct: s.incomeTaxSetAsidePct,
  });

  const safeShiftHours = Math.max(0, Number(shiftHours) || 0);
  const hoursWorked = safeShiftHours > 0 ? safeShiftHours : orderMinutes / 60;
  const netPerHour = hoursWorked > 0 ? netProfit / hoursWorked : 0;

  const goalProgress = s.dailyGoal > 0 ? Math.min(1, Math.max(0, netProfit / s.dailyGoal)) : 0;
  const goalRemaining = s.dailyGoal > 0 ? Math.max(0, s.dailyGoal - netProfit) : 0;

  return {
    dateKey,
    ordersCount: todaysTaken.length,
    tripMiles,
    manualMiles: safeManualMiles,
    gpsMiles: safeGpsMiles,
    totalMiles,
    milesSource,
    grossEarnings,
    vehicleCost,
    otherExpenses,
    netProfit,
    taxDeduction,
    totalDeductions,
    setAside,
    hoursWorked,
    netPerHour,
    goalProgress,
    goalRemaining,
    dailyGoal: s.dailyGoal,
    irsRate: s.irsRate,
  };
}

/**
 * Returns local start dateKey (YYYY-MM-DD) for 'today' | 'week' (Monday) | 'month' | 'ytd'.
 */
export function getPeriodStartDateKey(range = 'today', nowTs = Date.now()) {
  const d = new Date(nowTs);
  if (range === 'week') {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    return getLocalDateKey(copy.getTime());
  }
  if (range === 'month') {
    return getLocalDateKey(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  }
  if (range === 'ytd') {
    return `${d.getFullYear()}-01-01`;
  }
  return getLocalDateKey(nowTs);
}

/**
 * Computes summary totals across Today, Week (Mon-Sun), Month, or YTD.
 */
export function computePeriodSummary({
  orders = [],
  dailyDataByDate = {},
  expenses = [],
  settings = DEFAULT_SETTINGS,
  range = 'today',
  nowTs = Date.now(),
  liveGpsMiles = 0,
  liveShiftHours = 0,
}) {
  const s = sanitizeSettings(settings);
  const todayKey = getLocalDateKey(nowTs);
  const startKey = getPeriodStartDateKey(range, nowTs);

  const dateKeys = new Set([todayKey]);
  for (const o of orders) {
    if (!o || o.isSample || o.decision !== 'take') continue;
    const k = getLocalDateKey(o.timestamp);
    if (k >= startKey && k <= todayKey) dateKeys.add(k);
  }
  for (const k of Object.keys(dailyDataByDate || {})) {
    if (k >= startKey && k <= todayKey) dateKeys.add(k);
  }
  for (const e of expenses) {
    if (!e) continue;
    const k = getLocalDateKey(e.timestamp);
    if (k >= startKey && k <= todayKey) dateKeys.add(k);
  }

  let ordersCount = 0;
  let tripMiles = 0;
  let gpsMiles = 0;
  let manualMiles = 0;
  let totalMiles = 0;
  let grossEarnings = 0;
  let vehicleCost = 0;
  let otherExpenses = 0;
  let netProfit = 0;
  let taxDeduction = 0;
  let totalDeductions = 0;
  let hoursWorked = 0;

  for (const k of dateKeys) {
    const dayRecord = (dailyDataByDate && dailyDataByDate[k]) || {};
    const isToday = k === todayKey;
    const dayGps = (Number(dayRecord.gpsSavedMiles) || 0) + (isToday ? Math.max(0, Number(liveGpsMiles) || 0) : 0);
    const dayShiftHrs = ((Number(dayRecord.shiftSeconds) || 0) / 3600) + (isToday ? Math.max(0, Number(liveShiftHours) || 0) : 0);

    const daySum = computeDailySummary({
      orders,
      manualEntries: Array.isArray(dayRecord.entries) ? dayRecord.entries : null,
      manualMiles: Number(dayRecord.manualMiles) || 0,
      gpsMiles: dayGps,
      expenses,
      shiftHours: dayShiftHrs,
      settings: s,
      dateKey: k,
    });

    ordersCount += daySum.ordersCount;
    tripMiles += daySum.tripMiles;
    gpsMiles += daySum.gpsMiles;
    manualMiles += daySum.manualMiles;
    totalMiles += daySum.totalMiles;
    grossEarnings += daySum.grossEarnings;
    vehicleCost += daySum.vehicleCost;
    otherExpenses += daySum.otherExpenses;
    netProfit += daySum.netProfit;
    taxDeduction += daySum.taxDeduction;
    totalDeductions += daySum.totalDeductions;
    hoursWorked += daySum.hoursWorked;
  }

  const { setAside } = computeTaxSetAside({
    grossEarnings,
    taxDeduction,
    otherExpenses,
    incomeTaxSetAsidePct: s.incomeTaxSetAsidePct,
  });

  const milesSource = gpsMiles >= tripMiles && gpsMiles > 0 ? 'gps' : 'trips';
  const netPerHour = hoursWorked > 0 ? netProfit / hoursWorked : 0;
  const goalProgress = s.dailyGoal > 0 ? Math.min(1, Math.max(0, netProfit / s.dailyGoal)) : 0;
  const goalRemaining = s.dailyGoal > 0 ? Math.max(0, s.dailyGoal - netProfit) : 0;

  return {
    range,
    startKey,
    endKey: todayKey,
    ordersCount,
    tripMiles,
    gpsMiles,
    manualMiles,
    totalMiles,
    milesSource,
    grossEarnings,
    vehicleCost,
    otherExpenses,
    netProfit,
    taxDeduction,
    totalDeductions,
    setAside,
    hoursWorked,
    netPerHour,
    goalProgress,
    goalRemaining,
    dailyGoal: s.dailyGoal,
    irsRate: s.irsRate,
  };
}
