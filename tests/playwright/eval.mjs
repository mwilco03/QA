/**
 * Connects via CDP and evaluates an expression in a specific page.
 *
 * Usage:
 *   node tests/playwright/eval.mjs <pageIndex> "<js expression>"
 *   node tests/playwright/eval.mjs 2 "document.title"
 */
import { chromium } from 'playwright';

const pageIdx = parseInt(process.argv[2] ?? '0', 10);
const expr = process.argv[3];
if (!expr) {
    console.error('Usage: eval.mjs <pageIndex> "<expr>"');
    process.exit(1);
}

const browser = await chromium.connectOverCDP('http://localhost:9222');
const pages = browser.contexts().flatMap(c => c.pages());
const page = pages[pageIdx];
if (!page) {
    console.error(`No page at index ${pageIdx} (have ${pages.length})`);
    process.exit(1);
}

try {
    const result = await page.evaluate(expr);
    console.log(JSON.stringify(result, null, 2));
} catch (e) {
    console.error('eval error:', e.message);
}

await browser.close();
