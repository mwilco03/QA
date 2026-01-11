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

    const VERSION = '3.5.0';

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
                    // Search for API objects
                    const apis = this.searchObject(obj, name, 0);
                    found.push(...apis);

                    // Search for standalone completion functions
                    const standaloneFns = this.searchStandaloneFunctions(obj, name);
                    found.push(...standaloneFns);
                } catch (e) { /* Cross-origin */ }
            }

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
            // Method 1: Check iframe sources for story_html5.html or story.html
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const src = iframe.src || '';
                    if (src.includes('/story_html5.html') || src.includes('/story.html')) {
                        const match = src.match(/(.+?)\/(?:story_html5|story)\.html/);
                        if (match) return match[1];
                    }
                    // Also check for /html5/data/ pattern in iframe
                    if (src.includes('/html5/') || src.includes('/data/js/')) {
                        const match = src.match(/(.+?)\/html5\//);
                        if (match) return match[1];
                    }
                } catch (e) { /* Cross-origin */ }
            }

            // Method 2: Current URL contains story patterns
            const currentUrl = window.location.href;
            const currentPath = window.location.pathname;

            if (currentPath.includes('/story_html5.html') || currentPath.includes('/story.html')) {
                return currentUrl.replace(/\/(?:story_html5|story)\.html.*$/, '');
            }

            // Method 3: Check if we're in Storyline iframe (has globalProvideData or DS)
            if (typeof window.globalProvideData === 'function' || window.DS) {
                // Find base from current URL - strip to parent of html5 folder
                const html5Match = currentUrl.match(/(.+?)\/html5\//);
                if (html5Match) return html5Match[1];

                // Or strip the last path segment
                return currentUrl.replace(/\/[^/]*$/, '');
            }

            // Method 4: Look for loaded Storyline scripts in performance entries
            if (performance.getEntriesByType) {
                const entries = performance.getEntriesByType('resource');
                for (const entry of entries) {
                    if (entry.name.includes('/html5/data/js/') || entry.name.includes('globalProvideData')) {
                        const match = entry.name.match(/(.+?)\/html5\//);
                        if (match) return match[1];
                    }
                }
            }

            // Method 5: Check for Storyline markers in DOM
            if (document.querySelector('.slide-object') || document.querySelector('.acc-shadow-dom')) {
                // We're in Storyline content, use current URL as base
                const html5Match = currentUrl.match(/(.+?)\/html5\//);
                if (html5Match) return html5Match[1];
                return currentUrl.replace(/\/[^/]*(\?.*)?$/, '');
            }

            return null;
        },

        async extract() {
            Logger.info('Extracting Storyline content...');

            // First, try to extract from already-loaded scripts
            const loadedItems = this.extractFromLoadedScripts();
            if (loadedItems.length > 0) {
                Logger.info(`Found ${loadedItems.length} items from loaded scripts`);
            }

            const baseUrl = this.findBaseUrl();
            if (!baseUrl) {
                Logger.debug('No Storyline base URL detected');
                return loadedItems;
            }

            Logger.info(`Found Storyline at: ${baseUrl}`);

            try {
                // Try to fetch course data
                const courseData = await this.fetchCourseData(baseUrl);

                let slideIds = [];
                if (courseData) {
                    slideIds = this.extractSlideIds(courseData);
                    Logger.info(`Found ${slideIds.length} slides from data.js`);
                } else {
                    // Fallback: find slide IDs from loaded scripts
                    slideIds = this.findSlideIdsFromScripts();
                    Logger.info(`Found ${slideIds.length} slides from loaded scripts`);
                }

                const items = [...loadedItems];
                for (const slideId of slideIds) {
                    const slideItems = await this.fetchSlideContent(baseUrl, slideId);
                    items.push(...slideItems);
                }

                return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
            } catch (error) {
                Logger.error('Storyline extraction failed', { error: error.message });
                return loadedItems;
            }
        },

        /**
         * Extract Q&A from scripts already loaded in the page
         */
        extractFromLoadedScripts() {
            const items = [];

            // Check all script elements for globalProvideData
            document.querySelectorAll('script').forEach(script => {
                if (script.textContent?.includes('globalProvideData')) {
                    const slideItems = this.parseSlideContent(script.textContent, 'inline');
                    items.push(...slideItems);
                }
            });

            // Also check window.DS for pre-parsed data
            if (window.DS?.VO) {
                try {
                    for (const [id, obj] of Object.entries(window.DS.VO)) {
                        if (obj.caption || obj.altText || obj.text) {
                            const text = obj.caption || obj.altText || obj.text;
                            if (text.length > 15 && !Utils.isCodeLike(text)) {
                                const isQuestion = text.includes('?') || text.toLowerCase().startsWith('select');
                                items.push({
                                    type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                                    text: text.trim(),
                                    source: `Storyline:DS.VO.${id}`,
                                    confidence: CONFIDENCE.HIGH
                                });
                            }
                        }
                    }
                } catch (e) { /* Access error */ }
            }

            return items;
        },

        /**
         * Find slide IDs from already-loaded script resources
         */
        findSlideIdsFromScripts() {
            const ids = new Set();

            if (performance.getEntriesByType) {
                const entries = performance.getEntriesByType('resource');
                for (const entry of entries) {
                    // Match patterns like /html5/data/js/5g5maGnO7R8.js
                    const match = entry.name.match(/\/html5\/data\/js\/([a-zA-Z0-9_-]+)\.js/);
                    if (match && match[1] !== 'data' && match[1] !== 'frame' && match[1] !== 'paths') {
                        ids.add(match[1]);
                    }
                }
            }

            return Array.from(ids);
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

            // First pass: Look for structured question data (question + choices together)
            this.extractStructuredQuestions(slideData, slideId, items);

            // Second pass: Extract individual items from objects
            this.extractFromObject(slideData, slideId, items);

            // Remove duplicates and associate questions with their answers
            return this.associateQuestionsAndAnswers(items);
        },

        /**
         * Look for structured question patterns in Storyline data
         */
        extractStructuredQuestions(data, source, items) {
            if (!data || typeof data !== 'object') return;

            // Look for question bank / quiz structures
            if (data.questionBanks || data.questions || data.quiz) {
                const questions = data.questionBanks || data.questions || data.quiz?.questions;
                if (Array.isArray(questions)) {
                    questions.forEach(q => this.extractQuestionObject(q, source, items));
                }
            }

            // Look for objects with both question text and choices/answers
            if (data.objects && Array.isArray(data.objects)) {
                // Group objects - look for question text followed by answer choices
                const textObjects = [];
                const choiceObjects = [];

                data.objects.forEach(obj => {
                    if (obj.accType === 'checkbox' || obj.accType === 'radiobutton') {
                        choiceObjects.push(obj);
                    } else if (obj.accType === 'text' || !obj.accType) {
                        textObjects.push(obj);
                    }
                });

                // If we have choices but no question identified, look for the question in text objects
                if (choiceObjects.length > 0 && textObjects.length > 0) {
                    // Find the longest text object that looks like a question
                    const questionText = textObjects
                        .filter(o => o.caption || o.altText || o.text)
                        .map(o => o.caption || o.altText || o.text)
                        .filter(t => typeof t === 'string' && t.length > 20)
                        .sort((a, b) => b.length - a.length)[0];

                    if (questionText && !items.some(i => i.text === questionText.trim())) {
                        items.push({
                            type: ITEM_TYPE.QUESTION,
                            text: questionText.trim(),
                            source: `Storyline:${source}`,
                            confidence: CONFIDENCE.HIGH
                        });
                    }
                }
            }

            // Recurse into nested structures
            Object.values(data).forEach(value => {
                if (value && typeof value === 'object') {
                    this.extractStructuredQuestions(value, source, items);
                }
            });
        },

        /**
         * Extract a structured question object with its choices
         */
        extractQuestionObject(q, source, items) {
            if (!q) return;

            // Extract question text
            const questionText = q.questionText || q.question || q.text || q.caption;
            if (questionText && typeof questionText === 'string' && questionText.length > 10) {
                items.push({
                    type: ITEM_TYPE.QUESTION,
                    text: questionText.trim(),
                    source: `Storyline:${source}`,
                    confidence: CONFIDENCE.VERY_HIGH
                });
            }

            // Extract choices/answers
            const choices = q.choices || q.answers || q.options;
            if (Array.isArray(choices)) {
                choices.forEach(choice => {
                    const choiceText = choice.text || choice.caption || choice;
                    if (typeof choiceText === 'string' && choiceText.length > 0) {
                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: choiceText.trim(),
                            source: `Storyline:${source}`,
                            confidence: CONFIDENCE.VERY_HIGH,
                            correct: choice.correct || choice.isCorrect || false
                        });
                    }
                });
            }
        },

        /**
         * Associate questions with their answers based on order
         */
        associateQuestionsAndAnswers(items) {
            // Dedupe by text
            const seen = new Set();
            const unique = items.filter(item => {
                const key = `${item.type}:${item.text}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            return unique;
        },

        extractFromObject(obj, source, items, depth = 0) {
            if (!obj || depth > CONFIG.MAX_RECURSION_DEPTH) return;

            if (typeof obj === 'object' && !Array.isArray(obj)) {
                const text = obj.caption || obj.altText || obj.text;

                // Ensure it's natural language content, not code
                if (typeof text === 'string' && text.length > 10 && !Utils.isCodeLike(text)) {
                    // Determine type based on multiple signals
                    let itemType = ITEM_TYPE.ANSWER;

                    // Radio buttons and checkboxes are ANSWERS (selectable options)
                    if (obj.accType === 'checkbox' || obj.accType === 'radiobutton') {
                        itemType = ITEM_TYPE.ANSWER;
                    }
                    // Text with question indicators is a QUESTION
                    else if (this.isQuestionText(text)) {
                        itemType = ITEM_TYPE.QUESTION;
                    }
                    // Static text elements without interaction type might be questions
                    else if (obj.accType === 'text' || !obj.accType) {
                        if (text.length > 30 || this.hasQuestionPatterns(text)) {
                            itemType = ITEM_TYPE.QUESTION;
                        }
                    }

                    items.push({
                        type: itemType,
                        text: text.trim(),
                        source: `Storyline:${source}`,
                        confidence: CONFIDENCE.HIGH
                    });
                }

                // Check for correct answer indicators in states
                if (obj.states && Array.isArray(obj.states)) {
                    const hasCorrectReview = obj.states.some(s =>
                        typeof s === 'string' &&
                        (s.includes('_Review') && !s.includes('Incorrect') ||
                         s.includes('Correct') || s.includes('Selected'))
                    );
                    if (hasCorrectReview && (obj.caption || obj.altText)) {
                        const lastItem = items[items.length - 1];
                        if (lastItem && lastItem.type === ITEM_TYPE.ANSWER) {
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
        },

        /**
         * Check if text looks like a question
         */
        isQuestionText(text) {
            const lower = text.toLowerCase();
            return (
                text.includes('?') ||
                lower.startsWith('select ') ||
                lower.startsWith('choose ') ||
                lower.startsWith('which ') ||
                lower.startsWith('what ') ||
                lower.startsWith('how ') ||
                lower.startsWith('why ') ||
                lower.startsWith('when ') ||
                lower.startsWith('where ') ||
                lower.startsWith('who ') ||
                lower.startsWith('identify ') ||
                lower.startsWith('determine ') ||
                /^(true|false)[:\s]/i.test(text) === false && lower.includes('true or false')
            );
        },

        /**
         * Check for question-like patterns
         */
        hasQuestionPatterns(text) {
            const lower = text.toLowerCase();
            return (
                lower.includes('following') && (lower.includes('which') || lower.includes('select')) ||
                lower.includes('best describes') ||
                lower.includes('correct answer') ||
                lower.includes('applies to') ||
                /^\d+\.\s/.test(text) // Numbered question
            );
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

        // Seed-based extraction - pass a question text to find all related Q&A
        seedExtract: (seedText) => SeedExtractor.extractFromSeed(seedText),
        clearSeedCache: () => SeedExtractor.clearCache(),

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
