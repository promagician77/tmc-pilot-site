import { landingRequests } from '../engine/klaviyo.mjs';
import { urlHasPii } from '../engine/tags.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.dataLayer = window.dataLayer || [];

const SOURCES = {
  meta: { label: 'Meta ad', params: { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'tmc_pilot_meta_test', utm_content: 'cold-lal_press' } },
  klaviyo: { label: 'Pilot email', params: { utm_source: 'klaviyo', utm_medium: 'email', utm_campaign: 'tmc_pilot_c1_press_story', utm_content: 'warm', _kx: 'DEMO_KX_FROM_EMAIL_CLICK' } },
  press: { label: 'Press article', params: { utm_source: 'press', utm_medium: 'referral' } },
  direct: { label: 'Direct', params: {} },
};
const PRODUCTS = [
  { asin: 'ASIN_SLOT_1', name: 'Bestseller slot 1', note: 'Product name and one-line benefit from the brand', shape: 'pump' },
  { asin: 'ASIN_SLOT_2', name: 'Bestseller slot 2', note: 'Product name and one-line benefit from the brand', shape: 'jar' },
  { asin: 'ASIN_SLOT_3', name: 'Bestseller slot 3', note: 'Product name and one-line benefit from the brand', shape: 'tube' },
];
const SHAPES = {
  pump: '<rect x="86" y="46" width="48" height="80" rx="10" fill="#2f5d43"/><rect x="100" y="28" width="20" height="20" rx="3" fill="#1d2a22"/><rect x="108" y="16" width="26" height="8" rx="3" fill="#1d2a22"/><rect x="94" y="72" width="32" height="24" rx="3" fill="#eef3ec"/>',
  jar: '<rect x="74" y="60" width="72" height="62" rx="12" fill="#c9a27e"/><rect x="70" y="46" width="80" height="18" rx="5" fill="#1d2a22"/><rect x="88" y="78" width="44" height="24" rx="3" fill="#f6f9f4"/>',
  tube: '<path d="M88 30 h44 l-6 86 h-32 z" fill="#44554a"/><rect x="98" y="116" width="24" height="14" rx="3" fill="#1d2a22"/><rect x="96" y="54" width="28" height="30" rx="3" fill="#eef3ec"/>',
};

const state = { source: 'direct', kx: null, signedUp: null, viewed: new Set() };
let io = null;
// Re-observing makes the observer report cards already on screen again.
function watchProducts() {
  io.disconnect();
  document.querySelectorAll('.product').forEach((el) => io.observe(el));
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const src = p.get('utm_source');
  state.source = src && SOURCES[src] ? src : 'direct';
  state.kx = p.get('_kx');
}
const adGroup = () => `TMC-PILOT_LP_AMAZON-CTA_${state.source.toUpperCase()}`;
// The console issues the real tag; the ad group decides which one the page uses.
const amazonUrl = (asin) => `https://www.amazon.com/dp/${asin}?maas=MAAS_TAG_FOR_${adGroup()}&ref_=aa_maas&tag=maas`;
const identified = () => (state.kx ? 'yes, via _kx from the email click' : state.signedUp ? 'yes, after sign-up' : 'no');
// GA4 must not receive identifiers, so _kx is stripped from the URL it sees.
function cleanLocation() {
  const u = new URL(location.href);
  u.searchParams.delete('_kx');
  return u.toString();
}

function renderState() {
  $('#log-state').innerHTML = [
    ['Source', SOURCES[state.source].label],
    ['Identified in Klaviyo', identified()],
    ['Amazon ad group', adGroup()],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  for (const a of document.querySelectorAll('a.buy')) a.href = amazonUrl(a.dataset.asin);
  for (const b of document.querySelectorAll('.arrive button')) b.setAttribute('aria-pressed', String(b.dataset.src === state.source));
}

let n = 0;
function log(kind, name, why, payload) {
  const list = $('#entries');
  list.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  li.className = 'entry';
  li.dataset.kind = kind;
  li.dataset.name = name;
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
  li.innerHTML = `<div class="top"><span class="tag ${kind}">${{ ga4: 'GA4', klaviyo: 'Klaviyo', amazon: 'Amazon' }[kind]}</span><span class="name">${esc(name)}</span><span class="time">${t}</span></div>${why ? `<p class="why">${esc(why)}</p>` : ''}${payload ? `<details${n === 0 ? ' open' : ''}><summary>Payload</summary><pre tabindex="0">${esc(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))}</pre></details>` : ''}`;
  list.prepend(li);
  n++;
}
function clearLog() {
  $('#entries').innerHTML = '<li class="empty">No events yet. Scroll the page, sign up or click an Amazon button.</li>';
}

function ga4(event, params, why) {
  const push = { event, ...params };
  window.dataLayer.push(push);
  log('ga4', event, why, push);
}
function klaviyo(req, why) {
  const q = Object.entries(req.query).map(([k, v]) => `${k}=${v}`).join('&');
  log('klaviyo', req.title, why, `${req.method} https://a.klaviyo.com${req.path}?${q}\nrevision: ${req.headers.revision}\n\n${JSON.stringify(req.body, null, 2)}`);
}
function profileArgs(extra = {}) {
  return state.kx ? { kx: state.kx, ...extra } : { email: state.signedUp, ...extra };
}

function pageView() {
  ga4('page_view', { page_location: cleanLocation(), page_title: document.title }, state.kx ? 'Sent by the GA4 tag on load. _kx is removed from the URL first.' : 'Sent by the GA4 tag on load.');
}

function renderProducts() {
  $('#products').innerHTML = PRODUCTS.map((p) => `<article class="product" data-asin="${p.asin}"><svg viewBox="0 0 220 140" role="img" aria-label="Product photo placeholder">${SHAPES[p.shape]}</svg><h3>${p.name}</h3><p>${p.note}</p><a class="buy" data-asin="${p.asin}" href="${amazonUrl(p.asin)}">Buy on Amazon</a></article>`).join('');
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const asin = e.target.dataset.asin;
      if (state.viewed.has(asin)) continue;
      state.viewed.add(asin);
      const p = PRODUCTS.find((x) => x.asin === asin);
      window.dataLayer.push({ ecommerce: null });
      ga4('view_item', { ecommerce: { items: [{ item_id: asin, item_name: p.name, affiliation: 'Amazon' }] } }, 'Product card is at least 60% on screen.');
      if (state.kx || state.signedUp) {
        const req = landingRequests({ ...profileArgs(), asin, productName: p.name, adGroup: adGroup() })[1];
        klaviyo(req, 'Visitor is identified, so browse abandonment can follow up.');
      }
    }
  }, { threshold: 0.6 });
  watchProducts();
  for (const a of document.querySelectorAll('a.buy')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const asin = a.dataset.asin;
      const p = PRODUCTS.find((x) => x.asin === asin);
      ga4('amazon_click', { item_id: asin, item_name: p.name, attribution_ad_group: adGroup(), traffic_source: state.source }, 'Custom event: Amazon purchases happen off-site, so this click is the last step GA4 can see.');
      if (state.kx || state.signedUp) {
        const req = landingRequests({ ...profileArgs(), asin, productName: p.name, adGroup: adGroup() })[2];
        klaviyo(req, 'Keeps this person out of browse-abandonment emails.');
      }
      const url = amazonUrl(asin);
      log('amazon', 'Would open Amazon', `Attribution ad group ${adGroup()}. ${urlHasPii(url) ? 'Warning: personal data in link.' : 'No personal data in the link.'}`, url);
    });
  }
}

$('#capture').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = $('#email').value.trim();
  const msg = $('#form-msg');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Enter an email address like name@example.com.'; $('#email').focus(); return; }
  if (!$('#consent').checked) { msg.textContent = 'Tick the box to agree to emails, then send again.'; $('#consent').focus(); return; }
  state.signedUp = email;
  ga4('generate_lead', { form_id: 'press_capture', traffic_source: state.source }, 'No email address in GA4: only that a sign-up happened.');
  const req = landingRequests({ email, adGroup: adGroup() })[0];
  klaviyo(req, 'Subscribes the visitor to the press-capture list; the welcome flow starts from the list.');
  msg.textContent = 'Thanks. On the live page this would subscribe you and start the welcome emails.';
  renderState();
});

for (const b of document.querySelectorAll('.arrive button')) {
  b.addEventListener('click', () => {
    const p = new URLSearchParams(SOURCES[b.dataset.src].params);
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
    readUrl();
    state.viewed.clear();
    renderState();
    pageView();
    watchProducts();
  });
}
$('#clear-log').addEventListener('click', clearLog);

readUrl();
clearLog();
renderProducts();
renderState();
pageView();
document.documentElement.dataset.ready = 'true';
