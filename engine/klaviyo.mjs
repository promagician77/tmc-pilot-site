// Klaviyo API requests for the pilot: 4 tier segments, 5 flows, the landing-page sign-up and the
// two landing-page events. Built against Klaviyo's published OpenAPI spec (revision 2026-10-15);
// src/node/klaviyo-validate.mjs checks every body against it.
//
// IDs in CAPITALS are account-specific (metric, list and template IDs). They are looked up with
// GET /api/metrics, GET /api/lists and GET /api/templates on day 1 and swapped in.

export const REVISION = '2026-10-15';

export const METRIC = {
  clickedEmail: 'METRIC_ID_CLICKED_EMAIL',
  placedOrder: 'METRIC_ID_PLACED_ORDER',
  activeOnSite: 'METRIC_ID_ACTIVE_ON_SITE',
  viewedProduct: 'METRIC_ID_VIEWED_PRODUCT',
  startedCheckout: 'METRIC_ID_STARTED_CHECKOUT',
  clickedAmazonCta: 'METRIC_ID_CLICKED_AMAZON_CTA',
};
export const LIST_PRESS_CAPTURE = 'LIST_ID_PRESS_CAPTURE';
export const FROM = { email: 'FROM_EMAIL_ON_BRANDED_DOMAIN', label: 'The Mane Choice' };

const ENGAGEMENT = [METRIC.clickedEmail, METRIC.placedOrder, METRIC.activeOnSite];

const inLast = (days) => ({ type: 'date', operator: 'in-the-last', unit: 'day', quantity: days });
const atLeastOnce = (metricId, days) => ({
  type: 'profile-metric', metric_id: metricId, measurement: 'count',
  measurement_filter: { type: 'numeric', operator: 'greater-than-or-equal', value: 1 },
  timeframe_filter: inLast(days),
});
const zeroTimes = (metricId, days) => ({
  type: 'profile-metric', metric_id: metricId, measurement: 'count',
  measurement_filter: { type: 'numeric', operator: 'equals', value: 0 },
  timeframe_filter: inLast(days),
});
const zeroSinceFlowStart = (metricId) => ({
  type: 'profile-metric', metric_id: metricId, measurement: 'count',
  measurement_filter: { type: 'numeric', operator: 'equals', value: 0 },
  timeframe_filter: { type: 'date', operator: 'flow-start' },
});
const consent = {
  conditions: [{
    type: 'profile-marketing-consent',
    consent: { channel: 'email', can_receive_marketing: true, consent_status: { subscription: 'subscribed' } },
  }],
};
// NeverBounce results are written to a profile property during import.
const verified = (results) => ({
  conditions: results.map((r) => ({
    type: 'profile-property', property: "properties['nb_result']",
    filter: { type: 'string', operator: 'equals', value: r },
  })),
});

// Groups are ANDed; conditions inside a group are ORed (per the spec's own description).
export const SEGMENT_DEFS = [
  {
    tier: 'warm', name: 'Pilot | Warm | engaged 0-180d',
    groups: [consent, verified(['valid', 'catchall']), { conditions: ENGAGEMENT.map((m) => atLeastOnce(m, 180)) }],
  },
  {
    tier: 'medium', name: 'Pilot | Medium | engaged 181-365d',
    groups: [consent, verified(['valid', 'catchall']), { conditions: ENGAGEMENT.map((m) => atLeastOnce(m, 365)) },
      ...ENGAGEMENT.map((m) => ({ conditions: [zeroTimes(m, 180)] }))],
  },
  {
    tier: 'cold', name: 'Pilot | Cold | engaged 366-730d',
    groups: [consent, verified(['valid']), { conditions: ENGAGEMENT.map((m) => atLeastOnce(m, 730)) },
      ...ENGAGEMENT.map((m) => ({ conditions: [zeroTimes(m, 365)] }))],
  },
  {
    tier: 'sunset', name: 'Pilot | Sunset | no engagement 730d+ (not mailed)',
    groups: [consent, ...ENGAGEMENT.map((m) => ({ conditions: [zeroTimes(m, 730)] }))],
  },
];

export function segmentRequests() {
  return SEGMENT_DEFS.map((s) => ({
    id: `segment-${s.tier}`,
    title: `Create segment: ${s.name}`,
    method: 'POST', path: '/api/segments',
    headers: { revision: REVISION }, query: {},
    schema: 'SegmentCreateQuery',
    body: { data: { type: 'segment', attributes: { name: s.name, definition: { condition_groups: s.groups } } } },
  }));
}

function chain(steps) {
  // steps: [{kind:'email', ...} | {kind:'delay', unit, value}]
  const actions = steps.map((st, i) => {
    const temporary_id = `a${i + 1}`;
    const next = i + 1 < steps.length ? `a${i + 2}` : null;
    if (st.kind === 'delay') {
      return { temporary_id, type: 'time-delay', links: { next }, data: { unit: st.unit, value: st.value, timezone: 'profile' } };
    }
    return {
      temporary_id, type: 'send-email', links: { next },
      data: {
        status: 'draft',
        message: {
          from_email: FROM.email, from_label: FROM.label,
          subject_line: st.subject, preview_text: st.preview, template_id: st.template,
          smart_sending_enabled: st.smartSending ?? true,
          add_tracking_params: true,
          custom_tracking_params: [
            { param: 'utm_source', value: 'klaviyo' },
            { param: 'utm_medium', value: 'email' },
            { param: 'utm_campaign', value: st.utm },
          ],
        },
      },
    };
  });
  return { actions, entry_action_id: actions[0].temporary_id };
}

export const FLOW_DEFS = [
  {
    key: 'welcome', name: 'Pilot | Welcome (press-capture sign-ups)',
    trigger: { type: 'list', id: LIST_PRESS_CAPTURE },
    triggerLabel: 'Joins the press-capture list',
    filter: [[zeroSinceFlowStart(METRIC.placedOrder)]],
    steps: [
      { kind: 'email', subject: 'Here’s the story you signed up for', preview: 'Plus where to find us on Amazon', template: 'TEMPLATE_ID_WELCOME_1', utm: 'flow_welcome_1' },
      { kind: 'delay', unit: 'days', value: 2 },
      { kind: 'email', subject: 'Start with these three', preview: 'The routine most people begin with', template: 'TEMPLATE_ID_WELCOME_2', utm: 'flow_welcome_2' },
      { kind: 'delay', unit: 'days', value: 3 },
      { kind: 'email', subject: 'Wash day, simplified', preview: 'A 3-step guide', template: 'TEMPLATE_ID_WELCOME_3', utm: 'flow_welcome_3' },
    ],
    gap: null,
  },
  {
    key: 'abandoned-cart', name: 'Pilot | Abandoned cart (own site)',
    trigger: { type: 'metric', id: METRIC.startedCheckout },
    triggerLabel: 'Started Checkout on the brand’s own store',
    filter: [[zeroSinceFlowStart(METRIC.placedOrder)]],
    steps: [
      { kind: 'delay', unit: 'hours', value: 4 },
      { kind: 'email', subject: 'Still in your cart', preview: 'We saved it for you', template: 'TEMPLATE_ID_CART_1', utm: 'flow_cart_1' },
      { kind: 'delay', unit: 'days', value: 1 },
      { kind: 'email', subject: 'Questions before you check out?', preview: 'Ingredients, sizes and how to use', template: 'TEMPLATE_ID_CART_2', utm: 'flow_cart_2' },
    ],
    gap: 'Fires only when someone starts checkout on the brand’s own store. A shopper sent to Amazon never triggers it.',
  },
  {
    key: 'browse', name: 'Pilot | Browse abandonment (site + landing page)',
    trigger: { type: 'metric', id: METRIC.viewedProduct },
    triggerLabel: 'Viewed Product (site, or landing page via the client events API)',
    filter: [[zeroSinceFlowStart(METRIC.startedCheckout)], [zeroSinceFlowStart(METRIC.placedOrder)], [zeroSinceFlowStart(METRIC.clickedAmazonCta)]],
    steps: [
      { kind: 'delay', unit: 'hours', value: 2 },
      { kind: 'email', subject: 'Still thinking it over?', preview: 'Here’s what people pair it with', template: 'TEMPLATE_ID_BROWSE_1', utm: 'flow_browse_1' },
      { kind: 'delay', unit: 'days', value: 2 },
      { kind: 'email', subject: 'Find it on Amazon', preview: 'Same product, fast delivery', template: 'TEMPLATE_ID_BROWSE_2', utm: 'flow_browse_2' },
    ],
    gap: 'Needs Viewed Product events from identified visitors. The landing page sends them for email clickers; Amazon page views are never visible.',
  },
  {
    key: 'post-purchase', name: 'Pilot | Post-purchase (own-site orders)',
    trigger: { type: 'metric', id: METRIC.placedOrder },
    triggerLabel: 'Placed Order on the brand’s own store',
    filter: null,
    steps: [
      { kind: 'delay', unit: 'days', value: 3 },
      { kind: 'email', subject: 'How to get the most from your order', preview: 'Usage tips from the team', template: 'TEMPLATE_ID_POST_1', utm: 'flow_post_1', smartSending: false },
      { kind: 'delay', unit: 'days', value: 10 },
      { kind: 'email', subject: 'How’s it going so far?', preview: 'Tell us in one click', template: 'TEMPLATE_ID_POST_2', utm: 'flow_post_2' },
    ],
    gap: 'Amazon does not share buyer emails, so Amazon orders never reach this flow. Amazon buyers are counted in Attribution reports only.',
  },
  {
    key: 'win-back', name: 'Pilot | Win-back (60 days after last own-site order)',
    trigger: { type: 'metric', id: METRIC.placedOrder },
    triggerLabel: 'Placed Order, then 60 days with no new own-site order',
    filter: [[zeroSinceFlowStart(METRIC.placedOrder)]],
    steps: [
      { kind: 'delay', unit: 'days', value: 60 },
      { kind: 'email', subject: 'Time for a refill?', preview: 'Your routine, restocked', template: 'TEMPLATE_ID_WINBACK_1', utm: 'flow_winback_1' },
      { kind: 'delay', unit: 'days', value: 14 },
      { kind: 'email', subject: 'We’d like you back', preview: 'Where to find us now', template: 'TEMPLATE_ID_WINBACK_2', utm: 'flow_winback_2' },
    ],
    gap: 'Someone who reorders on Amazon still looks lapsed here. Copy points to Amazon rather than assuming they left.',
  },
];

export function flowRequests() {
  return FLOW_DEFS.map((f) => {
    const { actions, entry_action_id } = chain(f.steps);
    const definition = {
      triggers: [f.trigger],
      profile_filter: f.filter ? { condition_groups: f.filter.map((conds) => ({ conditions: conds })) } : null,
      actions,
      entry_action_id,
    };
    return {
      id: `flow-${f.key}`,
      title: `Create flow: ${f.name}`,
      method: 'POST', path: '/api/flows',
      headers: { revision: REVISION }, query: {},
      schema: 'FlowCreateQuery',
      body: { data: { type: 'flow', attributes: { name: f.name, definition } } },
    };
  });
}

// Browser-side calls from the landing page (public key only, no private key in the page).
export function landingRequests({ email = 'shopper@example.com', kx = null, asin = 'ASIN_SLOT_1', productName = 'Bestseller slot 1', adGroup = 'TMC-PILOT_LP_AMAZON-CTA_KLAVIYO' } = {}) {
  const profile = kx ? { _kx: kx } : { email };
  return [
    {
      id: 'client-subscription',
      title: 'Sign-up form: subscribe to the press-capture list',
      method: 'POST', path: '/client/subscriptions',
      headers: { revision: REVISION }, query: { company_id: 'PUBLIC_API_KEY' },
      schema: 'OnsiteSubscriptionCreateQuery',
      body: {
        data: {
          type: 'subscription',
          attributes: {
            custom_source: 'Press-capture landing page',
            profile: { data: { type: 'profile', attributes: { email, properties: { signup_page: 'press-capture' } } } },
          },
          relationships: { list: { data: { type: 'list', id: LIST_PRESS_CAPTURE } } },
        },
      },
    },
    {
      id: 'client-event-viewed-product',
      title: 'Product card in view: Viewed Product event',
      method: 'POST', path: '/client/events',
      headers: { revision: REVISION }, query: { company_id: 'PUBLIC_API_KEY' },
      schema: 'EventCreateQueryV2',
      body: {
        data: {
          type: 'event',
          attributes: {
            properties: { ProductName: productName, ProductID: asin, Source: 'press-capture' },
            metric: { data: { type: 'metric', attributes: { name: 'Viewed Product' } } },
            profile: { data: { type: 'profile', attributes: profile } },
          },
        },
      },
    },
    {
      id: 'client-event-amazon-cta',
      title: 'Amazon button: Clicked Amazon CTA event',
      method: 'POST', path: '/client/events',
      headers: { revision: REVISION }, query: { company_id: 'PUBLIC_API_KEY' },
      schema: 'EventCreateQueryV2',
      body: {
        data: {
          type: 'event',
          attributes: {
            properties: { ProductID: asin, ProductName: productName, AttributionAdGroup: adGroup, Destination: 'amazon' },
            metric: { data: { type: 'metric', attributes: { name: 'Clicked Amazon CTA' } } },
            profile: { data: { type: 'profile', attributes: profile } },
          },
        },
      },
    },
  ];
}

export function allRequests() {
  return [...segmentRequests(), ...flowRequests(), ...landingRequests()];
}
