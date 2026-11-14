const MILES_RE = /(\d+(?:\.\d+)?)\s*(?:miles?|mi\b)/i;
const HR_MIN_RE = /(\d+)\s*(?:hours?|hrs?)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m\b)/i;
const MIN_RE = /(\d{1,3})\s*(?:minutes?|mins?|min\b)/i;
const DOLLAR_RE = /\$\s*(\d{1,3}(?:\.\d{1,2})?)/i;
const DC_RE = /(\d{1,3})\s*dollars?(?:\s*(?:and\s*)?(\d{1,2})\s*cents?)?/i;
const FIRST_NUM_RE = /\b(\d{1,3}(?:\.\d{1,2})?)\b/;

/**
 * Parses spoken offer text (e.g. "$13.50, 4.2 miles, 21 minutes") into structured fields.
 * Strips matched miles/time spans before running the fallback payout match so
 * decimal miles (like "4.2 miles 21 minutes") never get misread as payout "4".
 * @param {string} rawText
 */
export function parseSpokenOffer(rawText) {
  const text = (rawText || '').toLowerCase();
  const parsed = { payout: null, miles: null, minutes: null, deadhead: null, orderType: null };

  let remainder = text;

  const milesMatch = text.match(MILES_RE);
  if (milesMatch) {
    parsed.miles = parseFloat(milesMatch[1]);
    remainder = remainder.replace(milesMatch[0], ' ');
  }

  const hrMinMatch = text.match(HR_MIN_RE);
  if (hrMinMatch) {
    parsed.minutes = parseInt(hrMinMatch[1], 10) * 60 + parseInt(hrMinMatch[2], 10);
    remainder = remainder.replace(hrMinMatch[0], ' ');
  } else {
    const minMatch = text.match(MIN_RE);
    if (minMatch) {
      parsed.minutes = parseInt(minMatch[1], 10);
      remainder = remainder.replace(minMatch[0], ' ');
    }
  }

  const dollarMatch = text.match(DOLLAR_RE);
  const dcMatch = text.match(DC_RE);

  if (dollarMatch) {
    parsed.payout = parseFloat(dollarMatch[1]);
  } else if (dcMatch) {
    parsed.payout = parseFloat(dcMatch[1]) + (dcMatch[2] ? parseFloat(dcMatch[2]) / 100 : 0);
  } else {
    const firstNumMatch = remainder.match(FIRST_NUM_RE);
    if (firstNumMatch) {
      parsed.payout = parseFloat(firstNumMatch[1]);
    }
  }

  if (text.includes('round trip')) parsed.deadhead = '2';
  else if (text.includes('edge') || text.includes('out of zone')) parsed.deadhead = '1.5';

  if (text.includes('shop')) parsed.orderType = 'shop';
  else if (text.includes('stack')) parsed.orderType = 'stack';

  return parsed;
}
