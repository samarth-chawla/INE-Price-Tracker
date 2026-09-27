'use strict';

const { chromium } = require('playwright');

const STORE_BASE = 'https://demo.inelabteamdev.com';
const MANIFEST_URL = `${STORE_BASE}/api/v2/ui/manifest`;

const SCRAPE_TIMEOUT_MS = 90_000;   // hard cap per scrape
const OFFER_READY_TIMEOUT = 30_000; // wait for offer-panel offer-ready
const BUTTON_POLL_TIMEOUT = 10_000; // wait for check button to be enabled
const PRICE_APPEAR_TIMEOUT = 10_000; // wait for price after each click
const CLICK_TIMEOUT = 10_000; // per-click cap so one stuck click can't burn the whole budget
const MAX_CLICK_ATTEMPTS = 5;
const MAX_CONSENT_CLICKS = 4; // store needs 1-3 clicks to dismiss (70%/25%/5%)

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/127.0.6533.72 Safari/537.36';

/** Small sleep helper. */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Parse the store's displayed price text into whole Indian Rupees.
 *
 * The store renders the same value in several formats (default `₹35,286`,
 * `spaced` with spaces, `euro` as `₹35.286,00`, `lakh` as `Rs. 35,28,600.00`,
 * `trailing` with a `/- (incl. of all taxes)` suffix, `unicode` with
 * full-width digits, plus zero-width split-carrier characters). A naive
 * strip-non-digits turns euro `₹35.286,00` into 3528600 (100x too big) and
 * chokes on full-width digits — incorrect data that must never be stored.
 */
function parsePrice(text) {
  if (!text) return NaN;
  let s = String(text).normalize('NFKC'); // full-width digits → ASCII
  // zero-width split-carrier chars (U+200B-U+200D), BOM, nbsp, whitespace
  s = s.replace(/[\u200b\u200c\u200d\ufeff\u00a0\s]/g, '');
  s = s.replace(/[.,]00(?=\D*$)/, ''); // trailing ",00" (euro) / ".00" (lakh) decimals
  const digits = s.replace(/\D/g, '');
  return parseInt(digits, 10);
}

/**
 * Fetch the UI manifest to get current rotating CSS class names.
 * Retries up to 3 times with backoff on 429/503.
 * @returns {Promise<object>} manifest JSON
 */
async function fetchManifest(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(MANIFEST_URL);
    if (res.ok) return res.json();
    const transient = res.status === 429 || res.status === 503;
    if (transient && attempt < retries) {
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Manifest fetch failed: HTTP ${res.status}`);
  }
}

/**
 * Fetch product detail from the store API to validate the product and option.
 * @param {string} productId
 * @returns {Promise<object>} product JSON
 */
async function fetchProductData(productId) {
  const res = await fetch(`${STORE_BASE}/api/v2/items/${productId}`);
  if (res.status === 404) throw new Error(`Product ${productId} not found`);
  if (!res.ok) throw new Error(`Store API returned HTTP ${res.status} for product ${productId}`);
  return res.json();
}

/**
 * Satisfy the gesture guard by moving the mouse over the offer panel.
 * Guard requires: ≥8 moves, each ≥40ms apart, total dwell ≥600ms.
 * Strategy: 10 moves × 70ms = 700ms — satisfies all three conditions.
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} panelLocator
 */
async function satisfyGestureGuard(page, panelLocator) {
  const box = await panelLocator.boundingBox();
  if (!box) throw new Error('Could not get bounding box of offer panel');

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const spread = Math.min(box.width, box.height) * 0.3;

  for (let i = 0; i < 10; i++) {
    // Zigzag within the panel bounds
    const dx = (i % 2 === 0 ? 1 : -1) * spread * (i / 10);
    const dy = (i % 3 === 0 ? 1 : -1) * spread * 0.5;
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(70);
  }
}

/**
 * Dismiss the cookie-consent overlay.
 *
 * The store shows `.consent-scrim` in ~75% of sessions (after a 1.5-5s
 * delay) and requires 1-3 clicks on Allow/Reject to actually hide
 * (70% one click, 25% two clicks, 5% three clicks). A single click
 * therefore leaves the overlay visible ~30% of the time, which used to
 * wedge Playwright's locator-handler wait until the 90s timeout.
 *
 * This helper clicks until the scrim is hidden (or the click budget is
 * exhausted) and returns whether the scrim is gone. It never throws —
 * callers decide whether to retry the underlying action.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true when no visible scrim remains
 */
async function dismissConsent(page) {
  for (let i = 0; i < MAX_CONSENT_CLICKS; i++) {
    const scrim = page.locator('.consent-scrim');
    const visible = await scrim.isVisible().catch(() => false);
    if (!visible) return true;
    try {
      // Buttons live inside .consent-box: "Allow" and "Reject"
      // (there is no "Decline" button on the store).
      const dismissBtn = page
        .locator('.consent-box button:has-text("Allow")')
        .or(page.locator('.consent-box button:has-text("Reject")'))
        .first();
      await dismissBtn.click({ timeout: 2000 });
      await page.waitForTimeout(300);
    } catch {
      return false;
    }
  }
  const stillVisible = await page.locator('.consent-scrim').isVisible().catch(() => false);
  return !stillVisible;
}

/**
 * Scrape the current price for a given product + option from the INE store.
 *
 * @param {string} productId  Numeric product ID string (e.g. "2562")
 * @param {string} optionLabel  Exact option label to select (e.g. "Creator kit")
 * @param {object} [hooks]  Optional observers — no effect on scrape behavior.
 *   hooks.onAttempt({ attemptNumber, outcome:'retried', errorMessage }) fires
 *   once per click-loop attempt that ends without a price (i.e. will retry).
 *   The terminal attempt is NOT emitted: success is the return value, failure
 *   is the thrown error — the caller records those. The hook is awaited, but
 *   hook errors are swallowed so logging can never break the scrape.
 * @returns {Promise<object>} Structured scrape result
 */
async function scrapePrice(productId, optionLabel, hooks = {}) {
  // ── Step 1: Validate product + option via store API ──────────────────────
  const productData = await fetchProductData(productId);
  const options = productData.options || [];
  const optionExists =
    options.length === 0 || // product has no options — treat any label as valid
    options.some(
      (o) => (o.label || o.name || o).toLowerCase() === optionLabel.toLowerCase()
    );
  if (!optionExists) {
    throw new Error(
      `Option "${optionLabel}" not found for product ${productId}. ` +
      `Available: ${options.map((o) => o.label || o.name || o).join(', ')}`
    );
  }

  // ── Step 2: Fetch UI manifest ────────────────────────────────────────────
  const manifest = await fetchManifest();
  const priceValueClass = manifest.classes.priceValue;
  const stockClass = manifest.classes.stock;
  const priceTag = manifest.priceTag || 'strong';

  // ── Step 3-16: Browser scrape ────────────────────────────────────────────
  let browser = null;
  const overallTimer = Date.now();

  try {
    // Browser binary resolution (deployment-compatible, scrape logic untouched):
    // 1. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var wins when set.
    // 2. Local Windows dev falls back to the installed system Chrome.
    // 3. Otherwise (e.g. Render/Docker) executablePath is omitted so
    //    Playwright uses its own installed Chromium
    //    (`npx playwright install --with-deps chromium` in the image build).
    const WIN_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (!executablePath && process.platform === 'win32') {
      try {
        if (require('fs').existsSync(WIN_CHROME)) executablePath = WIN_CHROME;
      } catch {
        executablePath = WIN_CHROME; // preserve legacy behavior if the check fails
      }
    }

    const launchOpts = {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    };
    if (executablePath) launchOpts.executablePath = executablePath;

    browser = await chromium.launch(launchOpts);

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      extraHTTPHeaders: {
        'Accept-Language': 'en-IN,en;q=0.9',
      },
    });

    const page = await context.newPage();

    // Set a hard page-level timeout matching our overall cap
    page.setDefaultTimeout(SCRAPE_TIMEOUT_MS);

    // Automatically dismiss the cookie consent overlay whenever it appears.
    // The store shows a modal with a `.consent-scrim` backdrop (pointer-events:all)
    // that blocks 75% of sessions, and it needs 1-3 Allow/Reject clicks to go
    // away. The handler loop-clicks via dismissConsent(); `noWaitAfter: true`
    // opts out of Playwright's built-in "wait until overlay hidden" so a
    // stubborn overlay can never wedge a click until the 90s timeout — the
    // per-attempt dismiss + short CLICK_TIMEOUT recovers via retry instead.
    await page.addLocatorHandler(
      page.locator('.consent-scrim'),
      async () => {
        const gone = await dismissConsent(page);
        if (gone) console.log('  Auto-dismissed consent dialog.');
        else console.log('  Consent dialog still visible after handler.');
      },
      { noWaitAfter: true }
    );

    // ── Step 4: Navigate ─────────────────────────────────────────────────
    await page.goto(`${STORE_BASE}/item/${productId}`, {
      waitUntil: 'domcontentloaded',
      timeout: SCRAPE_TIMEOUT_MS,
    });

    // ── Step 5: Wait for option chips (React has loaded product data) ─────
    await page.waitForSelector('.opt-chip', { timeout: 20_000 });

    // ── Step 6: Select the correct option ────────────────────────────────
    // (Consent may already be visible here — clear it first so chip clicks
    // can't wedge on the overlay the way check-button clicks did.)
    await dismissConsent(page).catch(() => {});
    const chips = page.locator('.opt-chip');
    const count = await chips.count();
    let matched = false;

    for (let i = 0; i < count; i++) {
      const chip = chips.nth(i);
      const text = (await chip.textContent()).trim();
      if (text.toLowerCase() === optionLabel.toLowerCase()) {
        // Only click if not already active
        const classes = await chip.getAttribute('class');
        if (!classes.includes('opt-chip-on')) {
          try {
            await chip.click({ timeout: CLICK_TIMEOUT });
          } catch {
            await dismissConsent(page).catch(() => {});
            await chip.click({ timeout: CLICK_TIMEOUT });
          }
          await page.waitForTimeout(300);
        }
        matched = true;
        break;
      }
    }

    if (!matched && count > 0) {
      // Fallback: click first chip to ensure a valid selection state
      const firstClasses = await chips.first().getAttribute('class');
      if (!firstClasses.includes('opt-chip-on')) {
        try {
          await chips.first().click({ timeout: CLICK_TIMEOUT });
        } catch {
          await dismissConsent(page).catch(() => {});
          await chips.first().click({ timeout: CLICK_TIMEOUT });
        }
        await page.waitForTimeout(300);
      }
    }

    // ── Step 7: Find offer panel and scroll into view ─────────────────────
    const offerPanel = page.locator('.offer-panel').first();
    await offerPanel.waitFor({ state: 'attached', timeout: 15_000 });
    await offerPanel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    // ── Step 8: Satisfy gesture guard (10 moves × 70ms = 700ms) ──────────
    await satisfyGestureGuard(page, offerPanel);

    // ── Step 9: Proactively dismiss consent dialog if visible now ─────────
    // (The addLocatorHandler above covers dialog appearing mid-interaction;
    //  this catches it if it popped up during the mouse movement phase.
    //  Dismissal is also repeated before every click attempt below, since
    //  the dialog can appear with up to a 5s delay at any point.)
    try {
      if (await page.locator('.consent-scrim').isVisible().catch(() => false)) {
        if (await dismissConsent(page)) {
          console.log('  Proactively dismissed consent dialog.');
        }
      }
    } catch {
      // Not visible or dismiss failed — handler + per-attempt dismiss cover it
    }

    // ── Step 10: Wait for check button to become enabled ──────────────────
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => /check today/i.test(b.textContent)
        );
        return btn && !btn.disabled;
      },
      { polling: 250, timeout: BUTTON_POLL_TIMEOUT }
    );

    // ── Steps 11-14: State-aware click with retry ─────────────────────────
    // The store's offer panel is a state machine, and the "Check today's
    // price" button only exists in the idle (offer-locked) phase:
    //   idle (offer-locked)      → "Check today's price" button present
    //   loading / retrying       → loader, NO button (store fetching internally,
    //                              incl. its own 6-attempt retry on 502/429)
    //   error (offer-failed)     → "Retry" button (same handler, restarts fetch)
    //   success (offer-ready)    → price element present
    // Blindly re-clicking "check today" fails when the button isn't in the
    // DOM (slow store, error phase). So each attempt first reads the panel
    // state and only clicks the button that is actually present; when the
    // store is mid-fetch we wait for the price instead of clicking air.
    let priceText = null;
    let stockText = '';
    let attempts = 0;

    // True when the price-value element is already in the DOM.
    async function isPricePresent() {
      return await page.evaluate(
        (cls) => !!document.querySelector(`.${cls}`),
        priceValueClass
      ).catch(() => false);
    }

    // Notify the optional per-attempt observer (DB logging). Awaited so
    // rows land in order, but never throws.
    async function emitRetry(attempt, message) {
      try {
        if (typeof hooks.onAttempt === 'function') {
          await hooks.onAttempt({ attemptNumber: attempt, outcome: 'retried', errorMessage: message });
        }
      } catch {
        // Observer must never break the scrape
      }
    }

    for (let attempt = 1; attempt <= MAX_CLICK_ATTEMPTS; attempt++) {
      // The consent dialog can pop up (1.5-5s delay) at any point, including
      // between attempts — clear it before every attempt, not just once.
      await dismissConsent(page).catch(() => {});

      // 1. Slow-store case: a previous click's fetch may have finished while
      //    we were dismissing consent — don't click, just take the price.
      if (await isPricePresent()) {
        const priceEl = page.locator(`.${priceValueClass}`).first();
        priceText = await priceEl.textContent({ timeout: 5000 }).catch(() => null);
        if (priceText) {
          attempts = attempt;
          break;
        }
      }

      // 2. Read panel state and click whichever button is actually present.
      const checkBtn = page.locator('button', { hasText: /check today/i }).first();
      const retryBtn = page.locator('.offer-panel.offer-failed button').first();
      const checkCount = await checkBtn.count().catch(() => 0);
      const retryCount = await retryBtn.count().catch(() => 0);

      if (checkCount > 0) {
        // Idle phase — click with a short cap: a stuck click (e.g. overlay
        // interference) must fail fast into the next retry instead of
        // burning the whole 90s page budget on one attempt.
        try {
          await checkBtn.click({ timeout: CLICK_TIMEOUT });
        } catch (clickErr) {
          console.log(`  Click attempt ${attempt} could not complete (${clickErr.message.split('\n')[0]}), retrying…`);
          await dismissConsent(page).catch(() => {});
          if (attempt === MAX_CLICK_ATTEMPTS) {
            throw new Error(
              `Check button stayed blocked after ${MAX_CLICK_ATTEMPTS} click attempts: ${clickErr.message.split('\n')[0]}`
            );
          }
          await emitRetry(attempt, `check-button click failed: ${clickErr.message.split('\n')[0]}`);
          continue;
        }
      } else if (retryCount > 0) {
        // Error phase — the store exhausted its internal retries; its own
        // Retry control starts a fresh fetch cycle.
        console.log(`  Store reported an error, clicking its Retry control (attempt ${attempt})…`);
        try {
          await retryBtn.click({ timeout: CLICK_TIMEOUT });
        } catch (clickErr) {
          console.log(`  Retry click ${attempt} could not complete (${clickErr.message.split('\n')[0]}), retrying…`);
          await dismissConsent(page).catch(() => {});
          if (attempt === MAX_CLICK_ATTEMPTS) {
            throw new Error(
              `Store Retry control stayed blocked after ${MAX_CLICK_ATTEMPTS} click attempts: ${clickErr.message.split('\n')[0]}`
            );
          }
          await emitRetry(attempt, `store Retry click failed: ${clickErr.message.split('\n')[0]}`);
          continue;
        }
      } else {
        // Loading/retrying phase (loader, no button) — the store is still
        // working on a previous click's fetch; wait for the price below
        // instead of clicking a button that isn't there.
        console.log(`  Store still loading (attempt ${attempt}), waiting for price…`);
      }

      // Wait for the priceValue element to appear after click
      try {
        await page.waitForFunction(
          (cls) => !!document.querySelector(`.${cls}`),
          priceValueClass,
          { polling: 250, timeout: PRICE_APPEAR_TIMEOUT }
        );

        // Price element appeared — read it
        const priceEl = page.locator(`.${priceValueClass}`).first();
        priceText = await priceEl.textContent({ timeout: 5000 });
        attempts = attempt;
        break;
      } catch {
        // Price didn't appear within timeout — 35% drop rate hit, retry
        console.log(`  Click attempt ${attempt} dropped (no price appeared), retrying…`);

        if (attempt === MAX_CLICK_ATTEMPTS) {
          // Last resort: wait for offer-ready as fallback signal
          try {
            await page.waitForSelector('.offer-panel.offer-ready', {
              timeout: OFFER_READY_TIMEOUT,
            });
            const priceEl = page.locator(`.${priceValueClass}`).first();
            priceText = await priceEl.textContent({ timeout: 5000 });
            attempts = attempt;
          } catch (fallbackErr) {
            throw new Error(
              `Price did not appear after ${MAX_CLICK_ATTEMPTS} click attempts: ${fallbackErr.message}`
            );
          }
        } else {
          await emitRetry(attempt, 'no price appeared within 10s of click (store drop or slow load)');
        }
      }
    }

    // ── Step 14: Extract stock text ───────────────────────────────────────
    try {
      const stockEl = page.locator(`.${stockClass}`).first();
      stockText = (await stockEl.textContent({ timeout: 3000 })).trim();
    } catch {
      stockText = '';
    }

    // ── Step 15: Extract attempt count from footer ────────────────────────
    let footerAttempts = attempts;
    try {
      const footText = await page.locator('.offer-foot').first().textContent({ timeout: 2000 });
      const m = footText.match(/Loaded in (\d+)/i);
      if (m) footerAttempts = parseInt(m[1], 10);
    } catch {
      // Footer absent or unreadable — use our own click count
    }

    // ── Step 13: Parse price (format-aware — see parsePrice) ─────────────
    const priceNumeric = parsePrice(priceText);
    if (isNaN(priceNumeric)) {
      throw new Error(`Could not parse price from text: "${priceText}"`);
    }

    // ── Step 16: Return structured result ────────────────────────────────
    return {
      productId: String(productId),
      productName: productData.name,
      selectedOption: optionLabel,
      price: priceNumeric,
      currency: 'INR',
      stock: stockText,
      scrapedAt: new Date().toISOString(),
      attempts: footerAttempts,
      success: true,
    };
  } finally {
    // ── Step 17: Always close the browser ────────────────────────────────
    if (browser) {
      await browser.close().catch(() => {});
    }
    const elapsed = ((Date.now() - overallTimer) / 1000).toFixed(1);
    console.log(`Scrape for product ${productId} finished in ${elapsed}s`);
  }
}

module.exports = { scrapePrice };
