// Estimated date for each tirth.
//
// Only the endpoints are firmly dated in tradition:
//   leaves Ayodhya  Ashadh sud 10, VS 1849  = 29 June 1792
//   arrives at Loj  Shravan vad 6, VS 1856  = 21 August 1799
// (both tithis check out astronomically; see js/sky.js tithi()).
//
// Known long stays (swaminarayan.org / BAPS biographies):
//   Pulhashram, Muktinath: about 2½ months of austerities
//   with Gopal Yogi in Nepal: 9 months mastering Ashtanga Yoga (completed 1794).
//     Placed at Butolnagar here; the exact site is an assumption.
//   Jagannath Puri: about 6 months
//
// The remaining time is spread across the route: 60% in proportion to walking
// distance, 40% shared equally between stops. Every middle date is an estimate;
// override any of them with OVERRIDES below (1-based stop number -> 'YYYY-MM-DD').

import { STOPS } from './stops.js';

const DAY = 86400000;
export const START = Date.UTC(1792, 5, 29);
export const END = Date.UTC(1799, 7, 21);

const STAYS = { 14: 75, 15: 270, 27: 180 };      // stop number -> days spent
const OVERRIDES = { 1: '1792-06-28', 2: '1792-06-29', 65: '1799-08-21' };
const TRADITIONAL = new Set([2, 65]);             // dates given by tradition

export function buildChronology(legKm) {
  const n = STOPS.length;
  const stayTotal = Object.values(STAYS).reduce((a, b) => a + b, 0);
  const free = (END - START) / DAY - stayTotal;
  const kmTotal = legKm.slice(1).reduce((a, b) => a + b, 0);   // from Ayodhya onward
  const legs = n - 2;

  const days = [];
  let t = START;
  for (let i = 1; i < n; i++) {           // index 1 = Ayodhya
    days[i] = t;
    if (i === n - 1) break;
    t += (STAYS[i + 1] || 0) * DAY;       // stay at this stop before leaving
    t += (free * (0.6 * legKm[i] / kmTotal + 0.4 / legs)) * DAY;
  }
  days[0] = START - DAY;

  return STOPS.map((s, i) => {
    const iso = OVERRIDES[s.n];
    const date = new Date(iso ? Date.parse(iso) : days[i]);
    return { date, kind: TRADITIONAL.has(s.n) ? 'traditional' : 'estimated', stay: STAYS[s.n] || 0 };
  });
}
