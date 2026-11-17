// Pilot economics: email and Meta revenue through Amazon, Brand Referral Bonus, and whether the
// Meta test budget can detect a difference between two creatives. All inputs are assumptions
// until Amazon Attribution and Meta report real numbers.

export const ECON_ASSUMPTIONS = {
  aov: 22, // average Amazon order value, USD
  brbRate: 0.1, // Amazon describes the Brand Referral Bonus as averaging 10% of qualifying sales
  email: {
    purchasePerClick: { low: 0.05, mid: 0.08, high: 0.12 }, // Amazon purchases per email click
  },
  meta: {
    spend: 2000,
    warmShare: 0.4, // warm retargeting gets 40%, cold lookalike 60%
    cpm: { warm: 16, cold: 12 }, // USD per 1,000 impressions; haircare benchmarks run about $10-$16
    ctr: { warm: 0.018, cold: 0.01 }, // link click-through
    lpSignup: { warm: 0.14, cold: 0.08 }, // landing-page visitors who leave an email
    lpAmazonClick: { warm: 0.35, cold: 0.22 }, // landing-page visitors who click to Amazon
    amazonPurchasePerClick: { warm: 0.12, cold: 0.07 },
  },
};

const Z_ALPHA = 1.959964; // two-sided 5%
const Z_BETA = 0.841621; // 80% power

// Smallest relative lift a 50/50 test can detect for a rate p with n per arm.
export function relativeMde(p, nPerArm) {
  if (!(p > 0) || !(nPerArm > 0)) return Infinity;
  // Solve for p2 = p * (1 + lift) with the unpooled-variance normal approximation.
  let lo = 0;
  let hi = 50;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const p2 = Math.min(0.999999, p * (1 + mid));
    const pbar = (p + p2) / 2;
    const need = (Z_ALPHA * Math.sqrt(2 * pbar * (1 - pbar)) + Z_BETA * Math.sqrt(p * (1 - p) + p2 * (1 - p2))) / Math.sqrt(nPerArm);
    if (p2 - p >= need) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function metaPlan(over = {}) {
  const a = { ...ECON_ASSUMPTIONS.meta, ...over };
  const aov = over.aov ?? ECON_ASSUMPTIONS.aov;
  const brb = over.brbRate ?? ECON_ASSUMPTIONS.brbRate;
  const out = {};
  for (const aud of ['warm', 'cold']) {
    const spend = a.spend * (aud === 'warm' ? a.warmShare : 1 - a.warmShare);
    const impressions = (spend / a.cpm[aud]) * 1000;
    const clicks = impressions * a.ctr[aud];
    const leads = clicks * a.lpSignup[aud];
    const amazonClicks = clicks * a.lpAmazonClick[aud];
    const orders = amazonClicks * a.amazonPurchasePerClick[aud];
    const sales = orders * aov;
    out[aud] = {
      spend, impressions, clicks, leads, amazonClicks, orders, sales,
      costPerLead: leads ? spend / leads : Infinity,
      costPerOrder: orders ? spend / orders : Infinity,
      roas: spend ? sales / spend : 0,
      roasWithBonus: spend ? (sales * (1 + brb)) / spend : 0,
      // A 50/50 creative test inside this audience (press hook vs product hook):
      mde: {
        ctr: relativeMde(a.ctr[aud], impressions / 2),
        signup: relativeMde(a.lpSignup[aud], clicks / 2),
        purchase: relativeMde(a.lpAmazonClick[aud] * a.amazonPurchasePerClick[aud], clicks / 2),
      },
    };
  }
  const total = ['spend', 'impressions', 'clicks', 'leads', 'amazonClicks', 'orders', 'sales'].reduce(
    (acc, k) => ({ ...acc, [k]: out.warm[k] + out.cold[k] }), {},
  );
  total.roas = total.spend ? total.sales / total.spend : 0;
  total.roasWithBonus = total.spend ? (total.sales * (1 + brb)) / total.spend : 0;
  return { ...out, total, assumptions: a };
}

// What a creative test can and can't decide at this budget.
export function testVerdict(mde) {
  const fmt = (x) => (x === Infinity ? 'not detectable' : `${Math.round(x * 100)}%`);
  const usable = (x) => x <= 0.3;
  return {
    ctr: { mde: fmt(mde.ctr), usable: usable(mde.ctr) },
    signup: { mde: fmt(mde.signup), usable: usable(mde.signup) },
    purchase: { mde: fmt(mde.purchase), usable: usable(mde.purchase) },
  };
}

export function emailRevenue(clicksByTier, over = {}) {
  const aov = over.aov ?? ECON_ASSUMPTIONS.aov;
  const brb = over.brbRate ?? ECON_ASSUMPTIONS.brbRate;
  const rates = over.purchasePerClick ?? ECON_ASSUMPTIONS.email.purchasePerClick;
  const clicks = Object.values(clicksByTier).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [k, r] of Object.entries(rates)) {
    const orders = clicks * r;
    const sales = orders * aov;
    out[k] = { clicks, orders, sales, bonus: sales * brb };
  }
  return out;
}

// Spend left for Meta after verification, inside the client's managed-budget ceiling.
export function budgetFit({ cap = 3000, verifyCost, otherTools = 0, adMin = 1500, adMax = 2500 }) {
  const room = cap - verifyCost - otherTools;
  return {
    room,
    fitsMinAds: room >= adMin,
    fitsMaxAds: room >= adMax,
    adSpendPossible: Math.max(0, Math.min(adMax, room)),
  };
}
