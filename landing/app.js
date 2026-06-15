/*
 * Landing page logic (Phase 4, Task 4.1) — standalone, decoupled from the app.
 *
 * Fake-door validation: the season-pass button records the click and opens an
 * honest "join the list" state — NO checkout, NO charge. Email + click both fire
 * attributable events (not a silent console.log).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER TODO before going live (all in this CONFIG block — nothing else to edit):
 *   - BRAND:        the final product name (PENDING — placeholder for now)
 *   - PRICE:        the fake-door price string
 *   - DOWNLOAD_URL: the Windows installer link (GitHub release / R2 / Pages asset)
 *   - COLLECT_URL:  optional endpoint (Cloudflare Worker / webhook) that records
 *                   events + emails somewhere you read. Leave '' to rely on
 *                   Cloudflare Web Analytics pageviews (see track()).
 *   - TALLY_URL:    your Tally form URL for email capture → Google Sheet. When set,
 *                   the email field submits there; otherwise it shows a local thanks.
 *   Also: paste the Cloudflare Web Analytics beacon token in index.html.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  BRAND: 'Race Strategies', // PLACEHOLDER — product name is not chosen yet (see docs/DECISIONS.md)
  PRICE: '€9.99',
  DOWNLOAD_URL: '#', // TODO: link the Windows installer
  COLLECT_URL: '', // TODO (optional): a Worker/webhook that logs {event, detail}
  TALLY_URL: '', // TODO: Tally form URL (email → Google Sheet)
  LANG: 'en',
};

// --- i18n (English primary; add `fr` / `nl` objects later — strings only) ---
const STRINGS = {
  en: {
    header_cta: 'Season pass',
    kicker: 'GT7 endurance · single-team · PS5',
    hero_title: 'No manual input. It learns your car live.',
    hero_sub:
      'Live race strategy for GT7 endurance. Connect your PS5 and it measures fuel burn, tyre degradation and the weight effect as you drive — then tells your engineer exactly when to box and how much fuel to add.',
    hero_cta: 'See the season pass',
    hero_download: 'Download the app',
    hero_foot: 'Windows desktop app · runs on your LAN · no account needed',
    f1_title: 'Learns your car',
    f1_body:
      'Fuel per lap straight from the tank, the fuel-weight penalty, and a per-compound tyre curve — measured live, not typed in.',
    f2_title: 'Proposes, never hijacks',
    f2_body:
      'What it learns surfaces as recommendations your engineer accepts or ignores. Your plan stays yours.',
    f3_title: 'One glanceable screen',
    f3_body:
      'The Now view shows the current plan, the next pit lap, fuel to add and a lift-and-coast / push call — readable at a glance on a second screen.',
    dl_title: 'Get the Windows app',
    dl_body:
      "The capture app runs on your PC and reads your PS5 over the network. There's no web version — browsers can't open the raw telemetry sockets the PS5 needs.",
    dl_btn: 'Download for Windows',
    dl_note:
      "Unsigned during the beta — Windows may show a 'More info → Run anyway' prompt. We sign it before any paid launch.",
    offer_eyebrow: 'Season pass',
    offer_period: '/season',
    offer_line: 'Single-team live strategy that learns your car automatically. Up to 5 drivers.',
    offer_btn: 'Get the season pass',
    join_msg:
      "You're early — this isn't on sale yet. Leave your email and we'll tell you the moment the season pass opens.",
    email_placeholder: 'you@example.com',
    email_btn: 'Keep me posted',
    consent: "We'll only email you about this tool. No spam, no sharing.",
    email_thanks: "Thanks — you're on the list.",
    footer_note: 'Estimates only — verify against in-game data.',
  },
};

function t(key) {
  const table = STRINGS[CONFIG.LANG] || STRINGS.en;
  return table[key] ?? STRINGS.en[key] ?? key;
}

/**
 * Record an attributable event. Two sinks so a click is never just a console.log:
 *   1) push a distinct URL hash → shows as its own entry in Cloudflare Web Analytics
 *   2) if COLLECT_URL is set, sendBeacon the event to that endpoint (owner reads it)
 */
function track(event, detail) {
  try {
    history.pushState({ event }, '', '#/' + event);
  } catch {
    /* history not available */
  }
  if (CONFIG.COLLECT_URL && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(CONFIG.COLLECT_URL, JSON.stringify({ event, detail: detail || null, ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }
}

// --- Apply translations + config to the DOM ---
function applyContent() {
  document.documentElement.lang = CONFIG.LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const [attr, key] = el.getAttribute('data-i18n-attr').split(':');
    el.setAttribute(attr, t(key));
  });
  document.querySelectorAll('.brand-name').forEach((el) => {
    el.textContent = CONFIG.BRAND;
  });
  document.querySelector('.header-cta').textContent = t('header_cta');
  document.querySelector('.price-amount').textContent = CONFIG.PRICE;
  document.title = `${CONFIG.BRAND} — live GT7 endurance strategy that learns your car`;

  const dl = document.getElementById('download-btn');
  if (dl) dl.href = CONFIG.DOWNLOAD_URL;
}

function wireEvents() {
  // Generic: anything with data-track fires its event on click.
  document.querySelectorAll('[data-track]').forEach((el) => {
    el.addEventListener('click', () => track(el.getAttribute('data-track')));
  });

  // Fake door: reveal the honest "join the list" state. No checkout, no charge.
  const offerBtn = document.getElementById('offer-btn');
  const join = document.getElementById('join');
  offerBtn?.addEventListener('click', () => {
    join?.classList.remove('hidden');
    document.getElementById('email-input')?.focus();
  });

  // Email capture → Tally (if configured) + attributable event.
  const form = document.getElementById('email-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email-input')?.value?.trim();
    if (!email) return;
    track('email_submit', { email });
    if (CONFIG.TALLY_URL) {
      // Hand off to Tally (prefilled) so the lead lands in the Google Sheet.
      window.location.href = `${CONFIG.TALLY_URL}?email=${encodeURIComponent(email)}`;
      return;
    }
    document.getElementById('email-form').classList.add('hidden');
    document.getElementById('join-thanks')?.classList.remove('hidden');
  });
}

applyContent();
wireEvents();
