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

    const VERSION = '3.4.0';

    const CONFIG = Object.freeze({
        MAX_RECURSION_DEPTH: 20,
        MAX_API_SEARCH_DEPTH: 7,
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
        DROP: 'drop_target'
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
        AUTO_SELECT_RESULT: 'AUTO_SELECT_RESULT',
        CMD_SCAN: 'LMS_QA_CMD_SCAN',
        CMD_TEST_API: 'LMS_QA_CMD_TEST_API',
        CMD_SET_COMPLETION: 'LMS_QA_CMD_SET_COMPLETION',
        CMD_GET_STATE: 'LMS_QA_CMD_GET_STATE',
        CMD_GET_CMI_DATA: 'LMS_QA_CMD_GET_CMI_DATA',
        CMD_AUTO_SELECT: 'LMS_QA_CMD_AUTO_SELECT',
        CMD_EXPORT: 'LMS_QA_CMD_EXPORT',
        CMD_DETECT_APIS: 'LMS_QA_CMD_DETECT_APIS',
        APIS_DETECTED: 'APIS_DETECTED'
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
                // All 8 methods are mandatory per SCORM 1.2 RTE spec
                required: ['LMSInitialize', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSFinish',
                           'LMSGetLastError', 'LMSGetErrorString', 'LMSGetDiagnostic'],
                // Relaxed detection: only require core 5 for real-world compatibility
                detect: ['LMSInitialize', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSFinish']
            },
            [LMS_STANDARD.SCORM_2004]: {
                // All 8 methods are mandatory per SCORM 2004 RTE spec (IEEE 1484.11.2)
                required: ['Initialize', 'GetValue', 'SetValue', 'Commit', 'Terminate',
                           'GetLastError', 'GetErrorString', 'GetDiagnostic'],
                detect: ['Initialize', 'GetValue', 'SetValue', 'Commit', 'Terminate']
            },
            [LMS_STANDARD.XAPI]: {
                // ADL xAPIWrapper uses sendStatement; TinCan.js uses saveStatement
                required: ['sendStatement'],
                detect: ['sendStatement'],
                alternates: ['saveStatement']
            },
            [LMS_STANDARD.CUSTOM]: {
                required: ['sendResults'],
                detect: ['sendResults'],
                optional: ['getResults', 'setScore', 'setCompletion', 'markComplete']
            }
            // NOTE: AICC uses HTTP HACP, not JS API — detected via URL params, not signatures
            // NOTE: CMI5 uses xAPI statements — detected via URL params, not signatures
        },

        // Valid SCORM 1.2 lesson_status values
        SCORM12_VALID_STATUS: ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'],
        // Valid SCORM 2004 completion_status values
        SCORM2004_VALID_COMPLETION: ['completed', 'incomplete', 'not attempted', 'unknown'],
        // Valid SCORM 2004 success_status values
        SCORM2004_VALID_SUCCESS: ['passed', 'failed', 'unknown'],

        // Standalone function names to search for (not on API objects)
        standaloneFunctions: [
            'sendResults', 'submitResults', 'completeLesson', 'lessonComplete',
            'finishLesson', 'setLessonStatus', 'recordCompletion'
        ],

        discover() {
            Logger.info('Discovering LMS APIs...');
            const found = [];

            const searchLocations = [
                { name: 'window', obj: window },
                { name: 'parent', obj: window.parent },
                { name: 'top', obj: window.top }
            ];

            try {
                if (window.opener) {
                    searchLocations.push({ name: 'opener', obj: window.opener });
                }
            } catch (e) { /* Cross-origin */ }

            for (const { name, obj } of searchLocations) {
                try {
                    // Search for API objects (SCORM + xAPI)
                    const apis = this.searchObject(obj, name, 0);
                    found.push(...apis);

                    // Search for standalone completion functions
                    const standaloneFns = this.searchStandaloneFunctions(obj, name);
                    found.push(...standaloneFns);
                } catch (e) { /* Cross-origin */ }
            }

            // Detect AICC via URL parameters (HACP protocol)
            const aiccApi = this.detectAICC();
            if (aiccApi) found.push(aiccApi);

            // Detect CMI5 via URL parameters
            const cmi5Api = this.detectCMI5();
            if (cmi5Api) found.push(cmi5Api);

            const unique = Utils.dedupeBy(found, api => api.location);
            StateManager.set('apis', unique);

            Logger.info(`Found ${unique.length} API(s)`);
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
            // SCORM API object names per spec
            const scormNames = ['API', 'API_1484_11', 'SCORM_API', 'pipwerks'];
            // xAPI object names and nested paths
            const xapiNames = ['TinCan', 'xAPIWrapper'];
            // xAPI nested paths: ADL.XAPIWrapper is the standard ADL pattern
            const xapiNestedPaths = [
                { parent: 'ADL', child: 'XAPIWrapper' }
            ];

            // Search SCORM API names
            for (const name of scormNames) {
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

            // Search xAPI direct names (TinCan, xAPIWrapper)
            for (const name of xapiNames) {
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

            // Search xAPI nested paths (ADL.XAPIWrapper)
            for (const { parent, child } of xapiNestedPaths) {
                try {
                    const parentObj = obj[parent];
                    if (parentObj && typeof parentObj === 'object') {
                        const childObj = parentObj[child];
                        if (childObj && typeof childObj === 'object') {
                            const detected = this.identifyAPI(childObj);
                            if (detected) {
                                found.push({
                                    type: detected.type,
                                    location: `${path}.${parent}.${child}`,
                                    ref: childObj,
                                    methods: detected.methods,
                                    functional: false
                                });
                            }
                        }
                    }
                } catch (e) { /* Access denied */ }
            }

            // Traverse parent frame chain per SCORM spec
            try {
                if (obj.parent && obj.parent !== obj) {
                    found.push(...this.searchObject(obj.parent, `${path}.parent`, depth + 1));
                }
            } catch (e) { /* Cross-origin */ }

            return found;
        },

        identifyAPI(obj) {
            for (const [type, sig] of Object.entries(this.signatures)) {
                // Use detect list (relaxed) for identification, not full required list
                const detectMethods = sig.detect || sig.required;
                const hasDetect = detectMethods.every(m => typeof obj[m] === 'function');

                // Also check alternate method names (e.g., saveStatement for xAPI)
                const hasAlternate = sig.alternates?.some(m => typeof obj[m] === 'function');

                if (hasDetect || hasAlternate) {
                    const allMethods = [...(sig.required || []), ...(sig.optional || []), ...(sig.alternates || [])];
                    const methods = allMethods.filter(m => typeof obj[m] === 'function');
                    return { type, methods };
                }
            }
            return null;
        },

        // AICC detection via URL parameters (HTTP HACP protocol)
        detectAICC() {
            try {
                const params = new URLSearchParams(window.location.search);
                const aiccSid = params.get('aicc_sid') || params.get('AICC_SID');
                const aiccUrl = params.get('aicc_url') || params.get('AICC_URL');

                if (aiccSid && aiccUrl) {
                    Logger.info(`AICC detected: sid=${aiccSid}, url=${aiccUrl}`);
                    return {
                        type: LMS_STANDARD.AICC,
                        location: 'URL:HACP',
                        ref: { aicc_sid: aiccSid, aicc_url: aiccUrl },
                        methods: ['GetParam', 'PutParam', 'ExitAU'],
                        functional: false,
                        description: 'AICC HACP (HTTP-based communication)'
                    };
                }
            } catch (e) {
                Logger.debug('AICC detection error: ' + e.message);
            }
            return null;
        },

        // CMI5 detection via URL parameters (xAPI-based)
        detectCMI5() {
            try {
                const params = new URLSearchParams(window.location.search);
                const endpoint = params.get('endpoint');
                const fetchUrl = params.get('fetch');
                const actor = params.get('actor');
                const registration = params.get('registration');
                const activityId = params.get('activityId');

                // CMI5 requires all 5 parameters
                if (endpoint && fetchUrl && actor && registration && activityId) {
                    Logger.info(`CMI5 detected: endpoint=${endpoint}`);
                    return {
                        type: LMS_STANDARD.CMI5,
                        location: 'URL:cmi5',
                        ref: { endpoint, fetch: fetchUrl, actor, registration, activityId },
                        methods: ['initialized', 'completed', 'passed', 'failed', 'terminated'],
                        functional: false,
                        description: 'cmi5 (xAPI profile)'
                    };
                }
            } catch (e) {
                Logger.debug('CMI5 detection error: ' + e.message);
            }
            return null;
        },

        // AICC HACP HTTP communication
        async aiccRequest(aiccUrl, aiccSid, command, data = '') {
            const body = `command=${encodeURIComponent(command)}&version=4.0&session_id=${encodeURIComponent(aiccSid)}`;
            const fullBody = data ? `${body}&${data}` : body;

            try {
                const response = await Utils.fetchWithTimeout(aiccUrl, CONFIG.MAX_FETCH_TIMEOUT);
                // AICC uses form-encoded POST
                const result = await fetch(aiccUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: fullBody
                });
                return await result.text();
            } catch (e) {
                Logger.error(`AICC ${command} failed: ${e.message}`);
                return null;
            }
        },

        // Parse AICC HACP response (INI-style key=value pairs)
        parseAiccResponse(text) {
            if (!text) return { error: 'empty_response' };
            const result = {};
            const lines = text.split('\n');
            let currentGroup = '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Group header: [group]
                const groupMatch = trimmed.match(/^\[(.+)\]$/);
                if (groupMatch) {
                    currentGroup = groupMatch[1].toLowerCase();
                    continue;
                }

                // Key=value pair
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex > 0) {
                    const key = trimmed.substring(0, eqIndex).trim().toLowerCase();
                    const value = trimmed.substring(eqIndex + 1).trim();
                    const fullKey = currentGroup ? `${currentGroup}.${key}` : key;
                    result[fullKey] = value;
                }
            }
            return result;
        },

        async test(apiIndex = 0) {
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

                    // Check for errors after init
                    if (typeof api.ref.LMSGetLastError === 'function') {
                        const errCode = api.ref.LMSGetLastError();
                        if (errCode && errCode !== '0') {
                            result.tests.push({ method: 'LMSGetLastError', result: errCode, warning: true });
                        }
                    }

                    const studentName = api.ref.LMSGetValue('cmi.core.student_name');
                    result.tests.push({ method: 'LMSGetValue(student_name)', result: studentName });

                    api.functional = initResult === 'true' || initResult === true;

                } else if (api.type === LMS_STANDARD.SCORM_2004) {
                    const initResult = api.ref.Initialize('');
                    result.tests.push({ method: 'Initialize', result: initResult });

                    if (typeof api.ref.GetLastError === 'function') {
                        const errCode = api.ref.GetLastError();
                        if (errCode && errCode !== '0') {
                            result.tests.push({ method: 'GetLastError', result: errCode, warning: true });
                        }
                    }

                    const learnerName = api.ref.GetValue('cmi.learner_name');
                    result.tests.push({ method: 'GetValue(learner_name)', result: learnerName });

                    api.functional = initResult === 'true' || initResult === true;

                } else if (api.type === LMS_STANDARD.XAPI) {
                    // xAPI test: verify the send function exists and is callable
                    const sendFn = api.ref.sendStatement || api.ref.saveStatement;
                    const fnName = api.ref.sendStatement ? 'sendStatement' : 'saveStatement';
                    result.tests.push({
                        method: fnName,
                        result: typeof sendFn === 'function' ? 'Function available' : 'Not a function'
                    });
                    // Check for LRS configuration
                    const hasLrs = !!(api.ref.lrs || api.ref.endpoint || api.ref.recordStores);
                    result.tests.push({
                        method: 'LRS configured',
                        result: hasLrs ? 'Yes' : 'No'
                    });
                    api.functional = typeof sendFn === 'function';

                } else if (api.type === LMS_STANDARD.AICC) {
                    // AICC test: send GetParam to verify HACP endpoint
                    const aiccSid = api.ref.aicc_sid;
                    const aiccUrl = api.ref.aicc_url;
                    result.tests.push({ method: 'HACP session_id', result: aiccSid });
                    result.tests.push({ method: 'HACP endpoint', result: aiccUrl });

                    try {
                        const response = await this.aiccRequest(aiccUrl, aiccSid, 'GetParam');
                        const parsed = this.parseAiccResponse(response);
                        const hasError = parsed['error'] === 'empty_response';
                        result.tests.push({
                            method: 'GetParam',
                            result: hasError ? 'Failed' : 'OK',
                            data: hasError ? null : parsed
                        });
                        api.functional = !hasError;
                    } catch (e) {
                        result.tests.push({ method: 'GetParam', result: 'Error: ' + e.message });
                        api.functional = false;
                    }

                } else if (api.type === LMS_STANDARD.CMI5) {
                    // CMI5 test: verify endpoint and fetch URL
                    result.tests.push({ method: 'endpoint', result: api.ref.endpoint });
                    result.tests.push({ method: 'fetch', result: api.ref.fetch });
                    result.tests.push({ method: 'registration', result: api.ref.registration });
                    result.tests.push({ method: 'activityId', result: api.ref.activityId });

                    // Try to obtain auth token from fetch URL
                    try {
                        const tokenResponse = await Utils.fetchWithTimeout(api.ref.fetch);
                        if (tokenResponse.ok) {
                            const tokenData = await tokenResponse.json();
                            result.tests.push({
                                method: 'Auth token',
                                result: tokenData['auth-token'] ? 'Obtained' : 'Missing from response'
                            });
                            api.functional = !!tokenData['auth-token'];
                            api.ref._authToken = tokenData['auth-token'];
                        } else {
                            result.tests.push({ method: 'Auth token', result: `HTTP ${tokenResponse.status}` });
                            api.functional = false;
                        }
                    } catch (e) {
                        result.tests.push({ method: 'Auth token', result: 'Error: ' + e.message });
                        api.functional = false;
                    }

                } else if (api.type === LMS_STANDARD.CUSTOM) {
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

        async setCompletion(options = {}) {
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
                    // Validate status value per SCORM 1.2 spec
                    const validStatus = this.SCORM12_VALID_STATUS.includes(status) ? status : 'completed';

                    result.operations.push({
                        method: 'LMSSetValue(lesson_status)',
                        result: api.ref.LMSSetValue('cmi.core.lesson_status', validStatus)
                    });
                    result.operations.push({
                        method: 'LMSSetValue(score.raw)',
                        result: api.ref.LMSSetValue('cmi.core.score.raw', String(score))
                    });
                    result.operations.push({
                        method: 'LMSSetValue(score.min)',
                        result: api.ref.LMSSetValue('cmi.core.score.min', '0')
                    });
                    result.operations.push({
                        method: 'LMSSetValue(score.max)',
                        result: api.ref.LMSSetValue('cmi.core.score.max', '100')
                    });
                    result.operations.push({
                        method: 'LMSSetValue(exit)',
                        result: api.ref.LMSSetValue('cmi.core.exit', '')
                    });
                    result.operations.push({
                        method: 'LMSCommit',
                        result: api.ref.LMSCommit('')
                    });
                    result.operations.push({
                        method: 'LMSFinish',
                        result: api.ref.LMSFinish('')
                    });

                    // Check for errors
                    if (typeof api.ref.LMSGetLastError === 'function') {
                        const errCode = api.ref.LMSGetLastError();
                        if (errCode && errCode !== '0') {
                            result.lastError = errCode;
                            if (typeof api.ref.LMSGetErrorString === 'function') {
                                result.errorString = api.ref.LMSGetErrorString(errCode);
                            }
                        }
                    }

                } else if (api.type === LMS_STANDARD.SCORM_2004) {
                    // SCORM 2004: completion_status and success_status are SEPARATE
                    // completion_status: completed, incomplete, not attempted, unknown
                    // success_status: passed, failed, unknown
                    const completionStatus = (status === 'completed' || status === 'passed' || status === 'failed')
                        ? 'completed' : 'incomplete';

                    result.operations.push({
                        method: 'SetValue(completion_status)',
                        result: api.ref.SetValue('cmi.completion_status', completionStatus)
                    });

                    // Set success_status if applicable
                    if (status === 'passed' || status === 'failed') {
                        result.operations.push({
                            method: 'SetValue(success_status)',
                            result: api.ref.SetValue('cmi.success_status', status)
                        });
                    }

                    // Score: scaled (-1.0 to 1.0), raw, min, max
                    const scaledScore = Math.max(-1, Math.min(1, score / 100));
                    result.operations.push({
                        method: 'SetValue(score.scaled)',
                        result: api.ref.SetValue('cmi.score.scaled', String(scaledScore))
                    });
                    result.operations.push({
                        method: 'SetValue(score.raw)',
                        result: api.ref.SetValue('cmi.score.raw', String(score))
                    });
                    result.operations.push({
                        method: 'SetValue(score.min)',
                        result: api.ref.SetValue('cmi.score.min', '0')
                    });
                    result.operations.push({
                        method: 'SetValue(score.max)',
                        result: api.ref.SetValue('cmi.score.max', '100')
                    });
                    result.operations.push({
                        method: 'SetValue(exit)',
                        result: api.ref.SetValue('cmi.exit', 'normal')
                    });
                    result.operations.push({
                        method: 'Commit',
                        result: api.ref.Commit('')
                    });
                    result.operations.push({
                        method: 'Terminate',
                        result: api.ref.Terminate('')
                    });

                    // Check for errors
                    if (typeof api.ref.GetLastError === 'function') {
                        const errCode = api.ref.GetLastError();
                        if (errCode && errCode !== '0') {
                            result.lastError = errCode;
                            if (typeof api.ref.GetErrorString === 'function') {
                                result.errorString = api.ref.GetErrorString(errCode);
                            }
                        }
                    }

                } else if (api.type === LMS_STANDARD.XAPI) {
                    // xAPI: send a completion statement
                    const sendFn = api.ref.sendStatement || api.ref.saveStatement;
                    if (typeof sendFn !== 'function') {
                        throw new Error('No xAPI send function available');
                    }

                    const verbMap = {
                        completed: { id: 'http://adlnet.gov/expapi/verbs/completed', display: 'completed' },
                        passed: { id: 'http://adlnet.gov/expapi/verbs/passed', display: 'passed' },
                        failed: { id: 'http://adlnet.gov/expapi/verbs/failed', display: 'failed' }
                    };
                    const verb = verbMap[status] || verbMap.completed;

                    const statement = {
                        verb: {
                            id: verb.id,
                            display: { 'en-US': verb.display }
                        },
                        object: {
                            id: window.location.href,
                            definition: {
                                name: { 'en-US': document.title || 'Course' },
                                type: 'http://adlnet.gov/expapi/activities/course'
                            },
                            objectType: 'Activity'
                        },
                        result: {
                            completion: status === 'completed' || status === 'passed',
                            success: status === 'passed',
                            score: { scaled: score / 100, raw: score, min: 0, max: 100 }
                        }
                    };

                    const sendResult = sendFn.call(api.ref, statement);
                    result.operations.push({
                        method: `${api.ref.sendStatement ? 'sendStatement' : 'saveStatement'}`,
                        result: sendResult ? 'Sent' : 'Sent (no confirmation)'
                    });
                    result.statement = statement;

                } else if (api.type === LMS_STANDARD.AICC) {
                    // AICC: send PutParam with completion data
                    const aiccSid = api.ref.aicc_sid;
                    const aiccUrl = api.ref.aicc_url;

                    const lessonStatus = status === 'passed' ? 'p' :
                                        status === 'completed' ? 'c' :
                                        status === 'failed' ? 'f' : 'i';

                    const aiccData = [
                        '[core]',
                        `lesson_status=${lessonStatus}`,
                        `score=${score}`,
                        '[core_lesson]'
                    ].join('\r\n');

                    const putResult = await this.aiccRequest(aiccUrl, aiccSid, 'PutParam',
                        `aicc_data=${encodeURIComponent(aiccData)}`);
                    result.operations.push({
                        method: 'PutParam(completion)',
                        result: putResult ? 'Sent' : 'Failed'
                    });

                    // Send ExitAU to close the session
                    const exitResult = await this.aiccRequest(aiccUrl, aiccSid, 'ExitAU');
                    result.operations.push({
                        method: 'ExitAU',
                        result: exitResult ? 'Sent' : 'Failed'
                    });

                } else if (api.type === LMS_STANDARD.CMI5) {
                    // CMI5: send xAPI statements with cmi5 profile
                    const authToken = api.ref._authToken;
                    if (!authToken) {
                        throw new Error('No auth token available. Run test first to obtain token.');
                    }

                    const verbMap = {
                        completed: 'http://adlnet.gov/expapi/verbs/completed',
                        passed: 'http://adlnet.gov/expapi/verbs/passed',
                        failed: 'http://adlnet.gov/expapi/verbs/failed'
                    };
                    const verbId = verbMap[status] || verbMap.completed;

                    const actor = Utils.safeJsonParse(decodeURIComponent(api.ref.actor));
                    const statement = {
                        actor: actor,
                        verb: { id: verbId, display: { 'en-US': status } },
                        object: {
                            id: api.ref.activityId,
                            objectType: 'Activity'
                        },
                        result: {
                            completion: status === 'completed' || status === 'passed',
                            success: status === 'passed',
                            score: { scaled: score / 100 },
                            duration: 'PT0S'
                        },
                        context: {
                            registration: api.ref.registration,
                            contextActivities: {
                                category: [{ id: 'https://w3id.org/xapi/cmi5/context/categories/cmi5' }]
                            }
                        }
                    };

                    const endpoint = api.ref.endpoint.replace(/\/$/, '');
                    const stmtResponse = await fetch(`${endpoint}/statements`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${authToken}`,
                            'Content-Type': 'application/json',
                            'X-Experience-API-Version': '1.0.3'
                        },
                        body: JSON.stringify(statement)
                    });
                    result.operations.push({
                        method: 'POST /statements',
                        result: stmtResponse.ok ? `${stmtResponse.status} OK` : `${stmtResponse.status} Error`
                    });
                    result.statement = statement;

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

        async getCmiData() {
            const apis = StateManager.get('apis');
            if (apis.length === 0) {
                return { error: 'No API found' };
            }

            const api = apis[0];
            const data = {};

            if (api.type === LMS_STANDARD.AICC) {
                // AICC: use GetParam HACP command
                try {
                    const response = await this.aiccRequest(api.ref.aicc_url, api.ref.aicc_sid, 'GetParam');
                    return this.parseAiccResponse(response);
                } catch (e) {
                    return { error: 'AICC GetParam failed: ' + e.message };
                }
            }

            if (api.type === LMS_STANDARD.XAPI || api.type === LMS_STANDARD.CMI5) {
                return { note: `${api.type} does not use CMI data model. Use LRS queries instead.` };
            }

            const elements = api.type === LMS_STANDARD.SCORM_12 ? [
                'cmi.core.student_id', 'cmi.core.student_name', 'cmi.core.lesson_status',
                'cmi.core.score.raw', 'cmi.core.score.min', 'cmi.core.score.max',
                'cmi.core.total_time', 'cmi.core.lesson_location', 'cmi.core.entry',
                'cmi.core.credit', 'cmi.core.lesson_mode',
                'cmi.suspend_data', 'cmi.launch_data',
                'cmi.student_data.mastery_score'
            ] : [
                'cmi.learner_id', 'cmi.learner_name', 'cmi.completion_status',
                'cmi.success_status', 'cmi.score.scaled', 'cmi.score.raw',
                'cmi.score.min', 'cmi.score.max',
                'cmi.total_time', 'cmi.location', 'cmi.entry',
                'cmi.credit', 'cmi.mode', 'cmi.progress_measure',
                'cmi.scaled_passing_score',
                'cmi.suspend_data'
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
    // SECTION 8: STORYLINE EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    const StorylineExtractor = {
        findBaseUrl() {
            const iframes = document.querySelectorAll('iframe');
            
            for (const iframe of iframes) {
                try {
                    const src = iframe.src || '';
                    if (src.includes('/story_html5.html') || src.includes('/story.html')) {
                        const match = src.match(/(.+?)\/(?:story_html5|story)\.html/);
                        if (match) return match[1];
                    }
                } catch (e) { /* Cross-origin */ }
            }

            const currentPath = window.location.pathname;
            if (currentPath.includes('/story_html5.html') || currentPath.includes('/story.html')) {
                return window.location.href.replace(/\/(?:story_html5|story)\.html.*$/, '');
            }

            if (typeof window.globalProvideData === 'function') {
                return window.location.href.replace(/\/[^/]*$/, '');
            }

            return null;
        },

        async extract() {
            Logger.info('Extracting Storyline content...');
            
            const baseUrl = this.findBaseUrl();
            if (!baseUrl) {
                Logger.debug('No Storyline course detected');
                return [];
            }

            Logger.info(`Found Storyline at: ${baseUrl}`);

            try {
                const courseData = await this.fetchCourseData(baseUrl);
                if (!courseData) return [];

                const slideIds = this.extractSlideIds(courseData);
                Logger.info(`Found ${slideIds.length} slides to analyze`);

                const items = [];
                for (const slideId of slideIds) {
                    const slideItems = await this.fetchSlideContent(baseUrl, slideId);
                    items.push(...slideItems);
                }

                return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
            } catch (error) {
                Logger.error('Storyline extraction failed', { error: error.message });
                return [];
            }
        },

        async fetchCourseData(baseUrl) {
            try {
                const response = await Utils.fetchWithTimeout(`${baseUrl}/html5/data/js/data.js`);
                if (!response.ok) return null;

                const text = await response.text();
                const match = text.match(/globalProvideData\s*\(\s*'data'\s*,\s*'(.+)'\s*\)/);
                if (!match) return null;

                const json = this.unescapeJson(match[1]);
                return Utils.safeJsonParse(json);
            } catch (e) {
                return null;
            }
        },

        unescapeJson(str) {
            return str
                .replace(/\\'/g, "'")
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\\\/g, '\\');
        },

        extractSlideIds(courseData) {
            const ids = new Set();

            courseData.quizzes?.forEach(quiz => {
                quiz.questions?.forEach(q => {
                    if (q.slideId) ids.add(q.slideId);
                });
            });

            courseData.scenes?.forEach(scene => {
                scene.slides?.forEach(slide => {
                    if (slide.id) ids.add(slide.id);
                });
            });

            return Array.from(ids);
        },

        async fetchSlideContent(baseUrl, slideId) {
            try {
                const response = await Utils.fetchWithTimeout(`${baseUrl}/html5/data/js/${slideId}.js`);
                if (!response.ok) return [];

                const text = await response.text();
                return this.parseSlideContent(text, slideId);
            } catch (e) {
                return [];
            }
        },

        parseSlideContent(text, slideId) {
            const items = [];
            
            const match = text.match(/globalProvideData\s*\(\s*'slide'\s*,\s*'(.+)'\s*\)/);
            if (!match) return items;

            const json = this.unescapeJson(match[1]);
            const slideData = Utils.safeJsonParse(json);
            if (!slideData) return items;

            this.extractFromObject(slideData, slideId, items);

            return items;
        },

        extractFromObject(obj, source, items, depth = 0) {
            if (!obj || depth > CONFIG.MAX_RECURSION_DEPTH) return;

            if (typeof obj === 'object' && !Array.isArray(obj)) {
                if (obj.caption || obj.altText || obj.text) {
                    const text = obj.caption || obj.altText || obj.text;
                    // Ensure it's natural language content, not code
                    if (typeof text === 'string' && text.length > 10 && !Utils.isCodeLike(text)) {
                        const isQuestion = text.includes('?') || obj.accType === 'checkbox' || obj.accType === 'radiobutton';
                        items.push({
                            type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                            text: text.trim(),
                            source: `Storyline:${source}`,
                            confidence: CONFIDENCE.HIGH
                        });
                    }
                }

                if (obj.states && Array.isArray(obj.states)) {
                    const hasReview = obj.states.some(s => 
                        typeof s === 'string' && s.includes('_Review') && !s.includes('Incorrect')
                    );
                    if (hasReview && (obj.caption || obj.altText)) {
                        const lastItem = items[items.length - 1];
                        if (lastItem) {
                            lastItem.correct = true;
                            lastItem.confidence = CONFIDENCE.VERY_HIGH;
                        }
                    }
                }
            }

            if (Array.isArray(obj)) {
                obj.forEach(item => this.extractFromObject(item, source, items, depth + 1));
            } else if (typeof obj === 'object') {
                Object.values(obj).forEach(value => {
                    if (value && typeof value === 'object') {
                        this.extractFromObject(value, source, items, depth + 1);
                    }
                });
            }
        }
    };

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
                this.reportProgress(1, 5, 'Discovering APIs...');
                SCORMAPI.discover();

                this.reportProgress(2, 5, 'Checking for Storyline data files...');
                const storylineItems = await StorylineExtractor.extract();

                this.reportProgress(3, 5, 'Extracting Storyline accessibility DOM...');
                const storylineDOMItems = StorylineDOMExtractor.extract();

                this.reportProgress(4, 5, 'Scanning DOM for quizzes...');
                const domQuizzes = DOMQuizExtractor.extract();
                const domItems = DOMQuizExtractor.toQAItems(domQuizzes);

                this.reportProgress(5, 5, 'Analyzing resources...');
                ResourceDiscovery.discover();
                const resourceItems = await ResourceDiscovery.analyze();

                const allItems = Utils.dedupeBy(
                    [...storylineItems, ...storylineDOMItems, ...domItems, ...resourceItems],
                    item => `${item.type}:${item.text.substring(0, 50)}`
                );

                StateManager.set('qa', allItems);
                StateManager.set('scanning', false);
                StateManager.set('lastScan', Date.now());

                const scanTime = endTimer();
                const report = Reporter.generate();
                report.scanTime = scanTime;

                Logger.info('Scan complete', {
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

            const questions = qa.filter(item => item.type === ITEM_TYPE.QUESTION);
            const answers = qa.filter(item => item.type === ITEM_TYPE.ANSWER);
            const correct = answers.filter(item => item.correct);

            return {
                version: VERSION,
                url: window.location.href,
                timestamp: new Date().toISOString(),
                apis: apis.map(api => ({
                    type: api.type,
                    location: api.location,
                    methods: api.methods,
                    functional: api.functional
                })),
                qa: {
                    total: qa.length,
                    questions: questions.length,
                    answers: answers.length,
                    correct: correct.length,
                    items: qa
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
        getCmiData: () => SCORMAPI.getCmiData(),
        
        getDOMQuizzes: () => DOMQuizExtractor.extract(),
        autoSelect: () => DOMQuizExtractor.autoSelect(),

        getStorylineDOM: () => StorylineDOMExtractor.extract(),
        isStorylinePage: () => StorylineDOMExtractor.isStorylinePage(),

        export: (format) => Exporter.export(format),
        getReport: () => Reporter.generate(),

        discoverAPIs: () => SCORMAPI.discover(),
        discoverResources: () => ResourceDiscovery.discover()
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 14: INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    Messenger.init();
    Messenger.send(MSG.READY, { version: VERSION, url: window.location.href });
    Logger.info(`LMS QA Validator v${VERSION} initialized`);

})();
