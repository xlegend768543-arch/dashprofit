import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  analyzePatterns,
  computeDailySummary,
  computePeriodSummary,
  computeTaxSetAside,
  evaluateOffer,
  getCostPerMile,
  getLocalDateKey,
  getPeriodStartDateKey,
  isValidGpsSegment,
  sanitizeSettings,
} from '../js/calculator.js';
import { parseSpokenOffer } from '../js/voice-parser.js';
import {
  addManualEntryToRecord,
  applyOdometerToRecord,
  buildExpensesCsv,
  buildMileageLogCsv,
  buildOrdersCsv,
  emptyDailyRecord,
  migrateOrder,
  normalizeDailyRecord,
  undoLastManualEntryInRecord,
} from '../js/storage.js';

test('voice parser: payout fallback ignores decimal miles and minutes', () => {
  const res = parseSpokenOffer('4.2 miles 21 minutes');
  assert.equal(res.payout, null);
  assert.equal(res.miles, 4.2);
  assert.equal(res.minutes, 21);
});

test('voice parser: parses standard currency, dollars/cents, deadhead and order type', () => {
  const a = parseSpokenOffer('$13.50, 4.2 miles, 21 minutes');
  assert.equal(a.payout, 13.5);
  assert.equal(a.miles, 4.2);
  assert.equal(a.minutes, 21);

  const b = parseSpokenOffer('12 dollars 5 miles 20 min round trip');
  assert.equal(b.payout, 12);
  assert.equal(b.miles, 5);
  assert.equal(b.minutes, 20);
  assert.equal(b.deadhead, '2');

  const c = parseSpokenOffer('13 dollars 50 cents 4 miles 20 minutes');
  assert.equal(c.payout, 13.5);
  assert.equal(c.miles, 4);
  assert.equal(c.minutes, 20);
});

test('sanitizeSettings preserves 0 values and falls back on empty/NaN', () => {
  const zeroed = sanitizeSettings({
    wearPerMile: 0,
    gasPrice: 0,
    irsRate: 0,
    dailyGoal: 0,
    incomeTaxSetAsidePct: 0,
    minPayout: 0,
    mpg: 0, // clamped to 1
  });
  assert.equal(zeroed.wearPerMile, 0);
  assert.equal(zeroed.gasPrice, 0);
  assert.equal(zeroed.irsRate, 0);
  assert.equal(zeroed.dailyGoal, 0);
  assert.equal(zeroed.incomeTaxSetAsidePct, 0);
  assert.equal(zeroed.minPayout, 0);
  assert.equal(zeroed.mpg, 1);

  assert.equal(getCostPerMile(zeroed), 0);

  const offer = evaluateOffer({ payout: 10, miles: 5, minutes: 20 }, zeroed);
  assert.equal(offer.vehicleCost, 0);
  assert.equal(offer.taxDeduction, 0);
  assert.equal(offer.netProfit, 10);

  const emptyInput = sanitizeSettings({ wearPerMile: '', irsRate: 'abc', incomeTaxSetAsidePct: 0.9 });
  assert.equal(emptyInput.wearPerMile, DEFAULT_SETTINGS.wearPerMile);
  assert.equal(emptyInput.irsRate, DEFAULT_SETTINGS.irsRate);
  assert.equal(emptyInput.incomeTaxSetAsidePct, 0.5);
});

test('day miles prevent double counting: max(gps, trips) + manual', () => {
  const now = new Date(2026, 10, 13, 12, 0, 0).getTime();
  const dateKey = getLocalDateKey(now);
  const orders = [
    { id: 'ord-1', timestamp: now, decision: 'take', effectiveMiles: 10, payout: 30, effectiveMinutes: 30, isSample: false },
  ];

  // When GPS > trips, use GPS + manual
  const gpsWins = computeDailySummary({
    orders,
    manualEntries: [{ id: 'm1', timestamp: now, miles: 3, kind: 'quick' }],
    gpsMiles: 14,
    settings: DEFAULT_SETTINGS,
    dateKey,
  });
  assert.equal(gpsWins.totalMiles, 17);
  assert.equal(gpsWins.milesSource, 'gps');

  // When trips > GPS, fall back to trips + manual
  const tripsWin = computeDailySummary({
    orders,
    manualEntries: [{ id: 'm1', timestamp: now, miles: 3, kind: 'quick' }],
    gpsMiles: 4,
    settings: DEFAULT_SETTINGS,
    dateKey,
  });
  assert.equal(tripsWin.totalMiles, 13);
  assert.equal(tripsWin.milesSource, 'trips');
});

test('sample orders are excluded from totals, patterns, and legacy sample- ids migrate', () => {
  const now = new Date(2026, 10, 13, 12, 0, 0).getTime();
  const dateKey = getLocalDateKey(now);
  const migrated = migrateOrder({ id: 'sample-123', timestamp: now, decision: 'take', effectiveMiles: 12, payout: 40 });
  assert.equal(migrated.isSample, true);

  const orders = [
    migrated,
    { id: 'ord-1', timestamp: now, decision: 'take', effectiveMiles: 5, payout: 15, effectiveMinutes: 20, shownMiles: 5, orderType: 'food', netProfit: 13.75, isSample: false },
    { id: 'sample-2', timestamp: now, decision: 'take', effectiveMiles: 8, payout: 25, effectiveMinutes: 25, shownMiles: 8, orderType: 'shop', netProfit: 23, isSample: true },
  ];

  const day = computeDailySummary({ orders, settings: DEFAULT_SETTINGS, dateKey });
  assert.equal(day.ordersCount, 1);
  assert.equal(day.tripMiles, 5);
  assert.equal(day.grossEarnings, 15);

  const patterns = analyzePatterns(orders);
  assert.equal(patterns.length, 0); // only 1 real taken order, need >= 2
});

test('GPS segment validation allows >1 mi gaps when implied speed <= 100 mph', () => {
  const t0 = 1700000000000;
  // 2 minutes later, ~1.8 miles -> ~54 mph => valid!
  const twoMinLater = t0 + 120 * 1000;
  const ok = isValidGpsSegment({
    prevLat: 37.7749,
    prevLon: -122.4194,
    prevTime: t0,
    lat: 37.8000,
    lon: -122.4194,
    time: twoMinLater,
    accuracy: 15,
  });
  assert.equal(ok.valid, true);
  assert.ok(ok.miles > 1.5 && ok.mph <= 100);

  // 2 seconds later, ~1.7 miles -> >3000 mph => rejected!
  const twoSecLater = t0 + 2 * 1000;
  const teleport = isValidGpsSegment({
    prevLat: 37.7749,
    prevLon: -122.4194,
    prevTime: t0,
    lat: 37.8000,
    lon: -122.4194,
    time: twoSecLater,
    accuracy: 15,
  });
  assert.equal(teleport.valid, false);
});

test('tax set-aside and period summary (week/month/ytd) calculate accurately', () => {
  const t = computeTaxSetAside({
    grossEarnings: 200,
    taxDeduction: 70,
    otherExpenses: 10,
    incomeTaxSetAsidePct: 0.10,
  });
  // seBase = 120, seTax = 120 * 0.9235 * 0.153 = 16.95546, incomeTax = (120 - 8.47773) * 0.10 = 11.152227
  assert.equal(t.seBase, 120);
  assert.ok(Math.abs(t.setAside - (16.95546 + 11.152227)) < 1e-4);

  const nov13 = new Date(2026, 10, 13, 12, 0, 0).getTime(); // Fri Nov 13 2026
  const nov10 = new Date(2026, 10, 10, 12, 0, 0).getTime(); // Tue Nov 10 2026 (same week)
  const nov02 = new Date(2026, 10, 2, 12, 0, 0).getTime();  // Mon Nov 2 2026 (same month, prior week)
  const jan15 = new Date(2026, 0, 15, 12, 0, 0).getTime();  // Jan 15 2026 (same year, prior month)

  assert.equal(getPeriodStartDateKey('week', nov13), '2026-11-09');
  assert.equal(getPeriodStartDateKey('month', nov13), '2026-11-01');
  assert.equal(getPeriodStartDateKey('ytd', nov13), '2026-01-01');

  const orders = [
    { id: '1', timestamp: nov13, decision: 'take', effectiveMiles: 10, payout: 30, effectiveMinutes: 30, isSample: false },
    { id: '2', timestamp: nov10, decision: 'take', effectiveMiles: 10, payout: 20, effectiveMinutes: 30, isSample: false },
    { id: '3', timestamp: nov02, decision: 'take', effectiveMiles: 10, payout: 25, effectiveMinutes: 30, isSample: false },
    { id: '4', timestamp: jan15, decision: 'take', effectiveMiles: 10, payout: 40, effectiveMinutes: 30, isSample: false },
  ];
  const expenses = [
    { id: 'e1', timestamp: nov10, amount: 5, category: 'Toll', note: 'Bridge' },
  ];

  const weekSum = computePeriodSummary({ orders, expenses, settings: DEFAULT_SETTINGS, range: 'week', nowTs: nov13 });
  assert.equal(weekSum.grossEarnings, 50);
  assert.equal(weekSum.totalMiles, 20);
  assert.equal(weekSum.otherExpenses, 5);

  const monthSum = computePeriodSummary({ orders, expenses, settings: DEFAULT_SETTINGS, range: 'month', nowTs: nov13 });
  assert.equal(monthSum.grossEarnings, 75);
  assert.equal(monthSum.totalMiles, 30);

  const ytdSum = computePeriodSummary({ orders, expenses, settings: DEFAULT_SETTINGS, range: 'ytd', nowTs: nov13 });
  assert.equal(ytdSum.grossEarnings, 115);
  assert.equal(ytdSum.totalMiles, 40);
});

test('manual entries undo, odometer replace, migration, and CSV exports', () => {
  const legacy = normalizeDailyRecord({ manualMiles: 4.5, gpsSavedMiles: 2.0 }, '2026-11-13');
  assert.equal(legacy.entries.length, 1);
  assert.equal(legacy.entries[0].miles, 4.5);

  let rec = emptyDailyRecord();
  rec = addManualEntryToRecord(rec, 1, 'quick');
  rec = addManualEntryToRecord(rec, 5, 'quick');
  assert.equal(rec.entries.length, 2);

  const { nextRecord, removed } = undoLastManualEntryInRecord(rec);
  assert.equal(removed.miles, 5);
  assert.equal(nextRecord.entries.length, 1);

  rec = applyOdometerToRecord(nextRecord, 1000, 1012);
  rec = applyOdometerToRecord(rec, 1000, 1015); // replaces previous odometer entry
  assert.equal(rec.entries.filter((e) => e.kind === 'odometer').length, 1);
  assert.equal(rec.entries.find((e) => e.kind === 'odometer').miles, 15);

  const now = new Date(2026, 10, 13, 12, 0, 0).getTime();
  const dateKey = getLocalDateKey(now);
  const mileageCsv = buildMileageLogCsv({
    orders: [{ id: 'o1', timestamp: now, decision: 'take', effectiveMiles: 10, payout: 25, effectiveMinutes: 20, isSample: false }],
    dailyDataByDate: { [dateKey]: rec },
    expenses: [{ id: 'e1', timestamp: now, amount: 3.5, category: 'Parking', note: 'Meter' }],
    settings: DEFAULT_SETTINGS,
  });
  assert.match(mileageCsv, /^Date,StartOdometer,EndOdometer,TripEstMiles,GPSMiles,ManualMiles,BusinessMiles,MilesSource,StandardRate,MileageDeduction,OtherExpenses,TotalDeductions,BusinessPurpose/m);
  assert.match(mileageCsv, /2026-11-13,1000\.0,1015\.0,10\.00,0\.00,16\.00,26\.00,trips,0\.70,18\.20,3\.50,21\.70,DoorDash delivery/);

  const expCsv = buildExpensesCsv([{ id: 'e1', timestamp: now, amount: 3.5, category: 'Parking', note: 'Meter' }]);
  assert.match(expCsv, /Date,Category,Amount,Note/);
  assert.match(expCsv, /2026-11-13,Parking,3\.50,Meter/);

  const ordCsv = buildOrdersCsv([
    {
      timestamp: now, decision: 'take', merchant: 'Chipotle', orderType: 'food',
      payout: 12, shownMiles: 4, effectiveMiles: 4, effectiveMinutes: 18,
      vehicleCost: 1, netProfit: 11, netHourly: 36.67, effectivePerMile: 3, taxDeduction: 2.8, score: 95, isSample: false,
    },
  ]);
  assert.match(ordCsv, /,IsSample$/m);
  assert.match(ordCsv, /,false$/m);
});
