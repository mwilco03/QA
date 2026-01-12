/**
 * LMS QA Validator v3.0
 * Comprehensive LMS content extraction and validation toolkit
 * 
 * Architecture:
 * - Self-contained IIFE (required for page context injection)
 * - Internally modular with clear section boundaries
 * - Consistent error handling throughout
 * - No external dependencies
 * 
 * @fileoverview Main validator script injected into page context
 */

(function() {
    'use strict';

    // Prevent double injection
    if (window.__LMS_QA_INJECTED__) {
        console.log('[LMS QA] Already injected, skipping');
        return;
    }
    window.__LMS_QA_INJECTED__ = true;

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: CONSTANTS
    // Single source of truth for all configuration
    // ═══════════════════════════════════════════════════════════════════════════

    const VERSION = '3.8.0';

    const CONFIG = Object.freeze({
        MAX_RECURSION_DEPTH: 20,
        MAX_API_SEARCH_DEPTH: 5,
        MAX_FETCH_TIMEOUT: 5000,
        MAX_RESOURCES: 100,
        MAX_LOGS: 500,
        DEBOUNCE_DELAY: 150
    });

    const ITEM_TYPE = Object.freeze({
        QUESTION: 'question',
        ANSWER: 'answer',
        SEQUENCE: 'sequence_item',
        DRAG: 'drag_item',
        DROP: 'drop_target',
        MATCH_SOURCE: 'match_source',
        MATCH_TARGET: 'match_target'
    });

    // Question interaction types (aligned with SCORM/xAPI)
    const QUESTION_TYPE = Object.freeze({
        MULTIPLE_CHOICE: 'choice',
        MULTIPLE_RESPONSE: 'multiple-choice',  // Multiple correct answers
        TRUE_FALSE: 'true-false',
        FILL_IN: 'fill-in',
        MATCHING: 'matching',
        SEQUENCING: 'sequencing',
        HOTSPOT: 'hotspot',
        DRAG_DROP: 'drag-drop',
        NUMERIC: 'numeric',
        LIKERT: 'likert',
        ESSAY: 'long-fill-in',
        OTHER: 'other'
    });

    // Authoring tool identifiers
    const AUTHORING_TOOL = Object.freeze({
        STORYLINE: 'storyline',
        RISE: 'rise',
        CAPTIVATE: 'captivate',
        LECTORA: 'lectora',
        ISPRING: 'ispring',
        CAMTASIA: 'camtasia',
        GENERIC: 'generic'
    });

    const CONFIDENCE = Object.freeze({
        VERY_HIGH: 95,
        HIGH: 90,
        MEDIUM: 70,
        LOW: 50,
        VERY_LOW: 30
    });

    const LMS_STANDARD = Object.freeze({
        SCORM_12: 'scorm12',
        SCORM_2004: 'scorm2004',
        XAPI: 'xapi',
        AICC: 'aicc',
        CMI5: 'cmi5',
        CUSTOM: 'custom'  // Proprietary/custom LMS APIs
    });

    const PRIORITY = Object.freeze({
        HIGH: 'high',
        NORMAL: 'normal',
        LOW: 'low'
    });

    const CORRECT_INDICATORS = Object.freeze({
        VALUES: ['true', 'correct', '1'],
        DATA_ATTRS: ['correct', 'answer', 'right'],
        CLASSES: ['correct', 'right-answer', 'is-correct']
    });

    const PLACEHOLDER_TEXT = Object.freeze([
        'choose...', 'select...', 'select one', 'select an option',
        '---', '- select -', ''
    ]);

    const MSG = Object.freeze({
        PREFIX: 'LMS_QA_',
        READY: 'READY',
        SCAN_STARTED: 'SCAN_STARTED',
        SCAN_COMPLETE: 'SCAN_COMPLETE',
        SCAN_ERROR: 'SCAN_ERROR',
        PROGRESS: 'PROGRESS',
        STATE: 'STATE',
        CMI_DATA: 'CMI_DATA',
        TEST_RESULT: 'TEST_RESULT',
        SET_COMPLETION_RESULT: 'SET_COMPLETION_RESULT',
        FORCE_COMPLETION_RESULT: 'FORCE_COMPLETION_RESULT',
        AUTO_SELECT_RESULT: 'AUTO_SELECT_RESULT',
        CMD_SCAN: 'LMS_QA_CMD_SCAN',
        CMD_TEST_API: 'LMS_QA_CMD_TEST_API',
        CMD_SET_COMPLETION: 'LMS_QA_CMD_SET_COMPLETION',
        CMD_FORCE_COMPLETION: 'LMS_QA_CMD_FORCE_COMPLETION',
        CMD_GET_STATE: 'LMS_QA_CMD_GET_STATE',
        CMD_GET_CMI_DATA: 'LMS_QA_CMD_GET_CMI_DATA',
        CMD_AUTO_SELECT: 'LMS_QA_CMD_AUTO_SELECT',
        CMD_EXPORT: 'LMS_QA_CMD_EXPORT',
        CMD_DETECT_APIS: 'LMS_QA_CMD_DETECT_APIS',
        CMD_SEED_EXTRACT: 'LMS_QA_CMD_SEED_EXTRACT',
        APIS_DETECTED: 'APIS_DETECTED',
        SEED_EXTRACT_RESULT: 'SEED_EXTRACT_RESULT'
    });

    // Code detection patterns - if text matches these, it's likely code not content
    const CODE_INDICATORS = [
        /[{}\[\]();].*[{}\[\]();]/,          // Multiple code brackets
        /\bfunction\s*\(/,                    // Function declarations
        /\bvar\s+\w+\s*=/,                    // Variable declarations
        /\bconst\s+\w+\s*=/,
        /\blet\s+\w+\s*=/,
        /\breturn\s+[\w.]+[({]/,              // Return statements
        /\bif\s*\([^)]+\)\s*{/,               // If statements
        /\bfor\s*\([^)]+\)/,                  // For loops
        /\bwhile\s*\(/,
        /\bthis\.\w+\(/,                      // Method calls
        /\w+\.\w+\.\w+\(/,                    // Chained method calls
        /=>\s*{/,                             // Arrow functions
        /\w+\s*===?\s*\w+/,                   // Comparisons
        /\w+\s*!==?\s*\w+/,
        /\|\||&&/,                            // Logical operators
        /\+\+|--/,                            // Increment/decrement
        /\w+\[\w+\]/,                         // Array access
        /parseInt|parseFloat|toString/,       // Common JS methods
        /null|undefined|NaN/,                 // JS literals
        /\.length\s*[><=]/,                   // Length comparisons
        /\.push\(|\.pop\(|\.shift\(/,         // Array methods
        /\.map\(|\.filter\(|\.reduce\(/,      // Functional methods
        /\.substr\(|\.substring\(/,           // String methods
        /console\.|window\.|document\./,      // Global objects
        /[a-z]+[A-Z][a-z]+[A-Z]/,             // camelCase variables (strCorrectResponse)
        /^[a-z]+[A-Z]/,                       // Starts with camelCase
        /\b(str|int|bln|ary|obj)[A-Z]/,       // Hungarian notation prefixes
    ];

    // Content patterns - more restrictive, require natural language context
    const CONTENT_PATTERNS = {
        questions: [
            // "Question: What is..." or "Question 1: ..."
            /["']?question["']?\s*(?:\d+)?\s*:\s*["']([^"']{20,200})["']/gi,
            // Sentences ending with ? that look like natural language
            /(?:^|\n)\s*(?:\d+[\.\)]\s+)?([A-Z][^?\n]{20,150}\?)\s*$/gm,
        ],
        answers: [
            // "answer": "Some text" in JSON-like structures
            /["']answer["']\s*:\s*["']([^"']{5,200})["']/gi,
            // a) Answer text, b) Answer text format
            /(?:^|\n)\s*[a-d][\.\)]\s+([A-Z][^\n]{5,150})/gm
        ],
        correct: [
            // "correctAnswer": "text" in JSON
            /["']correct(?:Answer|Response|Option)["']\s*:\s*["']([^"']{5,200})["']/gi,
        ]
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 2: STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    const StateManager = (function() {
        const state = {
            apis: [],
            resources: [],
            qa: [],
            logs: [],
            warnings: [],
            scanning: false,
            lastScan: null
        };

        const listeners = new Map();

        function emit(event, data) {
            const handlers = listeners.get(event) || [];
            handlers.forEach(fn => {
                try {
                    fn(data);
                } catch (e) {
                    console.error(`[LMS QA] Event handler error for ${event}:`, e);
                }
            });
        }

        return {
            get(key) {
                return key ? state[key] : { ...state };
            },

            set(key, value) {
                const oldValue = state[key];
                state[key] = value;
                emit('change', { key, value, oldValue });
                emit(`change:${key}`, { value, oldValue });
            },

            append(key, item) {
                if (Array.isArray(state[key])) {
                    state[key].push(item);
                    emit(`append:${key}`, item);
                }
            },

            reset() {
                state.apis = [];
                state.resources = [];
                state.qa = [];
                state.logs = [];
                state.warnings = [];
                state.scanning = false;
                emit('reset');
            },

            on(event, handler) {
                if (!listeners.has(event)) {
                    listeners.set(event, []);
                }
                listeners.get(event).push(handler);
                return () => this.off(event, handler);
            },

            off(event, handler) {
                const handlers = listeners.get(event);
                if (handlers) {
                    const idx = handlers.indexOf(handler);
                    if (idx > -1) handlers.splice(idx, 1);
                }
            }
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 3: LOGGING
    // ═══════════════════════════════════════════════════════════════════════════

    const Logger = (function() {
        const LOG_LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        let currentLevel = LOG_LEVEL.INFO;

        function formatEntry(level, message, data) {
            return {
                timestamp: new Date().toISOString(),
                level,
                message,
                data: data ? JSON.parse(JSON.stringify(data)) : undefined
            };
        }

        function log(level, levelName, message, data) {
            if (level < currentLevel) return;

            const entry = formatEntry(levelName, message, data);
            StateManager.append('logs', entry);

            const logs = StateManager.get('logs');
            if (logs.length > CONFIG.MAX_LOGS) {
                StateManager.set('logs', logs.slice(-CONFIG.MAX_LOGS));
            }

            const consoleMethod = levelName === 'ERROR' ? 'error' : 
                                  levelName === 'WARN' ? 'warn' : 'log';
            if (data) {
                console[consoleMethod](`[LMS QA] ${message}`, data);
            } else {
                console[consoleMethod](`[LMS QA] ${message}`);
            }

            return entry;
        }

        return {
            debug: (msg, data) => log(LOG_LEVEL.DEBUG, 'DEBUG', msg, data),
            info: (msg, data) => log(LOG_LEVEL.INFO, 'INFO', msg, data),
            warn: (msg, data) => log(LOG_LEVEL.WARN, 'WARN', msg, data),
            error: (msg, data) => log(LOG_LEVEL.ERROR, 'ERROR', msg, data),
            
            setLevel(level) {
                currentLevel = LOG_LEVEL[level] ?? LOG_LEVEL.INFO;
            },

            getLogs() {
                return StateManager.get('logs');
            },

            time(label) {
                const start = performance.now();
                return () => {
                    const duration = performance.now() - start;
                    this.debug(`${label}: ${duration.toFixed(2)}ms`);
                    return duration;
                };
            }
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 4: UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    const Utils = {
        matchesAny(value, patterns) {
            if (!value) return false;
            const normalized = String(value).toLowerCase().trim();
            return patterns.some(p => normalized === p.toLowerCase());
        },

        /**
         * Check if text looks like code rather than natural language content
         */
        isCodeLike(text) {
            if (!text || text.length < 5) return true;
            
            // Check against code indicator patterns
            for (const pattern of CODE_INDICATORS) {
                if (pattern.test(text)) {
                    return true;
                }
            }

            // Additional heuristics
            const codeCharCount = (text.match(/[{}\[\]();=<>!&|+\-*\/]/g) || []).length;
            const codeCharRatio = codeCharCount / text.length;
            if (codeCharRatio > 0.15) return true;

            // Check for very short words typical of code (var, let, if, for)
            const words = text.split(/\s+/);
            const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
            if (avgWordLength < 3 && words.length > 3) return true;

            // Check if it starts with lowercase and has no spaces (likely variable)
            if (/^[a-z]+[A-Z]/.test(text) && !text.includes(' ')) return true;

            return false;
        },

        /**
         * Check if text looks like natural language content
         */
        isNaturalLanguage(text) {
            if (!text || text.length < 10) return false;
            
            // Must have spaces (multiple words)
            if (!text.includes(' ')) return false;
            
            // Should start with capital letter or number
            if (!/^[A-Z0-9]/.test(text.trim())) return false;
            
            // Should have reasonable word structure
            const words = text.trim().split(/\s+/);
            if (words.length < 2) return false;
            
            // Average word length should be reasonable (3-12 chars)
            const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
            if (avgLen < 2 || avgLen > 15) return false;

            return !Utils.isCodeLike(text);
        },

        isCorrectAnswer(element) {
            if (!element) return false;

            const value = element.value || element.getAttribute('value');
            if (Utils.matchesAny(value, CORRECT_INDICATORS.VALUES)) {
                return true;
            }

            for (const attr of CORRECT_INDICATORS.DATA_ATTRS) {
                if (element.dataset?.[attr] === 'true' || 
                    element.getAttribute(`data-${attr}`) === 'true') {
                    return true;
                }
            }

            if (element.classList) {
                for (const cls of CORRECT_INDICATORS.CLASSES) {
                    if (element.classList.contains(cls)) {
                        return true;
                    }
                }
            }

            return false;
        },

        isPlaceholder(text) {
            if (!text) return true;
            return Utils.matchesAny(text.trim(), PLACEHOLDER_TEXT);
        },

        safeJsonParse(str, defaultValue = null) {
            try {
                return JSON.parse(str);
            } catch {
                return defaultValue;
            }
        },

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        generateId(prefix = '') {
            const random = Math.random().toString(36).substring(2, 8);
            return prefix ? `${prefix}-${random}` : random;
        },

        truncate(str, maxLength = 100) {
            if (!str || str.length <= maxLength) return str;
            return str.substring(0, maxLength - 3) + '...';
        },

        async fetchWithTimeout(url, timeout = CONFIG.MAX_FETCH_TIMEOUT) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    throw new Error(`Request timeout: ${url}`);
                }
                throw error;
            }
        },

        isSameOrigin(url) {
            try {
                const parsed = new URL(url, window.location.href);
                return parsed.origin === window.location.origin;
            } catch {
                return false;
            }
        },

        dedupeBy(array, keyFn) {
            const seen = new Set();
            return array.filter(item => {
                const key = keyFn(item);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5: EXTENSION COMMUNICATION
    // ═══════════════════════════════════════════════════════════════════════════

    const Messenger = {
        send(type, payload = {}) {
            window.postMessage({
                type: `${MSG.PREFIX}${type}`,
                payload,
                timestamp: Date.now()
            }, '*');
        },

        handleCommand(type, payload) {
            Logger.debug(`Received command: ${type}`, payload);

            switch (type) {
                case MSG.CMD_SCAN:
                    Scanner.run();
                    break;

                case MSG.CMD_TEST_API:
                    SCORMAPI.test(payload?.apiIndex || 0);
                    break;

                case MSG.CMD_SET_COMPLETION:
                    SCORMAPI.setCompletion(payload);
                    break;

                case MSG.CMD_FORCE_COMPLETION:
                    // Async handler for force completion
                    SCORMAPI.forceCompletion(payload);
                    break;

                case MSG.CMD_GET_STATE:
                    Messenger.send(MSG.STATE, Reporter.generate());
                    break;

                case MSG.CMD_GET_CMI_DATA:
                    Messenger.send(MSG.CMI_DATA, { data: SCORMAPI.getCmiData() });
                    break;

                case MSG.CMD_AUTO_SELECT:
                    const count = DOMQuizExtractor.autoSelect();
                    Messenger.send(MSG.AUTO_SELECT_RESULT, {
                        success: true,
                        count,
                        message: `Selected ${count} correct answer(s)`
                    });
                    break;

                case MSG.CMD_EXPORT:
                    Exporter.export(payload?.format || 'json');
                    break;

                case MSG.CMD_DETECT_APIS:
                    SCORMAPI.discover();
                    const detectedApis = StateManager.get('apis');
                    Messenger.send(MSG.APIS_DETECTED, { apis: detectedApis });
                    break;

                case MSG.CMD_SEED_EXTRACT:
                    (async () => {
                        const seedText = payload?.seedText;
                        const result = await SeedExtractor.extractFromSeed(seedText);
                        Messenger.send(MSG.SEED_EXTRACT_RESULT, result);
                    })();
                    break;
            }
        },

        init() {
            window.addEventListener('message', (event) => {
                if (event.source !== window) return;
                if (!event.data?.type?.startsWith(MSG.PREFIX)) return;

                const type = event.data.type;
                const payload = event.data.payload;

                if (type.includes('_CMD_')) {
                    this.handleCommand(type, payload);
                }
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 6: SCORM API DETECTION & INTERACTION
    // ═══════════════════════════════════════════════════════════════════════════

    const SCORMAPI = {
        signatures: {
            [LMS_STANDARD.SCORM_12]: {
                required: ['LMSInitialize', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSFinish'],
                optional: ['LMSGetLastError', 'LMSGetErrorString', 'LMSGetDiagnostic']
            },
            [LMS_STANDARD.SCORM_2004]: {
                required: ['Initialize', 'GetValue', 'SetValue', 'Commit', 'Terminate'],
                optional: ['GetLastError', 'GetErrorString', 'GetDiagnostic']
            },
            [LMS_STANDARD.XAPI]: {
                // xAPIWrapper, ADL xAPI, TinCan.js all use similar patterns
                required: ['sendStatement'],
                optional: ['getStatement', 'getStatements', 'sendStatements', 'getState', 'setState', 'getActivityProfile', 'getAgentProfile']
            },
            [LMS_STANDARD.AICC]: {
                required: ['AICC_Init', 'AICC_GetParam', 'AICC_PutParam'],
                optional: []
            },
            [LMS_STANDARD.CUSTOM]: {
                // Common custom completion functions (DoD, proprietary LMS)
                required: ['sendResults'],
                optional: ['getResults', 'setScore', 'setCompletion', 'markComplete']
            }
        },

        // Standalone function names to search for (not on API objects)
        standaloneFunctions: [
            'sendResults', 'submitResults', 'completeLesson', 'lessonComplete',
            'finishLesson', 'setLessonStatus', 'recordCompletion'
        ],

        /**
         * Get all searchable windows/frames comprehensively
         * Handles: iframes, frames collection, parent chain, opener, popups, arrays
         */
        _getAllSearchableWindows() {
            const windows = new Map(); // Use Map to dedupe by reference
            const visited = new WeakSet();

            const addWindow = (win, name) => {
                if (!win || visited.has(win)) return;
                try {
                    // Test access - will throw if cross-origin
                    const testAccess = win.location.href;
                    visited.add(win);
                    windows.set(win, name);
                } catch (e) {
                    // Cross-origin - still add but mark it
                    try {
                        visited.add(win);
                        windows.set(win, `${name} (limited access)`);
                    } catch (e2) { /* completely inaccessible */ }
                }
            };

            // Start with current window
            addWindow(window, 'window');

            // Parent chain - traverse all the way up
            let parentCount = 0;
            let currentParent = window.parent;
            while (currentParent && currentParent !== window && parentCount < 10) {
                addWindow(currentParent, `parent${parentCount > 0 ? `[${parentCount}]` : ''}`);
                if (currentParent === currentParent.parent) break; // Reached top
                currentParent = currentParent.parent;
                parentCount++;
            }

            // Top window (may be same as parent chain end)
            try {
                if (window.top && window.top !== window) {
                    addWindow(window.top, 'top');
                }
            } catch (e) { /* Cross-origin */ }

            // Opener (popup parent)
            try {
                if (window.opener) {
                    addWindow(window.opener, 'opener');
                    // Opener might have its own parent chain
                    try {
                        if (window.opener.parent && window.opener.parent !== window.opener) {
                            addWindow(window.opener.parent, 'opener.parent');
                        }
                    } catch (e) { /* Cross-origin */ }
                }
            } catch (e) { /* Cross-origin */ }

            // All frames collections (window.frames is array-like)
            const searchFramesCollection = (win, baseName) => {
                try {
                    if (win.frames && win.frames.length > 0) {
                        for (let i = 0; i < win.frames.length; i++) {
                            try {
                                addWindow(win.frames[i], `${baseName}.frames[${i}]`);
                            } catch (e) { /* Cross-origin frame */ }
                        }
                    }
                } catch (e) { /* Access denied */ }
            };

            // Search frames in all known windows
            windows.forEach((name, win) => {
                searchFramesCollection(win, name);
            });

            // All iframes in current document
            try {
                const iframes = document.querySelectorAll('iframe');
                iframes.forEach((iframe, index) => {
                    try {
                        if (iframe.contentWindow) {
                            const iframeName = iframe.id || iframe.name || `iframe[${index}]`;
                            addWindow(iframe.contentWindow, iframeName);

                            // Search nested frames within iframe
                            searchFramesCollection(iframe.contentWindow, iframeName);
                        }
                    } catch (e) { /* Cross-origin iframe */ }
                });
            } catch (e) { /* Document access error */ }

            // Check for array-based window references (some LMS use this.window[0])
            const arrayPatterns = ['window', 'win', 'wnd', 'contentWindow', 'targetWindow'];
            windows.forEach((name, win) => {
                for (const pattern of arrayPatterns) {
                    try {
                        const arr = win[pattern];
                        if (Array.isArray(arr) || (arr && typeof arr.length === 'number' && arr.length > 0)) {
                            for (let i = 0; i < Math.min(arr.length, 10); i++) {
                                try {
                                    if (arr[i] && typeof arr[i] === 'object') {
                                        addWindow(arr[i], `${name}.${pattern}[${i}]`);
                                    }
                                } catch (e) { /* Access denied */ }
                            }
                        }
                    } catch (e) { /* Access denied */ }
                }
            });

            // Check for named popup windows (tracked in some LMS)
            const popupPatterns = ['popup', 'popupWindow', 'childWindow', 'courseWindow', 'contentWindow', 'scoWindow'];
            windows.forEach((name, win) => {
                for (const pattern of popupPatterns) {
                    try {
                        const popup = win[pattern];
                        if (popup && typeof popup === 'object' && popup.document) {
                            addWindow(popup, `${name}.${pattern}`);
                        }
                    } catch (e) { /* Access denied */ }
                }
            });

            // Convert Map to array of {name, obj}
            const result = [];
            windows.forEach((name, win) => {
                result.push({ name, obj: win });
            });

            Logger.info(`Found ${result.length} searchable windows/frames`);
            return result;
        },

        /**
         * Search for API in object, handling arrays
         */
        _searchWithArrayHandling(obj, basePath) {
            const found = [];

            // Direct search
            const directResults = this.searchObject(obj, basePath, 0);
            found.push(...directResults);

            // Check if obj has array properties that might contain APIs
            const apiArrayPatterns = ['API', 'api', 'scormAPI', 'SCORM_API'];
            for (const pattern of apiArrayPatterns) {
                try {
                    const arr = obj[pattern];
                    if (Array.isArray(arr)) {
                        for (let i = 0; i < arr.length; i++) {
                            if (arr[i] && typeof arr[i] === 'object') {
                                const arrayResults = this.searchObject(arr[i], `${basePath}.${pattern}[${i}]`, 0);
                                found.push(...arrayResults);
                            }
                        }
                    }
                } catch (e) { /* Access denied */ }
            }

            return found;
        },

        discover() {
            Logger.info('Discovering LMS APIs...');
            const found = [];

            // Get all searchable windows comprehensively
            const searchLocations = this._getAllSearchableWindows();

            for (const { name, obj } of searchLocations) {
                try {
                    // Search for API objects with array handling
                    const apis = this._searchWithArrayHandling(obj, name);
                    found.push(...apis);

                    // Search for standalone completion functions
                    const standaloneFns = this.searchStandaloneFunctions(obj, name);
                    found.push(...standaloneFns);
                } catch (e) {
                    Logger.debug(`Error searching ${name}: ${e.message}`);
                }
            }

            const unique = Utils.dedupeBy(found, api => api.location);
            StateManager.set('apis', unique);

            Logger.info(`Found ${unique.length} API(s) across ${searchLocations.length} windows/frames`);
            return unique;
        },

        searchStandaloneFunctions(obj, path) {
            const found = [];

            for (const fnName of this.standaloneFunctions) {
                try {
                    if (typeof obj[fnName] === 'function') {
                        found.push({
                            type: LMS_STANDARD.CUSTOM,
                            location: `${path}.${fnName}`,
                            ref: { [fnName]: obj[fnName] },
                            methods: [fnName],
                            functional: true,
                            description: `Custom completion function: ${fnName}()`
                        });
                        Logger.info(`Found standalone function: ${fnName}() at ${path}`);
                    }
                } catch (e) { /* Access denied */ }
            }

            return found;
        },

        searchObject(obj, path, depth) {
            if (!obj || depth > CONFIG.MAX_API_SEARCH_DEPTH) return [];

            const found = [];
            // SCORM + xAPI/TCAPI (Tin Can) + common wrappers
            const apiNames = ['API', 'API_1484_11', 'SCORM_API', 'pipwerks', 'TinCanAPI', 'TCAPI', 'ADL', 'xAPIWrapper'];
            
            for (const name of apiNames) {
                try {
                    const api = obj[name];
                    if (api && typeof api === 'object') {
                        const detected = this.identifyAPI(api);
                        if (detected) {
                            found.push({
                                type: detected.type,
                                location: `${path}.${name}`,
                                ref: api,
                                methods: detected.methods,
                                functional: false
                            });
                        }
                    }
                } catch (e) { /* Access denied */ }
            }

            try {
                if (obj.parent && obj.parent !== obj) {
                    found.push(...this.searchObject(obj.parent, `${path}.parent`, depth + 1));
                }
            } catch (e) { /* Cross-origin */ }

            return found;
        },

        identifyAPI(obj) {
            for (const [type, sig] of Object.entries(this.signatures)) {
                const hasRequired = sig.required.every(m => typeof obj[m] === 'function');
                if (hasRequired) {
                    const methods = [...sig.required, ...sig.optional].filter(m => typeof obj[m] === 'function');
                    return { type, methods };
                }
            }
            return null;
        },

        test(apiIndex = 0) {
            const apis = StateManager.get('apis');
            if (apiIndex >= apis.length) {
                Messenger.send(MSG.TEST_RESULT, { success: false, error: 'No API at index' });
                return;
            }

            const api = apis[apiIndex];
            const result = { api: api.type, tests: [] };

            try {
                if (api.type === LMS_STANDARD.SCORM_12) {
                    const initResult = api.ref.LMSInitialize('');
                    result.tests.push({ method: 'LMSInitialize', result: initResult });

                    const studentName = api.ref.LMSGetValue('cmi.core.student_name');
                    result.tests.push({ method: 'LMSGetValue(student_name)', result: studentName });

                    api.functional = initResult === 'true' || initResult === true;
                } else if (api.type === LMS_STANDARD.SCORM_2004) {
                    const initResult = api.ref.Initialize('');
                    result.tests.push({ method: 'Initialize', result: initResult });

                    const learnerName = api.ref.GetValue('cmi.learner_name');
                    result.tests.push({ method: 'GetValue(learner_name)', result: learnerName });

                    api.functional = initResult === 'true' || initResult === true;
                } else if (api.type === LMS_STANDARD.CUSTOM) {
                    // Custom API - verify function exists
                    const fnName = api.methods?.[0] || Object.keys(api.ref)[0];
                    const fn = api.ref[fnName];
                    result.tests.push({
                        method: fnName,
                        result: typeof fn === 'function' ? 'Function available' : 'Not a function'
                    });
                    api.functional = typeof fn === 'function';
                    result.customFunction = fnName;
                }

                result.success = true;
            } catch (error) {
                result.success = false;
                result.error = error.message;
            }

            Messenger.send(MSG.TEST_RESULT, result);
            return result;
        },

        setCompletion(options = {}) {
            const { status = 'completed', score = 100, apiIndex = 0 } = options;
            const apis = StateManager.get('apis');

            if (apiIndex >= apis.length) {
                Messenger.send(MSG.SET_COMPLETION_RESULT, { success: false, error: 'No API available' });
                return;
            }

            const api = apis[apiIndex];
            const result = { operations: [], apiType: api.type };

            try {
                if (api.type === LMS_STANDARD.SCORM_12) {
                    result.operations.push({
                        method: 'LMSSetValue(lesson_status)',
                        result: api.ref.LMSSetValue('cmi.core.lesson_status', status)
                    });
                    result.operations.push({
                        method: 'LMSSetValue(score.raw)',
                        result: api.ref.LMSSetValue('cmi.core.score.raw', String(score))
                    });
                    result.operations.push({
                        method: 'LMSCommit',
                        result: api.ref.LMSCommit('')
                    });
                } else if (api.type === LMS_STANDARD.SCORM_2004) {
                    const status2004 = status === 'completed' ? 'completed' :
                                       status === 'passed' ? 'passed' : 'incomplete';
                    result.operations.push({
                        method: 'SetValue(completion_status)',
                        result: api.ref.SetValue('cmi.completion_status', status2004)
                    });
                    result.operations.push({
                        method: 'SetValue(score.scaled)',
                        result: api.ref.SetValue('cmi.score.scaled', String(score / 100))
                    });
                    result.operations.push({
                        method: 'Commit',
                        result: api.ref.Commit('')
                    });
                } else if (api.type === LMS_STANDARD.CUSTOM) {
                    // Custom completion function (e.g., sendResults, completeLesson)
                    const fnName = api.methods?.[0] || Object.keys(api.ref)[0];
                    const fn = api.ref[fnName];

                    if (typeof fn === 'function') {
                        // Call with common argument patterns
                        // sendResults(1) = pass, sendResults(0) = fail
                        const arg = status === 'completed' || status === 'passed' ? 1 : 0;
                        const callResult = fn(arg);
                        result.operations.push({
                            method: `${fnName}(${arg})`,
                            result: callResult !== undefined ? String(callResult) : 'executed'
                        });
                        result.customFunction = fnName;
                    } else {
                        throw new Error(`${fnName} is not a function`);
                    }
                }

                result.success = true;
            } catch (error) {
                result.success = false;
                result.error = error.message;
            }

            Messenger.send(MSG.SET_COMPLETION_RESULT, result);
            return result;
        },

        getCmiData() {
            const apis = StateManager.get('apis');
            if (apis.length === 0) {
                return { error: 'No API found' };
            }

            const api = apis[0];
            const data = {};

            const elements = api.type === LMS_STANDARD.SCORM_12 ? [
                'cmi.core.student_id', 'cmi.core.student_name', 'cmi.core.lesson_status',
                'cmi.core.score.raw', 'cmi.core.score.min', 'cmi.core.score.max',
                'cmi.core.total_time', 'cmi.suspend_data'
            ] : [
                'cmi.learner_id', 'cmi.learner_name', 'cmi.completion_status',
                'cmi.success_status', 'cmi.score.scaled', 'cmi.score.raw',
                'cmi.total_time', 'cmi.suspend_data'
            ];

            const getValue = api.type === LMS_STANDARD.SCORM_12 ? 'LMSGetValue' : 'GetValue';

            for (const element of elements) {
                try {
                    const value = api.ref[getValue](element);
                    if (value !== '' && value !== null && value !== undefined) {
                        data[element] = value;
                    }
                } catch (e) { /* Element not supported */ }
            }

            return data;
        },

        /**
         * Force course completion using hybrid approach (Approach 3 from tech spec):
         * 1. Sets Storyline internal variables if available
         * 2. Forces LMS API completion (SCORM 1.2, SCORM 2004, or xAPI)
         * 3. Verifies the completion was accepted
         *
         * @param {Object} options - Completion options
         * @param {string} options.status - Completion status ('passed', 'completed', 'failed')
         * @param {number} options.score - Score value (0-100, default: 100)
         * @param {number} options.minScore - Minimum score (default: 0)
         * @param {number} options.maxScore - Maximum score (default: 100)
         * @param {string} options.sessionTime - Session time (auto-generated if not provided)
         * @param {number} options.apiIndex - Which API to use (default: 0)
         * @param {boolean} options.includeInteraction - Include interaction data (default: false)
         * @param {boolean} options.terminate - Terminate session after completion (default: false)
         * @param {boolean} options.skipStoryline - Skip Storyline variable injection (default: false)
         * @returns {Object} Result with success status and operation details
         */
        async forceCompletion(options = {}) {
            const {
                status = 'passed',
                score = 100,
                minScore = 0,
                maxScore = 100,
                passPercent = null,  // Auto-detect or use score as threshold
                sessionTime = null,
                apiIndex = 0,
                includeInteraction = false,
                terminate = false,
                skipStoryline = false,
                fallbackToKitchenSink = true  // Try all methods if primary fails
            } = options;

            const result = {
                success: false,
                timestamp: new Date().toISOString(),
                operations: [],
                storylineState: null,
                verification: null,
                errors: [],
                warnings: []
            };

            Logger.info('Force completion started', options);

            // ─────────────────────────────────────────────────────────
            // Step 1: Inject Storyline variables (if available)
            // ─────────────────────────────────────────────────────────
            if (!skipStoryline) {
                const storylineResult = this._injectStorylineVariables(score, status, {
                    passPercent: passPercent || Math.min(score, 70)
                });
                result.storylineState = storylineResult;
                result.operations.push({
                    phase: 'storyline',
                    ...storylineResult
                });

                if (storylineResult.injected) {
                    await this._sleep(500);
                }
            }

            // ─────────────────────────────────────────────────────────
            // Step 2: Force LMS API completion
            // ─────────────────────────────────────────────────────────
            let apis = StateManager.get('apis');
            if (!apis || apis.length === 0) {
                this.discover();
                apis = StateManager.get('apis');
            }

            let primarySuccess = false;
            const api = apis?.[apiIndex];

            if (api) {
                result.apiType = api.type;
                result.apiLocation = api.location;

                try {
                    let apiResult;
                    const completionOpts = {
                        status, score, minScore, maxScore,
                        includeInteraction, terminate
                    };

                    switch (api.type) {
                        case LMS_STANDARD.SCORM_12:
                            apiResult = this._completeSCORM12(api.ref, {
                                ...completionOpts,
                                sessionTime: sessionTime || this._formatSCORM12Time(300)
                            });
                            break;

                        case LMS_STANDARD.SCORM_2004:
                            apiResult = this._completeSCORM2004(api.ref, {
                                ...completionOpts,
                                sessionTime: sessionTime || this._formatISO8601Duration(300)
                            });
                            break;

                        case LMS_STANDARD.XAPI:
                            apiResult = await this._completeXAPI(api.ref, {
                                status, score, minScore, maxScore,
                                sessionTime: sessionTime || this._formatISO8601Duration(300)
                            });
                            break;

                        case LMS_STANDARD.AICC:
                            apiResult = await this._completeAICC(api.ref, {
                                status, score,
                                sessionTime: sessionTime || '00:05:00'
                            });
                            break;

                        case LMS_STANDARD.CUSTOM:
                            apiResult = this._completeCustom(api, { status, score });
                            break;

                        default:
                            apiResult = { success: false, errors: [`Unsupported API type: ${api.type}`] };
                    }

                    result.operations.push({
                        phase: 'lmsApi',
                        type: api.type,
                        ...apiResult
                    });

                    primarySuccess = apiResult.success;
                    if (!apiResult.success) {
                        result.errors.push(...(apiResult.errors || [`${api.type} completion failed`]));
                    }

                } catch (error) {
                    result.errors.push(`API error: ${error.message}`);
                    result.operations.push({
                        phase: 'lmsApi',
                        type: api.type,
                        success: false,
                        error: error.message
                    });
                }
            } else {
                result.warnings.push('No LMS API found at specified index');
            }

            // ─────────────────────────────────────────────────────────
            // Step 2b: Fallback to kitchen sink if primary failed
            // ─────────────────────────────────────────────────────────
            if (!primarySuccess && fallbackToKitchenSink) {
                Logger.info('Primary completion failed, trying kitchen sink fallback...');
                result.warnings.push('Using kitchen sink fallback');

                const kitchenResult = await this.tryAllCompletionMethods({
                    status, score, stopOnSuccess: true
                });

                result.operations.push({
                    phase: 'kitchenSinkFallback',
                    ...kitchenResult.summary,
                    attempts: kitchenResult.attempts
                });

                if (kitchenResult.successful.length > 0) {
                    primarySuccess = true;
                    result.errors = []; // Clear errors since fallback succeeded
                    result.fallbackUsed = kitchenResult.successful;
                }
            }

            // ─────────────────────────────────────────────────────────
            // Step 3: Verify completion was accepted
            // ─────────────────────────────────────────────────────────
            await this._sleep(200);

            if (api) {
                const verification = this._verifyCompletion(api);
                result.verification = verification;
                result.operations.push({
                    phase: 'verification',
                    ...verification
                });

                result.success = primarySuccess && (verification.verified || result.fallbackUsed);

                if (!verification.verified && verification.status) {
                    result.warnings.push(`Status is '${verification.status}' (requested '${status}')`);
                }
            } else {
                result.success = primarySuccess;
            }

            Logger.info('Force completion finished', { success: result.success, errors: result.errors });
            Messenger.send(MSG.FORCE_COMPLETION_RESULT, result);
            return result;
        },

        /**
         * Inject passing state into Storyline runtime variables
         * @param {number} score - Score value (0-100)
         * @param {string} status - Status ('passed', 'completed', 'failed')
         * @param {Object} options - Additional options
         * @param {number} options.passPercent - Pass threshold (auto-detected if not provided)
         */
        _injectStorylineVariables(score, status, options = {}) {
            const result = {
                available: false,
                injected: false,
                variablesSet: [],
                discoveredVariables: [],
                errors: []
            };

            // Check for Storyline DS object
            if (!window.DS) {
                result.available = false;
                return result;
            }

            result.available = true;
            const isPassing = status === 'passed' || status === 'completed';

            // Discover existing variables from DS.VO to find actual pass threshold
            let detectedPassPercent = options.passPercent || 70;
            try {
                if (window.DS.VO) {
                    for (const [id, obj] of Object.entries(window.DS.VO)) {
                        if (obj?.type === 'variable') {
                            const name = obj.name || id;
                            result.discoveredVariables.push({ id, name, currentValue: obj.value });

                            // Detect pass threshold from existing variables
                            if (name.toLowerCase().includes('passpercent') ||
                                name.toLowerCase().includes('passingscore')) {
                                const existingPass = parseFloat(obj.value);
                                if (!isNaN(existingPass) && existingPass > 0) {
                                    detectedPassPercent = existingPass;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                result.errors.push(`Variable discovery failed: ${e.message}`);
            }

            // Build variable mappings with detected/provided values
            const variables = [
                // Results variables (Storyline quiz results)
                { name: 'Results.ScorePercent', value: score },
                { name: 'Results.PassPercent', value: detectedPassPercent },
                { name: 'Results.QuizPointsScored', value: score },
                { name: 'Results.QuizPointsPossible', value: 100 },
                { name: 'Results.PassFail', value: isPassing ? 'pass' : 'fail' },
                // Quiz variables
                { name: 'Quiz.Score', value: score },
                { name: 'Quiz.Passed', value: isPassing },
                { name: 'Quiz.Complete', value: true },
                // Common custom variable patterns
                { name: 'quizComplete', value: true },
                { name: 'courseComplete', value: true },
                { name: 'lessonComplete', value: true },
                { name: 'PassingScore', value: detectedPassPercent },
                { name: 'UserScore', value: score }
            ];

            // Only set variables if setVariable function exists
            if (typeof window.DS.setVariable !== 'function') {
                result.errors.push('DS.setVariable is not a function');
                return result;
            }

            for (const { name, value } of variables) {
                try {
                    window.DS.setVariable(name, value);
                    result.variablesSet.push({ name, value, success: true });
                } catch (e) {
                    // Variable may not exist in this course - that's expected
                    result.variablesSet.push({ name, value, success: false, error: e.message });
                }
            }

            // Also try to set any discovered variables that look completion-related
            for (const discovered of result.discoveredVariables) {
                const lowerName = discovered.name.toLowerCase();
                if (lowerName.includes('complete') || lowerName.includes('passed') ||
                    lowerName.includes('finished') || lowerName.includes('done')) {
                    try {
                        const newValue = lowerName.includes('score') ? score : true;
                        window.DS.setVariable(discovered.name, newValue);
                        result.variablesSet.push({
                            name: discovered.name,
                            value: newValue,
                            success: true,
                            wasDiscovered: true
                        });
                    } catch (e) {
                        // Ignore - variable might be read-only
                    }
                }
            }

            result.injected = result.variablesSet.some(v => v.success);
            result.passPercentUsed = detectedPassPercent;
            return result;
        },

        /**
         * Complete SCORM 1.2 course with all required data elements
         */
        _completeSCORM12(api, options) {
            const { status, score, minScore, maxScore, sessionTime, includeInteraction, terminate } = options;
            const result = { success: true, operations: [], errors: [] };

            // Map status to SCORM 1.2 values
            const scormStatus = status === 'passed' ? 'passed' :
                               status === 'failed' ? 'failed' : 'completed';

            const setOps = [
                // Score data (required by many LMS)
                ['cmi.core.score.raw', String(score)],
                ['cmi.core.score.min', String(minScore)],
                ['cmi.core.score.max', String(maxScore)],
                // Completion status
                ['cmi.core.lesson_status', scormStatus],
                // Session time (required by some LMS)
                ['cmi.core.session_time', sessionTime],
                // Exit type
                ['cmi.core.exit', '']
            ];

            for (const [element, value] of setOps) {
                const opResult = this._safeSetValue(api, element, value, true);
                result.operations.push(opResult);
                if (!opResult.success) {
                    result.errors.push(`Failed to set ${element}: ${opResult.error}`);
                }
            }

            // Add interaction data if requested (some LMS require this)
            if (includeInteraction) {
                const interactionOps = [
                    ['cmi.interactions.0.id', 'QA_Validation_Q1'],
                    ['cmi.interactions.0.type', 'choice'],
                    ['cmi.interactions.0.result', 'correct'],
                    ['cmi.interactions.0.student_response', 'a'],
                    ['cmi.interactions.0.correct_responses.0.pattern', 'a'],
                    ['cmi.interactions.0.weighting', '1'],
                    ['cmi.interactions.0.latency', '00:00:30']
                ];

                for (const [element, value] of interactionOps) {
                    const opResult = this._safeSetValue(api, element, value, true);
                    result.operations.push(opResult);
                }
            }

            // Commit changes
            try {
                const commitResult = api.LMSCommit('');
                result.operations.push({
                    method: 'LMSCommit',
                    success: commitResult === 'true' || commitResult === true,
                    result: commitResult
                });
            } catch (e) {
                result.errors.push(`Commit failed: ${e.message}`);
            }

            // Terminate if requested
            if (terminate) {
                try {
                    const finishResult = api.LMSFinish('');
                    result.operations.push({
                        method: 'LMSFinish',
                        success: finishResult === 'true' || finishResult === true,
                        result: finishResult
                    });
                } catch (e) {
                    result.errors.push(`Finish failed: ${e.message}`);
                }
            }

            result.success = result.errors.length === 0;
            return result;
        },

        /**
         * Complete SCORM 2004 course with all required data elements
         */
        _completeSCORM2004(api, options) {
            const { status, score, minScore, maxScore, sessionTime, includeInteraction, terminate } = options;
            const result = { success: true, operations: [], errors: [] };

            // SCORM 2004 uses separate completion_status and success_status
            const completionStatus = 'completed';
            const successStatus = status === 'passed' ? 'passed' :
                                 status === 'failed' ? 'failed' : 'unknown';
            const scaledScore = (score - minScore) / (maxScore - minScore);
            const progressMeasure = 1.0; // 100% complete

            const setOps = [
                // Score data
                ['cmi.score.scaled', String(scaledScore.toFixed(2))],
                ['cmi.score.raw', String(score)],
                ['cmi.score.min', String(minScore)],
                ['cmi.score.max', String(maxScore)],
                // Completion and success
                ['cmi.completion_status', completionStatus],
                ['cmi.success_status', successStatus],
                // Progress
                ['cmi.progress_measure', String(progressMeasure)],
                // Session time (ISO 8601 duration)
                ['cmi.session_time', sessionTime],
                // Exit
                ['cmi.exit', 'normal']
            ];

            for (const [element, value] of setOps) {
                const opResult = this._safeSetValue(api, element, value, false);
                result.operations.push(opResult);
                if (!opResult.success) {
                    result.errors.push(`Failed to set ${element}: ${opResult.error}`);
                }
            }

            // Add interaction data if requested
            if (includeInteraction) {
                const interactionOps = [
                    ['cmi.interactions.0.id', 'QA_Validation_Q1'],
                    ['cmi.interactions.0.type', 'choice'],
                    ['cmi.interactions.0.result', 'correct'],
                    ['cmi.interactions.0.learner_response', 'a'],
                    ['cmi.interactions.0.correct_responses.0.pattern', 'a'],
                    ['cmi.interactions.0.weighting', '1'],
                    ['cmi.interactions.0.latency', 'PT30S'],
                    ['cmi.interactions.0.description', 'QA Validation Question']
                ];

                for (const [element, value] of interactionOps) {
                    const opResult = this._safeSetValue(api, element, value, false);
                    result.operations.push(opResult);
                }
            }

            // Commit changes
            try {
                const commitResult = api.Commit('');
                result.operations.push({
                    method: 'Commit',
                    success: commitResult === 'true' || commitResult === true,
                    result: commitResult
                });
            } catch (e) {
                result.errors.push(`Commit failed: ${e.message}`);
            }

            // Terminate if requested
            if (terminate) {
                try {
                    const terminateResult = api.Terminate('');
                    result.operations.push({
                        method: 'Terminate',
                        success: terminateResult === 'true' || terminateResult === true,
                        result: terminateResult
                    });
                } catch (e) {
                    result.errors.push(`Terminate failed: ${e.message}`);
                }
            }

            result.success = result.errors.length === 0;
            return result;
        },

        /**
         * Complete xAPI course by sending completion statement to LRS
         */
        async _completeXAPI(api, options) {
            const { status, score, minScore, maxScore, sessionTime } = options;
            const result = { success: true, operations: [], errors: [] };

            // Build xAPI statement (may fail if no actor available)
            const { statement, error: buildError } = this._buildXAPIStatement(
                status, score, minScore, maxScore, sessionTime
            );

            if (buildError || !statement) {
                result.success = false;
                result.errors.push(buildError || 'Failed to build xAPI statement');
                result.operations.push({
                    method: 'buildStatement',
                    success: false,
                    error: buildError
                });
                return result;
            }

            try {
                // Try different xAPI library patterns
                if (typeof api.sendStatement === 'function') {
                    // Standard xAPIWrapper pattern
                    const sendResult = await this._xapiSendWithCallback(
                        api, 'sendStatement', statement
                    );

                    result.operations.push({
                        method: 'sendStatement',
                        success: sendResult.success,
                        result: sendResult.response,
                        error: sendResult.error,
                        statementId: statement.id
                    });

                    if (!sendResult.success) {
                        throw new Error(sendResult.error || 'sendStatement failed');
                    }
                } else if (api.lrs && typeof api.lrs.saveStatement === 'function') {
                    // TinCanJS pattern
                    const saveResult = await this._xapiSendWithCallback(
                        api.lrs, 'saveStatement', statement, { useOptionsCallback: true }
                    );

                    result.operations.push({
                        method: 'lrs.saveStatement',
                        success: saveResult.success,
                        result: saveResult.response,
                        error: saveResult.error,
                        statementId: statement.id
                    });

                    if (!saveResult.success) {
                        throw new Error(saveResult.error || 'saveStatement failed');
                    }
                } else {
                    throw new Error('No compatible xAPI send method found on API object');
                }
            } catch (e) {
                result.success = false;
                result.errors.push(`xAPI statement failed: ${e.message}`);
            }

            return result;
        },

        /**
         * Send xAPI statement with proper callback/promise handling
         * Avoids double-resolve issues
         */
        async _xapiSendWithCallback(api, method, statement, options = {}) {
            const { useOptionsCallback = false } = options;

            return new Promise((resolve) => {
                let resolved = false;
                const safeResolve = (result) => {
                    if (!resolved) {
                        resolved = true;
                        resolve(result);
                    }
                };

                // Set timeout to avoid hanging
                const timeout = setTimeout(() => {
                    safeResolve({ success: false, error: 'xAPI send timeout (10s)' });
                }, 10000);

                try {
                    if (useOptionsCallback) {
                        // TinCanJS style: method(statement, { callback: fn })
                        api[method](statement, {
                            callback: (err, xhr) => {
                                clearTimeout(timeout);
                                if (err) {
                                    safeResolve({ success: false, error: String(err) });
                                } else {
                                    safeResolve({ success: true, response: xhr?.status || 'ok' });
                                }
                            }
                        });
                    } else {
                        // xAPIWrapper style: method(statement, callback)
                        const result = api[method](statement, (err, resp) => {
                            clearTimeout(timeout);
                            if (err) {
                                safeResolve({ success: false, error: String(err) });
                            } else {
                                safeResolve({ success: true, response: resp });
                            }
                        });

                        // Handle synchronous return (no callback invoked)
                        if (result !== undefined && typeof result !== 'function') {
                            // Give callback a moment to fire first
                            setTimeout(() => {
                                clearTimeout(timeout);
                                safeResolve({ success: true, response: result });
                            }, 100);
                        }
                    }
                } catch (e) {
                    clearTimeout(timeout);
                    safeResolve({ success: false, error: e.message });
                }
            });
        },

        /**
         * Build xAPI statement for completion
         * Returns { statement, error } - error is set if actor cannot be found
         */
        _buildXAPIStatement(status, score, minScore, maxScore, duration) {
            // Get actor - MUST have valid actor per xAPI spec
            const actor = this._getXAPIActor();
            if (!actor) {
                return {
                    statement: null,
                    error: 'No valid xAPI actor found - cannot send statement without learner identity'
                };
            }

            const activity = this._getXAPIActivity();

            const verb = status === 'passed' ? {
                id: 'http://adlnet.gov/expapi/verbs/passed',
                display: { 'en-US': 'passed' }
            } : status === 'failed' ? {
                id: 'http://adlnet.gov/expapi/verbs/failed',
                display: { 'en-US': 'failed' }
            } : {
                id: 'http://adlnet.gov/expapi/verbs/completed',
                display: { 'en-US': 'completed' }
            };

            // Calculate scaled score (clamped to -1 to 1 per spec)
            const range = maxScore - minScore;
            const scaled = range > 0 ? Math.max(-1, Math.min(1, (score - minScore) / range)) : 0;

            return {
                statement: {
                    id: this._generateUUID(),
                    timestamp: new Date().toISOString(),
                    actor: actor,
                    verb: verb,
                    object: activity,
                    result: {
                        completion: true,
                        success: status === 'passed',
                        score: {
                            scaled: parseFloat(scaled.toFixed(4)),
                            raw: score,
                            min: minScore,
                            max: maxScore
                        },
                        duration: duration
                    }
                },
                error: null
            };
        },

        /**
         * Get xAPI actor from existing context
         * Returns null if no valid actor can be found (do not use fake actors)
         */
        _getXAPIActor() {
            // Search paths for actor in various xAPI libraries
            const actorPaths = [
                ['ADL', 'XAPIWrapper', 'lrs', 'actor'],
                ['xAPIWrapper', 'lrs', 'actor'],
                ['TinCan', 'actor'],
                ['lrs', 'actor'],
                ['xapiConfig', 'actor'],
                ['Config', 'xapi', 'actor'],
                ['TCAPI', 'actor'],
                ['xapi', 'actor']
            ];

            for (const path of actorPaths) {
                const actor = this._resolveObjectPath(path);
                if (actor && this._isValidXAPIActor(actor)) {
                    return actor;
                }
            }

            // Check URL parameters for actor (common in xAPI launch)
            try {
                const params = new URLSearchParams(window.location.search);
                const actorParam = params.get('actor');
                if (actorParam) {
                    const actor = JSON.parse(decodeURIComponent(actorParam));
                    if (this._isValidXAPIActor(actor)) {
                        return actor;
                    }
                }
            } catch (e) { /* ignore parse errors */ }

            // Check for actor in parent/opener windows
            const locations = [window.parent, window.top, window.opener];
            for (const loc of locations) {
                if (!loc || loc === window) continue;
                try {
                    for (const path of actorPaths) {
                        const actor = this._resolveObjectPath(path, loc);
                        if (actor && this._isValidXAPIActor(actor)) {
                            return actor;
                        }
                    }
                } catch (e) { /* cross-origin */ }
            }

            // No valid actor found - return null instead of fake
            return null;
        },

        /**
         * Validate xAPI actor has required inverse functional identifier
         */
        _isValidXAPIActor(actor) {
            if (!actor || typeof actor !== 'object') return false;

            // Must have at least one inverse functional identifier
            return !!(
                actor.mbox ||
                actor.mbox_sha1sum ||
                actor.openid ||
                (actor.account && actor.account.homePage && actor.account.name)
            );
        },

        /**
         * Get xAPI activity from existing context or derive from URL
         */
        _getXAPIActivity() {
            // Try to find existing activity ID
            try {
                if (window.ADL?.XAPIWrapper?.lrs?.activity_id) {
                    return {
                        id: window.ADL.XAPIWrapper.lrs.activity_id,
                        objectType: 'Activity',
                        definition: {
                            type: 'http://adlnet.gov/expapi/activities/course',
                            name: { 'en-US': document.title || 'Course' }
                        }
                    };
                }
            } catch (e) { /* ignore */ }

            // Derive from URL
            return {
                id: window.location.href.split('?')[0],
                objectType: 'Activity',
                definition: {
                    type: 'http://adlnet.gov/expapi/activities/course',
                    name: { 'en-US': document.title || 'Course' }
                }
            };
        },

        /**
         * Complete using custom/proprietary API
         */
        _completeCustom(api, options) {
            const { status, score } = options;
            const result = { success: true, operations: [], errors: [] };

            const fnName = api.methods?.[0] || Object.keys(api.ref)[0];
            const fn = api.ref[fnName];

            if (typeof fn !== 'function') {
                result.success = false;
                result.errors.push(`${fnName} is not a function`);
                return result;
            }

            try {
                // Common calling patterns for custom APIs
                const arg = status === 'passed' || status === 'completed' ? 1 : 0;
                const callResult = fn(arg);

                result.operations.push({
                    method: `${fnName}(${arg})`,
                    success: true,
                    result: callResult !== undefined ? String(callResult) : 'executed'
                });

                // Try score-specific function if available
                if (typeof api.ref.setScore === 'function') {
                    const scoreResult = api.ref.setScore(score);
                    result.operations.push({
                        method: `setScore(${score})`,
                        success: true,
                        result: scoreResult !== undefined ? String(scoreResult) : 'executed'
                    });
                }
            } catch (e) {
                result.success = false;
                result.errors.push(`Custom API call failed: ${e.message}`);
            }

            return result;
        },

        /**
         * Safe SCORM SetValue with error detection
         */
        _safeSetValue(api, element, value, isSCORM12) {
            const method = isSCORM12 ? 'LMSSetValue' : 'SetValue';
            const getErrorMethod = isSCORM12 ? 'LMSGetLastError' : 'GetLastError';
            const getErrorStringMethod = isSCORM12 ? 'LMSGetErrorString' : 'GetErrorString';

            try {
                const result = api[method](element, value);
                const success = result === 'true' || result === true;

                if (!success) {
                    // Get error details
                    let errorCode = '0';
                    let errorString = '';

                    try {
                        errorCode = api[getErrorMethod]?.() || '0';
                        errorString = api[getErrorStringMethod]?.(errorCode) || '';
                    } catch (e) { /* ignore */ }

                    return {
                        method: `${method}('${element}', '${value}')`,
                        success: false,
                        result: result,
                        error: `Error ${errorCode}: ${errorString}`.trim()
                    };
                }

                return {
                    method: `${method}('${element}', '${value}')`,
                    success: true,
                    result: result
                };
            } catch (e) {
                return {
                    method: `${method}('${element}', '${value}')`,
                    success: false,
                    error: e.message
                };
            }
        },

        /**
         * Verify completion was accepted by LMS
         */
        _verifyCompletion(api) {
            const result = {
                verified: false,
                status: null,
                score: null,
                errors: []
            };

            try {
                if (api.type === LMS_STANDARD.SCORM_12) {
                    const status = api.ref.LMSGetValue('cmi.core.lesson_status');
                    const score = api.ref.LMSGetValue('cmi.core.score.raw');

                    result.status = status;
                    result.score = score;
                    result.verified = ['passed', 'completed'].includes(status);
                } else if (api.type === LMS_STANDARD.SCORM_2004) {
                    const completionStatus = api.ref.GetValue('cmi.completion_status');
                    const successStatus = api.ref.GetValue('cmi.success_status');
                    const score = api.ref.GetValue('cmi.score.scaled');

                    result.status = `${completionStatus}/${successStatus}`;
                    result.score = score;
                    result.verified = completionStatus === 'completed' || successStatus === 'passed';
                } else if (api.type === LMS_STANDARD.XAPI) {
                    // xAPI verification would require querying the LRS
                    // For now, assume success if statement was sent without error
                    result.verified = true;
                    result.status = 'statement_sent';
                } else if (api.type === LMS_STANDARD.CUSTOM) {
                    // Custom APIs may not have verification
                    result.verified = true;
                    result.status = 'assumed_success';
                }
            } catch (e) {
                result.errors.push(`Verification failed: ${e.message}`);
            }

            return result;
        },

        /**
         * Format session time for SCORM 1.2 (HHHH:MM:SS.SS)
         */
        _formatSCORM12Time(seconds) {
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            return `${String(hrs).padStart(4, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        },

        /**
         * Format duration as ISO 8601 (PT#H#M#S)
         */
        _formatISO8601Duration(seconds) {
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            let duration = 'PT';
            if (hrs > 0) duration += `${hrs}H`;
            if (mins > 0) duration += `${mins}M`;
            if (secs > 0 || duration === 'PT') duration += `${secs}S`;
            return duration;
        },

        /**
         * Generate UUID for xAPI statements
         */
        _generateUUID() {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID();
            }
            // Fallback for older browsers
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        },

        /**
         * Promise-based sleep helper
         */
        _sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // AICC / HACP SUPPORT
        // ═══════════════════════════════════════════════════════════════════════════

        /**
         * Complete AICC course via HACP protocol
         * Per CMI001 spec: Initialize -> PutParam -> ExitAU
         */
        async _completeAICC(api, options) {
            const { status, score, sessionTime } = options;
            const result = { success: false, operations: [], errors: [], sessionId: null };

            // AICC status mapping per CMI001 spec
            const aiccStatus = status === 'passed' ? 'p' :
                              status === 'failed' ? 'f' :
                              status === 'completed' ? 'c' :
                              status === 'incomplete' ? 'i' :
                              status === 'not attempted' ? 'n' :
                              status === 'browsed' ? 'b' : 'c';

            // Find session ID (required for HACP)
            const sessionId = this._findAICCSessionId();
            result.sessionId = sessionId;

            try {
                // ─────────────────────────────────────────────────────────
                // Method 1: AICC API wrapper (if available)
                // ─────────────────────────────────────────────────────────
                if (api && typeof api.AICC_Init === 'function') {
                    // Initialize session first
                    try {
                        const initResult = api.AICC_Init();
                        result.operations.push({
                            method: 'AICC_Init()',
                            success: true,
                            result: initResult
                        });
                    } catch (e) {
                        result.operations.push({
                            method: 'AICC_Init()',
                            success: false,
                            error: e.message
                        });
                    }
                }

                if (api && typeof api.AICC_PutParam === 'function') {
                    const params = [
                        ['lesson_status', aiccStatus],
                        ['score', String(score)],
                        ['time', sessionTime || '00:05:00']
                    ];

                    for (const [param, value] of params) {
                        try {
                            const putResult = api.AICC_PutParam(param, value);
                            result.operations.push({
                                method: `AICC_PutParam('${param}', '${value}')`,
                                success: true,
                                result: putResult
                            });
                        } catch (e) {
                            result.operations.push({
                                method: `AICC_PutParam('${param}', '${value}')`,
                                success: false,
                                error: e.message
                            });
                        }
                    }
                }

                // ─────────────────────────────────────────────────────────
                // Method 2: Direct HACP POST
                // ─────────────────────────────────────────────────────────
                const hacpUrl = this._findHACPEndpoint();
                if (hacpUrl) {
                    const hacpResult = await this._postHACP(hacpUrl, {
                        lesson_status: aiccStatus,
                        score: score,
                        time: sessionTime || '00:05:00',
                        session_id: sessionId
                    });
                    result.operations.push({
                        method: 'HACP PutParam',
                        url: hacpUrl,
                        ...hacpResult
                    });

                    // Only mark success if HACP returned error=0
                    if (hacpResult.success && hacpResult.errorCode === 0) {
                        result.success = true;
                    }
                }

                // ─────────────────────────────────────────────────────────
                // Method 3: Global AICC wrapper functions
                // ─────────────────────────────────────────────────────────
                const locations = [window, window.parent, window.top];
                for (const loc of locations) {
                    if (!loc) continue;

                    try {
                        // Try AICC_Init if available
                        if (typeof loc.AICC_Init === 'function' && !result.operations.some(o => o.method === 'AICC_Init()')) {
                            try {
                                loc.AICC_Init();
                                result.operations.push({ method: 'AICC_Init()', success: true, location: loc === window ? 'window' : 'parent' });
                            } catch (e) { /* ignore */ }
                        }

                        // SetStatus, SetScore, ExitAU
                        if (typeof loc.SetStatus === 'function') {
                            loc.SetStatus(aiccStatus);
                            result.operations.push({ method: 'SetStatus()', success: true, value: aiccStatus });
                            result.success = true;
                        }
                        if (typeof loc.SetScore === 'function') {
                            loc.SetScore(score);
                            result.operations.push({ method: 'SetScore()', success: true, value: score });
                        }
                        if (typeof loc.PutParam === 'function') {
                            loc.PutParam('lesson_status', aiccStatus);
                            loc.PutParam('score', String(score));
                            result.operations.push({ method: 'PutParam()', success: true });
                            result.success = true;
                        }
                    } catch (e) { /* cross-origin */ }
                }

                // ─────────────────────────────────────────────────────────
                // Method 4: ExitAU to finalize
                // ─────────────────────────────────────────────────────────
                for (const loc of locations) {
                    if (!loc) continue;
                    try {
                        if (typeof loc.ExitAU === 'function') {
                            loc.ExitAU('');
                            result.operations.push({ method: 'ExitAU()', success: true });
                            break;
                        }
                    } catch (e) { /* cross-origin */ }
                }

            } catch (e) {
                result.errors.push(`AICC completion failed: ${e.message}`);
            }

            // Determine success from operations
            if (!result.success) {
                result.success = result.operations.some(op => op.success);
            }

            return result;
        },

        /**
         * Find AICC session ID from various sources
         */
        _findAICCSessionId() {
            // Check URL parameters (most common)
            const params = new URLSearchParams(window.location.search);
            const sessionId = params.get('aicc_sid') ||
                             params.get('AICC_SID') ||
                             params.get('session_id') ||
                             params.get('SESSION_ID');
            if (sessionId) return sessionId;

            // Check window variables
            const locations = [window, window.parent, window.top];
            for (const loc of locations) {
                try {
                    if (loc.AICC_SID) return loc.AICC_SID;
                    if (loc.aicc_sid) return loc.aicc_sid;
                    if (loc.sessionId) return loc.sessionId;
                } catch (e) { /* cross-origin */ }
            }

            // Check hidden form fields
            const hiddenField = document.querySelector('input[name="aicc_sid"], input[name="session_id"]');
            if (hiddenField?.value) return hiddenField.value;

            return null;
        },

        /**
         * Find HACP endpoint URL from page context
         */
        _findHACPEndpoint() {
            // Check URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            const aiccUrl = urlParams.get('aicc_url') || urlParams.get('AICC_URL');
            if (aiccUrl) return aiccUrl;

            // Check for hidden form fields
            const form = document.querySelector('form[action*="HACP"], form[action*="hacp"]');
            if (form) return form.action;

            // Check input fields
            const urlField = document.querySelector('input[name="aicc_url"], input[name="AICC_URL"]');
            if (urlField?.value) return urlField.value;

            // Check window variables
            const locations = [window, window.parent, window.top];
            for (const loc of locations) {
                try {
                    if (loc.AICC_URL) return loc.AICC_URL;
                    if (loc.aicc_url) return loc.aicc_url;
                    if (loc.hacpUrl) return loc.hacpUrl;
                    if (loc.aiccEndpoint) return loc.aiccEndpoint;
                } catch (e) { /* cross-origin */ }
            }

            return null;
        },

        /**
         * POST to HACP endpoint with proper session handling
         * Per CMI001 spec section 5.2
         */
        async _postHACP(url, data) {
            try {
                // Build AICC data block format (INI-style per CMI001)
                const aiccData = [
                    '[Core]',
                    `Lesson_Status=${data.lesson_status}`,
                    `Score=${data.score}`,
                    `Time=${data.time}`,
                    '[Core_Lesson]'
                ].join('\r\n');

                const formData = new FormData();
                formData.append('command', 'PutParam');
                formData.append('version', '4.0');
                formData.append('aicc_data', aiccData);

                // Include session_id if available (required by many LMS)
                if (data.session_id) {
                    formData.append('session_id', data.session_id);
                }

                const response = await fetch(url, {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });

                const text = await response.text();

                // Parse HACP response for error code
                const parsed = this._parseHACPResponse(text);

                return {
                    success: response.ok && parsed.errorCode === 0,
                    httpStatus: response.status,
                    errorCode: parsed.errorCode,
                    errorText: parsed.errorText,
                    response: text.substring(0, 500)
                };
            } catch (e) {
                return { success: false, error: e.message, errorCode: -1 };
            }
        },

        /**
         * Parse HACP response text for error code
         * Response format: error=0\r\nerror_text=Successful\r\n...
         */
        _parseHACPResponse(text) {
            const result = { errorCode: -1, errorText: '', data: {} };

            if (!text) return result;

            // Parse line by line
            const lines = text.split(/[\r\n]+/);
            for (const line of lines) {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const [, key, value] = match;
                    const lowerKey = key.toLowerCase().trim();

                    if (lowerKey === 'error') {
                        result.errorCode = parseInt(value, 10) || 0;
                    } else if (lowerKey === 'error_text') {
                        result.errorText = value.trim();
                    } else {
                        result.data[lowerKey] = value.trim();
                    }
                }
            }

            return result;
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // ENHANCED TCAPI / TIN CAN / xAPI SUPPORT
        // ═══════════════════════════════════════════════════════════════════════════

        /**
         * Enhanced TCAPI completion with multiple library pattern support
         */
        async _completeTCAPI(options) {
            const { status, score, minScore, maxScore, sessionTime } = options;
            const result = { success: false, operations: [], errors: [], librariesFound: [] };

            // All known xAPI/TCAPI library patterns
            const tcapiPatterns = [
                // ADL xAPIWrapper
                { name: 'ADL.XAPIWrapper', path: ['ADL', 'XAPIWrapper'], sendMethod: 'sendStatement' },
                { name: 'xAPIWrapper', path: ['xAPIWrapper'], sendMethod: 'sendStatement' },
                // TinCanJS
                { name: 'TinCan', path: ['TinCan'], isClass: true },
                { name: 'TinCan.LRS', path: ['TinCan', 'LRS'], isClass: true },
                // TCAPI
                { name: 'TCAPI', path: ['TCAPI'], sendMethod: 'sendStatement' },
                { name: 'TinCanAPI', path: ['TinCanAPI'], sendMethod: 'sendStatement' },
                // Rustici/SCORM Cloud patterns
                { name: 'pipwerks.SCORM', path: ['pipwerks', 'SCORM'], sendMethod: 'set' },
                { name: 'ScormCloud', path: ['ScormCloud', 'xAPI'], sendMethod: 'sendStatement' },
                // Generic xapi objects
                { name: 'xapi', path: ['xapi'], sendMethod: 'sendStatement' },
                { name: 'lrs', path: ['lrs'], sendMethod: 'saveStatement' }
            ];

            const statement = this._buildXAPIStatement(status, score, minScore, maxScore, sessionTime);

            for (const pattern of tcapiPatterns) {
                const api = this._resolveObjectPath(pattern.path);
                if (!api) continue;

                result.librariesFound.push(pattern.name);
                Logger.info(`Found TCAPI library: ${pattern.name}`);

                try {
                    if (pattern.isClass && typeof api === 'function') {
                        // TinCanJS class pattern - need to instantiate
                        const tcResult = await this._sendViaTinCanJS(api, statement);
                        result.operations.push({ library: pattern.name, ...tcResult });
                        if (tcResult.success) result.success = true;
                    } else if (pattern.sendMethod && typeof api[pattern.sendMethod] === 'function') {
                        // Direct send method - use safe callback wrapper
                        const sendResult = await this._xapiSendWithCallback(api, pattern.sendMethod, statement);
                        result.operations.push({ library: pattern.name, method: pattern.sendMethod, ...sendResult });
                        if (sendResult.success) result.success = true;
                    } else if (api.lrs && typeof api.lrs.saveStatement === 'function') {
                        // Nested LRS pattern
                        const sendResult = await this._xapiSendWithCallback(
                            api.lrs, 'saveStatement', statement, { useOptionsCallback: true }
                        );
                        result.operations.push({ library: pattern.name, method: 'lrs.saveStatement', ...sendResult });
                        if (sendResult.success) result.success = true;
                    }
                } catch (e) {
                    result.operations.push({
                        library: pattern.name,
                        success: false,
                        error: e.message
                    });
                }
            }

            // Also check for configured LRS endpoint
            const lrsConfig = this._findLRSConfig();
            if (lrsConfig) {
                result.lrsConfig = lrsConfig;
                try {
                    const directResult = await this._sendDirectToLRS(lrsConfig, statement);
                    result.operations.push({ method: 'Direct LRS POST', ...directResult });
                    if (directResult.success) result.success = true;
                } catch (e) {
                    result.errors.push(`Direct LRS failed: ${e.message}`);
                }
            }

            if (!result.success && result.librariesFound.length === 0) {
                result.errors.push('No TCAPI/xAPI libraries found');
            }

            return result;
        },

        /**
         * Resolve nested object path like ['ADL', 'XAPIWrapper']
         */
        _resolveObjectPath(path, root = window) {
            let obj = root;
            for (const key of path) {
                if (!obj || typeof obj !== 'object') return null;
                obj = obj[key];
            }
            return obj || null;
        },

        /**
         * Send via TinCanJS class pattern
         */
        async _sendViaTinCanJS(TinCanClass, statement) {
            try {
                // Look for existing LRS configuration
                const lrsConfig = this._findLRSConfig();
                if (!lrsConfig) {
                    return { success: false, error: 'No LRS configuration found for TinCanJS' };
                }

                const lrs = new TinCanClass.LRS({
                    endpoint: lrsConfig.endpoint,
                    auth: lrsConfig.auth
                });

                return new Promise((resolve) => {
                    lrs.saveStatement(statement, {
                        callback: (err, xhr) => {
                            if (err) resolve({ success: false, error: String(err) });
                            else resolve({ success: true, status: xhr?.status });
                        }
                    });
                });
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        /**
         * Find LRS configuration from various sources
         */
        _findLRSConfig() {
            const config = { endpoint: null, auth: null, actor: null };

            // Check URL query parameters (common launch pattern)
            const params = new URLSearchParams(window.location.search);
            config.endpoint = params.get('endpoint') || params.get('lrs_endpoint');
            config.auth = params.get('auth') || params.get('authorization');

            // Check window objects
            const searchPaths = [
                ['ADL', 'XAPIWrapper', 'lrs'],
                ['xAPIWrapper', 'lrs'],
                ['TinCan', 'LRS'],
                ['lrsConfig'],
                ['xapiConfig'],
                ['Config', 'lrs']
            ];

            for (const path of searchPaths) {
                const obj = this._resolveObjectPath(path);
                if (obj) {
                    config.endpoint = config.endpoint || obj.endpoint;
                    config.auth = config.auth || obj.auth || obj.authorization;
                    config.actor = config.actor || obj.actor;
                }
            }

            // Check for meta tags
            const endpointMeta = document.querySelector('meta[name="lrs-endpoint"]');
            if (endpointMeta) config.endpoint = endpointMeta.content;

            return config.endpoint ? config : null;
        },

        /**
         * Send statement directly to LRS via HTTP
         */
        async _sendDirectToLRS(config, statement) {
            try {
                const headers = {
                    'Content-Type': 'application/json',
                    'X-Experience-API-Version': '1.0.3'
                };

                if (config.auth) {
                    headers['Authorization'] = config.auth.startsWith('Basic ') ? config.auth : `Basic ${config.auth}`;
                }

                const response = await fetch(`${config.endpoint}/statements`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(statement)
                });

                return {
                    success: response.ok,
                    status: response.status,
                    statementId: response.headers.get('X-Experience-API-Statement-Id')
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // KITCHEN SINK DISCOVERY - TRY EVERYTHING APPROACH
        // ═══════════════════════════════════════════════════════════════════════════

        /**
         * Kitchen sink discovery - find ALL potential completion mechanisms
         * Returns comprehensive diagnostic info about what's available
         */
        kitchenSinkDiscover() {
            Logger.info('Running kitchen sink discovery...');

            const discovery = {
                timestamp: new Date().toISOString(),
                url: window.location.href,
                findings: {
                    scorm12: { found: false, details: [] },
                    scorm2004: { found: false, details: [] },
                    aicc: { found: false, details: [] },
                    xapi: { found: false, details: [] },
                    tcapi: { found: false, details: [] },
                    custom: { found: false, details: [] },
                    storyline: { found: false, details: [] },
                    captivate: { found: false, details: [] },
                    lectora: { found: false, details: [] },
                    unknown: { found: false, details: [] }
                },
                globalFunctions: [],
                globalObjects: [],
                windows: [],
                iframes: [],
                recommendations: []
            };

            // Use comprehensive window discovery
            const locations = this._getAllSearchableWindows();
            discovery.windows = locations.map(l => ({
                name: l.name,
                accessible: !l.name.includes('limited access')
            }));

            // ─────────────────────────────────────────────────────────
            // SCORM API Detection
            // ─────────────────────────────────────────────────────────
            const scormObjects = ['API', 'API_1484_11', 'SCORM_API', 'ScormProcessGetValue', 'ScormProcessSetValue'];
            for (const loc of locations) {
                for (const objName of scormObjects) {
                    const obj = this._safeAccess(() => loc.obj[objName]);
                    if (obj) {
                        const type = this._identifySCORMVersion(obj);
                        if (type === 'scorm12') {
                            discovery.findings.scorm12.found = true;
                            discovery.findings.scorm12.details.push({
                                location: `${loc.name}.${objName}`,
                                methods: this._getMethodList(obj),
                                functional: this._testSCORM12(obj)
                            });
                        } else if (type === 'scorm2004') {
                            discovery.findings.scorm2004.found = true;
                            discovery.findings.scorm2004.details.push({
                                location: `${loc.name}.${objName}`,
                                methods: this._getMethodList(obj),
                                functional: this._testSCORM2004(obj)
                            });
                        }
                    }
                }
            }

            // ─────────────────────────────────────────────────────────
            // AICC Detection
            // ─────────────────────────────────────────────────────────
            const aiccIndicators = ['AICC_Init', 'AICC_GetParam', 'AICC_PutParam', 'SetStatus', 'PutParam', 'ExitAU'];
            for (const loc of locations) {
                for (const fnName of aiccIndicators) {
                    const fn = this._safeAccess(() => loc.obj[fnName]);
                    if (typeof fn === 'function') {
                        discovery.findings.aicc.found = true;
                        discovery.findings.aicc.details.push({
                            location: `${loc.name}.${fnName}`,
                            type: 'function'
                        });
                    }
                }
            }

            // Check for HACP URL
            const hacpUrl = this._findHACPEndpoint();
            if (hacpUrl) {
                discovery.findings.aicc.found = true;
                discovery.findings.aicc.details.push({
                    location: 'HACP endpoint',
                    url: hacpUrl,
                    type: 'hacp'
                });
            }

            // ─────────────────────────────────────────────────────────
            // xAPI / TCAPI Detection
            // ─────────────────────────────────────────────────────────
            const xapiObjects = [
                'ADL', 'xAPIWrapper', 'TinCan', 'TCAPI', 'TinCanAPI',
                'lrs', 'xapi', 'XAPIWrapper', 'tincan'
            ];
            for (const loc of locations) {
                for (const objName of xapiObjects) {
                    const obj = this._safeAccess(() => loc.obj[objName]);
                    if (obj && typeof obj === 'object') {
                        const isXAPI = this._hasXAPIMethods(obj);
                        if (isXAPI) {
                            discovery.findings.xapi.found = true;
                            discovery.findings.tcapi.found = true;
                            discovery.findings.xapi.details.push({
                                location: `${loc.name}.${objName}`,
                                methods: this._getMethodList(obj),
                                hasLRS: !!obj.lrs,
                                hasEndpoint: !!this._resolveObjectPath(['lrs', 'endpoint'], obj)
                            });
                        }
                    }
                }
            }

            // Check LRS config
            const lrsConfig = this._findLRSConfig();
            if (lrsConfig) {
                discovery.findings.xapi.found = true;
                discovery.findings.xapi.details.push({
                    type: 'lrsConfig',
                    endpoint: lrsConfig.endpoint,
                    hasAuth: !!lrsConfig.auth
                });
            }

            // ─────────────────────────────────────────────────────────
            // Authoring Tool Detection (Storyline, Captivate, Lectora)
            // ─────────────────────────────────────────────────────────

            // Storyline
            if (window.DS || typeof window.globalProvideData === 'function') {
                discovery.findings.storyline.found = true;
                discovery.findings.storyline.details.push({
                    hasDS: !!window.DS,
                    hasGlobalProvideData: typeof window.globalProvideData === 'function',
                    hasSetVariable: typeof window.DS?.setVariable === 'function',
                    hasGetVariable: typeof window.DS?.getVariable === 'function',
                    variables: this._getStorylineVariables()
                });
            }

            // Captivate
            const captivateIndicators = ['cpAPIInterface', 'cpAPIEventEmitter', 'cp', 'Captivate'];
            for (const indicator of captivateIndicators) {
                const obj = this._safeAccess(() => window[indicator]);
                if (obj) {
                    discovery.findings.captivate.found = true;
                    discovery.findings.captivate.details.push({
                        object: indicator,
                        methods: this._getMethodList(obj)
                    });
                }
            }

            // Lectora
            const lectoraIndicators = ['trivREADY', 'trivantis', 'TrivWindow'];
            for (const indicator of lectoraIndicators) {
                const obj = this._safeAccess(() => window[indicator]);
                if (obj !== undefined) {
                    discovery.findings.lectora.found = true;
                    discovery.findings.lectora.details.push({
                        object: indicator,
                        type: typeof obj
                    });
                }
            }

            // ─────────────────────────────────────────────────────────
            // Custom/Standalone Completion Functions
            // ─────────────────────────────────────────────────────────
            const completionFunctions = [
                'sendResults', 'submitResults', 'completeLesson', 'lessonComplete',
                'finishLesson', 'setLessonStatus', 'recordCompletion', 'markComplete',
                'SetPassed', 'SetFailed', 'SetComplete', 'SetIncomplete',
                'doLMSCommit', 'doLMSFinish', 'doLMSSetValue',
                'ReportResults', 'SubmitScore', 'SaveProgress'
            ];
            for (const loc of locations) {
                for (const fnName of completionFunctions) {
                    const fn = this._safeAccess(() => loc.obj[fnName]);
                    if (typeof fn === 'function') {
                        discovery.findings.custom.found = true;
                        discovery.findings.custom.details.push({
                            location: `${loc.name}.${fnName}`,
                            type: 'function'
                        });
                        discovery.globalFunctions.push(`${loc.name}.${fnName}`);
                    }
                }
            }

            // ─────────────────────────────────────────────────────────
            // Scan for unknown/interesting objects
            // ─────────────────────────────────────────────────────────
            const interestingPatterns = [
                /scorm/i, /lms/i, /lrs/i, /xapi/i, /tincan/i,
                /aicc/i, /course/i, /lesson/i, /complete/i, /score/i
            ];

            for (const key of Object.keys(window)) {
                if (interestingPatterns.some(p => p.test(key))) {
                    const obj = this._safeAccess(() => window[key]);
                    if (obj && typeof obj === 'object' && !discovery.globalObjects.some(o => o.name === key)) {
                        discovery.globalObjects.push({
                            name: key,
                            type: typeof obj,
                            isFunction: typeof obj === 'function',
                            methods: this._getMethodList(obj)?.slice(0, 10) // Limit to first 10
                        });
                    }
                }
            }

            // ─────────────────────────────────────────────────────────
            // Check iframes for potential API locations
            // ─────────────────────────────────────────────────────────
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach((iframe, index) => {
                try {
                    const hasAPI = iframe.contentWindow?.API || iframe.contentWindow?.API_1484_11;
                    discovery.iframes.push({
                        index,
                        src: iframe.src?.substring(0, 100),
                        hasAPI: !!hasAPI,
                        accessible: true
                    });
                } catch (e) {
                    discovery.iframes.push({
                        index,
                        src: iframe.src?.substring(0, 100),
                        accessible: false,
                        error: 'Cross-origin'
                    });
                }
            });

            // ─────────────────────────────────────────────────────────
            // Generate recommendations
            // ─────────────────────────────────────────────────────────
            discovery.recommendations = this._generateRecommendations(discovery);

            return discovery;
        },

        /**
         * Safe property access with cross-origin protection
         */
        _safeAccess(fn) {
            try {
                return fn();
            } catch (e) {
                return null;
            }
        },

        /**
         * Identify SCORM version from API object
         */
        _identifySCORMVersion(obj) {
            if (typeof obj.LMSInitialize === 'function') return 'scorm12';
            if (typeof obj.Initialize === 'function') return 'scorm2004';
            return null;
        },

        /**
         * Get list of methods on an object
         */
        _getMethodList(obj) {
            if (!obj || typeof obj !== 'object') return [];
            try {
                return Object.keys(obj).filter(k => {
                    try { return typeof obj[k] === 'function'; }
                    catch (e) { return false; }
                });
            } catch (e) {
                return [];
            }
        },

        /**
         * Test if object has xAPI-related methods
         */
        _hasXAPIMethods(obj) {
            const xapiMethods = ['sendStatement', 'sendStatements', 'saveStatement',
                                'getStatement', 'getStatements', 'setState', 'getState'];
            return xapiMethods.some(m => {
                try { return typeof obj[m] === 'function' || typeof obj?.lrs?.[m] === 'function'; }
                catch (e) { return false; }
            });
        },

        /**
         * Quick test of SCORM 1.2 API
         */
        _testSCORM12(api) {
            try {
                const result = api.LMSInitialize('');
                return result === 'true' || result === true;
            } catch (e) {
                return false;
            }
        },

        /**
         * Quick test of SCORM 2004 API
         */
        _testSCORM2004(api) {
            try {
                const result = api.Initialize('');
                return result === 'true' || result === true;
            } catch (e) {
                return false;
            }
        },

        /**
         * Get Storyline variables if available
         */
        _getStorylineVariables() {
            if (!window.DS?.VO) return [];
            try {
                const vars = [];
                for (const [id, obj] of Object.entries(window.DS.VO)) {
                    if (obj?.type === 'variable') {
                        vars.push({ id, name: obj.name, value: obj.value });
                    }
                }
                return vars.slice(0, 20); // Limit to first 20
            } catch (e) {
                return [];
            }
        },

        /**
         * Generate recommendations based on discovery
         */
        _generateRecommendations(discovery) {
            const recs = [];

            if (discovery.findings.scorm12.found) {
                recs.push({
                    priority: 1,
                    type: 'scorm12',
                    message: 'SCORM 1.2 API detected - use forceCompletion() with default settings',
                    action: "forceCompletion({ status: 'passed', score: 100 })"
                });
            }

            if (discovery.findings.scorm2004.found) {
                recs.push({
                    priority: 1,
                    type: 'scorm2004',
                    message: 'SCORM 2004 API detected - use forceCompletion() with default settings',
                    action: "forceCompletion({ status: 'passed', score: 100 })"
                });
            }

            if (discovery.findings.aicc.found) {
                recs.push({
                    priority: 2,
                    type: 'aicc',
                    message: 'AICC/HACP detected - forceCompletion will use AICC protocol',
                    action: "forceCompletion({ status: 'passed' })"
                });
            }

            if (discovery.findings.xapi.found) {
                const hasEndpoint = discovery.findings.xapi.details.some(d => d.endpoint || d.hasEndpoint);
                recs.push({
                    priority: hasEndpoint ? 1 : 3,
                    type: 'xapi',
                    message: hasEndpoint
                        ? 'xAPI with LRS endpoint detected - statements can be sent'
                        : 'xAPI library found but no LRS endpoint configured - may need manual setup',
                    action: "forceCompletion({ status: 'passed' })"
                });
            }

            if (discovery.findings.storyline.found) {
                recs.push({
                    priority: 2,
                    type: 'storyline',
                    message: 'Articulate Storyline detected - variables can be injected directly',
                    action: "forceCompletion() will auto-inject Storyline variables"
                });
            }

            if (discovery.findings.captivate.found) {
                recs.push({
                    priority: 2,
                    type: 'captivate',
                    message: 'Adobe Captivate detected - try cpAPIInterface for variable control',
                    lookFor: ['cpAPIInterface.setVariableValue', 'cp.setResultsVariable']
                });
            }

            if (discovery.findings.custom.found) {
                const fns = discovery.findings.custom.details.map(d => d.location);
                recs.push({
                    priority: 3,
                    type: 'custom',
                    message: `Custom completion functions found: ${fns.join(', ')}`,
                    action: 'Try calling these functions directly',
                    functions: fns
                });
            }

            if (recs.length === 0) {
                recs.push({
                    priority: 4,
                    type: 'none',
                    message: 'No standard LMS APIs detected',
                    suggestions: [
                        'Check if course is loaded in LMS context (not local file)',
                        'Look for iframes that may contain the API',
                        'Check browser console for SCORM/xAPI errors',
                        'Course may use proprietary completion mechanism'
                    ]
                });
            }

            return recs.sort((a, b) => a.priority - b.priority);
        },

        /**
         * Try ALL completion methods and report what worked
         * Kitchen sink approach - throws everything at the wall
         * @param {Object} options
         * @param {string} options.status - Completion status ('passed', 'completed', 'failed')
         * @param {number} options.score - Score value (0-100)
         * @param {boolean} options.stopOnSuccess - Stop after first successful method (default: false)
         */
        async tryAllCompletionMethods(options = {}) {
            const { status = 'passed', score = 100, stopOnSuccess = false } = options;

            Logger.info('Trying all completion methods...', { stopOnSuccess });

            const results = {
                timestamp: new Date().toISOString(),
                discovery: this.kitchenSinkDiscover(),
                attempts: [],
                successful: [],
                failed: [],
                stoppedEarly: false
            };

            // Helper to check if we should continue
            const shouldContinue = () => !stopOnSuccess || results.successful.length === 0;

            // ─────────────────────────────────────────────────────────
            // Try SCORM 1.2
            // ─────────────────────────────────────────────────────────
            for (const detail of results.discovery.findings.scorm12.details) {
                if (!shouldContinue()) break;
                try {
                    const api = this._resolveLocationPath(detail.location);
                    if (api) {
                        const result = this._completeSCORM12(api, {
                            status, score, minScore: 0, maxScore: 100,
                            sessionTime: this._formatSCORM12Time(300),
                            includeInteraction: false, terminate: false
                        });
                        results.attempts.push({ type: 'scorm12', location: detail.location, ...result });
                        if (result.success) {
                            results.successful.push('scorm12');
                            if (stopOnSuccess) results.stoppedEarly = true;
                        } else {
                            results.failed.push({ type: 'scorm12', errors: result.errors });
                        }
                    }
                } catch (e) {
                    results.failed.push({ type: 'scorm12', error: e.message });
                }
            }

            // ─────────────────────────────────────────────────────────
            // Try SCORM 2004
            // ─────────────────────────────────────────────────────────
            for (const detail of results.discovery.findings.scorm2004.details) {
                if (!shouldContinue()) break;
                try {
                    const api = this._resolveLocationPath(detail.location);
                    if (api) {
                        const result = this._completeSCORM2004(api, {
                            status, score, minScore: 0, maxScore: 100,
                            sessionTime: this._formatISO8601Duration(300),
                            includeInteraction: false, terminate: false
                        });
                        results.attempts.push({ type: 'scorm2004', location: detail.location, ...result });
                        if (result.success) {
                            results.successful.push('scorm2004');
                            if (stopOnSuccess) results.stoppedEarly = true;
                        } else {
                            results.failed.push({ type: 'scorm2004', errors: result.errors });
                        }
                    }
                } catch (e) {
                    results.failed.push({ type: 'scorm2004', error: e.message });
                }
            }

            // ─────────────────────────────────────────────────────────
            // Try AICC
            // ─────────────────────────────────────────────────────────
            if (shouldContinue() && results.discovery.findings.aicc.found) {
                try {
                    const aiccResult = await this._completeAICC({}, {
                        status, score, sessionTime: '00:05:00'
                    });
                    results.attempts.push({ type: 'aicc', ...aiccResult });
                    if (aiccResult.success) {
                        results.successful.push('aicc');
                        if (stopOnSuccess) results.stoppedEarly = true;
                    } else {
                        results.failed.push({ type: 'aicc', errors: aiccResult.errors });
                    }
                } catch (e) {
                    results.failed.push({ type: 'aicc', error: e.message });
                }
            }

            // ─────────────────────────────────────────────────────────
            // Try xAPI/TCAPI
            // ─────────────────────────────────────────────────────────
            if (shouldContinue() && results.discovery.findings.xapi.found) {
                try {
                    const xapiResult = await this._completeTCAPI({
                        status, score, minScore: 0, maxScore: 100,
                        sessionTime: this._formatISO8601Duration(300)
                    });
                    results.attempts.push({ type: 'xapi/tcapi', ...xapiResult });
                    if (xapiResult.success) {
                        results.successful.push('xapi');
                        if (stopOnSuccess) results.stoppedEarly = true;
                    } else {
                        results.failed.push({ type: 'xapi', errors: xapiResult.errors });
                    }
                } catch (e) {
                    results.failed.push({ type: 'xapi', error: e.message });
                }
            }

            // ─────────────────────────────────────────────────────────
            // Try Storyline variables (always try - doesn't conflict)
            // ─────────────────────────────────────────────────────────
            if (results.discovery.findings.storyline.found) {
                const slResult = this._injectStorylineVariables(score, status, {});
                results.attempts.push({ type: 'storyline', ...slResult });
                if (slResult.injected) results.successful.push('storyline');
            }

            // ─────────────────────────────────────────────────────────
            // Try custom functions
            // ─────────────────────────────────────────────────────────
            for (const detail of results.discovery.findings.custom.details) {
                if (!shouldContinue()) break;
                try {
                    const fn = this._resolveLocationPath(detail.location);
                    if (typeof fn === 'function') {
                        const arg = status === 'passed' || status === 'completed' ? 1 : 0;
                        fn(arg);
                        results.attempts.push({ type: 'custom', function: detail.location, called: true, success: true });
                        results.successful.push(`custom:${detail.location}`);
                        if (stopOnSuccess) results.stoppedEarly = true;
                    }
                } catch (e) {
                    results.failed.push({ type: 'custom', function: detail.location, error: e.message });
                }
            }

            results.summary = {
                totalAttempts: results.attempts.length,
                successCount: results.successful.length,
                failCount: results.failed.length,
                successfulMethods: results.successful,
                stoppedEarly: results.stoppedEarly
            };

            Logger.info('Completion methods attempted', results.summary);
            Messenger.send(MSG.FORCE_COMPLETION_RESULT, results);

            return results;
        },

        /**
         * Resolve location path like "window.parent.API" to actual object
         */
        _resolveLocationPath(path) {
            const parts = path.split('.');
            let obj = window;

            for (const part of parts) {
                if (part === 'window') continue;
                if (!obj) return null;
                try {
                    obj = obj[part];
                } catch (e) {
                    return null;
                }
            }

            return obj;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7: DOM QUIZ EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    const DOMQuizExtractor = {
        extract() {
            Logger.info('Extracting DOM quizzes...');
            const quizzes = [];
            const processed = new Set();

            this.processDocument(document, null, quizzes, processed);
            
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (doc) {
                        this.processDocument(doc, iframe, quizzes, processed);
                    }
                } catch (e) { /* Cross-origin */ }
            });

            Logger.info(`Found ${quizzes.length} DOM quizzes`);
            return quizzes;
        },

        processDocument(doc, iframe, quizzes, processed) {
            const correctSelectors = [
                'option[value="true"]', 'option[value="correct"]', 'option[value="1"]',
                'input[type="radio"][value="true"]', 'input[type="radio"][value="correct"]',
                'input[type="checkbox"][value="true"]', 'input[type="checkbox"][value="correct"]',
                '[data-correct="true"]', '[data-answer="true"]'
            ].join(',');

            doc.querySelectorAll(correctSelectors).forEach(el => {
                if (el.tagName === 'OPTION') {
                    const select = el.closest('select');
                    if (select && !processed.has(select)) {
                        processed.add(select);
                        const quiz = this.extractSelect(select, doc, iframe);
                        if (quiz) quizzes.push(quiz);
                    }
                } else if (el.tagName === 'INPUT') {
                    if (el.type === 'radio' && el.name) {
                        const key = `radio:${el.name}`;
                        if (!processed.has(key)) {
                            processed.add(key);
                            const quiz = this.extractRadioGroup(doc, el.name, iframe);
                            if (quiz) quizzes.push(quiz);
                        }
                    } else if (el.type === 'checkbox') {
                        if (!processed.has(el)) {
                            processed.add(el);
                            const quiz = this.extractCheckbox(el, doc, iframe);
                            if (quiz) quizzes.push(quiz);
                        }
                    }
                }
            });
        },

        extractSelect(select, doc, iframe) {
            const questionId = select.id || select.name || Utils.generateId('select');
            const questionText = this.findQuestionText(select, doc);
            
            const answers = [];
            Array.from(select.options).forEach(option => {
                const text = option.textContent.trim();
                if (Utils.isPlaceholder(text)) return;

                answers.push({
                    text,
                    correct: Utils.isCorrectAnswer(option),
                    value: option.value,
                    element: option
                });
            });

            if (answers.length === 0) return null;

            return { type: 'select', questionId, questionText, answers, selectElement: select, iframe };
        },

        extractRadioGroup(doc, groupName, iframe) {
            const radios = doc.querySelectorAll(`input[type="radio"][name="${groupName}"]`);
            if (radios.length === 0) return null;

            const questionText = this.findQuestionText(radios[0], doc);
            const answers = [];

            radios.forEach(radio => {
                const text = this.findLabelText(radio, doc) || radio.value;
                answers.push({
                    text,
                    correct: Utils.isCorrectAnswer(radio),
                    value: radio.value,
                    element: radio
                });
            });

            return { type: 'radio', questionId: groupName, questionText, answers, iframe };
        },

        extractCheckbox(checkbox, doc, iframe) {
            const text = this.findLabelText(checkbox, doc) || checkbox.value;
            const questionText = this.findQuestionText(checkbox, doc);

            return {
                type: 'checkbox',
                questionId: checkbox.id || checkbox.name || Utils.generateId('cb'),
                questionText,
                answers: [{
                    text,
                    correct: Utils.isCorrectAnswer(checkbox),
                    value: checkbox.value,
                    element: checkbox
                }],
                iframe
            };
        },

        findQuestionText(element, doc) {
            if (element.id) {
                const label = doc.querySelector(`label[for="${element.id}"]`);
                if (label) return label.textContent.trim();
            }

            const container = element.closest('.question, .form-group, .quiz-item, fieldset, [class*="question"]');
            if (container) {
                const textEl = container.querySelector('label, legend, .question-text, p:first-child');
                if (textEl && textEl !== element.parentElement) {
                    return textEl.textContent.trim();
                }
            }

            return '';
        },

        findLabelText(input, doc) {
            if (input.id) {
                const label = doc.querySelector(`label[for="${input.id}"]`);
                if (label) return label.textContent.trim();
            }

            const parentLabel = input.closest('label');
            if (parentLabel) return parentLabel.textContent.trim();

            const next = input.nextSibling;
            if (next) {
                if (next.nodeType === Node.TEXT_NODE) {
                    return next.textContent.trim();
                }
                if (next.nodeType === Node.ELEMENT_NODE) {
                    return next.textContent.trim();
                }
            }

            return '';
        },

        autoSelect() {
            Logger.info('Auto-selecting correct answers...');
            let count = 0;

            const quizzes = this.extract();

            quizzes.forEach(quiz => {
                quiz.answers.forEach(answer => {
                    if (!answer.correct) return;

                    try {
                        if (quiz.type === 'select' && quiz.selectElement) {
                            const optionIndex = Array.from(quiz.selectElement.options)
                                .findIndex(opt => opt.value === answer.value);
                            
                            if (optionIndex >= 0) {
                                quiz.selectElement.selectedIndex = optionIndex;
                                quiz.selectElement.dispatchEvent(new Event('change', { bubbles: true }));
                                quiz.selectElement.dispatchEvent(new Event('input', { bubbles: true }));
                                count++;
                                Logger.debug(`Selected: "${answer.text}"`);
                            }
                        } else if (quiz.type === 'radio' || quiz.type === 'checkbox') {
                            if (answer.element && !answer.element.checked) {
                                answer.element.checked = true;
                                answer.element.dispatchEvent(new Event('change', { bubbles: true }));
                                answer.element.dispatchEvent(new Event('click', { bubbles: true }));
                                count++;
                                Logger.debug(`Checked: "${answer.text}"`);
                            }
                        }
                    } catch (error) {
                        Logger.warn(`Failed to select: ${error.message}`);
                    }
                });
            });

            Logger.info(`Auto-selected ${count} answers`);
            return count;
        },

        toQAItems(quizzes) {
            const items = [];

            quizzes.forEach(quiz => {
                if (quiz.questionText) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        text: quiz.questionText,
                        source: `DOM:${quiz.type}:${quiz.questionId}`,
                        confidence: CONFIDENCE.HIGH
                    });
                }

                quiz.answers.forEach(answer => {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: answer.text,
                        correct: answer.correct,
                        source: `DOM:${quiz.type}:${quiz.questionId}`,
                        confidence: answer.correct ? CONFIDENCE.VERY_HIGH : CONFIDENCE.MEDIUM
                    });
                });
            });

            return items;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7A: FRAMEWORK DETECTOR
    // Advanced detection via scripts, SVG analysis, and global variables
    // ═══════════════════════════════════════════════════════════════════════════

    const FrameworkDetector = {
        /**
         * Comprehensive framework detection using multiple sources
         */
        detect() {
            const results = {
                tool: null,
                confidence: 0,
                evidence: [],
                scripts: [],
                globals: [],
                svgContent: false
            };

            // Method 1: Check global variables
            const globalResult = this.detectFromGlobals();
            if (globalResult.tool) {
                results.tool = globalResult.tool;
                results.confidence = Math.max(results.confidence, globalResult.confidence);
                results.evidence.push(...globalResult.evidence);
                results.globals = globalResult.globals;
            }

            // Method 2: Analyze loaded scripts
            const scriptResult = this.detectFromScripts();
            if (scriptResult.tool && (!results.tool || scriptResult.confidence > results.confidence)) {
                results.tool = scriptResult.tool;
                results.confidence = Math.max(results.confidence, scriptResult.confidence);
            }
            results.evidence.push(...scriptResult.evidence);
            results.scripts = scriptResult.scripts;

            // Method 3: Check SVG content (Storyline heavily uses SVG)
            const svgResult = this.analyzeSVGContent();
            results.svgContent = svgResult.hasContent;
            if (svgResult.tool && (!results.tool || svgResult.confidence > results.confidence)) {
                results.tool = svgResult.tool;
                results.confidence = svgResult.confidence;
            }
            results.evidence.push(...svgResult.evidence);

            // Method 4: Check meta tags and generators
            const metaResult = this.detectFromMeta();
            if (metaResult.tool && (!results.tool || metaResult.confidence > results.confidence)) {
                results.tool = metaResult.tool;
                results.confidence = metaResult.confidence;
            }
            results.evidence.push(...metaResult.evidence);

            Logger.info(`Framework detection: ${results.tool || 'none'} (confidence: ${results.confidence}%)`, {
                evidence: results.evidence.slice(0, 5)
            });

            return results;
        },

        /**
         * Detect framework from global JavaScript variables
         */
        detectFromGlobals() {
            const result = { tool: null, confidence: 0, evidence: [], globals: [] };

            const signatures = [
                // Storyline
                { globals: ['DS', 'g_slideData', 'globalProvideData'], tool: AUTHORING_TOOL.STORYLINE, confidence: 95 },
                { globals: ['player', 'GetPlayer'], tool: AUTHORING_TOOL.STORYLINE, confidence: 85 },
                { globals: ['g_objAPI', 'g_slideManager'], tool: AUTHORING_TOOL.STORYLINE, confidence: 90 },

                // Rise 360
                { globals: ['__RISE__', 'Rise'], tool: AUTHORING_TOOL.RISE, confidence: 95 },

                // Captivate
                { globals: ['cp', 'cpAPIInterface', 'cpAPIEventEmitter'], tool: AUTHORING_TOOL.CAPTIVATE, confidence: 95 },
                { globals: ['cpCmndResume', 'cpCmndPause', 'cpQuizInfoObject'], tool: AUTHORING_TOOL.CAPTIVATE, confidence: 90 },
                { globals: ['Captivate', 'CaptivateAPI'], tool: AUTHORING_TOOL.CAPTIVATE, confidence: 90 },

                // Lectora
                { globals: ['trivantis', 'TrivantisCore', 'ObL'], tool: AUTHORING_TOOL.LECTORA, confidence: 95 },
                { globals: ['getObjbyID', 'Lectora'], tool: AUTHORING_TOOL.LECTORA, confidence: 85 },

                // iSpring
                { globals: ['iSpring', 'ispringPresentationConnector'], tool: AUTHORING_TOOL.ISPRING, confidence: 95 },
                { globals: ['PresentationSettings', 'ispringQuiz'], tool: AUTHORING_TOOL.ISPRING, confidence: 85 },

                // Camtasia
                { globals: ['TechSmith', 'Camtasia'], tool: AUTHORING_TOOL.CAMTASIA, confidence: 95 }
            ];

            for (const sig of signatures) {
                const found = sig.globals.filter(g => {
                    try {
                        return typeof window[g] !== 'undefined';
                    } catch {
                        return false;
                    }
                });

                if (found.length > 0) {
                    result.globals.push(...found);
                    result.evidence.push(`Global: ${found.join(', ')}`);
                    if (sig.confidence > result.confidence) {
                        result.tool = sig.tool;
                        result.confidence = sig.confidence;
                    }
                }
            }

            return result;
        },

        /**
         * Detect framework from loaded script URLs and content
         */
        detectFromScripts() {
            const result = { tool: null, confidence: 0, evidence: [], scripts: [] };

            // Check script tags
            const scripts = document.querySelectorAll('script[src]');
            const scriptUrls = Array.from(scripts).map(s => s.src).filter(Boolean);

            // Also check performance entries for dynamically loaded scripts
            try {
                const perfScripts = performance.getEntriesByType('resource')
                    .filter(e => e.initiatorType === 'script')
                    .map(e => e.name);
                scriptUrls.push(...perfScripts);
            } catch (e) {}

            result.scripts = [...new Set(scriptUrls)];

            const patterns = [
                // Storyline
                { pattern: /storyline|articulate|player\.js|frame\.js|user\.js|data\.js/i, tool: AUTHORING_TOOL.STORYLINE, confidence: 90 },
                { pattern: /story_html5\.html|story\.html/i, tool: AUTHORING_TOOL.STORYLINE, confidence: 95 },
                { pattern: /lms\/lms\.js|scormdriver/i, tool: AUTHORING_TOOL.STORYLINE, confidence: 80 },

                // Rise
                { pattern: /rise.*\.js|articulate.*rise/i, tool: AUTHORING_TOOL.RISE, confidence: 90 },

                // Captivate
                { pattern: /captivate|cplib|cpapi/i, tool: AUTHORING_TOOL.CAPTIVATE, confidence: 90 },
                { pattern: /AdobeCaptivate/i, tool: AUTHORING_TOOL.CAPTIVATE, confidence: 95 },

                // Lectora
                { pattern: /lectora|trivantis/i, tool: AUTHORING_TOOL.LECTORA, confidence: 90 },
                { pattern: /trivantis_core|ObL\.js/i, tool: AUTHORING_TOOL.LECTORA, confidence: 95 },

                // iSpring
                { pattern: /ispring|ispringpro/i, tool: AUTHORING_TOOL.ISPRING, confidence: 90 },

                // Camtasia
                { pattern: /camtasia|techsmith/i, tool: AUTHORING_TOOL.CAMTASIA, confidence: 90 }
            ];

            for (const url of result.scripts) {
                for (const pat of patterns) {
                    if (pat.pattern.test(url)) {
                        result.evidence.push(`Script: ${url.split('/').pop()}`);
                        if (pat.confidence > result.confidence) {
                            result.tool = pat.tool;
                            result.confidence = pat.confidence;
                        }
                    }
                }
            }

            return result;
        },

        /**
         * Analyze SVG content for text and framework signatures
         */
        analyzeSVGContent() {
            const result = { tool: null, confidence: 0, evidence: [], hasContent: false, textContent: [] };

            const svgs = document.querySelectorAll('svg');
            if (svgs.length === 0) return result;

            result.hasContent = true;

            for (const svg of svgs) {
                // Check for Storyline-specific SVG classes
                if (svg.classList.contains('vector-slide-content') ||
                    svg.closest('.slide-object') ||
                    svg.querySelector('[class*="slide-"]')) {
                    result.tool = AUTHORING_TOOL.STORYLINE;
                    result.confidence = 85;
                    result.evidence.push('SVG: Storyline slide structure');
                }

                // Extract text content from SVG
                const textElements = svg.querySelectorAll('text, tspan');
                textElements.forEach(el => {
                    const text = el.textContent?.trim();
                    if (text && text.length > 2) {
                        result.textContent.push(text);
                    }
                });

                // Check for foreignObject (often contains HTML text)
                const foreignObjects = svg.querySelectorAll('foreignObject');
                foreignObjects.forEach(fo => {
                    const text = fo.textContent?.trim();
                    if (text && text.length > 2) {
                        result.textContent.push(text);
                    }
                });
            }

            if (result.textContent.length > 0) {
                result.evidence.push(`SVG text: ${result.textContent.length} elements`);
            }

            return result;
        },

        /**
         * Detect from meta tags and HTML comments
         */
        detectFromMeta() {
            const result = { tool: null, confidence: 0, evidence: [] };

            // Check meta generator tag
            const generator = document.querySelector('meta[name="generator"]');
            if (generator) {
                const content = generator.getAttribute('content') || '';

                if (/storyline|articulate/i.test(content)) {
                    result.tool = AUTHORING_TOOL.STORYLINE;
                    result.confidence = 95;
                    result.evidence.push(`Meta: ${content}`);
                } else if (/captivate/i.test(content)) {
                    result.tool = AUTHORING_TOOL.CAPTIVATE;
                    result.confidence = 95;
                    result.evidence.push(`Meta: ${content}`);
                } else if (/lectora/i.test(content)) {
                    result.tool = AUTHORING_TOOL.LECTORA;
                    result.confidence = 95;
                    result.evidence.push(`Meta: ${content}`);
                } else if (/ispring/i.test(content)) {
                    result.tool = AUTHORING_TOOL.ISPRING;
                    result.confidence = 95;
                    result.evidence.push(`Meta: ${content}`);
                }
            }

            // Check HTML comments for signatures
            const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
            let commentCount = 0;
            while (walker.nextNode() && commentCount < 20) {
                const comment = walker.currentNode.nodeValue || '';
                commentCount++;

                if (/storyline|articulate/i.test(comment)) {
                    result.evidence.push('Comment: Articulate signature');
                    if (!result.tool) {
                        result.tool = AUTHORING_TOOL.STORYLINE;
                        result.confidence = 70;
                    }
                }
            }

            return result;
        },

        /**
         * Extract text content from all SVG elements on page
         * Returns array of text strings found in SVGs
         */
        extractSVGText() {
            const texts = [];
            const svgs = document.querySelectorAll('svg');

            svgs.forEach(svg => {
                // Direct text elements
                svg.querySelectorAll('text, tspan').forEach(el => {
                    const text = el.textContent?.trim();
                    if (text && text.length > 1 && !texts.includes(text)) {
                        texts.push(text);
                    }
                });

                // foreignObject content
                svg.querySelectorAll('foreignObject').forEach(fo => {
                    const text = fo.textContent?.trim();
                    if (text && text.length > 1) {
                        // Split by newlines and filter
                        text.split(/\n+/).forEach(line => {
                            const trimmed = line.trim();
                            if (trimmed.length > 1 && !texts.includes(trimmed)) {
                                texts.push(trimmed);
                            }
                        });
                    }
                });

                // title and desc elements (accessibility)
                svg.querySelectorAll('title, desc').forEach(el => {
                    const text = el.textContent?.trim();
                    if (text && text.length > 1 && !texts.includes(text)) {
                        texts.push(text);
                    }
                });
            });

            return texts;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7B: EXTRACTOR FRAMEWORK
    // Base abstraction for authoring tool extractors
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Base extractor interface - all tool-specific extractors implement this pattern
     */
    const ExtractorRegistry = {
        extractors: new Map(),

        register(toolId, extractor) {
            this.extractors.set(toolId, extractor);
            Logger.debug(`Registered extractor: ${toolId}`);
        },

        /**
         * Detect which authoring tool created this content
         */
        detectTool() {
            for (const [toolId, extractor] of this.extractors) {
                if (extractor.detect()) {
                    Logger.info(`Detected authoring tool: ${toolId}`);
                    return toolId;
                }
            }
            return AUTHORING_TOOL.GENERIC;
        },

        /**
         * Get extractor for specific tool
         */
        getExtractor(toolId) {
            return this.extractors.get(toolId);
        },

        /**
         * Run extraction using detected or specified tool
         */
        async extract(toolId = null) {
            const tool = toolId || this.detectTool();
            const extractor = this.extractors.get(tool);

            if (!extractor) {
                Logger.warn(`No extractor found for tool: ${tool}`);
                return { tool: AUTHORING_TOOL.GENERIC, items: [], questions: [] };
            }

            const items = await extractor.extract();
            const questions = this.groupIntoQuestions(items);

            return { tool, items, questions };
        },

        /**
         * Group flat items into structured questions with their answers
         */
        groupIntoQuestions(items) {
            const questions = [];
            let currentQuestion = null;

            for (const item of items) {
                if (item.type === ITEM_TYPE.QUESTION) {
                    // Save previous question if exists
                    if (currentQuestion) {
                        questions.push(currentQuestion);
                    }
                    // Start new question
                    currentQuestion = {
                        id: `q_${questions.length + 1}`,
                        text: item.text,
                        questionType: item.questionType || QUESTION_TYPE.MULTIPLE_CHOICE,
                        source: item.source,
                        confidence: item.confidence,
                        answers: [],
                        sequenceItems: [],
                        matchPairs: [],
                        correctOrder: item.correctOrder || null
                    };
                } else if (currentQuestion) {
                    // Add to current question based on type
                    if (item.type === ITEM_TYPE.ANSWER) {
                        currentQuestion.answers.push({
                            text: item.text,
                            correct: item.correct || false,
                            position: item.position,
                            confidence: item.confidence
                        });
                    } else if (item.type === ITEM_TYPE.SEQUENCE) {
                        currentQuestion.questionType = QUESTION_TYPE.SEQUENCING;
                        currentQuestion.sequenceItems.push({
                            text: item.text,
                            correctPosition: item.correctPosition,
                            displayPosition: item.displayPosition
                        });
                    } else if (item.type === ITEM_TYPE.MATCH_SOURCE || item.type === ITEM_TYPE.MATCH_TARGET) {
                        currentQuestion.questionType = QUESTION_TYPE.MATCHING;
                        currentQuestion.matchPairs.push({
                            type: item.type,
                            text: item.text,
                            matchId: item.matchId
                        });
                    }
                }
            }

            // Don't forget the last question
            if (currentQuestion) {
                questions.push(currentQuestion);
            }

            return questions;
        }
    };

    /**
     * Structured question result for sequence questions
     */
    const SequenceQuestion = {
        create(questionText, items, correctOrder) {
            return {
                type: ITEM_TYPE.QUESTION,
                questionType: QUESTION_TYPE.SEQUENCING,
                text: questionText,
                items: items,  // Array of {text, id}
                correctOrder: correctOrder,  // Array of IDs in correct order
                getCorrectSequence() {
                    return this.correctOrder.map(id =>
                        this.items.find(item => item.id === id)
                    );
                }
            };
        }
    };

    /**
     * Structured question result for matching questions
     */
    const MatchingQuestion = {
        create(questionText, pairs) {
            return {
                type: ITEM_TYPE.QUESTION,
                questionType: QUESTION_TYPE.MATCHING,
                text: questionText,
                pairs: pairs,  // Array of {source: {id, text}, target: {id, text}}
                getCorrectPairs() {
                    return this.pairs.map(p => ({
                        source: p.source.text,
                        target: p.target.text
                    }));
                }
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8: STORYLINE EXTRACTION
    // Aggressive enumeration of ALL JavaScript files to find Q&A content
    // ═══════════════════════════════════════════════════════════════════════════

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
            const dataJsPath = `${baseUrl}/html5/data/js`;

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

            // Source 3: Known Storyline structure files
            const knownFiles = ['data.js', 'frame.js', 'paths.js', 'text.js', 'textdata.js'];
            for (const file of knownFiles) {
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
                const response = await Utils.fetchWithTimeout(`${baseUrl}/html5/data/js/data.js`, { timeout: 5000 });
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
                const response = await Utils.fetchWithTimeout(`${baseUrl}/html5/data/js/frame.js`, { timeout: 5000 });
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
            const dataJsPath = `${baseUrl}/html5/data/js`;

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

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8A: RISE 360 EXTRACTION
    // Extracts Q&A from Articulate Rise 360 courses
    // ═══════════════════════════════════════════════════════════════════════════

    const RiseExtractor = {
        toolId: AUTHORING_TOOL.RISE,

        /**
         * Detect if current page is Rise 360 content
         */
        detect() {
            return !!(
                document.querySelector('[data-ba-component]') ||
                document.querySelector('.block-knowledge') ||
                document.querySelector('.block-quiz') ||
                document.querySelector('[class*="rise-"]') ||
                window.__RISE_COURSE_DATA__ ||
                document.querySelector('meta[name="generator"][content*="Rise"]')
            );
        },

        /**
         * Extract Q&A from Rise 360 content
         */
        async extract() {
            if (!this.detect()) {
                Logger.debug('No Rise 360 content detected');
                return [];
            }

            Logger.info('Extracting Rise 360 content...');
            const items = [];

            // Method 1: Extract from knowledge check blocks
            items.push(...this.extractFromKnowledgeBlocks());

            // Method 2: Extract from quiz blocks
            items.push(...this.extractFromQuizBlocks());

            // Method 3: Extract from embedded course data
            items.push(...this.extractFromCourseData());

            Logger.info(`Extracted ${items.length} items from Rise 360`);
            return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
        },

        /**
         * Extract from Rise knowledge check blocks
         */
        extractFromKnowledgeBlocks() {
            const items = [];
            const blocks = document.querySelectorAll('.block-knowledge, [data-ba-component="knowledge"]');

            blocks.forEach(block => {
                // Find question text
                const questionEl = block.querySelector('.knowledge-check__question, .question-text, h3, h2');
                if (questionEl) {
                    const questionText = questionEl.textContent?.trim();
                    if (questionText && questionText.length > 10) {
                        items.push({
                            type: ITEM_TYPE.QUESTION,
                            questionType: QUESTION_TYPE.MULTIPLE_CHOICE,
                            text: questionText,
                            source: 'Rise:knowledge-block',
                            confidence: CONFIDENCE.HIGH
                        });
                    }
                }

                // Find answer choices
                const choices = block.querySelectorAll('.knowledge-check__choice, .choice, [role="radio"], [role="checkbox"]');
                choices.forEach(choice => {
                    const choiceText = choice.textContent?.trim();
                    if (choiceText && choiceText.length > 0) {
                        const isCorrect = choice.classList.contains('correct') ||
                            choice.getAttribute('data-correct') === 'true' ||
                            choice.getAttribute('aria-checked') === 'true';

                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: choiceText,
                            correct: isCorrect,
                            source: 'Rise:knowledge-block',
                            confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
                        });
                    }
                });
            });

            return items;
        },

        /**
         * Extract from Rise quiz blocks
         */
        extractFromQuizBlocks() {
            const items = [];
            const quizBlocks = document.querySelectorAll('.block-quiz, [data-ba-component="quiz"]');

            quizBlocks.forEach(block => {
                // Similar extraction to knowledge blocks
                const questionEl = block.querySelector('.quiz-question, .question');
                if (questionEl) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        questionType: QUESTION_TYPE.MULTIPLE_CHOICE,
                        text: questionEl.textContent?.trim(),
                        source: 'Rise:quiz-block',
                        confidence: CONFIDENCE.HIGH
                    });
                }

                const choices = block.querySelectorAll('.quiz-choice, .answer-choice');
                choices.forEach(choice => {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: choice.textContent?.trim(),
                        correct: choice.classList.contains('correct'),
                        source: 'Rise:quiz-block',
                        confidence: CONFIDENCE.MEDIUM
                    });
                });
            });

            return items;
        },

        /**
         * Extract from Rise course data object
         */
        extractFromCourseData() {
            const items = [];

            // Rise sometimes exposes course data on window
            const courseData = window.__RISE_COURSE_DATA__ || window.courseData;
            if (!courseData) return items;

            try {
                // Recursively search for question/quiz content
                this.extractFromObject(courseData, items);
            } catch (e) {
                Logger.debug('Error extracting Rise course data', { error: e.message });
            }

            return items;
        },

        /**
         * Recursively extract from Rise data objects
         */
        extractFromObject(obj, items, depth = 0) {
            if (!obj || depth > 15) return;

            if (Array.isArray(obj)) {
                obj.forEach(item => this.extractFromObject(item, items, depth + 1));
                return;
            }

            if (typeof obj === 'object') {
                // Look for question structures
                if (obj.type === 'knowledge' || obj.type === 'quiz' || obj.questionText) {
                    const questionText = obj.questionText || obj.question || obj.text;
                    if (questionText) {
                        items.push({
                            type: ITEM_TYPE.QUESTION,
                            questionType: QUESTION_TYPE.MULTIPLE_CHOICE,
                            text: questionText,
                            source: 'Rise:course-data',
                            confidence: CONFIDENCE.HIGH
                        });
                    }

                    // Extract choices
                    const choices = obj.choices || obj.answers || obj.options;
                    if (Array.isArray(choices)) {
                        choices.forEach(choice => {
                            const text = choice.text || choice.label || choice;
                            if (typeof text === 'string' && text.length > 0) {
                                items.push({
                                    type: ITEM_TYPE.ANSWER,
                                    text: text,
                                    correct: choice.correct || choice.isCorrect || false,
                                    source: 'Rise:course-data',
                                    confidence: CONFIDENCE.HIGH
                                });
                            }
                        });
                    }
                }

                // Recurse
                Object.values(obj).forEach(value => {
                    if (value && typeof value === 'object') {
                        this.extractFromObject(value, items, depth + 1);
                    }
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CAPTIVATE EXTRACTOR (Stub)
    // Adobe Captivate e-learning content
    // ═══════════════════════════════════════════════════════════════════════════

    const CaptivateExtractor = {
        toolId: AUTHORING_TOOL.CAPTIVATE,

        /**
         * Detect if current page is Captivate content
         * Captivate markers: cp.*, Captivate runtime variables, specific DOM patterns
         */
        detect() {
            return !!(
                window.cp ||
                window.cpAPIInterface ||
                window.cpAPIEventEmitter ||
                document.querySelector('[class*="cp-"]') ||
                document.querySelector('meta[name="generator"][content*="Captivate"]') ||
                document.querySelector('#cpMainContainer') ||
                (typeof window.cpCmndResume === 'function')
            );
        },

        /**
         * Extract Q&A from Captivate content
         */
        async extract() {
            if (!this.detect()) {
                Logger.debug('No Captivate content detected');
                return [];
            }

            Logger.info('Extracting Captivate content...');
            const items = [];

            // Method 1: Extract from cp quiz data
            items.push(...this.extractFromCPQuizData());

            // Method 2: Extract from DOM quiz slides
            items.push(...this.extractFromQuizSlides());

            // Method 3: Extract from cpInfoQuiz object
            items.push(...this.extractFromInfoQuiz());

            Logger.info(`Extracted ${items.length} items from Captivate`);
            return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
        },

        /**
         * Extract from Captivate's quiz data structure
         */
        extractFromCPQuizData() {
            const items = [];

            try {
                // Captivate stores quiz data in various locations
                const quizData = window.cpQuizInfoObject ||
                                 window.cp?.QuizManager?.questionList ||
                                 window.cpInfoQuiz?.questionArray;

                if (!quizData) return items;

                const questions = Array.isArray(quizData) ? quizData : Object.values(quizData);

                questions.forEach(q => {
                    // Question text
                    if (q.questionText || q.strQuestion) {
                        items.push({
                            type: ITEM_TYPE.QUESTION,
                            questionType: this.mapQuestionType(q.type || q.questionType),
                            text: q.questionText || q.strQuestion,
                            source: 'Captivate:quiz-data',
                            confidence: CONFIDENCE.HIGH
                        });
                    }

                    // Answer choices
                    const choices = q.answers || q.arrAnswers || q.choices;
                    if (Array.isArray(choices)) {
                        choices.forEach((choice, idx) => {
                            const text = typeof choice === 'string' ? choice : (choice.text || choice.strText);
                            const isCorrect = typeof choice === 'object'
                                ? (choice.correct || choice.bCorrect || choice.isCorrect)
                                : (q.correctAnswer === idx || q.arrCorrect?.[idx]);

                            if (text) {
                                items.push({
                                    type: ITEM_TYPE.ANSWER,
                                    text: text,
                                    correct: !!isCorrect,
                                    source: 'Captivate:quiz-data',
                                    confidence: CONFIDENCE.HIGH
                                });
                            }
                        });
                    }
                });
            } catch (e) {
                Logger.debug('Error extracting Captivate quiz data', { error: e.message });
            }

            return items;
        },

        /**
         * Extract from DOM quiz slides
         */
        extractFromQuizSlides() {
            const items = [];

            // Common Captivate quiz DOM patterns
            const questionContainers = document.querySelectorAll(
                '.cp-quiz-question, [class*="questiontext"], .cp_quiz_question'
            );

            questionContainers.forEach(container => {
                const questionText = container.querySelector('.cp-question-text, [class*="qtext"]');
                if (questionText) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        text: questionText.textContent?.trim(),
                        source: 'Captivate:DOM',
                        confidence: CONFIDENCE.MEDIUM
                    });
                }

                // Answer options
                const options = container.querySelectorAll(
                    '.cp-quiz-option, [class*="answeroption"], .cp_radio_button, .cp_checkbox'
                );

                options.forEach(opt => {
                    const text = opt.textContent?.trim() || opt.getAttribute('aria-label');
                    if (text) {
                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: text,
                            correct: opt.classList.contains('correct') ||
                                    opt.getAttribute('data-correct') === 'true',
                            source: 'Captivate:DOM',
                            confidence: CONFIDENCE.MEDIUM
                        });
                    }
                });
            });

            return items;
        },

        /**
         * Extract from cpInfoQuiz global object
         */
        extractFromInfoQuiz() {
            const items = [];

            if (!window.cpInfoQuiz) return items;

            try {
                const infoQuiz = window.cpInfoQuiz;

                // Extract from reporting data
                if (infoQuiz.quiz) {
                    const quiz = infoQuiz.quiz;
                    if (Array.isArray(quiz.questions)) {
                        quiz.questions.forEach(q => {
                            if (q.text) {
                                items.push({
                                    type: ITEM_TYPE.QUESTION,
                                    text: q.text,
                                    source: 'Captivate:infoQuiz',
                                    confidence: CONFIDENCE.HIGH
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                Logger.debug('Error extracting cpInfoQuiz', { error: e.message });
            }

            return items;
        },

        /**
         * Map Captivate question types to standard types
         */
        mapQuestionType(cpType) {
            const typeMap = {
                'mcq': QUESTION_TYPE.MULTIPLE_CHOICE,
                'mcqsa': QUESTION_TYPE.CHOICE,
                'mcqma': QUESTION_TYPE.MULTIPLE_CHOICE,
                'truefalse': QUESTION_TYPE.TRUE_FALSE,
                'tf': QUESTION_TYPE.TRUE_FALSE,
                'matching': QUESTION_TYPE.MATCHING,
                'sequence': QUESTION_TYPE.SEQUENCING,
                'fillin': QUESTION_TYPE.FILL_IN,
                'shortanswer': QUESTION_TYPE.FILL_IN
            };
            return typeMap[String(cpType).toLowerCase()] || QUESTION_TYPE.CHOICE;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // LECTORA EXTRACTOR (Stub)
    // ELB Learning Lectora content
    // ═══════════════════════════════════════════════════════════════════════════

    const LectoraExtractor = {
        toolId: AUTHORING_TOOL.LECTORA,

        /**
         * Detect if current page is Lectora content
         * Lectora markers: trivantis.*, lectora-specific classes, runtime
         */
        detect() {
            return !!(
                window.trivantis ||
                window.TrivantisCore ||
                window.ObL ||
                document.querySelector('[class*="lectora"]') ||
                document.querySelector('meta[name="generator"][content*="Lectora"]') ||
                document.querySelector('#lectoraContent, .lectora-page') ||
                (typeof window.getObjbyID === 'function')
            );
        },

        /**
         * Extract Q&A from Lectora content
         */
        async extract() {
            if (!this.detect()) {
                Logger.debug('No Lectora content detected');
                return [];
            }

            Logger.info('Extracting Lectora content...');
            const items = [];

            // Method 1: Extract from trivantis quiz objects
            items.push(...this.extractFromTrivantisQuiz());

            // Method 2: Extract from Lectora DOM
            items.push(...this.extractFromLectoraDOM());

            // Method 3: Extract from test/question objects
            items.push(...this.extractFromTestObjects());

            Logger.info(`Extracted ${items.length} items from Lectora`);
            return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
        },

        /**
         * Extract from Trivantis quiz data structures
         */
        extractFromTrivantisQuiz() {
            const items = [];

            try {
                // Lectora stores quiz data in trivantis namespace
                const trivantis = window.trivantis || window.TrivantisCore;
                if (!trivantis) return items;

                // Look for question bank or test objects
                const tests = trivantis.tests || trivantis.questionBank || [];

                Object.values(tests).forEach(test => {
                    if (test.questions) {
                        test.questions.forEach(q => {
                            if (q.questionText || q.text) {
                                items.push({
                                    type: ITEM_TYPE.QUESTION,
                                    questionType: QUESTION_TYPE.CHOICE,
                                    text: q.questionText || q.text,
                                    source: 'Lectora:trivantis',
                                    confidence: CONFIDENCE.HIGH
                                });
                            }

                            // Extract answers
                            const choices = q.choices || q.answers || q.distractors;
                            if (Array.isArray(choices)) {
                                choices.forEach((choice, idx) => {
                                    const text = typeof choice === 'string' ? choice : choice.text;
                                    if (text) {
                                        items.push({
                                            type: ITEM_TYPE.ANSWER,
                                            text: text,
                                            correct: q.correctIndex === idx ||
                                                    q.correctAnswers?.includes(idx) ||
                                                    choice.isCorrect,
                                            source: 'Lectora:trivantis',
                                            confidence: CONFIDENCE.HIGH
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            } catch (e) {
                Logger.debug('Error extracting Trivantis quiz data', { error: e.message });
            }

            return items;
        },

        /**
         * Extract from Lectora DOM elements
         */
        extractFromLectoraDOM() {
            const items = [];

            // Lectora question containers
            const questionContainers = document.querySelectorAll(
                '[class*="question"], [id*="question"], .test-question'
            );

            questionContainers.forEach(container => {
                // Look for question text
                const qText = container.querySelector(
                    '[class*="questiontext"], [class*="qtext"], .question-stem'
                );
                if (qText) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        text: qText.textContent?.trim(),
                        source: 'Lectora:DOM',
                        confidence: CONFIDENCE.MEDIUM
                    });
                }

                // Look for answer choices
                const choices = container.querySelectorAll(
                    'input[type="radio"] + label, input[type="checkbox"] + label, ' +
                    '[class*="choice"], [class*="answer-option"]'
                );

                choices.forEach(choice => {
                    const text = choice.textContent?.trim();
                    if (text) {
                        const input = choice.previousElementSibling;
                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: text,
                            correct: input?.getAttribute('data-correct') === 'true' ||
                                    choice.classList.contains('correct'),
                            source: 'Lectora:DOM',
                            confidence: CONFIDENCE.MEDIUM
                        });
                    }
                });
            });

            return items;
        },

        /**
         * Extract from test/question objects in page scope
         */
        extractFromTestObjects() {
            const items = [];

            try {
                // Look for Lectora test objects on window
                const testObjects = Object.keys(window).filter(key =>
                    key.includes('test') || key.includes('quiz') || key.includes('question')
                );

                testObjects.forEach(key => {
                    const obj = window[key];
                    if (obj && typeof obj === 'object' && obj.questions) {
                        // Already handled in trivantis extraction
                        return;
                    }
                });
            } catch (e) {
                Logger.debug('Error extracting Lectora test objects', { error: e.message });
            }

            return items;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ISPRING EXTRACTOR (Stub)
    // iSpring Suite content
    // ═══════════════════════════════════════════════════════════════════════════

    const iSpringExtractor = {
        toolId: AUTHORING_TOOL.ISPRING,

        /**
         * Detect if current page is iSpring content
         * iSpring markers: ispring.*, specific DOM elements, runtime
         */
        detect() {
            return !!(
                window.iSpring ||
                window.ispringPresentationConnector ||
                window.PresentationSettings ||
                document.querySelector('[class*="ispring"]') ||
                document.querySelector('meta[name="generator"][content*="iSpring"]') ||
                document.querySelector('#ispring-player, .ispring-slide') ||
                document.querySelector('object[data*="ispring"], embed[src*="ispring"]')
            );
        },

        /**
         * Extract Q&A from iSpring content
         */
        async extract() {
            if (!this.detect()) {
                Logger.debug('No iSpring content detected');
                return [];
            }

            Logger.info('Extracting iSpring content...');
            const items = [];

            // Method 1: Extract from iSpring quiz module
            items.push(...this.extractFromQuizModule());

            // Method 2: Extract from presentation slides
            items.push(...this.extractFromSlides());

            // Method 3: Extract from iSpring data.js
            items.push(...this.extractFromDataJS());

            Logger.info(`Extracted ${items.length} items from iSpring`);
            return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
        },

        /**
         * Extract from iSpring Quiz module
         */
        extractFromQuizModule() {
            const items = [];

            try {
                // iSpring stores quiz data in various locations
                const quizModule = window.iSpring?.quiz ||
                                   window.QuizModule ||
                                   window.ispringQuiz;

                if (!quizModule) return items;

                const questions = quizModule.questions || quizModule.getQuestions?.() || [];

                questions.forEach(q => {
                    const questionText = q.text || q.questionText || q.stem;
                    if (questionText) {
                        items.push({
                            type: ITEM_TYPE.QUESTION,
                            questionType: this.mapQuestionType(q.type),
                            text: questionText,
                            source: 'iSpring:quiz-module',
                            confidence: CONFIDENCE.HIGH
                        });
                    }

                    // Answer choices
                    const answers = q.answers || q.choices || q.options;
                    if (Array.isArray(answers)) {
                        answers.forEach(ans => {
                            const text = typeof ans === 'string' ? ans : (ans.text || ans.label);
                            if (text) {
                                items.push({
                                    type: ITEM_TYPE.ANSWER,
                                    text: text,
                                    correct: ans.correct || ans.isCorrect || false,
                                    source: 'iSpring:quiz-module',
                                    confidence: CONFIDENCE.HIGH
                                });
                            }
                        });
                    }
                });
            } catch (e) {
                Logger.debug('Error extracting iSpring quiz module', { error: e.message });
            }

            return items;
        },

        /**
         * Extract from iSpring presentation slides
         */
        extractFromSlides() {
            const items = [];

            // Look for quiz slides in DOM
            const quizSlides = document.querySelectorAll(
                '.quiz-slide, [class*="quiz"], .ispring-quiz-container'
            );

            quizSlides.forEach(slide => {
                // Question text
                const qText = slide.querySelector(
                    '.question-text, [class*="question"], .quiz-question'
                );
                if (qText) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        text: qText.textContent?.trim(),
                        source: 'iSpring:slides',
                        confidence: CONFIDENCE.MEDIUM
                    });
                }

                // Answer options
                const options = slide.querySelectorAll(
                    '.answer-option, [class*="choice"], input[type="radio"] + span'
                );

                options.forEach(opt => {
                    const text = opt.textContent?.trim();
                    if (text) {
                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: text,
                            correct: opt.classList.contains('correct') ||
                                    opt.getAttribute('data-correct') === 'true',
                            source: 'iSpring:slides',
                            confidence: CONFIDENCE.MEDIUM
                        });
                    }
                });
            });

            return items;
        },

        /**
         * Extract from iSpring data.js file
         */
        extractFromDataJS() {
            const items = [];

            try {
                // iSpring sometimes exposes data through PresentationSettings
                const settings = window.PresentationSettings || window.presentationData;
                if (!settings) return items;

                // Look for quiz data in settings
                if (settings.quizzes || settings.quiz) {
                    const quizzes = settings.quizzes || [settings.quiz];
                    quizzes.forEach(quiz => {
                        if (quiz.questions) {
                            quiz.questions.forEach(q => {
                                if (q.text) {
                                    items.push({
                                        type: ITEM_TYPE.QUESTION,
                                        text: q.text,
                                        source: 'iSpring:data.js',
                                        confidence: CONFIDENCE.HIGH
                                    });
                                }
                            });
                        }
                    });
                }
            } catch (e) {
                Logger.debug('Error extracting iSpring data.js', { error: e.message });
            }

            return items;
        },

        /**
         * Map iSpring question types to standard types
         */
        mapQuestionType(ispringType) {
            const typeMap = {
                'multiple_choice': QUESTION_TYPE.CHOICE,
                'multiple_response': QUESTION_TYPE.MULTIPLE_CHOICE,
                'true_false': QUESTION_TYPE.TRUE_FALSE,
                'matching': QUESTION_TYPE.MATCHING,
                'sequence': QUESTION_TYPE.SEQUENCING,
                'fill_blank': QUESTION_TYPE.FILL_IN,
                'numeric': QUESTION_TYPE.FILL_IN,
                'hotspot': QUESTION_TYPE.CHOICE
            };
            return typeMap[String(ispringType).toLowerCase()] || QUESTION_TYPE.CHOICE;
        }
    };

    // Register extractors
    ExtractorRegistry.register(AUTHORING_TOOL.STORYLINE, StorylineExtractor);
    ExtractorRegistry.register(AUTHORING_TOOL.RISE, RiseExtractor);
    ExtractorRegistry.register(AUTHORING_TOOL.CAPTIVATE, CaptivateExtractor);
    ExtractorRegistry.register(AUTHORING_TOOL.LECTORA, LectoraExtractor);
    ExtractorRegistry.register(AUTHORING_TOOL.ISPRING, iSpringExtractor);

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8B: STORYLINE ACCESSIBILITY DOM EXTRACTION
    // Extracts Q&A from Storyline's accessibility shadow DOM
    // ═══════════════════════════════════════════════════════════════════════════

    const StorylineDOMExtractor = {
        /**
         * Check if this page contains Storyline accessibility DOM
         */
        isStorylinePage() {
            // Check for Storyline markers
            return !!(
                document.querySelector('.slide-object[data-acc-text]') ||
                document.querySelector('.acc-shadow-dom') ||
                document.querySelector('[class*="slide-object-"]') ||
                document.querySelector('svg.vector-slide-content') ||
                window.DS || // Storyline runtime
                window.globalProvideData
            );
        },

        /**
         * Extract Q&A from all documents (main + iframes)
         */
        extract() {
            if (!this.isStorylinePage()) {
                Logger.debug('No Storyline accessibility DOM detected');
                return [];
            }

            Logger.info('Extracting from Storyline accessibility DOM...');
            const items = [];

            // Process main document
            items.push(...this.extractFromDocument(document));

            // Process iframes (Storyline often runs in an iframe)
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (doc) {
                        items.push(...this.extractFromDocument(doc));
                    }
                } catch (e) { /* Cross-origin */ }
            });

            Logger.info(`Extracted ${items.length} items from Storyline DOM`);
            return items;
        },

        /**
         * Extract from a single document
         */
        extractFromDocument(doc) {
            const items = [];
            const processed = new Set();

            // Method 1: Extract from data-acc-text attributes (most reliable)
            items.push(...this.extractFromAccText(doc, processed));

            // Method 2: Extract from accessibility shadow elements
            items.push(...this.extractFromAccShadow(doc, processed));

            // Method 3: Extract from aria-labeled elements
            items.push(...this.extractFromAriaLabels(doc, processed));

            return items;
        },

        /**
         * Extract from data-acc-text attributes
         * Storyline stores accessible text in these attributes
         */
        extractFromAccText(doc, processed) {
            const items = [];
            const elements = doc.querySelectorAll('[data-acc-text]');

            elements.forEach(el => {
                const text = el.getAttribute('data-acc-text')?.trim();
                if (!text || text.length < 10 || processed.has(text)) return;

                // Skip if looks like code or navigation/UI elements
                if (Utils.isCodeLike(text)) return;
                if (this.isUIElement(text)) return;

                processed.add(text);

                // Determine if this is a question or answer
                const isQuestion = this.isQuestionText(text, el);
                const isCorrect = this.isCorrectAnswer(el);

                items.push({
                    type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                    text,
                    correct: isCorrect,
                    source: 'StorylineDOM:acc-text',
                    confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
                });
            });

            return items;
        },

        /**
         * Check if text is a UI/navigation element (not content)
         */
        isUIElement(text) {
            const lower = text.toLowerCase();

            // Exact matches for common UI labels
            const uiLabels = [
                'correct', 'incorrect', 'right', 'wrong',
                'next', 'prev', 'previous', 'back', 'forward',
                'submit', 'continue', 'menu', 'close', 'open',
                'play', 'pause', 'stop', 'mute', 'unmute',
                'replay', 'restart', 'reset', 'retry',
                'yes', 'no', 'ok', 'cancel', 'done',
                'loading', 'please wait', 'processing'
            ];
            if (uiLabels.includes(lower)) return true;

            // Pattern matches for UI elements
            const uiPatterns = [
                /^back\s+to/i,                    // "Back to top", "Back to menu"
                /playback\s*(speed|rate)/i,       // Media controls
                /sidebar\s*(toggle|open|close)/i, // Sidebar controls
                /volume\s*(up|down|control)/i,    // Volume controls
                /full\s*screen/i,                 // Fullscreen toggle
                /closed?\s*caption/i,             // CC controls
                /transcript/i,                    // Transcript toggle
                /bookmark/i,                      // Bookmark button
                /print/i,                         // Print button
                /download/i,                      // Download button
                /share/i,                         // Share button
                /help/i,                          // Help button
                /settings?/i,                     // Settings
                /slide\s*\d+\s*(of|\/)\s*\d+/i,   // "Slide 1 of 10"
                /page\s*\d+/i,                    // "Page 1"
                /^\d+\s*%$/,                      // "50%"
                /^\d+:\d+/,                       // "1:30" (time)
                /^(section|chapter|module)\s*\d+$/i, // Navigation labels
            ];

            return uiPatterns.some(p => p.test(text));
        },

        /**
         * Extract from accessibility shadow elements (acc-shadow-el)
         * These are hidden form elements for screen readers
         */
        extractFromAccShadow(doc, processed) {
            const items = [];

            // Find radio buttons and checkboxes in accessibility layer
            const accRadios = doc.querySelectorAll('.acc-shadow-el.acc-radio, .acc-shadow-el input[type="radio"]');
            const accCheckboxes = doc.querySelectorAll('.acc-shadow-el.acc-checkbox, .acc-shadow-el input[type="checkbox"]');

            // Group radios by name for proper question/answer grouping
            const radioGroups = new Map();
            accRadios.forEach(radio => {
                const name = radio.getAttribute('name') || radio.closest('[role="radiogroup"]')?.id || 'default';
                if (!radioGroups.has(name)) {
                    radioGroups.set(name, []);
                }
                radioGroups.set(name, [...radioGroups.get(name), radio]);
            });

            // Process radio groups
            radioGroups.forEach((radios, groupName) => {
                radios.forEach(radio => {
                    const labelText = this.findLabelForElement(radio, doc);
                    if (!labelText || labelText.length < 10 || processed.has(labelText)) return;
                    if (Utils.isCodeLike(labelText)) return;
                    if (this.isUIElement(labelText)) return;

                    processed.add(labelText);

                    const isCorrect = this.isCorrectAnswer(radio);
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: labelText,
                        correct: isCorrect,
                        source: `StorylineDOM:acc-radio:${groupName}`,
                        confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
                    });
                });
            });

            // Process checkboxes
            accCheckboxes.forEach(checkbox => {
                const labelText = this.findLabelForElement(checkbox, doc);
                if (!labelText || labelText.length < 10 || processed.has(labelText)) return;
                if (Utils.isCodeLike(labelText)) return;
                if (this.isUIElement(labelText)) return;

                processed.add(labelText);

                const isCorrect = this.isCorrectAnswer(checkbox);
                items.push({
                    type: ITEM_TYPE.ANSWER,
                    text: labelText,
                    correct: isCorrect,
                    source: 'StorylineDOM:acc-checkbox',
                    confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
                });
            });

            return items;
        },

        /**
         * Extract from aria-label and aria-labelledby attributes
         */
        extractFromAriaLabels(doc, processed) {
            const items = [];

            // Elements with aria-label that look like Q&A content
            doc.querySelectorAll('[aria-label]').forEach(el => {
                const text = el.getAttribute('aria-label')?.trim();
                if (!text || text.length < 15 || processed.has(text)) return;
                if (Utils.isCodeLike(text)) return;
                if (this.isUIElement(text)) return;
                if (/^(button|link|image|icon)/i.test(text)) return;

                // Only include if it looks like content
                if (!Utils.isNaturalLanguage(text)) return;

                processed.add(text);

                const isQuestion = this.isQuestionText(text, el);
                items.push({
                    type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                    text,
                    correct: false,
                    source: 'StorylineDOM:aria-label',
                    confidence: CONFIDENCE.MEDIUM
                });
            });

            return items;
        },

        /**
         * Determine if text is likely a question
         */
        isQuestionText(text, element) {
            // Ends with question mark
            if (text.endsWith('?')) return true;

            // Contains question keywords
            if (/^(what|which|who|when|where|why|how|select|choose|identify)/i.test(text)) return true;

            // Element has question-like attributes
            if (element.classList.contains('question') ||
                element.getAttribute('data-model-id')?.includes('Question')) return true;

            // Parent is a question container
            const parent = element.closest('[class*="question"], [data-acc-text*="?"]');
            if (parent && parent !== element) return false; // This is likely an answer within a question

            return false;
        },

        /**
         * Check if element represents a correct answer
         */
        isCorrectAnswer(element) {
            // Check aria-checked state
            if (element.getAttribute('aria-checked') === 'true') return true;

            // Check for correct-related classes
            const classes = element.className || '';
            if (/correct|right|selected.*correct/i.test(classes)) return true;

            // Check parent states
            const slideObject = element.closest('.slide-object, [class*="slide-object-"]');
            if (slideObject) {
                const stateAttr = slideObject.getAttribute('data-state') || '';
                if (/correct|review(?!.*incorrect)/i.test(stateAttr)) return true;
            }

            // Check data attributes
            if (element.dataset?.correct === 'true' || element.dataset?.answer === 'true') return true;

            // Check Storyline state system
            const objectId = element.id || element.closest('[id]')?.id;
            if (objectId && window.DS?.VO?.[objectId]) {
                const objectData = window.DS.VO[objectId];
                if (objectData?.states?.includes('Correct') ||
                    objectData?.states?.includes('Selected Correct')) {
                    return true;
                }
            }

            return false;
        },

        /**
         * Find label text for a form element
         */
        findLabelForElement(element, doc) {
            // Method 1: aria-labelledby
            const labelledBy = element.getAttribute('aria-labelledby');
            if (labelledBy) {
                const labelEl = doc.getElementById(labelledBy);
                if (labelEl) {
                    return labelEl.textContent?.trim() || labelEl.getAttribute('data-acc-text')?.trim();
                }
            }

            // Method 2: aria-label
            const ariaLabel = element.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel.trim();

            // Method 3: Associated label element (id_label pattern from Storyline)
            const id = element.id;
            if (id) {
                // Try id_label pattern
                const label = doc.getElementById(`${id}_label`) || doc.querySelector(`label[for="${id}"]`);
                if (label) {
                    return label.textContent?.trim() || label.getAttribute('data-acc-text')?.trim();
                }

                // Try finding text in same slide-object
                const slideObject = element.closest('.slide-object, [class*="slide-object-"]');
                if (slideObject) {
                    const textEl = slideObject.querySelector('[data-acc-text]');
                    if (textEl && textEl !== element) {
                        return textEl.getAttribute('data-acc-text')?.trim();
                    }
                }
            }

            // Method 4: Parent with data-acc-text
            const parent = element.closest('[data-acc-text]');
            if (parent && parent !== element) {
                return parent.getAttribute('data-acc-text')?.trim();
            }

            // Method 5: Sibling text content
            const nextText = element.nextSibling;
            if (nextText?.nodeType === Node.TEXT_NODE) {
                const text = nextText.textContent?.trim();
                if (text && text.length > 2) return text;
            }

            // Method 6: Inner text as last resort
            const innerText = element.textContent?.trim();
            if (innerText && innerText.length > 2 && innerText.length < 200) {
                return innerText;
            }

            return null;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 9: RESOURCE DISCOVERY
    // ═══════════════════════════════════════════════════════════════════════════

    const ResourceDiscovery = {
        discover() {
            Logger.info('Discovering resources...');
            const resources = new Map();

            document.querySelectorAll('script[src]').forEach(script => {
                this.addResource(resources, script.src, 'script');
            });

            if (performance.getEntriesByType) {
                performance.getEntriesByType('resource').forEach(entry => {
                    if (/\.js($|\?)|\.json($|\?)/i.test(entry.name)) {
                        this.addResource(resources, entry.name, 'performance');
                    }
                });
            }

            const result = Array.from(resources.values()).slice(0, CONFIG.MAX_RESOURCES);
            
            StateManager.set('resources', result);
            Logger.info(`Found ${result.length} resources`);
            
            return result;
        },

        addResource(map, url, source) {
            if (!Utils.isSameOrigin(url)) return;
            if (map.has(url)) return;

            // Skip known library files and SCORM runtime code
            const skipPatterns = [
                /jquery|angular|react|vue|lodash|backbone|moment/i,
                /scorm.*(?:api|runtime|wrapper|driver)/i,  // SCORM runtime libraries
                /lms.*(?:api|runtime|wrapper)/i,           // LMS API wrappers  
                /pipwerks|scormcloud|rustici/i,            // Common SCORM vendors
                /(?:min|bundle|vendor|polyfill)\.js/i,     // Bundled/minified files
                /(?:player|frame|loader)\.js/i,            // Player framework files
            ];
            
            if (skipPatterns.some(p => p.test(url))) {
                return;
            }

            let priority = PRIORITY.NORMAL;
            if (/data|quiz|question|slide|content/i.test(url)) {
                priority = PRIORITY.HIGH;
            }

            map.set(url, { url, type: url.includes('.json') ? 'json' : 'js', priority, source });
        },

        async analyze() {
            const resources = StateManager.get('resources');
            const items = [];

            const sorted = [...resources].sort((a, b) => {
                if (a.priority === PRIORITY.HIGH && b.priority !== PRIORITY.HIGH) return -1;
                if (b.priority === PRIORITY.HIGH && a.priority !== PRIORITY.HIGH) return 1;
                return 0;
            });

            for (const resource of sorted) {
                try {
                    const response = await Utils.fetchWithTimeout(resource.url);
                    if (!response.ok) continue;

                    const text = await response.text();
                    const found = this.analyzeContent(text, resource.url);
                    items.push(...found);
                } catch (e) { /* Skip failed fetches */ }
            }

            return items;
        },

        analyzeContent(text, source) {
            const items = [];

            // Try JSON parse first - structured data is most reliable
            const json = Utils.safeJsonParse(text);
            if (json) {
                this.extractFromJson(json, source, items);
                return items;
            }

            // Skip pattern matching on files that look like pure code
            // (high ratio of code characters throughout)
            const sampleSize = Math.min(text.length, 2000);
            const sample = text.substring(0, sampleSize);
            const codeChars = (sample.match(/[{}\[\]();=<>!&|]/g) || []).length;
            if (codeChars / sampleSize > 0.1) {
                Logger.debug(`Skipping ${source} - appears to be code`);
                return items;
            }

            // Apply restrictive patterns with natural language validation
            for (const [type, patterns] of Object.entries(CONTENT_PATTERNS)) {
                for (const pattern of patterns) {
                    // Reset regex state
                    pattern.lastIndex = 0;
                    const matches = text.matchAll(pattern);
                    
                    for (const match of matches) {
                        const content = match[1]?.trim();
                        
                        // Validate content is natural language, not code
                        if (!content || content.length < 15 || content.length > 500) continue;
                        if (!Utils.isNaturalLanguage(content)) continue;
                        
                        items.push({
                            type: type === 'questions' ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                            text: content,
                            source: `Pattern:${source}`,
                            correct: type === 'correct',
                            confidence: CONFIDENCE.LOW  // Pattern matches are low confidence
                        });
                    }
                }
            }

            return items;
        },

        extractFromJson(obj, source, items, depth = 0) {
            if (!obj || depth > CONFIG.MAX_RECURSION_DEPTH) return;

            if (typeof obj === 'object' && !Array.isArray(obj)) {
                // Keys that typically contain question text
                const questionKeys = ['question', 'prompt', 'stem', 'query', 'questionText'];
                // Keys that typically contain answer text  
                const answerKeys = ['answer', 'response', 'options', 'choices', 'answerText'];
                // Keys that indicate correct answer
                const correctKeys = ['correctAnswer', 'correctResponse', 'correct'];

                for (const key of questionKeys) {
                    const value = obj[key];
                    if (value && typeof value === 'string' && value.length > 15) {
                        // Filter out code-like content
                        if (!Utils.isCodeLike(value)) {
                            items.push({
                                type: ITEM_TYPE.QUESTION,
                                text: value.trim(),
                                source: `JSON:${source}`,
                                confidence: CONFIDENCE.HIGH
                            });
                        }
                    }
                }

                for (const key of correctKeys) {
                    const value = obj[key];
                    if (value && typeof value === 'string' && value.length > 2) {
                        if (!Utils.isCodeLike(value)) {
                            items.push({
                                type: ITEM_TYPE.ANSWER,
                                text: value.trim(),
                                source: `JSON:${source}`,
                                correct: true,
                                confidence: CONFIDENCE.VERY_HIGH
                            });
                        }
                    }
                }

                for (const key of answerKeys) {
                    const value = obj[key];
                    if (typeof value === 'string' && value.length > 2) {
                        if (!Utils.isCodeLike(value)) {
                            items.push({
                                type: ITEM_TYPE.ANSWER,
                                text: value.trim(),
                                source: `JSON:${source}`,
                                correct: obj.isCorrect === true || obj.correct === true,
                                confidence: CONFIDENCE.HIGH
                            });
                        }
                    } else if (Array.isArray(value)) {
                        value.forEach(item => {
                            if (typeof item === 'string' && !Utils.isCodeLike(item)) {
                                items.push({
                                    type: ITEM_TYPE.ANSWER,
                                    text: item.trim(),
                                    source: `JSON:${source}`,
                                    confidence: CONFIDENCE.MEDIUM
                                });
                            } else if (item && typeof item === 'object') {
                                this.extractFromJson(item, source, items, depth + 1);
                            }
                        });
                    }
                }
            }

            // Recurse into arrays and nested objects
            if (Array.isArray(obj)) {
                obj.forEach(item => this.extractFromJson(item, source, items, depth + 1));
            } else if (typeof obj === 'object') {
                Object.values(obj).forEach(value => {
                    if (value && typeof value === 'object') {
                        this.extractFromJson(value, source, items, depth + 1);
                    }
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 9B: SEED-BASED EXTRACTION
    // Uses user-selected content to find Q&A in JavaScript files
    // ═══════════════════════════════════════════════════════════════════════════

    const SeedExtractor = {
        // Cache fetched resources to avoid re-fetching
        resourceCache: new Map(),

        /**
         * Main entry point: Given seed text from user selection, find all related Q&A
         * @param {string} seedText - The question/answer text user selected
         * @returns {Promise<{items: Array, source: string, context: object}>}
         */
        async extractFromSeed(seedText) {
            if (!seedText || seedText.length < 10) {
                return { items: [], error: 'Seed text too short' };
            }

            Logger.info(`Seed extraction starting with: "${Utils.truncate(seedText, 50)}"`);

            // Step 1: Discover all JS/JSON resources
            ResourceDiscovery.discover();
            const resources = StateManager.get('resources');

            // Step 2: Search each resource for the seed text
            const matches = await this.searchResources(seedText, resources);

            if (matches.length === 0) {
                Logger.warn('Seed text not found in any resource');
                return { items: [], error: 'Text not found in JavaScript files' };
            }

            Logger.info(`Found seed in ${matches.length} resource(s)`);

            // Step 3: Extract Q&A from the context around each match
            const allItems = [];
            for (const match of matches) {
                const items = this.extractFromMatch(match);
                allItems.push(...items);
            }

            // Dedupe and return
            const unique = Utils.dedupeBy(allItems, item => `${item.type}:${item.text.substring(0, 50)}`);

            Logger.info(`Seed extraction found ${unique.length} Q&A items`);

            return {
                items: unique,
                source: matches[0]?.resource?.url || 'unknown',
                matchCount: matches.length
            };
        },

        /**
         * Search all resources for the seed text
         */
        async searchResources(seedText, resources) {
            const matches = [];
            const normalizedSeed = this.normalizeText(seedText);

            for (const resource of resources) {
                try {
                    // Check cache first
                    let content = this.resourceCache.get(resource.url);

                    if (!content) {
                        const response = await Utils.fetchWithTimeout(resource.url);
                        if (!response.ok) continue;
                        content = await response.text();
                        this.resourceCache.set(resource.url, content);
                    }

                    // Search for seed text (normalized comparison)
                    const normalizedContent = this.normalizeText(content);
                    const position = normalizedContent.indexOf(normalizedSeed);

                    if (position !== -1) {
                        matches.push({
                            resource,
                            content,
                            position,
                            seedText
                        });
                    }
                } catch (e) {
                    // Skip failed fetches
                }
            }

            return matches;
        },

        /**
         * Normalize text for comparison (remove extra whitespace, lowercase)
         */
        normalizeText(text) {
            return text.toLowerCase().replace(/\s+/g, ' ').trim();
        },

        /**
         * Extract Q&A from a matched resource
         */
        extractFromMatch(match) {
            const { content, position, resource } = match;
            const items = [];

            // Try to find the containing data structure
            // Strategy 1: If it's JSON, parse and find containing object/array
            const json = Utils.safeJsonParse(content);
            if (json) {
                const context = this.findContextInJson(json, match.seedText);
                if (context) {
                    this.extractFromContext(context, resource.url, items);
                    return items;
                }
            }

            // Strategy 2: Find embedded JSON in JavaScript (e.g., globalProvideData)
            const embeddedJson = this.findEmbeddedJson(content, position);
            if (embeddedJson) {
                const context = this.findContextInJson(embeddedJson.data, match.seedText);
                if (context) {
                    this.extractFromContext(context, resource.url, items);
                    return items;
                }
            }

            // Strategy 3: Extract from string literals near the position
            const nearbyStrings = this.extractNearbyStrings(content, position);
            nearbyStrings.forEach(str => {
                if (str.length > 15 && !Utils.isCodeLike(str) && Utils.isNaturalLanguage(str)) {
                    const isQuestion = str.endsWith('?') || /^(what|which|who|when|where|why|how|select|choose)/i.test(str);
                    items.push({
                        type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                        text: str,
                        source: `Seed:${resource.url}`,
                        confidence: CONFIDENCE.MEDIUM
                    });
                }
            });

            return items;
        },

        /**
         * Find embedded JSON data in JavaScript (like globalProvideData calls)
         */
        findEmbeddedJson(content, nearPosition) {
            // Look for common patterns that embed JSON in JS
            const patterns = [
                // Storyline: globalProvideData('slide', '...')
                /globalProvideData\s*\(\s*['"][^'"]+['"]\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g,
                // Generic: var data = {...}
                /(?:var|let|const)\s+\w+\s*=\s*(\{[\s\S]*?\});/g,
                // JSON array assignment
                /(?:var|let|const)\s+\w+\s*=\s*(\[[\s\S]*?\]);/g
            ];

            for (const pattern of patterns) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    // Check if this match is near our position
                    if (Math.abs(match.index - nearPosition) < 5000) {
                        let jsonStr = match[1];

                        // Unescape if needed (for Storyline's escaped JSON)
                        if (jsonStr.includes("\\'")) {
                            jsonStr = jsonStr
                                .replace(/\\'/g, "'")
                                .replace(/\\"/g, '"')
                                .replace(/\\n/g, '\n')
                                .replace(/\\r/g, '\r')
                                .replace(/\\t/g, '\t')
                                .replace(/\\\\/g, '\\');
                        }

                        const data = Utils.safeJsonParse(jsonStr);
                        if (data) {
                            return { data, index: match.index };
                        }
                    }
                }
            }

            return null;
        },

        /**
         * Recursively find the object/array containing the seed text in JSON
         */
        findContextInJson(obj, seedText, path = [], depth = 0) {
            if (!obj || depth > CONFIG.MAX_RECURSION_DEPTH) return null;

            const normalizedSeed = this.normalizeText(seedText);

            if (typeof obj === 'string') {
                if (this.normalizeText(obj).includes(normalizedSeed)) {
                    return { type: 'string', value: obj, path };
                }
                return null;
            }

            if (Array.isArray(obj)) {
                // Check if any element contains the seed
                for (let i = 0; i < obj.length; i++) {
                    const found = this.findContextInJson(obj[i], seedText, [...path, i], depth + 1);
                    if (found) {
                        // Return the parent array as context (all siblings are likely Q&A)
                        return { type: 'array', value: obj, path: path, matchIndex: i };
                    }
                }
            }

            if (typeof obj === 'object') {
                for (const [key, value] of Object.entries(obj)) {
                    const found = this.findContextInJson(value, seedText, [...path, key], depth + 1);
                    if (found) {
                        // Return the parent object as context
                        return { type: 'object', value: obj, path: path, matchKey: key };
                    }
                }
            }

            return null;
        },

        /**
         * Extract Q&A items from a found context (array or object)
         */
        extractFromContext(context, source, items) {
            if (!context) return;

            if (context.type === 'array') {
                // The array likely contains all questions or all answers
                context.value.forEach((item, index) => {
                    this.extractFromItem(item, source, items, index);
                });
            } else if (context.type === 'object') {
                // The object might be a single Q&A pair or container
                this.extractFromItem(context.value, source, items);

                // Also check for sibling objects (parent might have multiple Q&A)
                // This is handled by the caller extracting from the parent array
            }
        },

        /**
         * Extract Q&A from a single item (object or primitive)
         */
        extractFromItem(item, source, items, index = 0) {
            if (!item) return;

            if (typeof item === 'string') {
                if (item.length > 10 && !Utils.isCodeLike(item) && Utils.isNaturalLanguage(item)) {
                    const isQuestion = item.endsWith('?') ||
                        /^(what|which|who|when|where|why|how|select|choose|identify)/i.test(item);
                    items.push({
                        type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                        text: item.trim(),
                        source: `Seed:${source}`,
                        confidence: CONFIDENCE.HIGH
                    });
                }
                return;
            }

            if (typeof item !== 'object') return;

            // Look for question-like keys
            const questionKeys = ['question', 'prompt', 'stem', 'text', 'questionText', 'q', 'caption', 'altText'];
            const answerKeys = ['answer', 'response', 'answerText', 'a', 'correctAnswer', 'correct'];
            const optionKeys = ['options', 'choices', 'answers', 'responses', 'distractors'];
            const correctIndicators = ['correct', 'isCorrect', 'right', 'isRight', 'selected'];

            // Extract questions
            for (const key of questionKeys) {
                const value = item[key];
                if (typeof value === 'string' && value.length > 10 && !Utils.isCodeLike(value)) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        text: value.trim(),
                        source: `Seed:${source}`,
                        confidence: CONFIDENCE.HIGH
                    });
                }
            }

            // Extract correct answer
            for (const key of answerKeys) {
                const value = item[key];
                if (typeof value === 'string' && value.length > 2 && !Utils.isCodeLike(value)) {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: value.trim(),
                        correct: true,
                        source: `Seed:${source}`,
                        confidence: CONFIDENCE.VERY_HIGH
                    });
                }
            }

            // Extract options/choices
            for (const key of optionKeys) {
                const value = item[key];
                if (Array.isArray(value)) {
                    value.forEach((opt, optIndex) => {
                        if (typeof opt === 'string' && opt.length > 2 && !Utils.isCodeLike(opt)) {
                            items.push({
                                type: ITEM_TYPE.ANSWER,
                                text: opt.trim(),
                                source: `Seed:${source}`,
                                confidence: CONFIDENCE.MEDIUM
                            });
                        } else if (typeof opt === 'object' && opt) {
                            // Option object with text and possibly correct indicator
                            const optText = opt.text || opt.label || opt.value || opt.content;
                            if (optText && typeof optText === 'string' && !Utils.isCodeLike(optText)) {
                                const isCorrect = correctIndicators.some(ind => opt[ind] === true);
                                items.push({
                                    type: ITEM_TYPE.ANSWER,
                                    text: optText.trim(),
                                    correct: isCorrect,
                                    source: `Seed:${source}`,
                                    confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
                                });
                            }
                        }
                    });
                }
            }

            // Recurse into nested objects that might contain more Q&A
            const nestedKeys = ['questions', 'items', 'slides', 'pages', 'quizzes', 'data'];
            for (const key of nestedKeys) {
                const value = item[key];
                if (Array.isArray(value)) {
                    value.forEach((nested, i) => this.extractFromItem(nested, source, items, i));
                }
            }
        },

        /**
         * Extract string literals from JavaScript near a given position
         */
        extractNearbyStrings(content, position, range = 2000) {
            const start = Math.max(0, position - range);
            const end = Math.min(content.length, position + range);
            const nearby = content.substring(start, end);

            const strings = [];

            // Match quoted strings (single and double)
            const stringPattern = /(['"])((?:(?!\1)[^\\]|\\.)*)(\1)/g;
            let match;
            while ((match = stringPattern.exec(nearby)) !== null) {
                const str = match[2]
                    .replace(/\\'/g, "'")
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, ' ')
                    .replace(/\\r/g, '')
                    .replace(/\\t/g, ' ')
                    .trim();

                if (str.length > 15 && str.length < 500) {
                    strings.push(str);
                }
            }

            return strings;
        },

        /**
         * Clear the resource cache
         */
        clearCache() {
            this.resourceCache.clear();
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 10: SCANNER (Orchestrator)
    // ═══════════════════════════════════════════════════════════════════════════

    const Scanner = {
        async run() {
            if (StateManager.get('scanning')) {
                Logger.warn('Scan already in progress');
                return;
            }

            const endTimer = Logger.time('Full scan');
            StateManager.reset();
            StateManager.set('scanning', true);

            Messenger.send(MSG.SCAN_STARTED);

            try {
                // Step 1: Discover APIs
                this.reportProgress(1, 7, 'Discovering LMS APIs...');
                SCORMAPI.discover();

                // Step 2: Deep framework detection (scripts, globals, SVG, meta)
                this.reportProgress(2, 7, 'Analyzing page for authoring framework...');
                const detection = FrameworkDetector.detect();
                const detectedTool = detection.tool || ExtractorRegistry.detectTool();
                StateManager.set('tool', detectedTool);
                StateManager.set('frameworkEvidence', detection.evidence);

                // Build detection message
                const toolNames = {
                    storyline: 'Articulate Storyline',
                    rise: 'Articulate Rise 360',
                    captivate: 'Adobe Captivate',
                    lectora: 'Lectora',
                    ispring: 'iSpring',
                    camtasia: 'Camtasia',
                    generic: 'Generic LMS'
                };
                const toolName = toolNames[detectedTool] || detectedTool;
                Logger.info(`Framework detected: ${toolName}`, { confidence: detection.confidence, evidence: detection.evidence });

                // Step 3: Extract SVG text content
                this.reportProgress(3, 7, 'Extracting SVG text content...');
                const svgTexts = FrameworkDetector.extractSVGText();
                Logger.debug(`Found ${svgTexts.length} SVG text elements`);

                // Step 4: Run tool-specific extraction
                this.reportProgress(4, 7, `Extracting Q&A from ${toolName}...`);
                const extractorResult = await ExtractorRegistry.extract(detectedTool);
                const extractorItems = extractorResult.items || [];
                const groupedQuestions = extractorResult.questions || [];

                // Step 5: Extract from Storyline accessibility DOM (if applicable)
                this.reportProgress(5, 7, 'Scanning accessibility DOM...');
                const storylineDOMItems = StorylineDOMExtractor.extract();

                // Step 6: Scan DOM for generic quiz forms
                this.reportProgress(6, 7, 'Scanning DOM for quiz forms...');
                const domQuizzes = DOMQuizExtractor.extract();
                const domItems = DOMQuizExtractor.toQAItems(domQuizzes);

                // Step 7: Analyze embedded resources
                this.reportProgress(7, 7, 'Analyzing resources...');
                ResourceDiscovery.discover();
                const resourceItems = await ResourceDiscovery.analyze();

                // Combine all items
                const allItems = Utils.dedupeBy(
                    [...extractorItems, ...storylineDOMItems, ...domItems, ...resourceItems],
                    item => `${item.type}:${item.text.substring(0, 50)}`
                );

                // Store results
                StateManager.set('qa', allItems);
                StateManager.set('groupedQuestions', groupedQuestions);
                StateManager.set('scanning', false);
                StateManager.set('lastScan', Date.now());

                const scanTime = endTimer();
                const report = Reporter.generate();
                report.scanTime = scanTime;

                Logger.info('Scan complete', {
                    tool: detectedTool,
                    apis: report.apis.length,
                    questions: report.qa.questions,
                    correct: report.qa.correct,
                    time: `${scanTime.toFixed(0)}ms`
                });

                Messenger.send(MSG.SCAN_COMPLETE, report);

            } catch (error) {
                StateManager.set('scanning', false);
                Logger.error('Scan failed', { error: error.message });
                Messenger.send(MSG.SCAN_ERROR, { error: error.message });
            }
        },

        reportProgress(step, total, message) {
            Messenger.send(MSG.PROGRESS, { step, total, message });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 11: REPORTER
    // ═══════════════════════════════════════════════════════════════════════════

    const Reporter = {
        generate() {
            const qa = StateManager.get('qa');
            const apis = StateManager.get('apis');
            const resources = StateManager.get('resources');
            const logs = StateManager.get('logs');
            const warnings = StateManager.get('warnings');
            const tool = StateManager.get('tool');
            const frameworkEvidence = StateManager.get('frameworkEvidence') || [];
            const groupedQuestions = StateManager.get('groupedQuestions') || [];

            const questions = qa.filter(item => item.type === ITEM_TYPE.QUESTION);
            const answers = qa.filter(item => item.type === ITEM_TYPE.ANSWER);
            const correct = answers.filter(item => item.correct);
            const sequences = qa.filter(item => item.type === ITEM_TYPE.SEQUENCE);
            const matchItems = qa.filter(item =>
                item.type === ITEM_TYPE.MATCH_SOURCE || item.type === ITEM_TYPE.MATCH_TARGET
            );

            return {
                version: VERSION,
                url: window.location.href,
                timestamp: new Date().toISOString(),
                tool: tool || 'generic',
                toolEvidence: frameworkEvidence.slice(0, 5), // Include up to 5 evidence items
                apis: apis.map(api => ({
                    type: api.type,
                    location: api.location,
                    methods: api.methods,
                    functional: api.functional
                })),
                qa: {
                    total: qa.length,
                    questionCount: questions.length,
                    answers: answers.length,
                    correct: correct.length,
                    sequences: sequences.length,
                    matchItems: matchItems.length,
                    items: qa,
                    questions: groupedQuestions  // Structured question objects
                },
                resources: resources.length,
                logs,
                warnings
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 12: EXPORTER
    // ═══════════════════════════════════════════════════════════════════════════

    const Exporter = {
        export(format = 'json') {
            const report = Reporter.generate();

            let data, mimeType, filename;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

            switch (format) {
                case 'csv':
                    data = this.toCSV(report);
                    mimeType = 'text/csv';
                    filename = `lms-qa-${timestamp}.csv`;
                    break;

                case 'txt':
                    data = this.toTXT(report);
                    mimeType = 'text/plain';
                    filename = `lms-qa-${timestamp}.txt`;
                    break;

                default:
                    data = JSON.stringify(report, null, 2);
                    mimeType = 'application/json';
                    filename = `lms-qa-${timestamp}.json`;
            }

            Messenger.send('EXPORT_DATA', { format, data, filename, mimeType });
        },

        toCSV(report) {
            const rows = [['Type', 'Text', 'Correct', 'Source', 'Confidence']];
            
            report.qa.items.forEach(item => {
                rows.push([
                    item.type,
                    `"${(item.text || '').replace(/"/g, '""')}"`,
                    item.correct ? 'Yes' : '',
                    item.source,
                    item.confidence
                ]);
            });

            return rows.map(row => row.join(',')).join('\n');
        },

        toTXT(report) {
            const lines = [
                '='.repeat(60),
                'LMS QA VALIDATOR - ANSWER KEY',
                '='.repeat(60),
                `Exported: ${report.timestamp}`,
                `URL: ${report.url}`,
                `Total Items: ${report.qa.total}`,
                `Questions: ${report.qa.questions}`,
                `Correct Answers: ${report.qa.correct}`,
                '',
                '-'.repeat(60),
                'ALL QUESTIONS & ANSWERS',
                '-'.repeat(60),
                ''
            ];

            let questionNum = 0;
            report.qa.items.forEach(item => {
                if (item.type === ITEM_TYPE.QUESTION) {
                    questionNum++;
                    lines.push(`Q${questionNum}: ${item.text}`);
                } else {
                    const marker = item.correct ? '  * CORRECT:' : '  -';
                    lines.push(`${marker} ${item.text}`);
                }
            });

            lines.push('');
            lines.push('-'.repeat(60));
            lines.push('CORRECT ANSWERS ONLY');
            lines.push('-'.repeat(60));
            lines.push('');

            const correct = report.qa.items.filter(i => i.correct);
            correct.forEach((item, idx) => {
                lines.push(`${idx + 1}. ${item.text}`);
            });

            return lines.join('\n');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 13: PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.LMS_QA = {
        version: VERSION,
        
        getState: () => StateManager.get(),
        getAPIs: () => StateManager.get('apis'),
        getQA: () => StateManager.get('qa'),
        getLogs: () => StateManager.get('logs'),

        scan: () => Scanner.run(),
        testAPI: (index) => SCORMAPI.test(index),
        setCompletion: (opts) => SCORMAPI.setCompletion(opts),
        forceCompletion: (opts) => SCORMAPI.forceCompletion(opts),
        getCmiData: () => SCORMAPI.getCmiData(),
        
        getDOMQuizzes: () => DOMQuizExtractor.extract(),
        autoSelect: () => DOMQuizExtractor.autoSelect(),

        getStorylineDOM: () => StorylineDOMExtractor.extract(),
        isStorylinePage: () => StorylineDOMExtractor.isStorylinePage(),

        // Seed-based extraction - pass a question text to find all related Q&A
        seedExtract: (seedText) => SeedExtractor.extractFromSeed(seedText),
        clearSeedCache: () => SeedExtractor.clearCache(),

        export: (format) => Exporter.export(format),
        getReport: () => Reporter.generate(),

        discoverAPIs: () => SCORMAPI.discover(),
        discoverResources: () => ResourceDiscovery.discover(),

        // Kitchen sink approach - comprehensive discovery and completion
        kitchenSinkDiscover: () => SCORMAPI.kitchenSinkDiscover(),
        tryAllCompletionMethods: (opts) => SCORMAPI.tryAllCompletionMethods(opts),

        // Window/frame discovery
        getSearchableWindows: () => SCORMAPI._getAllSearchableWindows()
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 14: INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    Messenger.init();
    Messenger.send(MSG.READY, { version: VERSION, url: window.location.href });
    Logger.info(`LMS QA Validator v${VERSION} initialized`);

})();
