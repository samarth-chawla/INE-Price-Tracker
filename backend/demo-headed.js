'use strict';

// Temporary/demo runner: executes ONE scrape with a VISIBLE browser window
// so the store's price-loading flow (gesture guard, consent dialog, retries)
// can be watched. Production behavior is unchanged — headless stays the
// default; this script only opts into headed mode for itself.
//
// Usage:
//   node demo-headed.js 2562 "Creator kit"
//   node demo-headed.js 2186 "Regular"
//   PLAYWRIGHT_HEADED=0 node demo-headed.js 2562 "Body only"   # headless run

process.env.PLAYWRIGHT_HEADED = process.env.PLAYWRIGHT_HEADED || '1';

const { scrapePrice } = require('./scraper/priceScraper');

const [, , productId, option] = process.argv;

if (!productId || !option) {
  console.error('Usage: node demo-headed.js <productId> "<option>"');
  console.error('Example: node demo-headed.js 2562 "Creator kit"');
  process.exit(1);
}

(async () => {
  console.log(`Demo scrape: product=${productId} option="${option}" (PLAYWRIGHT_HEADED=${process.env.PLAYWRIGHT_HEADED})`);
  try {
    const result = await scrapePrice(productId, option);
    console.log('SUCCESS:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  }
})();
