// Pilot calendar: 6 campaigns over 6 weeks, starting Tuesday 24 November 2026.

export const PILOT_START = '2026-11-24';
export const PILOT_LAST_DAY = 41; // Monday 4 January 2027
export const REPORT_DAY = 45; // final report day; dateOf(45) gives the date

const DAY_MS = 86400000;
export function dateOf(day, start = PILOT_START) {
  const d = new Date(Date.parse(start + 'T12:00:00Z') + day * DAY_MS);
  return d.toISOString().slice(0, 10);
}
export function dayOf(date, start = PILOT_START) {
  return Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / DAY_MS);
}
export function weekday(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
}

// No sends on these dates.
export const BLACKOUT = ['2026-11-26', '2026-12-25', '2027-01-01'];

// audience: 'new' = first touch (ramped), 'reached' = everyone already reached in that tier,
// 'clickers' = reached and clicked at least once, 'nonclickers' = reached and never clicked.
export const CAMPAIGNS = [
  {
    id: 'C1', key: 'press-story', name: 'Press story', audience: 'new', tiers: ['warm', 'medium', 'cold'],
    from: '2026-11-25', to: '2027-01-04',
    subject: 'You may have seen us in the news',
    purpose: 'First touch for every tier. The press coverage is the reason to write after a long gap.',
  },
  {
    id: 'C2', key: 'bfcm', name: 'Black Friday to Cyber Monday', audience: 'reached', tiers: ['warm'],
    from: '2026-11-27', to: '2026-11-30',
    subject: 'Your regimen, at the Amazon holiday price',
    purpose: 'Warm only. Cold contacts stay out of the busiest inbox week of the year.',
  },
  {
    id: 'C3', key: 'regimen', name: 'Regimen guide', audience: 'reached', tiers: ['warm', 'medium'],
    from: '2026-12-03', to: '2026-12-10',
    subject: 'Wash day, simplified: the 3-step routine',
    purpose: 'Education first, Amazon link second. Builds clicks, the signal Gmail and the tiers rely on.',
  },
  {
    id: 'C4', key: 'gift-on-amazon', name: 'Gift it on Amazon', audience: 'reached', tiers: ['warm', 'medium'],
    from: '2026-12-10', to: '2026-12-17',
    subject: 'Gifts that arrive in time, via Amazon',
    purpose: 'Holiday gifting while Amazon delivery dates still work.',
  },
  {
    id: 'C5', key: 're-permission', name: 'Keep hearing from us?', audience: 'nonclickers', tiers: ['cold'],
    from: '2026-12-17', to: '2026-12-23',
    subject: 'Should we keep writing?',
    purpose: 'Cold contacts who never clicked get one clear choice. No click by day 45 moves them to sunset.',
  },
  {
    id: 'C6', key: 'new-year', name: 'New year reset', audience: 'clickers', tiers: ['warm', 'medium', 'cold'],
    from: '2027-01-02', to: '2027-01-04',
    subject: 'New year, healthier hair: start here',
    purpose: 'Only people who clicked during the pilot. Ends the pilot on the engaged core.',
  },
];

export const WEEKS = [
  { week: 1, from: '2026-11-24', title: 'Verify, tier, authenticate', items: ['Upload list to NeverBounce; write results to a Klaviyo profile property', 'Create 4 tier segments by API; check SPF, DKIM, DMARC and one-click unsubscribe on a test send', 'Warm first touch from 25 Nov; Black Friday to warm only'] },
  { week: 2, from: '2026-12-01', title: 'Medium tier and flows live', items: ['Medium ramp starts after the first green warm reading', 'Welcome, browse, cart, post-purchase and win-back flows switched on', 'Landing page live with email capture and Amazon CTA'] },
  { week: 3, from: '2026-12-08', title: 'Cold tier, Meta test', items: ['Cold ramp in 5,000-contact steps, one tier per send day', 'Meta: warm retargeting and cold lookalike ad sets live', 'Weekly report 1'] },
  { week: 4, from: '2026-12-15', title: 'Re-permission and gifting', items: ['Gift-on-Amazon to warm and medium', 'Re-permission email to cold non-clickers', 'Weekly report 2'] },
  { week: 5, from: '2026-12-22', title: 'Holiday hold', items: ['No sends on 25 Dec', 'Read Amazon Attribution 14-day windows from the first sends', 'Weekly report 3'] },
  { week: 6, from: '2026-12-29', title: 'Engaged core and wrap-up', items: ['New year email to pilot clickers only', 'Sunset non-clickers; suppress invalid and unknown', 'Day-45 report with Phase 2 plan'] },
];
