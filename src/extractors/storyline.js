/**
 * Storyline Extractor
 *
 * Extracts Q&A content from Articulate Storyline courses.
 * Handles DS object, globalProvideData, slide data, and accessibility DOM.
 */

import { AUTHORING_TOOL, PATHS, ITEM_TYPE, QUESTION_TYPE, CONFIDENCE, CONFIG } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const StorylineExtractor = {
    toolId: AUTHORING_TOOL.STORYLINE,
    _foundScripts: new Set(),
    _scannedContent: new Set(),

    /**
     * Detect if current page is Storyline content
     */
    detect() {
        return !!(
            window.DS ||
            window.globalProvideData ||
            window.g_slideData ||
            window.player ||
            document.querySelector('.slide-object') ||
            document.querySelector('.acc-shadow-dom') ||
            document.querySelector('svg.vector-slide-content') ||
            document.querySelector('iframe[src*="story"]') ||
            document.querySelector('script[src*="storyline"]') ||
            this.findStorylineScripts().length > 0
        );
    },

    /**
     * Find ALL Storyline-related scripts in the page
     */
    findStorylineScripts() {
        const scripts = [];

        // Check all script elements
        document.querySelectorAll('script[src]').forEach(script => {
            const src = script.src || '';
            if (src.includes('/html5/') ||
                src.includes('/data/js/') ||
                src.includes('storyline') ||
                src.includes('story_content')) {
                scripts.push(src);
            }
        });

        // Check performance entries
        if (performance.getEntriesByType) {
            performance.getEntriesByType('resource').forEach(entry => {
                if (entry.initiatorType === 'script' || entry.name.endsWith('.js')) {
                    if (entry.name.includes('/html5/') ||
                        entry.name.includes('/data/js/') ||
                        entry.name.includes('storyline')) {
                        scripts.push(entry.name);
                    }
                }
            });
        }

        return [...new Set(scripts)];
    },

    /**
     * Find the base URL for Storyline content
     */
    findBaseUrl() {
        // Method 1: From script sources
        const scripts = this.findStorylineScripts();
        for (const src of scripts) {
            const match = src.match(/(.+?)\/html5\/data\/js\//);
            if (match) return match[1];

            const match2 = src.match(/(.+?)\/html5\//);
            if (match2) return match2[1];
        }

        // Method 2: Check iframes
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const src = iframe.src || '';
                if (src.includes('/story_html5.html') || src.includes('/story.html')) {
                    return src.replace(/\/(?:story_html5|story)\.html.*$/, '');
                }
                if (src.includes('/html5/')) {
                    const match = src.match(/(.+?)\/html5\//);
                    if (match) return match[1];
                }
            } catch (e) { /* Cross-origin */ }
        }

        // Method 3: Current URL
        const currentUrl = window.location.href;
        if (currentUrl.includes('/html5/')) {
            const match = currentUrl.match(/(.+?)\/html5\//);
            if (match) return match[1];
        }
        if (currentUrl.includes('/story')) {
            return currentUrl.replace(/\/story.*$/, '');
        }

        // Method 4: Check for Storyline globals
        if (window.DS || window.globalProvideData) {
            return window.location.href.replace(/\/[^/]*$/, '');
        }

        return null;
    },

    /**
     * MAIN EXTRACTION - Aggressive enumeration approach
     */
    async extract() {
        Logger.info('=== STORYLINE EXTRACTION: Starting aggressive scan ===');
        this._foundScripts.clear();
        this._scannedContent.clear();

        const items = [];

        // STEP 1: Extract from inline scripts in current document
        Logger.info('Step 1: Scanning inline scripts...');
        const inlineItems = this.extractFromInlineScripts();
        items.push(...inlineItems);
        Logger.info(`  Found ${inlineItems.length} items from inline scripts`);

        // STEP 2: Extract from window globals (DS, g_slideData, etc.)
        Logger.info('Step 2: Checking window globals...');
        const globalItems = this.extractFromGlobals();
        items.push(...globalItems);
        Logger.info(`  Found ${globalItems.length} items from globals`);

        // STEP 3: Find base URL and enumerate ALL JavaScript files
        const baseUrl = this.findBaseUrl();
        if (baseUrl) {
            Logger.info(`Step 3: Found base URL: ${baseUrl}`);

            // STEP 4: Enumerate ALL JS files
            Logger.info('Step 4: Enumerating ALL JavaScript files...');
            const jsFiles = await this.enumerateAllJsFiles(baseUrl);
            Logger.info(`  Found ${jsFiles.length} JS files to scan`);

            // STEP 5: Fetch and scan EVERY file
            Logger.info('Step 5: Fetching and scanning each file...');
            for (const jsFile of jsFiles) {
                const fileItems = await this.fetchAndParseJsFile(jsFile);
                if (fileItems.length > 0) {
                    Logger.info(`  ${jsFile.split('/').pop()}: ${fileItems.length} items`);
                    items.push(...fileItems);
                }
            }

            // STEP 6: Try iframe contexts
            Logger.info('Step 6: Checking iframe contexts...');
            const iframeItems = await this.extractFromIframes();
            items.push(...iframeItems);
            Logger.info(`  Found ${iframeItems.length} items from iframes`);
        } else {
            Logger.warn('No Storyline base URL found - trying fallback methods');

            // Fallback: scan all script src attributes
            const scriptItems = await this.scanAllScriptSources();
            items.push(...scriptItems);
        }

        // Deduplicate
        const deduped = Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
        Logger.info(`=== EXTRACTION COMPLETE: ${deduped.length} unique items ===`);

        return deduped;
    },

    /**
     * Enumerate ALL JavaScript files from the Storyline package
     */
    async enumerateAllJsFiles(baseUrl) {
        const jsFiles = new Set();
        const dataJsPath = `${baseUrl}${PATHS.STORYLINE.DATA_JS_PATH}`;

        // Source 1: Performance API - scripts already loaded
        if (performance.getEntriesByType) {
            performance.getEntriesByType('resource').forEach(entry => {
                if (entry.name.endsWith('.js') && entry.name.includes(baseUrl.replace(/^https?:\/\//, ''))) {
                    jsFiles.add(entry.name);
                }
            });
        }

        // Source 2: All script elements in page
        document.querySelectorAll('script[src]').forEach(script => {
            if (script.src) jsFiles.add(script.src);
        });

        // Source 3: Known Storyline structure files (from PATHS config)
        for (const file of PATHS.STORYLINE.DATA_FILES) {
            jsFiles.add(`${dataJsPath}/${file}`);
        }

        // Source 4: Parse data.js to find ALL referenced slide IDs
        const slideIds = await this.extractAllSlideIdsFromDataJs(baseUrl);
        Logger.info(`  Found ${slideIds.length} slide IDs from data.js`);
        slideIds.forEach(id => jsFiles.add(`${dataJsPath}/${id}.js`));

        // Source 5: Parse frame.js for additional references
        const frameIds = await this.extractIdsFromFrameJs(baseUrl);
        Logger.info(`  Found ${frameIds.length} additional IDs from frame.js`);
        frameIds.forEach(id => jsFiles.add(`${dataJsPath}/${id}.js`));

        // Source 6: Probe common patterns (sequential, alphanumeric)
        const probeIds = await this.probeForSlideFiles(baseUrl);
        Logger.info(`  Found ${probeIds.length} files via probing`);
        probeIds.forEach(url => jsFiles.add(url));

        return Array.from(jsFiles);
    },

    /**
     * Extract ALL slide IDs from data.js - deep search
     */
    async extractAllSlideIdsFromDataJs(baseUrl) {
        const ids = new Set();
        try {
            const response = await Utils.fetchWithTimeout(`${baseUrl}${PATHS.STORYLINE.DATA_JS_PATH}/data.js`, { timeout: 5000 });
            if (!response.ok) return [];

            const text = await response.text();

            // Extract the JSON data
            const match = text.match(/globalProvideData\s*\(\s*'data'\s*,\s*'([\s\S]+?)'\s*\)/);
            if (match) {
                const json = this.unescapeJson(match[1]);
                const data = Utils.safeJsonParse(json);
                if (data) {
                    // Deep search for anything that looks like a slide ID
                    this.deepSearchForIds(data, ids);
                }
            }

            // Also regex scan the raw text for slide ID patterns
            const idPattern = /['"]([a-zA-Z0-9]{6,15})['"]/g;
            let m;
            while ((m = idPattern.exec(text)) !== null) {
                const id = m[1];
                // Filter out common non-IDs
                if (!this.isCommonWord(id)) {
                    ids.add(id);
                }
            }
        } catch (e) {
            Logger.debug('Failed to parse data.js', { error: e.message });
        }
        return Array.from(ids);
    },

    /**
     * Deep search object for slide IDs
     */
    deepSearchForIds(obj, ids, depth = 0) {
        if (!obj || depth > 25) return;

        if (typeof obj === 'string') {
            if (/^[a-zA-Z0-9_-]{6,20}$/.test(obj) && !this.isCommonWord(obj)) {
                ids.add(obj);
            }
            return;
        }

        if (Array.isArray(obj)) {
            obj.forEach(item => this.deepSearchForIds(item, ids, depth + 1));
            return;
        }

        if (typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj)) {
                // Common slide reference properties
                if (['slideId', 'slide', 'id', 'entry', 'exit', 'target', 'ref', 'dataFile'].includes(key)) {
                    if (typeof value === 'string' && /^[a-zA-Z0-9_-]{6,20}$/.test(value)) {
                        ids.add(value);
                    }
                }
                this.deepSearchForIds(value, ids, depth + 1);
            }
        }
    },

    /**
     * Check if string is a common word (not a slide ID)
     */
    isCommonWord(str) {
        const common = [
            'function', 'object', 'string', 'number', 'boolean', 'undefined', 'null',
            'return', 'const', 'let', 'var', 'class', 'export', 'import', 'default',
            'true', 'false', 'window', 'document', 'global', 'module', 'require',
            'slides', 'scenes', 'objects', 'layers', 'frames', 'paths', 'data',
            'width', 'height', 'left', 'right', 'top', 'bottom', 'center',
            'normal', 'hidden', 'visible', 'absolute', 'relative', 'static',
            'button', 'text', 'image', 'video', 'audio', 'shape', 'caption'
        ];
        return common.includes(str.toLowerCase());
    },

    /**
     * Extract IDs from frame.js
     */
    async extractIdsFromFrameJs(baseUrl) {
        const ids = new Set();
        try {
            const response = await Utils.fetchWithTimeout(`${baseUrl}${PATHS.STORYLINE.DATA_JS_PATH}/frame.js`, { timeout: 5000 });
            if (!response.ok) return [];

            const text = await response.text();

            // Match anything that looks like a slide ID in quotes
            const idPattern = /['"]([a-zA-Z0-9]{6,20})['"]/g;
            let m;
            while ((m = idPattern.exec(text)) !== null) {
                if (!this.isCommonWord(m[1])) {
                    ids.add(m[1]);
                }
            }
        } catch (e) {
            Logger.debug('Failed to parse frame.js', { error: e.message });
        }
        return Array.from(ids);
    },

    /**
     * Probe for slide files using common patterns
     */
    async probeForSlideFiles(baseUrl) {
        const found = [];
        const dataJsPath = `${baseUrl}${PATHS.STORYLINE.DATA_JS_PATH}`;

        // Try HEAD requests for common patterns (fast probe)
        const probePromises = [];

        // Pattern 1: Sequential numbers (common in older Storyline)
        for (let i = 1; i <= 50; i++) {
            probePromises.push(this.probeFile(`${dataJsPath}/slide${i}.js`));
            probePromises.push(this.probeFile(`${dataJsPath}/${i}.js`));
        }

        // Pattern 2: Known Storyline ID patterns (alphanumeric with mixed case)
        // We'll discover more through the data.js parsing

        const results = await Promise.allSettled(probePromises);
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                found.push(result.value);
            }
        });

        return found;
    },

    /**
     * Probe if a file exists (HEAD request)
     */
    async probeFile(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            return response.ok ? url : null;
        } catch (e) {
            return null;
        }
    },

    /**
     * Fetch and parse a single JS file for globalProvideData
     */
    async fetchAndParseJsFile(url) {
        // Skip if already scanned
        if (this._scannedContent.has(url)) return [];
        this._scannedContent.add(url);

        try {
            const response = await Utils.fetchWithTimeout(url, { timeout: 8000 });
            if (!response.ok) return [];

            const text = await response.text();
            return this.parseJsContent(text, url);
        } catch (e) {
            // Silently skip failed fetches
            return [];
        }
    },

    /**
     * Parse JS content for globalProvideData calls
     */
    parseJsContent(text, source) {
        const items = [];
        const sourceFile = source.split('/').pop();

        // Look for ALL globalProvideData calls
        const patterns = [
            /globalProvideData\s*\(\s*'slide'\s*,\s*'([\s\S]+?)'\s*\)/g,
            /globalProvideData\s*\(\s*"slide"\s*,\s*"([\s\S]+?)"\s*\)/g,
            /globalProvideData\s*\(\s*'data'\s*,\s*'([\s\S]+?)'\s*\)/g,
            /globalProvideData\s*\(\s*'path'\s*,\s*'([\s\S]+?)'\s*\)/g,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                try {
                    const json = this.unescapeJson(match[1]);
                    const data = Utils.safeJsonParse(json);
                    if (data) {
                        const dataItems = this.extractItemsFromSlideData(data, sourceFile);
                        items.push(...dataItems);
                    }
                } catch (e) {
                    Logger.debug(`Failed to parse data from ${sourceFile}`, { error: e.message });
                }
            }
        }

        // Also look for raw text content that might be questions/answers
        const textMatches = text.match(/"caption"\s*:\s*"([^"]+)"/g) || [];
        textMatches.forEach(m => {
            const captionMatch = m.match(/"caption"\s*:\s*"([^"]+)"/);
            if (captionMatch) {
                const txt = captionMatch[1].trim();
                if (txt.length > 20 && Utils.isNaturalLanguage(txt) && !Utils.isCodeLike(txt)) {
                    const isQuestion = this.isQuestionText(txt);
                    items.push({
                        type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                        text: txt,
                        source: `Storyline:${sourceFile}`,
                        confidence: CONFIDENCE.MEDIUM
                    });
                }
            }
        });

        return items;
    },

    /**
     * Extract Q&A items from parsed slide data
     */
    extractItemsFromSlideData(data, source) {
        const items = [];

        if (!data || typeof data !== 'object') return items;

        // Check for objects array (main content)
        if (data.objects && Array.isArray(data.objects)) {
            data.objects.forEach(obj => {
                this.extractFromSlideObject(obj, source, items);
            });
        }

        // Check for timeline data
        if (data.timeline) {
            this.extractFromTimeline(data.timeline, source, items);
        }

        // Check for quiz/question structures
        if (data.quiz || data.questions || data.questionBanks) {
            const questions = data.quiz?.questions || data.questions || data.questionBanks;
            if (Array.isArray(questions)) {
                questions.forEach(q => this.extractFromQuestionObject(q, source, items));
            }
        }

        // Deep scan for text content
        this.deepScanForText(data, source, items, new Set());

        return items;
    },

    /**
     * Extract from a slide object
     */
    extractFromSlideObject(obj, source, items) {
        if (!obj) return;

        // Get text content
        const text = obj.caption || obj.altText || obj.text || obj.accText || obj.label;
        if (text && typeof text === 'string') {
            const cleaned = text.trim();
            if (cleaned.length > 15 && Utils.isNaturalLanguage(cleaned) && !Utils.isCodeLike(cleaned)) {
                const isQuestion = this.isQuestionText(cleaned);
                const isCorrect = obj.correct === true || obj.isCorrect === true ||
                                 obj.accState === 'checked' || obj.selected === true;

                items.push({
                    type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                    text: cleaned,
                    correct: isCorrect,
                    source: `Storyline:${source}`,
                    confidence: CONFIDENCE.HIGH,
                    metadata: {
                        accType: obj.accType,
                        objectType: obj.type
                    }
                });
            }
        }

        // Check for choices/answers in sub-objects
        if (obj.choices && Array.isArray(obj.choices)) {
            obj.choices.forEach((choice, idx) => {
                const choiceText = choice.text || choice.caption || choice.label;
                if (choiceText && typeof choiceText === 'string' && choiceText.length > 3) {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: choiceText.trim(),
                        correct: choice.correct === true || choice.isCorrect === true,
                        source: `Storyline:${source}`,
                        confidence: CONFIDENCE.HIGH
                    });
                }
            });
        }
    },

    /**
     * Extract from timeline data
     */
    extractFromTimeline(timeline, source, items) {
        if (!timeline) return;

        // Timeline often has text cues
        if (timeline.cues && Array.isArray(timeline.cues)) {
            timeline.cues.forEach(cue => {
                if (cue.text && typeof cue.text === 'string') {
                    const text = cue.text.trim();
                    if (text.length > 15 && Utils.isNaturalLanguage(text)) {
                        items.push({
                            type: this.isQuestionText(text) ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                            text: text,
                            source: `Storyline:${source}:timeline`,
                            confidence: CONFIDENCE.MEDIUM
                        });
                    }
                }
            });
        }
    },

    /**
     * Extract from question object
     */
    extractFromQuestionObject(q, source, items) {
        if (!q) return;

        // Question text
        const qText = q.question || q.questionText || q.text || q.caption || q.prompt;
        if (qText && typeof qText === 'string' && qText.length > 10) {
            items.push({
                type: ITEM_TYPE.QUESTION,
                text: qText.trim(),
                source: `Storyline:${source}`,
                confidence: CONFIDENCE.VERY_HIGH,
                questionType: q.type || q.questionType || QUESTION_TYPE.MULTIPLE_CHOICE
            });
        }

        // Answers/choices
        const answers = q.answers || q.choices || q.options || q.responses;
        if (Array.isArray(answers)) {
            answers.forEach(a => {
                const aText = a.text || a.caption || a.label || a.response ||
                             (typeof a === 'string' ? a : null);
                if (aText && typeof aText === 'string' && aText.length > 2) {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: aText.trim(),
                        correct: a.correct === true || a.isCorrect === true ||
                                a.score > 0 || a.value === 'correct',
                        source: `Storyline:${source}`,
                        confidence: CONFIDENCE.VERY_HIGH
                    });
                }
            });
        }

        // Correct answer reference
        if (q.correctAnswer || q.correctResponse) {
            const correct = q.correctAnswer || q.correctResponse;
            if (typeof correct === 'string') {
                // Mark the matching answer as correct
                items.forEach(item => {
                    if (item.type === ITEM_TYPE.ANSWER && item.text === correct) {
                        item.correct = true;
                    }
                });
            }
        }
    },

    /**
     * Deep scan for text content in any object structure
     */
    deepScanForText(obj, source, items, seen, depth = 0) {
        if (!obj || depth > 20 || seen.has(obj)) return;
        seen.add(obj);

        if (Array.isArray(obj)) {
            obj.forEach(item => this.deepScanForText(item, source, items, seen, depth + 1));
            return;
        }

        if (typeof obj === 'object') {
            // Text-containing properties
            const textProps = ['caption', 'altText', 'text', 'label', 'accText', 'title', 'prompt'];
            for (const prop of textProps) {
                if (obj[prop] && typeof obj[prop] === 'string') {
                    const text = obj[prop].trim();
                    if (text.length > 20 && Utils.isNaturalLanguage(text) && !Utils.isCodeLike(text)) {
                        // Avoid duplicates
                        if (!items.some(i => i.text === text)) {
                            items.push({
                                type: this.isQuestionText(text) ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                                text: text,
                                correct: obj.correct === true || obj.isCorrect === true,
                                source: `Storyline:${source}`,
                                confidence: CONFIDENCE.MEDIUM
                            });
                        }
                    }
                }
            }

            // Recurse
            Object.values(obj).forEach(value => {
                if (value && typeof value === 'object') {
                    this.deepScanForText(value, source, items, seen, depth + 1);
                }
            });
        }
    },

    /**
     * Extract from inline scripts
     */
    extractFromInlineScripts() {
        const items = [];
        document.querySelectorAll('script:not([src])').forEach(script => {
            const text = script.textContent || '';
            if (text.includes('globalProvideData') || text.includes('slideData') || text.includes('DS')) {
                const scriptItems = this.parseJsContent(text, 'inline');
                items.push(...scriptItems);
            }
        });
        return items;
    },

    /**
     * Extract from window globals
     */
    extractFromGlobals() {
        const items = [];

        // Check DS.VO (Storyline visual objects)
        if (window.DS?.VO) {
            try {
                for (const [id, obj] of Object.entries(window.DS.VO)) {
                    this.extractFromSlideObject(obj, `DS.VO.${id}`, items);
                }
            } catch (e) { }
        }

        // Check g_slideData
        if (window.g_slideData) {
            try {
                const dataItems = this.extractItemsFromSlideData(window.g_slideData, 'g_slideData');
                items.push(...dataItems);
            } catch (e) { }
        }

        // Check g_listQuizzes
        if (window.g_listQuizzes && Array.isArray(window.g_listQuizzes)) {
            try {
                window.g_listQuizzes.forEach((quiz, idx) => {
                    this.extractFromQuestionObject(quiz, `g_listQuizzes[${idx}]`, items);
                });
            } catch (e) { }
        }

        return items;
    },

    /**
     * Extract from iframes (if same-origin)
     */
    async extractFromIframes() {
        const items = [];
        const iframes = document.querySelectorAll('iframe');

        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!iframeDoc) continue;

                // Check inline scripts in iframe
                iframeDoc.querySelectorAll('script:not([src])').forEach(script => {
                    const text = script.textContent || '';
                    if (text.includes('globalProvideData')) {
                        const scriptItems = this.parseJsContent(text, 'iframe:inline');
                        items.push(...scriptItems);
                    }
                });

                // Check iframe's window globals
                const iframeWin = iframe.contentWindow;
                if (iframeWin?.DS?.VO) {
                    for (const [id, obj] of Object.entries(iframeWin.DS.VO)) {
                        this.extractFromSlideObject(obj, `iframe:DS.VO.${id}`, items);
                    }
                }
            } catch (e) {
                // Cross-origin - skip
            }
        }

        return items;
    },

    /**
     * Fallback: scan all script sources
     */
    async scanAllScriptSources() {
        const items = [];
        const scripts = document.querySelectorAll('script[src]');

        for (const script of scripts) {
            if (script.src) {
                const scriptItems = await this.fetchAndParseJsFile(script.src);
                items.push(...scriptItems);
            }
        }

        return items;
    },

    /**
     * Helper: Check if text looks like a question
     */
    isQuestionText(text) {
        const lower = text.toLowerCase();
        return text.includes('?') ||
               lower.startsWith('select') ||
               lower.startsWith('choose') ||
               lower.startsWith('which') ||
               lower.startsWith('what') ||
               lower.startsWith('how') ||
               lower.startsWith('why') ||
               lower.startsWith('when') ||
               lower.startsWith('where') ||
               lower.includes('following') ||
               lower.includes('true or false') ||
               /^\d+[\.\)]\s/.test(text);
    },

    /**
     * Helper: Unescape JSON string
     */
    unescapeJson(str) {
        return str
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
    }
};


export { StorylineExtractor };
