/**
 * Connects via CDP and takes a screenshot of a specific page.
 *
 * Usage:
 *   node tests/playwright/screenshot.mjs <pageIndex> [outputPath]
 */
import { chromium } from 'playwright';
import path from 'path';

const pageIdx = parseInt(process.argv[2] ?? '0', 10);
const out = process.argv[3] || `/tmp/qa-screenshot-${pageIdx}-${Date.now()}.png`;

const browser = await chromium.connectOverCDP('http://localhost:9222');
const pages = browser.contexts().flatMap(c => c.pages());
const page = pages[pageIdx];
if (!page) {
    console.error(`No page at index ${pageIdx} (have ${pages.length})`);
    process.exit(1);
}

await page.screenshot({ path: out, fullPage: false });
console.log(out);

await browser.close();
