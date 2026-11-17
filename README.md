# Reactivation pilot model for The Mane Choice

Prepared by Santiago.

A static site with two pages:

- `index.html`: the pilot model. List triage on a 200,000-contact synthetic list, the Apple privacy-open effect, a send-ramp simulator with Gmail spam-rate gates, a live SPF/DKIM/DMARC check, the five Klaviyo flows and where their events come from, the API requests checked against Klaviyo's published spec, Meta test sizing and the Amazon Attribution plan.
- `landing/index.html`: a press-capture landing page concept (email capture plus an Amazon button, no Shopify checkout) with a live log of every GA4 event, Klaviyo call and Amazon link it would send. Clearly marked as a concept; the form and buttons send nothing.

Deploy the folder as-is (Vercel: framework none, no build, output `.`). `vercel.json` sends `X-Robots-Tag: noindex, nofollow` and both pages carry a robots noindex tag.

## Measured

- Engine: 59 of 59 tests pass. 28 of 28 bugs planted one at a time in the engine were caught by the tests.
- Klaviyo: 12 of 12 requests (4 segments, 5 flows, 1 sign-up, 2 events) match Klaviyo's OpenAPI spec, revision 2026-10-15 (303 endpoints): method, path, required headers and query parameters, and the body. 15 of 15 errors planted in valid requests were rejected.
- List model: 200,000 synthetic profiles; 79,860 mailable in the pilot. Counting Apple privacy opens as engagement moves 64,160 profiles and grows warm from 12,075 to 76,235.
- Send ramp, 300 simulated pilots per cold complaint rate: at the default 0.25%, the ramp's 7-day Gmail rate crossed 0.3% in 5% of runs (a one-day blast: 0%, but it reads 0.19%, over Gmail's 0.1% target). At 0.5%, the blast crossed in 91% of runs and the ramp in 0.7%, stopping cold after 15,000 contacts.
- Meta at $2,000: a 50/50 creative test in the cold audience can detect a 18% difference in click-through, 68% in sign-up rate and 198% in Amazon purchases (80% power, 5% two-sided).
- Attribution plan: 20 ad groups, 0 problems (duplicates, unsafe characters, personal data in links).
- Site: 54 of 54 headless-Chrome checks pass, including mocked DNS lookups, the event log and 390px layouts; 0 axe-core violations on both pages, desktop and mobile.
- Model run time: 0.9 s for the list, triage, 1,800 ramps and 1,800 blasts.

## Not measured

- The real list. Every count comes from a synthetic list with the assumptions shown on the page.
- Complaint, bounce, click and Amazon purchase rates. They are inputs until the first batches and Attribution reports replace them.
- Live DNS for themanechoice.com from the build machine (its network blocks DNS). The check on the page runs in the visitor's browser through Cloudflare's DNS-over-HTTPS service; its parsing is tested against fixtures.
- Calls to Klaviyo, Amazon or Meta. Requests are validated, not sent. Klaviyo's spec does not forbid unknown extra fields, so a misspelt optional field would pass the check.
- NeverBounce pricing. Published figures disagree ($0.004 to $0.008 per address); both ends are shown.
- Meta CPM and click-through. Defaults sit inside published haircare ranges and are adjustable on the page.
