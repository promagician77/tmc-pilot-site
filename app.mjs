import { simulateRamp } from './engine/ramp.mjs';
import { metaPlan, testVerdict } from './engine/economics.mjs';
import { checkDomain, dohResolver } from './engine/dns.mjs';
import { dateOf } from './engine/calendar.mjs';

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (x, dp = 0) => `${(x * 100).toFixed(dp)}%`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const TIER_COLOR = { warm: 'var(--warm)', medium: 'var(--medium)', cold: 'var(--cold)', sunset: 'var(--sunset)' };
const TIER_NAME = { warm: 'Warm', medium: 'Medium', cold: 'Cold', sunset: 'Sunset' };
const RESULT_NAME = { valid: 'Valid', catchall: 'Catch-all', invalid: 'Invalid', disposable: 'Disposable', unknown: 'Unknown' };
const STATUS_GLYPH = { pass: '✓', warn: '!', fail: '×', info: 'i' };
const STATUS_WORD = { pass: 'Pass', warn: 'Check', fail: 'Fail', info: 'Note' };
const icon = (status) => `<span class="icon ${status}" aria-hidden="true">${STATUS_GLYPH[status]}</span><span class="visually-hidden">${STATUS_WORD[status]}: </span>`;

const data = await (await fetch('data/results.json')).json();
const TIERS = ['warm', 'medium', 'cold', 'sunset'];
const L = data.list;

/* ---------- Hero: the list bar ---------- */
function renderListbar(useMpp) {
  const totals = useMpp ? L.mpp.tierTotals : L.tierTotals;
  const mailable = useMpp ? L.mpp.mailable : L.mailable;
  const bar = $('#listbar');
  if (!bar.children.length) {
    bar.innerHTML = TIERS.map((t) => `<div class="seg" data-tier="${t}" style="--c:${TIER_COLOR[t]}"><div class="part solid"></div><div class="part striped"></div></div>`).join('');
  }
  for (const t of TIERS) {
    const seg = bar.querySelector(`[data-tier="${t}"]`);
    const m = mailable[t];
    const rest = totals[t] - m;
    seg.style.flexGrow = totals[t];
    const [solid, striped] = seg.children;
    solid.style.flexGrow = m;
    striped.style.flexGrow = rest;
    solid.style.display = m ? '' : 'none';
    striped.style.display = rest ? '' : 'none';
  }
  const labels = $('#listbar-labels');
  labels.innerHTML = TIERS.map((t) => `<div class="lab" style="--c:${TIER_COLOR[t]}"><strong><span class="key"></span>${TIER_NAME[t]}</strong><span>${fmt(totals[t])} contacts</span><span>${t === 'sunset' ? 'not mailed in the pilot' : `${fmt(mailable[t])} mailable`}</span></div>`).join('');
  bar.setAttribute('aria-label', TIERS.map((t) => `${TIER_NAME[t]}: ${fmt(totals[t])} contacts, ${fmt(mailable[t])} mailable`).join('; '));
  const note = $('#mpp-note');
  if (useMpp) {
    note.innerHTML = `<strong>${fmt(L.mpp.moved)} contacts change tier</strong> and warm grows from ${fmt(L.tierTotals.warm)} to ${fmt(L.mpp.tierTotals.warm)}. Their &ldquo;open&rdquo; is Apple Mail loading the last send (assumed ${L.assumptions.lastSendDaysAgo} days ago), not a person reading it. Mailing them as warm would put cold-tier complaint rates into the first, unguarded week.`;
  } else {
    note.textContent = 'Opens ignored. Tiers come from email clicks, own-site orders and site visits.';
  }
}
$('#mpp-toggle').addEventListener('change', (e) => renderListbar(e.target.checked));
renderListbar(false);

/* ---------- Findings ---------- */
const mailableTotal = L.mailable.warm + L.mailable.medium + L.mailable.cold;
const coldMde = data.economics.meta.cold.mde;
const findings = [
  [`${fmt(mailableTotal)} of 200,000`, 'are verified and active in the last 2 years, so they’re mailed in the pilot. The other 120,000 are failed addresses or the sunset tier.', '#list'],
  [`${(L.mpp.tierTotals.warm / L.tierTotals.warm).toFixed(1)}× more “warm”`, 'if Apple’s automatic opens count as engagement. The tiers here use clicks, orders and visits only.', '#list'],
  ['0 Amazon events', 'reach Klaviyo per shopper, so cart, browse and post-purchase flows never fire from Amazon traffic. The landing page closes part of that gap.', '#flows'],
  ['Clicks yes, purchases no', `A $2,000 Meta test can separate two creatives on click-through (a ${pct(coldMde.ctr)} difference), not on Amazon orders.`, '#money'],
  [`${money(L.cost.low)} to ${money(L.cost.high)}`, `to verify 200,000 addresses. At the top of that range, verification plus the $1,500 ad minimum passes the $3,000 cap.`, '#list'],
];
$('#findings').innerHTML = findings.map(([big, text, href]) => `<li><span class="big">${big}</span><p>${text} <a href="${href}">See how</a></p></li>`).join('');

/* ---------- List triage ---------- */
function renderMatrix() {
  const cols = ['valid', 'catchall', 'invalid', 'disposable', 'unknown'];
  const head = `<thead><tr><th scope="col">Tier</th>${cols.map((c) => `<th scope="col">${RESULT_NAME[c]}</th>`).join('')}<th scope="col">Total</th><th scope="col">Mailable</th></tr></thead>`;
  const rows = TIERS.map((t) => `<tr><th scope="row" class="text"><span class="tierkey" style="--c:${TIER_COLOR[t]}">${TIER_NAME[t]}</span></th>${cols.map((c) => `<td>${fmt(L.matrix[t][c])}</td>`).join('')}<td>${fmt(L.tierTotals[t])}</td><td>${fmt(L.mailable[t])}</td></tr>`).join('');
  const total = `<tr class="total"><td>All</td>${cols.map((c) => `<td>${fmt(L.totals[c])}</td>`).join('')}<td>${fmt(200000)}</td><td>${fmt(mailableTotal)}</td></tr>`;
  $('#matrix').innerHTML = `${head}<tbody>${rows}${total}</tbody>`;
  $('#matrix-note').textContent = `Catch-all domains accept any address, so a bounce can’t be ruled out. They are mailed only when the person engaged in the last year. ${fmt(L.buyersMailable.warm + L.buyersMailable.medium + L.buyersMailable.cold)} mailable contacts have bought on the brand’s own site: the seed for a Meta lookalike (Meta asks for 100 or more, ideally 1,000 to 5,000).`;
  $('#policy').innerHTML = [
    ['Warm', 'Valid and catch-all. First to be mailed, from 25 Nov.'],
    ['Medium', 'Valid and catch-all, once warm reads green.'],
    ['Cold', 'Valid only, in guarded batches once medium reads green.'],
    ['Sunset', 'Not mailed in the pilot. Re-permission test in Phase 2.'],
    ['Everyone', 'Invalid, disposable and unknown results are suppressed.'],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const b = L.budget;
  const firstThree = L.tierTotals.warm + L.tierTotals.medium + L.tierTotals.cold;
  $('#budget').innerHTML = `<p>NeverBounce: <strong>${money(L.cost.low)}</strong> at $0.004 per address (volume tier) to <strong>${money(L.cost.high)}</strong> at $0.008 (pay-as-you-go). Published figures disagree, so a written quote decides.</p>
  <p>The tools-and-ads budget tops out at $3,000 and ad spend is set at $1,500 to $2,500. At ${money(L.cost.high)}, ${money(b.atHigh.room)} is left for ads, below the minimum. At ${money(L.cost.low)}, ads can go up to ${money(b.atLow.adSpendPossible)}.</p>
  <p>Cheaper route: verify the ${fmt(firstThree)} warm, medium and cold contacts first (${money(L.costMailableOnly.low)} to ${money(L.costMailableOnly.high)}) and the sunset tier in Phase 2.</p>`;
  const a = L.assumptions;
  const va = L.verifyAssumptions;
  $('#list-assumptions').innerHTML = `<ul>
    <li>Email domains: ${a.domains.map(([d, w]) => `${d === 'other' ? 'other domains' : d} ${pct(w)}`).join(', ')}.</li>
    <li>Last real engagement (click, own-site order or visit): ${a.recency.map(([b, w]) => `${b === 'never' ? 'never' : b + ' days'} ${pct(w)}`).join(', ')}.</li>
    <li>Signups spread from ${a.signupYears[0][0]} to ${a.signupYears[a.signupYears.length - 1][0]}. Invalid rate ${pct(va.invalidBase, 1)} plus ${pct(va.invalidPerYear, 1)} a year since signup, plus ${pct(va.invalidNeverEngaged)} for people who never engaged. ${pct(va.catchallOther)} of addresses on non-major domains come back catch-all.</li>
    <li>Apple Mail Privacy Protection: ${pct(a.appleMppShare['icloud.com'])} of iCloud addresses, ${pct(a.appleMppShare.default)} elsewhere. Last send to the list assumed ${a.lastSendDaysAgo} days ago.</li>
    <li>${pct(a.ownSiteBuyerShare)} have bought on the brand’s own site at some point.</li>
  </ul>`;
}
renderMatrix();

/* ---------- DNS pre-flight ---------- */
$('#dns-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#dns-results');
  const domain = $('#dns-domain').value.trim();
  const sending = $('#dns-sending').value.trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    out.innerHTML = `<li>${icon('fail')}<span class="lbl">Domain</span><span class="det">Enter a domain such as themanechoice.com.</span></li>`;
    return;
  }
  out.innerHTML = `<li>${icon('info')}<span class="lbl">Checking</span><span class="det">Looking up ${esc(domain)}…</span></li>`;
  try {
    const res = await checkDomain(dohResolver(window.fetch.bind(window)), domain, sending);
    out.innerHTML = res.checks.map((c) => `<li data-check="${c.id}">${icon(c.status)}<span class="lbl">${esc(c.label)}</span><span class="det">${esc(c.detail)}</span></li>`).join('');
  } catch (err) {
    out.innerHTML = `<li>${icon('warn')}<span class="lbl">Lookup failed</span><span class="det">Couldn’t reach the DNS service from this browser (${esc(err.message)}). Try again, or from another network.</span></li>`;
  }
});

/* ---------- Ramp simulator ---------- */
const R = data.ramp;
const simState = { cold: 0.0025, seed: R.seed };
const NS = 'http://www.w3.org/2000/svg';

function niceTicks(max, count = 4) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
const compact = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : String(v));

function rollingSeries(days) {
  return days.map((d) => {
    let g = 0;
    let c = 0;
    for (const x of days) if (x.day <= d.day && x.day > d.day - 7) for (const s of x.sends) { g += s.gmail; c += s.complaintsGmail; }
    // Below 2,000 Gmail sends in the window the rate is too noisy to plot (Postmaster also hides low-volume days).
    return { day: d.day, rate: g >= 2000 ? c / g : null, gmail: g };
  });
}

function chartFrame(el, h, yTicks, yFmt, yTitle) {
  const W = 760;
  const M = { l: 48, r: 14, t: 22, b: 26 };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
  svg.setAttribute('role', 'img');
  const iw = W - M.l - M.r;
  const ih = h - M.t - M.b;
  const ymax = yTicks[yTicks.length - 1];
  const y = (v) => M.t + ih - (v / ymax) * ih;
  const band = iw / 42;
  const x = (day) => M.l + day * band;
  let s = `<text class="axis-title" x="${M.l}" y="12">${yTitle}</text>`;
  for (const t of yTicks) {
    s += `<line class="${t === 0 ? 'baseline' : 'grid'}" x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text x="${M.l - 8}" y="${y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`;
  }
  for (let d = 0; d <= 41; d += 7) s += `<text x="${x(d) + band / 2}" y="${h - 8}" text-anchor="middle">${shortDate(dateOf(d))}</text>`;
  svg.innerHTML = s;
  el.replaceChildren(svg);
  return { svg, x, y, band, M, ih, W, h };
}

function showTip(evt, html) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const host = $('.sim-charts').getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = evt.clientX - host.left + 14;
  if (left + tr.width > host.width) left = evt.clientX - host.left - tr.width - 14;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, evt.clientY - host.top - tr.height - 10)}px`;
}
const hideTip = () => { $('#tooltip').hidden = true; };

function dayTip(d, roll) {
  const head = `<strong>${shortDate(d.date)}${d.note === 'blackout' ? ', no sends (holiday)' : d.note === 'prep' ? ', verification and set-up' : ''}</strong>`;
  const rows = d.sends.map((s) => `<div class="row"><i style="--c:${TIER_COLOR[s.tier]}"></i>${TIER_NAME[s.tier]} ${s.campaign}${s.firstTouch ? ' first touch' : ''}: ${fmt(s.sent)} sent, ${s.complaintsGmail} Gmail complaints${s.decision ? `, then ${s.decision.replace('-', ' ')}` : ''}</div>`).join('');
  const r = roll && roll.rate !== null ? `<div class="row">7-day Gmail rate: ${pct(roll.rate, 3)}</div>` : '';
  return head + (rows || (d.note ? '' : '<div class="row">No send</div>')) + r;
}

function drawRamp(run) {
  const days = run.days;
  const totals = days.map((d) => d.sends.reduce((a, s) => a + s.sent, 0));
  const yt = niceTicks(Math.max(...totals, 1000));
  const f = chartFrame($('#chart-sends'), 230, yt, compact, 'Emails sent per day');
  f.svg.setAttribute('aria-label', `Emails sent per day by tier, 24 Nov to 4 Jan. Peak ${fmt(Math.max(...totals))}.`);
  let marks = '';
  const bw = Math.min(14, f.band - 4);
  for (const d of days) {
    const order = ['warm', 'medium', 'cold'];
    const byTier = Object.fromEntries(order.map((t) => [t, d.sends.filter((s) => s.tier === t).reduce((a, s) => a + s.sent, 0)]));
    let base = 0;
    const present = order.filter((t) => byTier[t] > 0);
    present.forEach((t, i) => {
      const v = byTier[t];
      const y0 = f.y(base);
      const y1 = f.y(base + v);
      const top = i === present.length - 1;
      const hgt = Math.max(1, y0 - y1 - (i > 0 ? 2 : 0));
      const xx = f.x(d.day) + (f.band - bw) / 2;
      const yy = y1;
      if (top && hgt > 4) {
        const r = 3;
        marks += `<path d="M${xx},${yy + hgt} V${yy + r} Q${xx},${yy} ${xx + r},${yy} H${xx + bw - r} Q${xx + bw},${yy} ${xx + bw},${yy + r} V${yy + hgt} Z" fill="${TIER_COLOR[t]}"/>`;
      } else {
        marks += `<rect x="${xx}" y="${yy}" width="${bw}" height="${hgt}" fill="${TIER_COLOR[t]}"/>`;
      }
      base += v;
    });
  }
  const shade = days.filter((d) => d.note === 'blackout').map((d) => `<rect class="blackout" x="${f.x(d.day)}" y="${f.M.t}" width="${f.band}" height="${f.ih}"/>`).join('');
  f.svg.insertAdjacentHTML('afterbegin', shade);
  const roll = rollingSeries(days);
  let hits = '';
  for (const d of days) hits += `<rect class="hit" data-day="${d.day}" x="${f.x(d.day)}" y="${f.M.t}" width="${f.band}" height="${f.ih}"/>`;
  f.svg.insertAdjacentHTML('beforeend', marks + hits);

  const maxRate = Math.max(0.0035, ...roll.map((r) => r.rate || 0));
  const rt = niceTicks(maxRate * 1.05, 4);
  const g = chartFrame($('#chart-rate'), 190, rt, (v) => `${(v * 100).toFixed(2).replace(/0$/, '')}%`, '7-day spam rate at Gmail, all sends (hidden under 2,000 sends)');
  g.svg.setAttribute('aria-label', `Rolling 7-day Gmail spam rate. Highest ${pct(Math.max(...roll.map((r) => r.rate || 0)), 3)}; Gmail’s limit is 0.3%.`);
  let s = '';
  for (const [v, cls, label] of [[0.001, 'var(--warn)', '0.1%: Gmail’s target'], [0.003, 'var(--bad)', '0.3%: Gmail’s limit']]) {
    s += `<line class="ref" x1="${g.M.l}" x2="${g.W - g.M.r}" y1="${g.y(v)}" y2="${g.y(v)}" stroke="${cls}"/>`;
    s += `<text x="${g.W - g.M.r}" y="${g.y(v) - 5}" text-anchor="end" fill="var(--ink-2)">${label}</text>`;
  }
  let path = '';
  let pen = false;
  for (const r of roll) {
    if (r.rate === null) { pen = false; continue; }
    const px = g.x(r.day) + g.band / 2;
    const py = g.y(r.rate);
    path += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)} `;
    pen = true;
  }
  s += `<path d="${path}" fill="none" stroke="var(--plum)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const peak = roll.reduce((a, r) => (r.rate !== null && r.rate > (a?.rate ?? -1) ? r : a), null);
  if (peak) {
    s += `<circle cx="${g.x(peak.day) + g.band / 2}" cy="${g.y(peak.rate)}" r="4.5" fill="var(--plum)" stroke="#fff" stroke-width="2"/>`;
    s += `<text x="${g.x(peak.day) + g.band / 2}" y="${g.y(peak.rate) - 9}" text-anchor="middle" fill="var(--ink)">peak ${pct(peak.rate, 2)}</text>`;
  }
  for (const d of days) s += `<rect class="hit" data-day="${d.day}" x="${g.x(d.day)}" y="${g.M.t}" width="${g.band}" height="${g.ih}"/>`;
  g.svg.insertAdjacentHTML('beforeend', s);

  for (const rect of document.querySelectorAll('.sim-charts .hit')) {
    const d = days[Number(rect.dataset.day)];
    rect.addEventListener('mousemove', (e) => {
      document.querySelectorAll(`.sim-charts .hit`).forEach((h) => h.classList.toggle('on', h.dataset.day === rect.dataset.day));
      showTip(e, dayTip(d, roll[d.day]));
    });
    rect.addEventListener('mouseleave', () => { hideTip(); document.querySelectorAll('.sim-charts .hit.on').forEach((h) => h.classList.remove('on')); });
  }

  const m = R.mailable;
  const stopDay = run.stopped.cold;
  $('#sim-stats').innerHTML = [
    ['Warm reached', `${fmt(run.reached.warm)} of ${fmt(m.warm)}`],
    ['Medium reached', `${fmt(run.reached.medium)} of ${fmt(m.medium)}`],
    ['Cold reached by 4 Jan', `${fmt(run.reached.cold)} (${pct(run.share.cold)})`],
    ['Cold tier stopped', stopDay === null ? 'No' : `${shortDate(dateOf(stopDay))}, after ${fmt(run.exposedBeforeStop.cold)}`],
    ['7-day rate over 0.3%', run.breaches ? `${run.breaches} time${run.breaches > 1 ? 's' : ''}` : 'Never'],
    ['Send days', String(run.sendDays)],
    ['Days over 5,000 Gmail sends', String(run.bulkDays)],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const rowsHtml = days.flatMap((d) => d.sends.map((s) => `<tr><td>${shortDate(d.date)}</td><td class="text"><span class="tierkey" style="--c:${TIER_COLOR[s.tier]}">${TIER_NAME[s.tier]}</span></td><td class="text">${s.campaign}${s.firstTouch ? ' first touch' : ''}</td><td>${fmt(s.sent)}</td><td>${fmt(s.gmail)}</td><td>${s.complaintsGmail}</td><td>${s.bounces}</td><td>${s.clicks}</td><td class="text">${s.decision ? s.decision.replace('-', ' ') : 'read after 4 Jan'}</td></tr>`)).join('');
  $('#sends-table').innerHTML = `<thead><tr><th scope="col">Date</th><th scope="col" class="text">Tier</th><th scope="col" class="text">Campaign</th><th scope="col">Sent</th><th scope="col">Gmail</th><th scope="col">Gmail complaints</th><th scope="col">Bounces</th><th scope="col">Clicks</th><th scope="col" class="text">Decision 2 days later</th></tr></thead><tbody>${rowsHtml}</tbody>`;
}

function runSim() {
  const run = simulateRamp({ mailable: R.mailable, gmailShare: R.gmailShare, rates: { complaint: { cold: simState.cold } }, seed: simState.seed });
  drawRamp(run);
}
$('#ramp-legend').innerHTML = ['warm', 'medium', 'cold'].map((t) => `<span><i style="--c:${TIER_COLOR[t]}"></i>${TIER_NAME[t]}</span>`).join('') + '<span><i class="line" style="--c:var(--plum)"></i>7-day Gmail spam rate (lower chart)</span><span><i style="--c:#e4dde9"></i>No sends: 26 Nov, 25 Dec, 1 Jan</span>';
$('#cold-rate').addEventListener('input', (e) => {
  simState.cold = Number(e.target.value) / 100;
  $('#cold-rate-out').textContent = `${Number(e.target.value).toFixed(2)}%`;
  runSim();
});
$('#rerun').addEventListener('click', () => { simState.seed += 1; runSim(); });
$('#reset-sim').addEventListener('click', () => {
  simState.cold = 0.0025;
  simState.seed = R.seed;
  $('#cold-rate').value = '0.25';
  $('#cold-rate-out').textContent = '0.25%';
  runSim();
});
runSim();

function renderSweep() {
  const head = '<thead><tr><th scope="col">Cold complaint rate</th><th scope="col">Blast: one-day reading</th><th scope="col">Blast over 0.3%</th><th scope="col">Ramp: 7-day rate over 0.3%</th><th scope="col">Ramp: cold tier stopped</th><th scope="col">Ramp: cold reached by 4 Jan</th><th scope="col">Cold mailed before a stop</th></tr></thead>';
  const rows = R.sweep.map((s) => `<tr${s.cold === 0.0025 ? ' class="total"' : ''}><td>${pct(s.cold, 2)}${s.cold === 0.0025 ? ' (default)' : ''}</td><td>${pct(s.expectedBlast, 2)}</td><td>${pct(s.blastBreachProbability)} of runs</td><td>${pct(s.rampBreachProbability)} of runs</td><td>${pct(s.coldStoppedProbability)} of runs</td><td>${pct(s.medianColdReached)}</td><td>${s.medianColdExposedAtStop === null ? 'never stopped' : fmt(s.medianColdExposedAtStop)}</td></tr>`).join('');
  $('#sweep').innerHTML = head + `<tbody>${rows}</tbody>`;
  const def = R.sweep.find((s) => s.cold === 0.0025);
  const hi = R.sweep.find((s) => s.cold === 0.005);
  $('#sweep-note').textContent = `Read it both ways. At the default ${pct(0.0025, 2)}, a one-day blast mixes cold into warm and medium mail and reads about ${pct(def.expectedBlast, 2)}: under Gmail\u2019s limit, over its 0.1% target. The ramp crossed 0.3% in ${pct(def.rampBreachProbability)} of runs and reached a median ${pct(def.medianColdReached)} of cold by 4 January; the rest waits for weeks with enough engaged mail to send beside it. At ${pct(0.005, 1)}, the blast crosses in ${pct(hi.blastBreachProbability)} of runs with all ${fmt(R.mailable.cold)} cold contacts exposed on day one, while the ramp stops cold after ${fmt(hi.medianColdExposedAtStop)}. The real rate is unknown until the first cold batches go out, which is the case for ramping.`;
}
renderSweep();

$('#campaigns').innerHTML = data.campaigns.map((c) => `<li><div class="when">${shortDate(c.from)} to ${shortDate(c.to)}</div><div class="cname">${c.id}: ${esc(c.name)}</div><div class="subject">“${esc(c.subject)}”</div><div class="chips">${c.tiers.map((t) => `<span class="chip" style="--c:${TIER_COLOR[t]}">${TIER_NAME[t]}</span>`).join('')}<span class="chip plain">${{ new: 'first touch, ramped', reached: 'everyone reached', clickers: 'clickers only', nonclickers: 'non-clickers only' }[c.audience]}</span></div><p>${esc(c.purpose)}</p></li>`).join('');

/* ---------- Flows ---------- */
const K = data.klaviyo;
$('#sources').innerHTML = [
  { cls: '', title: 'Own store', via: 'Klaviyo onsite tracking', events: ['Active on Site', 'Viewed Product', 'Started Checkout', 'Placed Order'], fires: '<strong>Fires:</strong> browse abandonment, abandoned cart, post-purchase, win-back.' },
  { cls: '', title: 'Landing page', via: 'Klaviyo client API, public key only', events: ['Joins the press-capture list', 'Viewed Product (email clickers, identified by _kx)', 'Clicked Amazon CTA'], fires: '<strong>Fires:</strong> welcome and browse abandonment. A click to Amazon keeps that person out of browse emails.' },
  { cls: 'amazon', title: 'Amazon', via: 'Amazon Attribution, per tag', events: ['Clicks and detail page views', 'Add-to-carts', 'Purchases and sales, 14-day window'], fires: '<strong>Fires:</strong> nothing. Amazon never says who bought, so these numbers go into the weekly report.' },
].map((s) => `<div class="source ${s.cls}"><h3>${s.title}</h3><div class="via">${s.via}</div><ul class="events">${s.events.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><div class="fires">${s.fires}</div></div>`).join('');

$('#flow-cards').innerHTML = K.flows.map((f) => `<article class="flow"><h4>${esc(f.name.replace('Pilot | ', ''))}</h4><div class="trigger">Trigger: ${esc(f.triggerLabel)}</div><ol class="steps">${f.steps.map((s) => (s.kind === 'delay' ? `<li class="delay">Wait ${s.value} ${s.value === 1 ? s.unit.replace(/s$/, '') : s.unit}</li>` : `<li><span class="subj">“${esc(s.subject)}”</span></li>`)).join('')}</ol>${f.gap ? `<p class="gap">${esc(f.gap)}</p>` : ''}</article>`).join('');

const okCount = K.requests.filter((r) => r.ok).length;
const caught = K.planted.filter((p) => p.caught).length;
$('#payload-summary').textContent = `${okCount} of ${K.requests.length} requests match Klaviyo’s OpenAPI spec, revision ${K.spec.version} (${K.spec.paths} endpoints): method, path, required headers and query parameters, and every field of the body. ${caught} of ${K.planted.length} planted errors were rejected. Metric, list and template IDs in capitals are filled in from the account on day 1.`;
$('#payloads').innerHTML = K.requests.map((r) => {
  const q = Object.entries(r.query || {}).map(([k, v]) => `${k}=${v}`).join('&');
  const text = `${r.method} https://a.klaviyo.com${r.path}${q ? '?' + q : ''}\nrevision: ${r.headers.revision}\n\n${JSON.stringify(r.body, null, 2)}`;
  return `<details class="payload"><summary>${icon(r.ok ? 'pass' : 'fail')}<span class="method">${r.method}</span><span>${esc(r.title)}</span><span class="path mono">${esc(r.path)}</span></summary><pre class="mono" tabindex="0">${esc(text)}</pre></details>`;
}).join('');
$('#planted').innerHTML = `<thead><tr><th scope="col" class="text">Planted error</th><th scope="col" class="text">Result</th><th scope="col" class="text">What the check reported</th></tr></thead><tbody>${K.planted.map((p) => `<tr><td class="text">${esc(p.name)}</td><td class="text">${p.caught ? 'Rejected' : 'Missed'}</td><td class="text mono">${esc(p.problem || '')}</td></tr>`).join('')}</tbody>`;

/* ---------- Money ---------- */
const E = data.economics;
const mState = { spend: 2000, warmShare: 0.4, cpmCold: 12, ctrCold: 0.01 };
function renderMoney() {
  const a = E.assumptions.meta;
  const p = metaPlan({ spend: mState.spend, warmShare: mState.warmShare, cpm: { ...a.cpm, cold: mState.cpmCold }, ctr: { ...a.ctr, cold: mState.ctrCold } });
  $('#m-spend-out').textContent = money(mState.spend);
  $('#m-warm-out').textContent = pct(mState.warmShare);
  $('#m-cpm-out').textContent = money(mState.cpmCold);
  $('#m-ctr-out').textContent = pct(mState.ctrCold, 1);
  const rows = [
    ['Spend', (o) => money(o.spend)],
    ['Impressions', (o) => fmt(o.impressions)],
    ['Link clicks', (o) => fmt(o.clicks)],
    ['Email sign-ups', (o) => fmt(o.leads)],
    ['Clicks to Amazon', (o) => fmt(o.amazonClicks)],
    ['Amazon orders', (o) => fmt(o.orders)],
    ['Cost per sign-up', (o) => (o.leads ? money(o.spend / o.leads) : '–')],
    ['Cost per Amazon order', (o) => (o.orders ? money(o.spend / o.orders) : '–')],
    ['Amazon sales', (o) => money(o.sales)],
    ['Return on ad spend', (o) => `${o.roas.toFixed(2)}×`],
    ['With 10% Brand Referral Bonus', (o) => `${o.roasWithBonus.toFixed(2)}×`],
  ];
  $('#meta-table').innerHTML = `<thead><tr><th scope="col">Measure</th><th scope="col">Warm retargeting</th><th scope="col">Cold lookalike</th><th scope="col">Total</th></tr></thead><tbody>${rows.map(([k, f]) => `<tr><td>${k}</td><td>${f(p.warm)}</td><td>${f(p.cold)}</td><td>${f(p.total)}</td></tr>`).join('')}</tbody>`;
  const v = testVerdict(p.cold.mde);
  const line = (label, x, base) => `<li>${icon(x.usable ? 'pass' : 'fail')}<span class="lbl">${label}</span><span class="det">${x.usable ? 'Decidable' : 'Not decidable'}: the smallest difference this budget can detect is ${x.mde} ${base}.</span></li>`;
  $('#verdict').innerHTML = line('Click-through', v.ctr, `(${fmt(p.cold.impressions / 2)} impressions per creative)`)
    + line('Sign-up rate', v.signup, `(${fmt(p.cold.clicks / 2)} visitors per creative)`)
    + line('Amazon purchases', v.purchase, `(about ${fmt(p.cold.orders / 2)} orders per creative)`);
}
for (const [id, key, scale] of [['#m-spend', 'spend', 1], ['#m-warm', 'warmShare', 1], ['#m-cpm', 'cpmCold', 1], ['#m-ctr', 'ctrCold', 0.01]]) {
  $(id).addEventListener('input', (e) => { mState[key] = Number(e.target.value) * scale; renderMoney(); });
}
renderMoney();

const em = E.email;
$('#email-table').innerHTML = `<thead><tr><th scope="col">Scenario</th><th scope="col">Email clicks</th><th scope="col">Purchases per click</th><th scope="col">Amazon orders</th><th scope="col">Sales</th><th scope="col">Bonus credit</th></tr></thead><tbody>${['low', 'mid', 'high'].map((k) => `<tr><td>${k[0].toUpperCase() + k.slice(1)}</td><td>${fmt(em[k].clicks)}</td><td>${pct(E.assumptions.email.purchasePerClick[k])}</td><td>${fmt(em[k].orders)}</td><td>${money(em[k].sales)}</td><td>${money(em[k].bonus)}</td></tr>`).join('')}</tbody>`;

const T = data.tags;
$('#tags-note').textContent = `${T.rows.length} Attribution ad groups: one per campaign and tier, one per Meta ad set and creative, and one per landing-page source. ${T.errors.length ? T.errors.length + ' problems' : 'No duplicates and no personal data in any link'}.`;
$('#tags').innerHTML = `<thead><tr><th scope="col" class="text">Channel</th><th scope="col" class="text">Ad group</th><th scope="col" class="text">utm_content</th></tr></thead><tbody>${T.rows.map((r) => `<tr><td class="text">${esc(r.channel)}</td><td class="text mono">${esc(r.adGroup)}</td><td class="text mono">${r.utm ? esc(r.utm.utm_content) : 'from visitor’s source'}</td></tr>`).join('')}</tbody>`;

/* ---------- Measured ---------- */
const mut = data.mutation;
const measured = [
  data.tests ? `${data.tests.pass} of ${data.tests.tests} tests pass.` : null,
  mut ? `${mut.caught} of ${mut.applied} bugs planted in the engine were caught by the tests.` : null,
  `${okCount} of ${K.requests.length} Klaviyo requests match the published spec (revision ${K.spec.version}); ${caught} of ${K.planted.length} planted request errors rejected.`,
  `200,000-row list generated, verified and tiered, plus ${fmt(R.sweep.length * R.sweep[0].runs)} simulated ramps and as many blasts, in ${(data.runtimeMs / 1000).toFixed(1)} s.`,
  `${T.rows.length} Attribution ad groups checked: ${T.errors.length} problems.`,
  data.qa ? `Site checked in headless Chrome: ${data.qa.passed} of ${data.qa.total} checks, ${data.qa.axeViolations} accessibility violations (axe-core).` : null,
].filter(Boolean);
$('#measured-list').innerHTML = measured.map((m) => `<li>${esc(m)}</li>`).join('');
$('#generated').textContent = `Model run ${new Date(data.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC.`;
document.documentElement.dataset.ready = 'true';
