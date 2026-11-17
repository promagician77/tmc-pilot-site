// A synthetic stand-in for the 200K dormant list. Every rate here is an assumption, stated so it
// can be swapped for the real export on day 1. Nothing in this file comes from the brand's data.

import { mulberry32, pickWeighted } from './rng.mjs';

export const LIST_ASSUMPTIONS = {
  size: 200000,
  seed: 20261124,
  asOf: '2026-11-17',
  domains: [
    ['gmail.com', 0.47],
    ['yahoo.com', 0.16],
    ['icloud.com', 0.09],
    ['hotmail.com', 0.07],
    ['aol.com', 0.06],
    ['outlook.com', 0.04],
    ['other', 0.11],
  ],
  signupYears: [
    [2016, 0.07], [2017, 0.1], [2018, 0.12], [2019, 0.14], [2020, 0.15],
    [2021, 0.13], [2022, 0.1], [2023, 0.08], [2024, 0.06], [2025, 0.05],
  ],
  // Days since the last real engagement: email click, own-site order or site visit.
  // Opens are deliberately not a signal here (Apple Mail Privacy Protection fakes them).
  recency: [
    ['0-180', 0.06],
    ['181-365', 0.11],
    ['366-730', 0.27],
    ['731+', 0.36],
    ['never', 0.2],
  ],
  // Share of profiles reading in Apple Mail with Mail Privacy Protection on.
  appleMppShare: { 'icloud.com': 0.92, default: 0.33 },
  // If any send reached the list this many days ago, MPP users carry an "open" from that day.
  lastSendDaysAgo: 120,
  // Share who ever ordered on the brand's own site (seed size for a Meta lookalike).
  ownSiteBuyerShare: 0.14,
};

export const DOMAIN_NAMES = LIST_ASSUMPTIONS.domains.map(([d]) => d);
export const MAJOR_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'aol.com', 'outlook.com']);

function drawDays(rand, bucket) {
  switch (bucket) {
    case '0-180': return Math.floor(rand() * 181);
    case '181-365': return 181 + Math.floor(rand() * 185);
    case '366-730': return 366 + Math.floor(rand() * 365);
    case '731+': return 731 + Math.floor(rand() * 1500);
    default: return -1; // never engaged
  }
}

// Columnar arrays keep 200K profiles light in memory and fast to scan.
export function generateList(opts = {}) {
  const a = { ...LIST_ASSUMPTIONS, ...opts };
  const n = a.size;
  const rand = mulberry32(a.seed);
  const domain = new Uint8Array(n);
  const signupYear = new Uint16Array(n);
  const daysSinceEngaged = new Int32Array(n);
  const mpp = new Uint8Array(n);
  const buyer = new Uint8Array(n);
  const domainIndex = new Map(DOMAIN_NAMES.map((d, i) => [d, i]));
  const asOfYear = Number(a.asOf.slice(0, 4));
  const neverShare = (a.recency.find(([b]) => b === 'never') || [0, 0])[1];
  const buyerAmongEngaged = a.ownSiteBuyerShare / (1 - neverShare);
  for (let i = 0; i < n; i++) {
    const d = pickWeighted(rand, a.domains);
    domain[i] = domainIndex.get(d);
    const year = pickWeighted(rand, a.signupYears);
    signupYear[i] = year;
    let days = drawDays(rand, pickWeighted(rand, a.recency));
    // Nobody engaged before they signed up.
    const maxDays = (asOfYear - year) * 365 + 300;
    if (days > maxDays) days = maxDays;
    daysSinceEngaged[i] = days;
    const mppShare = a.appleMppShare[d] ?? a.appleMppShare.default;
    mpp[i] = rand() < mppShare ? 1 : 0;
    buyer[i] = days >= 0 && rand() < buyerAmongEngaged ? 1 : 0;
  }
  return { n, domain, signupYear, daysSinceEngaged, mpp, buyer, assumptions: a };
}
