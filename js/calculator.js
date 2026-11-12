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
  irsRate: 0.70,
};

/**
 * Computes total operating cost per mile (fuel + wear/maintenance).
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {number}
 */
export function getCostPerMile(settings) {
  const mpg = Math.max(1, Number(settings.mpg) || 28);
  const gasPrice = Math.max(0, Number(settings.gasPrice) || 0);
  const wear = Math.max(0, Number(settings.wearPerMile) || 0);
  return gasPrice / mpg + wear;
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
  const payout = Number(offer.payout);
  const shownMiles = Number(offer.miles);
  const estMinutes = Number(offer.minutes);
  const deadheadMultiplier = Number(offer.deadheadMultiplier) || 1;
  const waitMinutes = Number(offer.waitMinutes) || 0;

  if (!(payout > 0) || !(shownMiles >= 0) || !(estMinutes > 0)) {
    return null;
  }

  const effectiveMiles = Math.max(0.1, shownMiles * deadheadMultiplier);
  const effectiveMinutes = Math.max(1, estMinutes + waitMinutes);

  const costPerMile = getCostPerMile(settings);
  const vehicleCost = effectiveMiles * costPerMile;
  const netProfit = payout - vehicleCost;

  const grossHourly = (payout / effectiveMinutes) * 60;
  const netHourly = (netProfit / effectiveMinutes) * 60;

  const grossPerMile = shownMiles > 0 ? payout / shownMiles : payout;
  const effectivePerMile = payout / effectiveMiles;
  const taxDeduction = effectiveMiles * (Number(settings.irsRate) || 0.70);

  // Efficiency Score (0 - 100)
  const hourlyRatio = netHourly / Math.max(1, settings.minNetHourly);
  const mileRatio = effectivePerMile / Math.max(0.1, settings.minPerMile);
  const payoutPenalty = payout < settings.minPayout ? 18 : 0;

  const rawScore = (hourlyRatio * 55 + mileRatio * 45) - payoutPenalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Verdict
  const meetsHourly = netHourly >= settings.minNetHourly;
  const meetsMile = effectivePerMile >= settings.minPerMile;
  const meetsPayout = payout >= settings.minPayout;

  let verdict = 'pass';
  let verdictLabel = 'PASS / DECLINE';
  let verdictTitle = 'Below your targets';

  if (meetsHourly && meetsMile && meetsPayout) {
    verdict = 'take';
    verdictLabel = 'STRONG TAKE';
    verdictTitle = score >= 90 ? 'High-efficiency order' : 'Meets all profit rules';
  } else if (
    netHourly >= settings.minNetHourly * 0.85 &&
    effectivePerMile >= settings.minPerMile * 0.85 &&
    payout >= settings.minPayout * 0.85
  ) {
    verdict = 'maybe';
    verdictLabel = 'BORDERLINE';
    verdictTitle = 'Take only if slow or heading home';
  } else {
    verdict = 'pass';
    verdictLabel = 'PASS / DECLINE';
    if (!meetsPayout) {
      verdictTitle = `Below $${settings.minPayout.toFixed(2)} minimum`;
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
 * Groups logged taken orders into brackets to reveal most profitable patterns.
 * @param {Array} orders
 */
export function analyzePatterns(orders) {
  const taken = orders.filter((o) => o.decision === 'take');
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
    // Distance bracket
    if (o.shownMiles < 3) addToBucket('dist-short', 'Short (< 3 mi)', o);
    else if (o.shownMiles <= 7) addToBucket('dist-med', 'Medium (3–7 mi)', o);
    else addToBucket('dist-long', 'Long (7+ mi)', o);

    // Order type
    const typeLabels = { food: 'Food Delivery', shop: 'Shop & Pay', stack: 'Stacked (2+)' };
    addToBucket(`type-${o.orderType}`, typeLabels[o.orderType] || 'Food Delivery', o);

    // Payout bracket
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
