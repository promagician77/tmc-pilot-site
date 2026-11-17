// Verification outcome model. Real results come from NeverBounce (or an equivalent) on day 1;
// these rates are assumptions so the plan can be sized before the file exists.

import { mulberry32 } from './rng.mjs';
import { DOMAIN_NAMES, MAJOR_DOMAINS } from './list.mjs';

export const RESULTS = ['valid', 'invalid', 'catchall', 'disposable', 'unknown'];

export const VERIFY_ASSUMPTIONS = {
  seed: 7,
  asOfYear: 2026,
  invalidBase: 0.03, // dead mailboxes on a fresh list
  invalidPerYear: 0.011, // address decay per year since signup
  invalidNeverEngaged: 0.05, // extra for people who never clicked or bought
  catchallOther: 0.28, // company and small-provider domains often accept everything
  disposable: 0.004,
  unknown: 0.012,
};

// Price per address. Published figures disagree: $0.008 flat pay-as-you-go vs about $0.004 at
// 100K-250K tiers. Both ends are shown; a written quote decides.
export const VERIFY_PRICE = { low: 0.004, high: 0.008, vendor: 'NeverBounce' };

export function verifyList(list, opts = {}) {
  const a = { ...VERIFY_ASSUMPTIONS, ...opts };
  const rand = mulberry32(a.seed);
  const out = new Uint8Array(list.n);
  for (let i = 0; i < list.n; i++) {
    const age = Math.max(0, a.asOfYear - list.signupYear[i]);
    const never = list.daysSinceEngaged[i] < 0;
    const pInvalid = Math.min(0.6, a.invalidBase + a.invalidPerYear * age + (never ? a.invalidNeverEngaged : 0));
    const isMajor = MAJOR_DOMAINS.has(DOMAIN_NAMES[list.domain[i]]);
    const pCatch = isMajor ? 0 : a.catchallOther;
    const r = rand();
    let res = 0; // valid
    if (r < pInvalid) res = 1;
    else if (r < pInvalid + a.disposable) res = 3;
    else if (r < pInvalid + a.disposable + a.unknown) res = 4;
    else if (rand() < pCatch) res = 2;
    out[i] = res;
  }
  return out;
}

export function verifyCost(count, price = VERIFY_PRICE) {
  return { low: Math.round(count * price.low), high: Math.round(count * price.high) };
}
