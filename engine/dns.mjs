// Email authentication pre-flight: SPF, DKIM (Klaviyo selectors), DMARC and the branded sending
// subdomain. The resolver is injected: DNS-over-HTTPS in the browser, fixtures in tests.

export const TYPE = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16 };
const TYPE_NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));

// Klaviyo's selectors: km1/km2 for marketing domains, kt1/kt2 for transactional, kl/kl1/kl2 on
// domains set up before send types existed.
export const KLAVIYO_SELECTORS = ['km1', 'km2', 'kt1', 'kt2', 'kl', 'kl1', 'kl2'];
const KLAVIYO_HOSTS = /(klaviyodns\.com|klaviyomail\.com|sendgrid\.net)\.?$/i;

// "\"v=spf1 include:x\" \"~all\"" -> v=spf1 include:x~all (DNS splits long TXT into 255-byte strings)
export function parseTxtData(data) {
  if (typeof data !== 'string') return '';
  const parts = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(data))) parts.push(m[1].replace(/\\(.)/g, '$1'));
  return parts.length ? parts.join('') : data.trim();
}

// Cloudflare's JSON API (application/dns-json).
export function dohResolver(fetchImpl, endpoint = 'https://cloudflare-dns.com/dns-query') {
  return async (name, type) => {
    const url = `${endpoint}?name=${encodeURIComponent(name)}&type=${type}`;
    const res = await fetchImpl(url, { headers: { accept: 'application/dns-json' } });
    if (!res.ok) throw new Error(`DNS lookup failed for ${name} (${res.status})`);
    const j = await res.json();
    return normaliseDoh(j);
  };
}

export function normaliseDoh(j) {
  return {
    status: j.Status,
    answers: (j.Answer || []).map((a) => ({ name: a.name, type: TYPE_NAME[a.type] || String(a.type), data: a.data })),
  };
}

async function txt(resolve, name) {
  const r = await resolve(name, 'TXT');
  return { status: r.status, records: r.answers.filter((a) => a.type === 'TXT').map((a) => parseTxtData(a.data)) };
}

const LOOKUP_TERMS = /^[+\-~?]?(include:|a$|a:|a\/|mx$|mx:|mx\/|ptr|exists:)|^redirect=/i;

export function parseSpf(record) {
  const terms = record.trim().split(/\s+/).slice(1);
  const includes = [];
  let redirect = null;
  let all = null;
  let lookups = 0;
  for (const term of terms) {
    if (LOOKUP_TERMS.test(term)) lookups++;
    const inc = term.match(/^[+\-~?]?include:(.+)$/i);
    if (inc) includes.push(inc[1]);
    const red = term.match(/^redirect=(.+)$/i);
    if (red) redirect = red[1];
    const al = term.match(/^([+\-~?]?)all$/i);
    if (al) all = al[1] || '+';
  }
  return { terms, includes, redirect, all, lookups };
}

// Counts DNS lookups through nested includes (the RFC 7208 limit is 10).
export async function spfLookupCount(resolve, domain, depth = 0, seen = new Set()) {
  if (depth > 10 || seen.has(domain)) return { lookups: 0, voids: 0, loop: seen.has(domain) };
  seen.add(domain);
  const { status, records } = await txt(resolve, domain);
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (status === 3 || spf.length === 0) return { lookups: 0, voids: 1, loop: false };
  const p = parseSpf(spf[0]);
  let lookups = p.lookups;
  let voids = 0;
  let loop = false;
  for (const inc of [...p.includes, ...(p.redirect ? [p.redirect] : [])]) {
    const sub = await spfLookupCount(resolve, inc, depth + 1, seen);
    lookups += sub.lookups;
    voids += sub.voids;
    loop = loop || sub.loop;
  }
  return { lookups, voids, loop };
}

export function parseDmarc(record) {
  const tags = {};
  for (const part of record.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k) tags[k] = part.slice(i + 1).trim();
  }
  return tags;
}

export async function checkDomain(resolve, domain, sendingSubdomain) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  domain = domain.trim().toLowerCase().replace(/\.$/, '');
  const sending = (sendingSubdomain || '').trim().toLowerCase().replace(/\.$/, '');

  // SPF on the root domain
  const root = await txt(resolve, domain);
  const spf = root.records.filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (spf.length === 0) add('spf', 'SPF record', 'fail', `No SPF record at ${domain}.`);
  else if (spf.length > 1) add('spf', 'SPF record', 'fail', `${spf.length} SPF records at ${domain}. Receivers treat that as an error; merge them into one.`);
  else {
    const p = parseSpf(spf[0]);
    const count = await spfLookupCount(resolve, domain);
    if (count.lookups > 10) add('spf', 'SPF record', 'fail', `SPF needs ${count.lookups} DNS lookups; the limit is 10.`);
    else if (p.all === '+') add('spf', 'SPF record', 'fail', 'SPF ends in +all, which lets anyone send as this domain.');
    else add('spf', 'SPF record', 'pass', `One SPF record, ${count.lookups} of 10 lookups, ends in ${p.all ? p.all + 'all' : 'no all term'}.`);
  }

  // DMARC
  const dm = await txt(resolve, `_dmarc.${domain}`);
  const dmarc = dm.records.filter((r) => /^v=DMARC1(\s*;|$)/i.test(r));
  if (dmarc.length === 0) add('dmarc', 'DMARC policy', 'fail', `No DMARC record at _dmarc.${domain}. Gmail requires one (p=none at least) from bulk senders.`);
  else if (dmarc.length > 1) add('dmarc', 'DMARC policy', 'fail', 'More than one DMARC record; receivers ignore both.');
  else {
    const t = parseDmarc(dmarc[0]);
    const p = (t.p || '').toLowerCase();
    if (!['none', 'quarantine', 'reject'].includes(p)) add('dmarc', 'DMARC policy', 'fail', 'DMARC record has no valid p= tag.');
    else if (p === 'none') add('dmarc', 'DMARC policy', 'pass', 'p=none: meets Gmail’s minimum for bulk senders, but asks receivers to take no action on failures.');
    else add('dmarc', 'DMARC policy', 'pass', `p=${p}${t.pct && t.pct !== '100' ? ` on ${t.pct}% of mail` : ''}.`);
    if (t.rua) add('dmarc-rua', 'DMARC reports', 'pass', `Aggregate reports go to ${t.rua.split(',').length} address(es).`);
    else add('dmarc-rua', 'DMARC reports', 'warn', 'No rua= address, so nobody receives reports on who sends as this domain.');
  }

  // Branded sending subdomain (Klaviyo dynamic routing uses NS, static routing uses CNAME)
  if (sending) {
    const ns = await resolve(sending, 'NS');
    const cname = await resolve(sending, 'CNAME');
    const nsK = ns.answers.filter((a) => a.type === 'NS' && KLAVIYO_HOSTS.test(a.data));
    const cnK = cname.answers.filter((a) => a.type === 'CNAME' && KLAVIYO_HOSTS.test(a.data));
    if (nsK.length) add('bsd', 'Branded sending domain', 'pass', `${sending} is delegated to Klaviyo (NS, dynamic routing).`);
    else if (cnK.length) add('bsd', 'Branded sending domain', 'pass', `${sending} points to Klaviyo (CNAME, static routing).`);
    else add('bsd', 'Branded sending domain', 'warn', `${sending} does not point to Klaviyo. Check the subdomain in Klaviyo’s domain settings.`);
  } else {
    add('bsd', 'Branded sending domain', 'info', 'Enter the sending subdomain from Klaviyo (for example send.yourdomain.com) to check it.');
  }

  // DKIM: Klaviyo selectors at the root and at the sending subdomain
  const found = [];
  for (const base of [domain, ...(sending ? [sending] : [])]) {
    for (const sel of KLAVIYO_SELECTORS) {
      const host = `${sel}._domainkey.${base}`;
      const c = await resolve(host, 'CNAME');
      const cn = c.answers.find((a) => a.type === 'CNAME');
      if (cn) { found.push(`${host} → ${cn.data.replace(/\.$/, '')}`); continue; }
      const tx = await txt(resolve, host);
      if (tx.records.some((r) => /(^|;\s*)p=[A-Za-z0-9+/]/.test(r))) found.push(`${host} (key published)`);
    }
  }
  if (found.length) add('dkim', 'DKIM for Klaviyo', 'pass', `Found ${found.length}: ${found.slice(0, 3).join('; ')}${found.length > 3 ? '…' : ''}`);
  else add('dkim', 'DKIM for Klaviyo', 'warn', `No key at Klaviyo’s selectors (${KLAVIYO_SELECTORS.join(', ')}). Sending may use Klaviyo’s shared domain or another selector.`);

  add('unsub', 'One-click unsubscribe', 'info', 'DNS can’t show this. Check a test send for the List-Unsubscribe and List-Unsubscribe-Post headers.');
  const worst = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { domain, sending, checks, worst };
}
