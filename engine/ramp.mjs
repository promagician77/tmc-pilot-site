// Guarded send ramp. One tier per send day, so Gmail's daily spam rate in Postmaster Tools maps to
// one tier. Each reading decides the next step: grow, hold, or stop.

import { mulberry32, binomial } from './rng.mjs';
import { CAMPAIGNS, BLACKOUT, PILOT_LAST_DAY, dateOf } from './calendar.mjs';

const ACTIVE_TIERS = ['warm', 'medium', 'cold'];

export const RAMP_RULES = {
  firstSendDay: 1,
  lastDay: PILOT_LAST_DAY,
  readLagDays: 2, // Gmail's spam rate is a daily aggregate that arrives late; wait for it
  holdAt: 0.001, // 0.1%: Gmail's "aim below" level. No growth until it drops.
  stopAt: 0.003, // 0.3%: above this Gmail offers no mitigation until 7 days below
  bounceStopAt: 0.02, // hard bounces after verification point to a bad batch: stop and re-verify
  pauseDaysAfterStop: 7,
  rollingDays: 7,
  guardAt: 0.002, // projected 7-day Gmail rate a first-touch batch may push the domain to
  minEstimateGmail: 2000, // below this many Gmail sends a tier uses the planner prior
  plannerPrior: { warm: 0.0005, medium: 0.001, cold: 0.005 }, // pessimistic until a tier has its own data
  minBatch: 1000,
  noiseZ: 1.645, // one-sided 95%
  guardStep: 250,
  minPooledGmail: 5000, // a tier is only stopped on its pooled rate once this many Gmail sends are in
  fastStopAt: 0.006,
  fastStopMinGmail: 2000,
  reverifyDays: 3,
  startSize: { warm: 6000, medium: 6000, cold: 5000 },
  growth: { warm: 2, medium: 1.75, cold: 1.5 },
  cap: { warm: 24000, medium: 16000, cold: 12000 },
  followupCap: { cold: 12000 }, // a follow-up to cold contacts is split across days above this
  unlockAfterGreen: 1, // next tier starts after this many green first-touch readings
  followupComplaintFactor: 0.6, // people who stayed after the first touch complain less
  bulkGmailPerDay: 5000,
};

// Assumptions per tier. The first batch of each tier replaces these with measured numbers.
export const RATE_ASSUMPTIONS = {
  complaint: { warm: 0.0004, medium: 0.001, cold: 0.0025, sunset: 0.006 },
  hardBounce: { warm: 0.003, medium: 0.005, cold: 0.008, sunset: 0.03 },
  unsub: { warm: 0.003, medium: 0.005, cold: 0.008, sunset: 0.012 },
  click: { warm: 0.025, medium: 0.012, cold: 0.006, sunset: 0.002 },
};

function mergeRates(over = {}) {
  const out = {};
  for (const k of Object.keys(RATE_ASSUMPTIONS)) out[k] = { ...RATE_ASSUMPTIONS[k], ...(over[k] || {}) };
  return out;
}

// Gmail judges the sending domain on its sustained spam rate, so the domain guard is a rolling
// 7-day rate across every send. Growth for a tier is judged on that tier's pooled rate, because
// a single small batch is too noisy: 7 complaints on 2,400 Gmail recipients already reads 0.29%.
export function decide(rules, { bounceRate, rollingRate, tierRate, tierGmail }) {
  if (bounceRate > rules.bounceStopAt) return 'stop-bounce';
  if (rollingRate >= rules.stopAt) return 'breach';
  // Strong evidence stops a tier early: 0.6% on 2,000 Gmail sends is 12+ complaints.
  if (tierRate >= rules.fastStopAt && tierGmail >= rules.fastStopMinGmail) return 'stop-tier';
  if (tierRate >= rules.stopAt && tierGmail >= rules.minPooledGmail) return 'stop-tier';
  if (tierRate >= rules.holdAt) return 'hold';
  return 'grow';
}

// Largest batch (in steps of rules.guardStep, up to `want`) that keeps the projected 7-day Gmail
// rate under rules.guardAt, and keeps that rate plus noiseZ standard deviations of complaint noise
// under Gmail's 0.3%. G and C are the window's Gmail sends and expected complaints so far.
// Small batches are noisy, so a lone small cold batch can fail where a bigger or mixed day passes.
export function guardSize({ G, C, est, share, want, rules: ruleOver }) {
  const rules = { ...RAMP_RULES, ...(ruleOver || {}) };
  const ok = (B) => {
    const g = G + B * share;
    const c = C + B * share * est;
    if (g <= 0) return true;
    const mean = c / g;
    const meanOk = est <= rules.guardAt || mean <= rules.guardAt;
    const noiseOk = mean + (rules.noiseZ * Math.sqrt(c)) / g <= rules.stopAt;
    return meanOk && noiseOk;
  };
  if (want <= 0) return 0;
  if (ok(want)) return want;
  const step = rules.guardStep;
  for (let B = Math.floor((want - 1) / step) * step; B >= step; B -= step) if (ok(B)) return B;
  return 0;
}

// mailable: { warm, medium, cold } contacts; gmailShare: { warm, medium, cold } 0..1
// Up to two sends a day: one follow-up to people already reached, and one first-touch batch.
// A first-touch batch is sized so the projected 7-day Gmail rate stays under rules.guardAt.
export function simulateRamp({ mailable, gmailShare, rates: rateOver, rules: ruleOver, seed = 1 } = {}) {
  const rules = { ...RAMP_RULES, ...(ruleOver || {}) };
  const rates = mergeRates(rateOver);
  const rand = mulberry32(seed);
  const blackout = new Set(BLACKOUT);
  const t = {};
  for (const id of ACTIVE_TIERS) {
    t[id] = {
      remaining: mailable[id] || 0, reached: 0, clickers: 0, nextSize: rules.startSize[id],
      readyDay: 0, greenFirstTouch: 0, haltedUntil: -1, unlocked: id === 'warm', exposedBeforeStop: null,
      pooledGmail: 0, pooledComplaints: 0, stopped: false, stoppedDay: null, guardSkips: 0,
    };
  }
  const read = [];
  const sent = []; // every send, for the projection
  const jobs = [];
  for (const c of CAMPAIGNS) {
    if (c.audience === 'new') continue;
    for (const tier of c.tiers) jobs.push({ c, tier, done: false });
  }
  const pendingReads = [];
  const days = [];
  let breaches = 0;
  let pausedUntil = -1;
  let firstBreachDay = null;
  const estimate = (tier) => {
    const s = t[tier];
    return s.pooledGmail >= rules.minEstimateGmail ? s.pooledComplaints / s.pooledGmail : rules.plannerPrior[tier];
  };
  for (let day = 0; day <= rules.lastDay; day++) {
    const date = dateOf(day);
    // 1. Read results that have arrived.
    for (const r of pendingReads.filter((x) => x.readDay === day)) {
      const s = t[r.tier];
      s.pooledGmail += r.batch.gmail;
      s.pooledComplaints += r.batch.complaintsGmail;
      read.push({ sentDay: r.sentDay, gmail: r.batch.gmail, complaints: r.batch.complaintsGmail });
      const windowStart = r.sentDay - rules.rollingDays + 1;
      const win = read.filter((x) => x.sentDay >= windowStart && x.sentDay <= r.sentDay);
      const wg = win.reduce((a, x) => a + x.gmail, 0);
      const rollingRate = wg ? win.reduce((a, x) => a + x.complaints, 0) / wg : 0;
      const tierRate = s.pooledGmail ? s.pooledComplaints / s.pooledGmail : 0;
      const decision = decide(rules, { bounceRate: r.bounceRate, rollingRate, tierRate, tierGmail: s.pooledGmail });
      Object.assign(r.batch, { decision, rollingRate, tierRate, readDay: day });
      if (decision === 'grow' && r.firstTouch) {
        s.nextSize = Math.min(rules.cap[r.tier], Math.round(s.nextSize * rules.growth[r.tier]));
        s.greenFirstTouch++;
      } else if (decision === 'stop-bounce') {
        s.nextSize = Math.max(rules.minBatch, Math.round(s.nextSize / 2));
        s.haltedUntil = day + rules.reverifyDays;
      } else if (decision === 'breach') {
        breaches++;
        if (firstBreachDay === null) firstBreachDay = day;
        s.nextSize = Math.max(rules.minBatch, Math.round(s.nextSize / 2));
        pausedUntil = Math.max(pausedUntil, day + rules.pauseDaysAfterStop);
      } else if (decision === 'stop-tier' && !s.stopped) {
        s.stopped = true;
        s.stoppedDay = day;
        s.exposedBeforeStop = (mailable[r.tier] || 0) - s.remaining;
      }
      const idx = ACTIVE_TIERS.indexOf(r.tier);
      if (r.firstTouch && decision === 'grow' && s.greenFirstTouch >= rules.unlockAfterGreen && idx < 2) {
        t[ACTIVE_TIERS[idx + 1]].unlocked = true;
      }
    }
    for (let i = 0; i < 2; i++) if (t[ACTIVE_TIERS[i]].remaining === 0 && t[ACTIVE_TIERS[i]].reached > 0) t[ACTIVE_TIERS[i + 1]].unlocked = true;

    const row = { day, date, sends: [], note: null };
    days.push(row);
    if (day < rules.firstSendDay) { row.note = 'prep'; continue; }
    if (blackout.has(date)) { row.note = 'blackout'; continue; }
    const canSend = (tier) => {
      const s = t[tier];
      if (s.stopped || s.readyDay > day || s.haltedUntil > day) return false;
      if (tier !== 'warm' && pausedUntil > day) return false;
      return true;
    };
    const plan = [];
    const guardCap = (tier, planned, want) => {
      const from = day - rules.rollingDays + 1;
      let G = 0;
      let C = 0;
      for (const x of sent) if (x.day >= from) { G += x.gmail; C += x.gmail * estimate(x.tier); }
      for (const p of planned) { const g = p.size * gmailShare[p.tier]; G += g; C += g * estimate(p.tier); }
      return guardSize({ G, C, est: estimate(tier), share: gmailShare[tier], want, rules });
    };
    // 2a. Follow-up: the open job whose window closes first. Large risky follow-ups go out in parts.
    const open = jobs
      .filter((j) => !j.done && j.c.from <= date && date <= j.c.to && canSend(j.tier) && t[j.tier].reached > 0)
      .sort((a, b) => (a.c.to < b.c.to ? -1 : a.c.to > b.c.to ? 1 : ACTIVE_TIERS.indexOf(a.tier) - ACTIVE_TIERS.indexOf(b.tier)));
    // A follow-up the guard blocks today gives way to the next open one.
    for (const j of open) {
      const s = t[j.tier];
      if (j.target === undefined) {
        j.target = j.c.audience === 'reached' ? s.reached
          : j.c.audience === 'clickers' ? s.clickers
          : j.c.audience === 'nonclickers' ? s.reached - s.clickers : 0;
        j.sentSoFar = 0;
      }
      const left = j.target - j.sentSoFar;
      if (left <= 0) { j.done = true; continue; }
      const size = guardCap(j.tier, plan, Math.min(left, rules.followupCap[j.tier] ?? Infinity));
      if (size > 0 && size >= Math.min(rules.minBatch, left)) {
        plan.push({ tier: j.tier, campaign: j.c.id, size, firstTouch: false, job: j });
        break;
      }
      s.guardSkips++;
    }
    // 2b. First touch: next unlocked tier, sized under the 7-day guard.
    const usedTier = plan[0]?.tier;
    const rampTier = ACTIVE_TIERS.find((id) => id !== usedTier && t[id].unlocked && t[id].remaining > 0 && canSend(id));
    if (rampTier) {
      const s = t[rampTier];
      const size = guardCap(rampTier, plan, Math.min(s.remaining, s.nextSize));
      if (size >= Math.min(rules.minBatch, s.remaining) && size > 0) plan.push({ tier: rampTier, campaign: 'C1', size, firstTouch: true });
      else s.guardSkips++;
    }
    // 3. Simulate today's sends.
    for (const p of plan) {
      const s = t[p.tier];
      const audienceSize = p.size;
      const gmail = Math.round(audienceSize * gmailShare[p.tier]);
      const factor = p.firstTouch ? 1 : rules.followupComplaintFactor;
      const complaintsGmail = binomial(rand, gmail, rates.complaint[p.tier] * factor);
      const bounces = binomial(rand, audienceSize, p.firstTouch ? rates.hardBounce[p.tier] : rates.hardBounce[p.tier] / 4);
      const unsubs = binomial(rand, audienceSize, rates.unsub[p.tier] * factor);
      const clicks = binomial(rand, audienceSize, rates.click[p.tier]);
      const spamRate = gmail > 0 ? complaintsGmail / gmail : 0;
      const bounceRate = bounces / audienceSize;
      if (p.firstTouch) {
        s.remaining -= audienceSize;
        s.reached += audienceSize - bounces;
      }
      const otherComplaints = Math.round(spamRate * (audienceSize - gmail));
      s.reached = Math.max(0, s.reached - unsubs - (p.firstTouch ? 0 : bounces) - complaintsGmail - otherComplaints);
      const newClickers = Math.round(clicks * Math.max(0, 1 - s.clickers / Math.max(1, s.reached)));
      s.clickers = Math.min(s.reached, s.clickers + newClickers);
      s.readyDay = day + rules.readLagDays;
      const batch = {
        tier: p.tier, campaign: p.campaign, firstTouch: p.firstTouch, sent: audienceSize, gmail, complaintsGmail,
        spamRate, bounces, bounceRate, unsubs, clicks, decision: null, rollingRate: null, tierRate: null, readDay: null,
      };
      if (p.job) {
        p.job.sentSoFar += audienceSize;
        if (p.job.sentSoFar >= p.job.target) p.job.done = true;
      }
      row.sends.push(batch);
      sent.push({ day, tier: p.tier, gmail });
      pendingReads.push({ readDay: day + rules.readLagDays, sentDay: day, tier: p.tier, bounceRate, firstTouch: p.firstTouch, batch });
    }
    row.gmail = row.sends.reduce((a, b) => a + b.gmail, 0);
    row.bulk = row.gmail > rules.bulkGmailPerDay;
  }
  const reached = Object.fromEntries(ACTIVE_TIERS.map((id) => [id, (mailable[id] || 0) - t[id].remaining]));
  const share = Object.fromEntries(ACTIVE_TIERS.map((id) => [id, mailable[id] ? reached[id] / mailable[id] : 1]));
  const sendRows = days.filter((d) => d.sends.length);
  return {
    days, breaches, firstBreachDay, reached, share,
    clickers: Object.fromEntries(ACTIVE_TIERS.map((id) => [id, t[id].clickers])),
    totalSent: sendRows.reduce((a, d) => a + d.sends.reduce((x, b) => x + b.sent, 0), 0),
    bulkDays: sendRows.filter((d) => d.bulk).length,
    sendDays: sendRows.length,
    exposedBeforeStop: Object.fromEntries(ACTIVE_TIERS.map((id) => [id, t[id].exposedBeforeStop])),
    stopped: Object.fromEntries(ACTIVE_TIERS.map((id) => [id, t[id].stopped ? t[id].stoppedDay : null])),
    tierRate: Object.fromEntries(ACTIVE_TIERS.map((id) => [id, t[id].pooledGmail ? t[id].pooledComplaints / t[id].pooledGmail : null])),
    guardSkips: Object.fromEntries(ACTIVE_TIERS.map((id) => [id, t[id].guardSkips])),
    rules, rates,
  };
}

// The alternative the ramp is compared with: every mailable contact on one day.
export function simulateBlast({ mailable, gmailShare, rates: rateOver, seed = 1, includeSunset = 0 }) {
  const rates = mergeRates(rateOver);
  const rand = mulberry32(seed);
  let gmail = 0;
  let complaints = 0;
  const tiers = { ...mailable, sunset: includeSunset };
  const share = { ...gmailShare, sunset: gmailShare.sunset ?? gmailShare.cold };
  for (const [tier, n] of Object.entries(tiers)) {
    if (!n) continue;
    const g = Math.round(n * share[tier]);
    gmail += g;
    complaints += binomial(rand, g, rates.complaint[tier]);
  }
  return { gmail, complaints, spamRate: gmail ? complaints / gmail : 0 };
}

export function monteCarlo({ mailable, gmailShare, rates, rules, runs = 300, seed = 99 }) {
  let breachRuns = 0;
  let blastBreaches = 0;
  let blastHolds = 0;
  const coldShare = [];
  const mediumShare = [];
  const breachCounts = [];
  const coldExposedAtStop = [];
  let coldStoppedRuns = 0;
  for (let i = 0; i < runs; i++) {
    const r = simulateRamp({ mailable, gmailShare, rates, rules, seed: seed + i });
    if (r.breaches > 0) breachRuns++;
    if (r.stopped.cold !== null) {
      coldStoppedRuns++;
      coldExposedAtStop.push(r.exposedBeforeStop.cold);
    }
    breachCounts.push(r.breaches);
    coldShare.push(r.share.cold);
    mediumShare.push(r.share.medium);
    const b = simulateBlast({ mailable, gmailShare, rates, seed: seed * 7 + i });
    if (b.spamRate >= RAMP_RULES.stopAt) blastBreaches++;
    else if (b.spamRate >= RAMP_RULES.holdAt) blastHolds++;
  }
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  return {
    runs,
    rampBreachProbability: breachRuns / runs,
    rampMedianBreaches: median(breachCounts),
    medianColdReached: median(coldShare),
    medianMediumReached: median(mediumShare),
    coldStoppedProbability: coldStoppedRuns / runs,
    medianColdExposedAtStop: coldExposedAtStop.length ? median(coldExposedAtStop) : null,
    blastBreachProbability: blastBreaches / runs,
    blastHoldProbability: blastHolds / runs,
  };
}

// Expected one-day spam rate if every mailable contact goes out together (no noise).
export function expectedBlastRate({ mailable, gmailShare, rates: rateOver }) {
  const rates = mergeRates(rateOver);
  let g = 0;
  let c = 0;
  for (const [tier, n] of Object.entries(mailable)) {
    const gm = n * gmailShare[tier];
    g += gm;
    c += gm * rates.complaint[tier];
  }
  return g ? c / g : 0;
}
