/**
 * Launches a headed Chromium with the LMS QA extension loaded and a
 * persistent user-data-dir so SSO logins (Workday, Okta, etc.) survive
 * across runs. Exposes a remote-debugging port so other Playwright
 * scripts can connect to inspect what's happening.
 *
 * Usage:
 *   node tests/playwright/launch.mjs
 *
 * Leaves the browser running. Close the browser window or Ctrl+C this
 * process to stop.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../..');
const userDataDir = path.resolve(__dirname, '.user-data');
const cdpPort = 9222;

if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

console.log(`[launch] extension root: ${extensionRoot}`);
console.log(`[launch] user data dir:  ${userDataDir}`);
console.log(`[launch] CDP port:       ${cdpPort}`);

const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    viewport: null,
    args: [
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
        `--remote-debugging-port=${cdpPort}`,
        '--no-first-run',
        '--no-default-browser-check'
    ]
});

// Capture page console output and route to our terminal
function attachLogging(page) {
    const tag = () => `[page ${page.url().slice(0, 80)}]`;
    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('LMS QA') || text.includes('LMS_QA')) {
            console.log(`${tag()} ${msg.type()}: ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        console.log(`${tag()} pageerror: ${err.message}`);
    });
}

context.pages().forEach(attachLogging);
context.on('page', (page) => {
    attachLogging(page);
    console.log(`[launch] new page: ${page.url()}`);
});

// Wait for the service worker to start so we know the extension loaded
let sw = context.serviceWorkers()[0];
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
if (sw) {
    const extId = new URL(sw.url()).host;
    console.log(`[launch] extension service worker active: ${sw.url()}`);
    console.log(`[launch] extension id: ${extId}`);
    fs.writeFileSync(path.join(__dirname, '.extension-id'), extId);
    sw.on('console', (msg) => console.log(`[sw] ${msg.type()}: ${msg.text()}`));
} else {
    console.log('[launch] WARN: no service worker detected after 15s');
}

console.log('[launch] browser is ready. Sign into Workday, open a course.');
console.log('[launch] keep this terminal open; CTRL+C closes the browser.');

// Keep running. The persistent context fires no specific exit event;
// poll for the browser process to be gone.
const browser = context.browser();
context.on('close', () => {
    console.log('[launch] context closed');
    process.exit(0);
});

// Heartbeat so it's obvious the process is alive
setInterval(() => {}, 1 << 30);
