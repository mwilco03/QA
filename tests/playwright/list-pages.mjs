/**
 * Lists all open pages with their index and URL.
 *
 * Usage: node tests/playwright/list-pages.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const pages = browser.contexts().flatMap(c => c.pages());
pages.forEach((p, i) => {
    console.log(`[${i}] ${p.url()}`);
});
await browser.close();
