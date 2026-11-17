// Amazon Attribution ad groups and UTM tags for every pilot link.
// One Attribution tag per ad group: Amazon reports clicks, detail page views, add-to-carts and
// purchases per tag, never per person. The tag names here are the plan; the tag URLs are created
// in the Amazon Ads console.

import { CAMPAIGNS } from './calendar.mjs';

const SAFE = /^[A-Za-z0-9_-]+$/;
// Personal data must never ride in a URL: no email, phone or name merge tags.
const PII = [/\{\{\s*email\s*\}\}/i, /\{\{\s*person\./i, /\{\{\s*first_name/i, /\{\{\s*phone/i, /[\w.+-]+@[\w-]+\.[\w.]+/, /(^|[?&])(email|e|phone)=/i];

export const META_AD_SETS = [
  { id: 'WARM-RT', audience: 'warm', name: 'Warm retargeting: site visitors and engaged email profiles' },
  { id: 'COLD-LAL', audience: 'cold', name: 'Cold lookalike: 1% of own-site buyers' },
];
export const CREATIVES = [
  { id: 'PRESS', name: 'Press hook' },
  { id: 'PRODUCT', name: 'Product hook' },
];

export function buildTagMatrix({ campaigns = CAMPAIGNS, adSets = META_AD_SETS, creatives = CREATIVES } = {}) {
  const rows = [];
  for (const c of campaigns) {
    for (const tier of c.tiers) {
      rows.push({
        channel: 'Email', source: 'klaviyo', medium: 'email', campaign: c.id, segment: tier,
        adGroup: `TMC-PILOT_EMAIL_${c.id}_${tier.toUpperCase()}`,
        destination: 'amazon',
        utm: { utm_source: 'klaviyo', utm_medium: 'email', utm_campaign: `tmc_pilot_${c.id.toLowerCase()}_${c.key.replace(/-/g, '_')}`, utm_content: tier },
      });
    }
  }
  for (const s of adSets) {
    for (const cr of creatives) {
      rows.push({
        channel: 'Meta', source: 'meta', medium: 'paid_social', campaign: 'META-TEST', segment: s.audience,
        adGroup: `TMC-PILOT_META_${s.id}_${cr.id}`,
        destination: 'landing',
        utm: { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'tmc_pilot_meta_test', utm_content: `${s.id.toLowerCase()}_${cr.id.toLowerCase()}` },
      });
    }
  }
  // The landing page's Amazon button swaps to the tag for the visitor's source, so Amazon sales
  // from Meta visitors are not credited to email (and the other way round).
  for (const src of ['meta', 'klaviyo', 'press', 'direct']) {
    rows.push({
      channel: 'Landing page', source: src, medium: 'referral', campaign: 'LP', segment: 'all',
      adGroup: `TMC-PILOT_LP_AMAZON-CTA_${src.toUpperCase()}`,
      destination: 'amazon',
      utm: null,
    });
  }
  return rows;
}

export function buildUrl(base, utm) {
  if (!utm) return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(utm)) u.searchParams.set(k, v);
  return u.toString();
}

export function validateTagMatrix(rows) {
  const errors = [];
  const seen = new Set();
  for (const r of rows) {
    if (!SAFE.test(r.adGroup)) errors.push(`${r.adGroup}: only letters, digits, - and _`);
    if (r.adGroup.length > 80) errors.push(`${r.adGroup}: longer than 80 characters`);
    if (seen.has(r.adGroup)) errors.push(`${r.adGroup}: duplicate ad group`);
    seen.add(r.adGroup);
    if (r.destination === 'landing') {
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
        if (!r.utm || !r.utm[k]) errors.push(`${r.adGroup}: landing link without ${k}`);
      }
    }
    const blob = JSON.stringify(r.utm || {}) + r.adGroup;
    for (const re of PII) if (re.test(blob)) errors.push(`${r.adGroup}: personal data in a link`);
  }
  return errors;
}

export function urlHasPii(url) {
  return PII.some((re) => re.test(url));
}
