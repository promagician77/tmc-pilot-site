// Engagement-recency tiers and the send policy for each verification result.

import { DOMAIN_NAMES } from './list.mjs';
import { RESULTS } from './verify.mjs';

export const TIERS = [
  { id: 'warm', label: 'Warm', maxDays: 180, desc: 'Clicked, bought or visited in the last 6 months' },
  { id: 'medium', label: 'Medium', maxDays: 365, desc: 'Last real engagement 6 to 12 months ago' },
  { id: 'cold', label: 'Cold', maxDays: 730, desc: 'Last real engagement 1 to 2 years ago' },
  { id: 'sunset', label: 'Sunset', maxDays: Infinity, desc: 'Over 2 years, or never clicked or bought' },
];
export const TIER_IDS = TIERS.map((t) => t.id);

export function tierFor(days) {
  if (days < 0) return 'sunset';
  for (const t of TIERS) if (days <= t.maxDays) return t.id;
  return 'sunset';
}

// Which verification results we send to, per tier. Catch-all domains accept any address, so a
// bounce can't be ruled out: only send to them when the person engaged in the last year.
export const SEND_POLICY = {
  warm: ['valid', 'catchall'],
  medium: ['valid', 'catchall'],
  cold: ['valid'],
  sunset: [], // not mailed in the pilot; re-permission candidates for Phase 2
};

export function isMailable(tier, result) {
  return SEND_POLICY[tier].includes(result);
}

// countMppOpens=true reproduces the common mistake: treating Apple privacy "opens" from the last
// send as engagement, which pulls dormant Apple Mail readers into the warm tier.
export function triage(list, verdicts, { countMppOpens = false } = {}) {
  const lastSend = list.assumptions.lastSendDaysAgo;
  const matrix = {};
  for (const t of TIER_IDS) {
    matrix[t] = Object.fromEntries(RESULTS.map((r) => [r, 0]));
  }
  const mailable = Object.fromEntries(TIER_IDS.map((t) => [t, 0]));
  const mailableGmail = Object.fromEntries(TIER_IDS.map((t) => [t, 0]));
  const buyersMailable = Object.fromEntries(TIER_IDS.map((t) => [t, 0]));
  const gmailIdx = DOMAIN_NAMES.indexOf('gmail.com');
  let movedByMpp = 0;
  for (let i = 0; i < list.n; i++) {
    let days = list.daysSinceEngaged[i];
    const result = RESULTS[verdicts[i]];
    if (countMppOpens && list.mpp[i] && result !== 'invalid') {
      // The last send produced an automatic "open" for everyone on Apple MPP.
      if (days < 0 || days > lastSend) {
        if (tierFor(days) !== tierFor(lastSend)) movedByMpp++;
        days = lastSend;
      }
    }
    const tier = tierFor(days);
    matrix[tier][result]++;
    if (isMailable(tier, result)) {
      mailable[tier]++;
      if (list.domain[i] === gmailIdx) mailableGmail[tier]++;
      if (list.buyer[i]) buyersMailable[tier]++;
    }
  }
  const totals = Object.fromEntries(RESULTS.map((r) => [r, TIER_IDS.reduce((s, t) => s + matrix[t][r], 0)]));
  const tierTotals = Object.fromEntries(TIER_IDS.map((t) => [t, RESULTS.reduce((s, r) => s + matrix[t][r], 0)]));
  return { matrix, totals, tierTotals, mailable, mailableGmail, buyersMailable, movedByMpp, countMppOpens };
}
