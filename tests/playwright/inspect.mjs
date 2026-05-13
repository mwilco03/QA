/**
 * Connects via CDP to the launched Chromium and dumps state about every
 * open page: URL, title, whether the LMS QA validator/panel are present,
 * whether SCORM/xAPI APIs are visible.
 *
 * Usage: node tests/playwright/inspect.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cdpEndpoint = 'http://localhost:9222';

const browser = await chromium.connectOverCDP(cdpEndpoint);
const contexts = browser.contexts();

let pageIdx = 0;
const probe = `
(function(){
    const r = {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        hasOpener: !!window.opener,
        outerHeight: window.outerHeight,
        innerHeight: window.innerHeight,
        chromeHeight: window.outerHeight - window.innerHeight,
        validatorInjected: !!window.__LMS_QA_INJECTED__,
        panelInjected: !!window.__LMS_QA_PANEL_INJECTED__,
        panelHostInDom: !!document.getElementById('lms-qa-panel-host'),
        lmsQaPublic: !!window.LMS_QA,
        api12: typeof window.API !== 'undefined' ? 'window.API' :
               typeof window.parent?.API !== 'undefined' ? 'parent.API' : null,
        api2004: typeof window.API_1484_11 !== 'undefined' ? 'window.API_1484_11' :
                 typeof window.parent?.API_1484_11 !== 'undefined' ? 'parent.API_1484_11' : null,
        iframeCount: document.querySelectorAll('iframe').length,
        videoCount: document.querySelectorAll('video').length,
        frames: [...document.querySelectorAll('iframe')].slice(0, 5).map((f,i) => ({
            i, src: (f.src || '').slice(0, 100), name: f.name, id: f.id
        }))
    };
    return r;
})()`;

for (const ctx of contexts) {
    for (const page of ctx.pages()) {
        const idx = pageIdx++;
        const url = page.url();
        let data;
        try {
            data = await page.evaluate(probe);
        } catch (e) {
            data = { error: e.message };
        }
        console.log(`\n=== page ${idx}: ${url.slice(0,120)} ===`);
        console.log(JSON.stringify(data, null, 2));

        // Also walk same-origin frames
        const frames = page.frames();
        for (let i = 1; i < frames.length; i++) {
            const f = frames[i];
            try {
                const d = await f.evaluate(probe);
                console.log(`  frame ${i}: ${f.url().slice(0,100)}`);
                console.log(`  ${JSON.stringify(d).slice(0, 400)}`);
            } catch (e) { /* cross-origin */ }
        }
    }
}

await browser.close();
