import { DEFAULT_SETTINGS, evaluateOffer } from './calculator.js';

const SETTINGS_KEY = 'dashprofit_settings_v1';
const ORDERS_KEY = 'dashprofit_orders_v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadOrders() {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOrders(orders) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
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
      ...metrics,
    };
  });
}

export function exportOrdersToCsv(orders) {
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
    'Score'
  ];

  const escapeCsv = (val) => {
    const str = String(val ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const rows = orders.map((o) => [
    new Date(o.timestamp).toISOString(),
    o.decision,
    o.merchant || '',
    o.orderType,
    o.payout.toFixed(2),
    o.shownMiles.toFixed(1),
    o.effectiveMiles.toFixed(1),
    o.effectiveMinutes,
    o.vehicleCost.toFixed(2),
    o.netProfit.toFixed(2),
    o.netHourly.toFixed(2),
    o.effectivePerMile.toFixed(2),
    o.taxDeduction.toFixed(2),
    o.score
  ]);

  const csvContent = [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dashprofit-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
