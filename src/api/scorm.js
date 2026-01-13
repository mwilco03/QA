/**
 * SCORM/xAPI API Detection and Completion Module
 *
 * Handles:
 * - SCORM 1.2 and SCORM 2004 API detection
 * - xAPI/TinCan API detection
 * - AICC detection
 * - Custom completion functions
 * - Course completion operations
 */

import { CONFIG, LMS_STANDARD, MSG } from '../core/constants.js';
import { StateManager } from '../core/state.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';
import { Messenger } from '../messenger.js';

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

                // Convert sessionTime (seconds) to appropriate format for each standard
                const timeSeconds = sessionTime || 300; // Default 5 minutes

                switch (api.type) {
                    case LMS_STANDARD.SCORM_12:
                        apiResult = this._completeSCORM12(api.ref, {
                            ...completionOpts,
                            sessionTime: this._formatSCORM12Time(timeSeconds)
                        });
                        break;

                    case LMS_STANDARD.SCORM_2004:
                        apiResult = this._completeSCORM2004(api.ref, {
                            ...completionOpts,
                            sessionTime: this._formatISO8601Duration(timeSeconds)
                        });
                        break;

                    case LMS_STANDARD.XAPI:
                        apiResult = await this._completeXAPI(api.ref, {
                            status, score, minScore, maxScore,
                            sessionTime: this._formatISO8601Duration(timeSeconds)
                        });
                        break;

                    case LMS_STANDARD.AICC: {
                        // AICC uses HH:MM:SS format
                        const hrs = String(Math.floor(timeSeconds / 3600)).padStart(2, '0');
                        const mins = String(Math.floor((timeSeconds % 3600) / 60)).padStart(2, '0');
                        const secs = String(timeSeconds % 60).padStart(2, '0');
                        apiResult = await this._completeAICC(api.ref, {
                            status, score,
                            sessionTime: `${hrs}:${mins}:${secs}`
                        });
                        break;
                    }

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
    // OBJECTIVES & SLIDES COMPLETION
    // Ensures all SCORM objectives are met and all slides are marked as viewed
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Complete all SCORM objectives
     * SCORM uses parent-child relationship: cmi.objectives._count tells how many exist
     * Each objective has: id, status/completion_status, success_status, score.*
     * @param {Object} options - Completion options
     * @returns {Object} Result with objectives completed
     */
    async completeAllObjectives(options = {}) {
        const {
            apiIndex = 0,
            status = 'passed',
            score = 100,
            commit = true
        } = options;

        const result = {
            success: false,
            objectivesFound: 0,
            objectivesCompleted: 0,
            operations: [],
            errors: [],
            warnings: []
        };

        let apis = StateManager.get('apis');
        if (!apis || apis.length === 0) {
            this.discover();
            apis = StateManager.get('apis');
        }

        const api = apis?.[apiIndex];
        if (!api) {
            result.errors.push('No SCORM API available');
            return result;
        }

        Logger.info('Completing all objectives', { apiType: api.type });

        try {
            if (api.type === LMS_STANDARD.SCORM_12) {
                result.objectivesFound = this._completeObjectivesSCORM12(api.ref, result, { status, score });
            } else if (api.type === LMS_STANDARD.SCORM_2004) {
                result.objectivesFound = this._completeObjectivesSCORM2004(api.ref, result, { status, score });
            } else {
                result.warnings.push(`Objectives not supported for API type: ${api.type}`);
            }

            // Commit changes
            if (commit && result.objectivesCompleted > 0) {
                const commitMethod = api.type === LMS_STANDARD.SCORM_12 ? 'LMSCommit' : 'Commit';
                try {
                    const commitResult = api.ref[commitMethod]('');
                    result.operations.push({
                        method: commitMethod,
                        success: commitResult === 'true' || commitResult === true
                    });
                } catch (e) {
                    result.errors.push(`Commit failed: ${e.message}`);
                }
            }

            result.success = result.errors.length === 0;
        } catch (e) {
            result.errors.push(`Objectives completion failed: ${e.message}`);
        }

        Logger.info('Objectives completion finished', result);
        Messenger.send(MSG.OBJECTIVES_COMPLETE, result);
        return result;
    },

    /**
     * Complete objectives for SCORM 1.2
     */
    _completeObjectivesSCORM12(api, result, options) {
        const { status, score } = options;

        // Get objective count - this is read-only in SCORM
        let objectiveCount = 0;
        try {
            const countStr = api.LMSGetValue('cmi.objectives._count');
            objectiveCount = parseInt(countStr, 10) || 0;
            result.operations.push({
                method: 'LMSGetValue(cmi.objectives._count)',
                result: countStr,
                parsed: objectiveCount
            });
        } catch (e) {
            result.warnings.push('Could not read objectives count');
        }

        // If no objectives defined, try to create at least one
        if (objectiveCount === 0) {
            result.warnings.push('No objectives found - attempting to create default objective');
            // Try setting objective 0 directly (some LMS allow this)
            try {
                const setResult = api.LMSSetValue('cmi.objectives.0.id', 'OBJ_MAIN');
                if (setResult === 'true' || setResult === true) {
                    objectiveCount = 1;
                    result.operations.push({
                        method: 'LMSSetValue(cmi.objectives.0.id)',
                        result: setResult,
                        note: 'Created default objective'
                    });
                }
            } catch (e) {
                result.warnings.push('Could not create default objective');
            }
        }

        // Complete each objective
        const scormStatus = status === 'passed' ? 'passed' :
                           status === 'failed' ? 'failed' : 'completed';

        for (let i = 0; i < objectiveCount; i++) {
            const prefix = `cmi.objectives.${i}`;

            // Read existing objective ID
            let objId = null;
            try {
                objId = api.LMSGetValue(`${prefix}.id`);
            } catch (e) {}

            const objOps = [
                [`${prefix}.status`, scormStatus],
                [`${prefix}.score.raw`, String(score)],
                [`${prefix}.score.min`, '0'],
                [`${prefix}.score.max`, '100']
            ];

            let objSuccess = true;
            for (const [element, value] of objOps) {
                try {
                    const setResult = api.LMSSetValue(element, value);
                    const success = setResult === 'true' || setResult === true;
                    result.operations.push({
                        method: `LMSSetValue('${element}')`,
                        value,
                        success,
                        objectiveId: objId
                    });
                    if (!success) objSuccess = false;
                } catch (e) {
                    result.operations.push({
                        method: `LMSSetValue('${element}')`,
                        success: false,
                        error: e.message
                    });
                    objSuccess = false;
                }
            }

            if (objSuccess) result.objectivesCompleted++;
        }

        return objectiveCount;
    },

    /**
     * Complete objectives for SCORM 2004
     */
    _completeObjectivesSCORM2004(api, result, options) {
        const { status, score } = options;

        // Get objective count
        let objectiveCount = 0;
        try {
            const countStr = api.GetValue('cmi.objectives._count');
            objectiveCount = parseInt(countStr, 10) || 0;
            result.operations.push({
                method: 'GetValue(cmi.objectives._count)',
                result: countStr,
                parsed: objectiveCount
            });
        } catch (e) {
            result.warnings.push('Could not read objectives count');
        }

        // If no objectives defined, try to create one
        if (objectiveCount === 0) {
            result.warnings.push('No objectives found - attempting to create default objective');
            try {
                const setResult = api.SetValue('cmi.objectives.0.id', 'OBJ_MAIN');
                if (setResult === 'true' || setResult === true) {
                    objectiveCount = 1;
                    result.operations.push({
                        method: 'SetValue(cmi.objectives.0.id)',
                        result: setResult,
                        note: 'Created default objective'
                    });
                }
            } catch (e) {
                result.warnings.push('Could not create default objective');
            }
        }

        // SCORM 2004 status mapping
        const completionStatus = 'completed';
        const successStatus = status === 'passed' ? 'passed' :
                             status === 'failed' ? 'failed' : 'unknown';
        const scaledScore = score / 100;

        for (let i = 0; i < objectiveCount; i++) {
            const prefix = `cmi.objectives.${i}`;

            // Read existing objective ID
            let objId = null;
            try {
                objId = api.GetValue(`${prefix}.id`);
            } catch (e) {}

            const objOps = [
                [`${prefix}.completion_status`, completionStatus],
                [`${prefix}.success_status`, successStatus],
                [`${prefix}.progress_measure`, '1.0'],
                [`${prefix}.score.scaled`, String(scaledScore.toFixed(2))],
                [`${prefix}.score.raw`, String(score)],
                [`${prefix}.score.min`, '0'],
                [`${prefix}.score.max`, '100']
            ];

            let objSuccess = true;
            for (const [element, value] of objOps) {
                try {
                    const setResult = api.SetValue(element, value);
                    const success = setResult === 'true' || setResult === true;
                    result.operations.push({
                        method: `SetValue('${element}')`,
                        value,
                        success,
                        objectiveId: objId
                    });
                    if (!success) objSuccess = false;
                } catch (e) {
                    result.operations.push({
                        method: `SetValue('${element}')`,
                        success: false,
                        error: e.message
                    });
                    objSuccess = false;
                }
            }

            if (objSuccess) result.objectivesCompleted++;
        }

        return objectiveCount;
    },

    /**
     * Mark all slides as viewed
     * Different authoring tools store slide state differently in suspend_data
     * @param {Object} options - Options including apiIndex and tool type
     * @returns {Object} Result with slides marked
     */
    async markAllSlidesViewed(options = {}) {
        const {
            apiIndex = 0,
            tool = null,  // Auto-detect if not provided
            commit = true,
            setLocation = true
        } = options;

        const result = {
            success: false,
            tool: tool,
            slidesFound: 0,
            slidesMarked: 0,
            suspendDataModified: false,
            locationSet: false,
            operations: [],
            errors: [],
            warnings: []
        };

        let apis = StateManager.get('apis');
        if (!apis || apis.length === 0) {
            this.discover();
            apis = StateManager.get('apis');
        }

        const api = apis?.[apiIndex];
        if (!api) {
            result.errors.push('No SCORM API available');
            return result;
        }

        // Auto-detect tool if not specified
        const detectedTool = tool || this._detectAuthoringTool();
        result.tool = detectedTool;

        Logger.info('Marking all slides as viewed', { apiType: api.type, tool: detectedTool });

        try {
            // Get current suspend_data
            const suspendData = this._getSuspendData(api);
            result.operations.push({
                method: 'GetSuspendData',
                dataLength: suspendData?.length || 0,
                hasData: !!suspendData
            });

            // Process based on authoring tool
            let newSuspendData = suspendData;
            let slideInfo = { found: 0, marked: 0 };

            switch (detectedTool) {
                case 'storyline':
                    ({ data: newSuspendData, ...slideInfo } = await this._markStorylineSlides(suspendData));
                    // Also set Storyline variables
                    this._setStorylineSlideVariables();
                    break;

                case 'rise':
                    ({ data: newSuspendData, ...slideInfo } = await this._markRiseBlocks(suspendData));
                    break;

                case 'captivate':
                    ({ data: newSuspendData, ...slideInfo } = this._markCaptivateSlides(suspendData));
                    break;

                case 'lectora':
                    ({ data: newSuspendData, ...slideInfo } = this._markLectoraPages(suspendData));
                    break;

                case 'ispring':
                    ({ data: newSuspendData, ...slideInfo } = this._markISpringSlides(suspendData));
                    break;

                default:
                    // Generic approach - try common patterns
                    ({ data: newSuspendData, ...slideInfo } = this._markGenericSlides(suspendData));
                    result.warnings.push(`Unknown tool - using generic slide marking`);
            }

            result.slidesFound = slideInfo.found;
            result.slidesMarked = slideInfo.marked;

            // Update suspend_data if changed
            if (newSuspendData !== suspendData) {
                const setResult = this._setSuspendData(api, newSuspendData);
                result.suspendDataModified = setResult.success;
                result.operations.push({
                    method: 'SetSuspendData',
                    success: setResult.success,
                    newLength: newSuspendData?.length || 0,
                    error: setResult.error
                });
            }

            // Set lesson_location to final slide
            if (setLocation && slideInfo.lastSlideId) {
                const locResult = this._setLocation(api, slideInfo.lastSlideId);
                result.locationSet = locResult.success;
                result.operations.push({
                    method: 'SetLocation',
                    value: slideInfo.lastSlideId,
                    success: locResult.success
                });
            }

            // Commit changes
            if (commit) {
                const commitMethod = api.type === LMS_STANDARD.SCORM_12 ? 'LMSCommit' : 'Commit';
                try {
                    const commitResult = api.ref[commitMethod]('');
                    result.operations.push({
                        method: commitMethod,
                        success: commitResult === 'true' || commitResult === true
                    });
                } catch (e) {
                    result.errors.push(`Commit failed: ${e.message}`);
                }
            }

            result.success = result.errors.length === 0;
        } catch (e) {
            result.errors.push(`Slide marking failed: ${e.message}`);
        }

        Logger.info('Slide marking finished', result);
        Messenger.send(MSG.SLIDES_MARKED, result);
        return result;
    },

    /**
     * Detect the authoring tool from page signatures
     */
    _detectAuthoringTool() {
        // Storyline
        if (window.DS || window.g_slideData || window.JSON_PLAYER ||
            document.querySelector('#slide-window, .slide-container')) {
            return 'storyline';
        }
        // Rise 360
        if (document.querySelector('[data-ba-component]') ||
            document.querySelector('.blocks-container') ||
            window.__RISE_COURSE_DATA__) {
            return 'rise';
        }
        // Captivate
        if (window.cp || window.cpAPIInterface ||
            document.querySelector('[class*="cp-"], #cpMainContainer')) {
            return 'captivate';
        }
        // Lectora
        if (window.trivantis || window.TrivantisCore ||
            document.querySelector('[class*="lectora"]')) {
            return 'lectora';
        }
        // iSpring
        if (window.iSpring || window.PresentationSettings ||
            document.querySelector('[class*="ispring"]')) {
            return 'ispring';
        }
        return 'generic';
    },

    /**
     * Estimate realistic course duration based on content analysis
     * Returns time in seconds with randomization for natural appearance
     * @param {Object} options - Estimation options
     * @returns {Object} { estimatedSeconds, randomizedSeconds, slideCount, confidence, breakdown }
     */
    estimateCourseDuration(options = {}) {
        const {
            variancePercent = 15,  // +/- variance for randomization
            minSeconds = 180,      // Minimum 3 minutes
            maxSeconds = 7200      // Maximum 2 hours
        } = options;

        const result = {
            estimatedSeconds: 300,
            randomizedSeconds: 300,
            slideCount: 0,
            quizCount: 0,
            videoCount: 0,
            confidence: 'low',
            breakdown: [],
            tool: 'unknown'
        };

        const tool = this._detectAuthoringTool();
        result.tool = tool;

        // ─────────────────────────────────────────────────────────
        // Count content elements by tool
        // ─────────────────────────────────────────────────────────

        let slideCount = 0;
        let quizCount = 0;
        let videoCount = 0;
        let hasAudio = false;

        switch (tool) {
            case 'storyline': {
                // Storyline: count from DS.VO or slide-related elements
                if (window.DS?.VO) {
                    for (const obj of Object.values(window.DS.VO)) {
                        if (obj?.type === 'slide' || obj?.kind === 'slide') {
                            slideCount++;
                        }
                    }
                }
                if (slideCount === 0) {
                    // Fallback: count from slide data
                    if (window.g_slideData) {
                        slideCount = Object.keys(window.g_slideData).length;
                    } else {
                        // Estimate from navigation
                        const navItems = document.querySelectorAll('[class*="slide-list"] li, [class*="menu"] li');
                        slideCount = navItems.length || 10; // Default assumption
                    }
                }
                // Check for quiz elements
                quizCount = document.querySelectorAll('[class*="quiz"], [class*="question"], [data-type="quiz"]').length;
                // Check for video/audio
                videoCount = document.querySelectorAll('video').length;
                hasAudio = document.querySelectorAll('audio').length > 0;
                result.confidence = slideCount > 0 ? 'high' : 'medium';
                break;
            }

            case 'rise': {
                // Rise 360: count blocks and lessons
                const blocks = document.querySelectorAll('[data-ba-component], .block');
                const lessons = document.querySelectorAll('.lesson, [class*="lesson-item"]');
                slideCount = Math.max(blocks.length, lessons.length * 5); // Estimate 5 blocks per lesson
                if (slideCount === 0) {
                    slideCount = 15; // Default Rise course estimate
                }
                quizCount = document.querySelectorAll('[data-ba-component="quiz"], .knowledge-check').length;
                videoCount = document.querySelectorAll('video, [data-ba-component="video"]').length;
                result.confidence = blocks.length > 0 ? 'high' : 'medium';
                break;
            }

            case 'captivate': {
                // Captivate: use global slide count
                if (window.cp?.movie?.totalSlides) {
                    slideCount = window.cp.movie.totalSlides;
                } else if (typeof window.cpInfoSlideCount !== 'undefined') {
                    slideCount = window.cpInfoSlideCount;
                } else {
                    slideCount = 20; // Default assumption
                }
                quizCount = document.querySelectorAll('[class*="quiz"], [class*="question"]').length;
                videoCount = document.querySelectorAll('video').length;
                result.confidence = window.cp ? 'high' : 'low';
                break;
            }

            case 'lectora': {
                // Lectora: count pages
                if (window.trivantis?.pages) {
                    slideCount = window.trivantis.pages.length;
                } else if (window.TrivantisCore?.pageCount) {
                    slideCount = window.TrivantisCore.pageCount;
                } else {
                    const pageElements = document.querySelectorAll('[class*="page"], [id*="page"]');
                    slideCount = pageElements.length || 15;
                }
                result.confidence = slideCount > 5 ? 'medium' : 'low';
                break;
            }

            case 'ispring': {
                // iSpring: use presentation slide count
                if (window.PresentationSettings?.slideCount) {
                    slideCount = window.PresentationSettings.slideCount;
                } else if (window.iSpring?.presentation?.slideCount) {
                    slideCount = window.iSpring.presentation.slideCount;
                } else {
                    slideCount = 20;
                }
                result.confidence = window.PresentationSettings ? 'high' : 'low';
                break;
            }

            default: {
                // Generic: count common elements
                const slides = document.querySelectorAll('.slide, [class*="slide"], section');
                const pages = document.querySelectorAll('.page, [class*="page"]');
                slideCount = Math.max(slides.length, pages.length, 10);
                result.confidence = 'low';
            }
        }

        result.slideCount = slideCount;
        result.quizCount = quizCount;
        result.videoCount = videoCount;

        // ─────────────────────────────────────────────────────────
        // Calculate estimated duration
        // ─────────────────────────────────────────────────────────

        // Base time per slide (in seconds) - varies by content type
        const baseSecondsPerSlide = 45;     // ~45 sec per text slide
        const quizSecondsPerQuestion = 60;  // ~1 min per quiz question
        const videoSecondsMultiplier = 90;  // Assume 90 sec per video element

        let totalSeconds = 0;

        // Slide time
        const slideTime = slideCount * baseSecondsPerSlide;
        totalSeconds += slideTime;
        result.breakdown.push({ type: 'slides', count: slideCount, seconds: slideTime });

        // Quiz time (additional)
        if (quizCount > 0) {
            const quizTime = quizCount * quizSecondsPerQuestion;
            totalSeconds += quizTime;
            result.breakdown.push({ type: 'quizzes', count: quizCount, seconds: quizTime });
        }

        // Video time (additional)
        if (videoCount > 0) {
            const videoTime = videoCount * videoSecondsMultiplier;
            totalSeconds += videoTime;
            result.breakdown.push({ type: 'videos', count: videoCount, seconds: videoTime });
        }

        // Apply bounds
        totalSeconds = Math.max(minSeconds, Math.min(maxSeconds, totalSeconds));
        result.estimatedSeconds = Math.round(totalSeconds);

        // ─────────────────────────────────────────────────────────
        // Add randomization for natural appearance
        // ─────────────────────────────────────────────────────────

        // Random variance within +/- variancePercent
        const variance = (Math.random() * 2 - 1) * (variancePercent / 100);
        let randomized = totalSeconds * (1 + variance);

        // Round to nearest 30 seconds for more natural appearance
        randomized = Math.round(randomized / 30) * 30;

        // Apply bounds again
        randomized = Math.max(minSeconds, Math.min(maxSeconds, randomized));
        result.randomizedSeconds = Math.round(randomized);

        Logger.debug('Course duration estimated', result);
        return result;
    },

    /**
     * Validate session time against course estimate
     * Returns warnings if time seems unrealistic
     * @param {number} sessionTimeSeconds - Proposed session time
     * @returns {Object} { valid, warnings, suggestion }
     */
    validateSessionTime(sessionTimeSeconds) {
        const estimate = this.estimateCourseDuration();
        const result = {
            valid: true,
            warnings: [],
            suggestion: null,
            estimate
        };

        const minRealistic = estimate.estimatedSeconds * 0.3;  // 30% of estimate
        const maxRealistic = estimate.estimatedSeconds * 2.5;  // 250% of estimate

        if (sessionTimeSeconds < minRealistic) {
            result.valid = false;
            result.warnings.push(
                `Session time (${Math.round(sessionTimeSeconds / 60)} min) is very short for ` +
                `a course with ${estimate.slideCount} slides. May be flagged by LMS.`
            );
            result.suggestion = estimate.randomizedSeconds;
        } else if (sessionTimeSeconds > maxRealistic) {
            result.warnings.push(
                `Session time (${Math.round(sessionTimeSeconds / 60)} min) is unusually long. ` +
                `Estimated: ${Math.round(estimate.estimatedSeconds / 60)} min.`
            );
        } else if (sessionTimeSeconds < estimate.estimatedSeconds * 0.5) {
            result.warnings.push(
                `Session time is below typical completion time. Consider ` +
                `${Math.round(estimate.randomizedSeconds / 60)} min for more realistic tracking.`
            );
        }

        return result;
    },

    /**
     * Get suspend_data from SCORM API
     */
    _getSuspendData(api) {
        try {
            if (api.type === LMS_STANDARD.SCORM_12) {
                return api.ref.LMSGetValue('cmi.suspend_data');
            } else if (api.type === LMS_STANDARD.SCORM_2004) {
                return api.ref.GetValue('cmi.suspend_data');
            }
        } catch (e) {
            Logger.warn('Failed to get suspend_data', e);
        }
        return null;
    },

    /**
     * Set suspend_data to SCORM API
     */
    _setSuspendData(api, data) {
        try {
            let result;
            if (api.type === LMS_STANDARD.SCORM_12) {
                result = api.ref.LMSSetValue('cmi.suspend_data', data || '');
            } else if (api.type === LMS_STANDARD.SCORM_2004) {
                result = api.ref.SetValue('cmi.suspend_data', data || '');
            }
            return { success: result === 'true' || result === true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    /**
     * Set lesson location
     */
    _setLocation(api, location) {
        try {
            let result;
            if (api.type === LMS_STANDARD.SCORM_12) {
                result = api.ref.LMSSetValue('cmi.core.lesson_location', String(location));
            } else if (api.type === LMS_STANDARD.SCORM_2004) {
                result = api.ref.SetValue('cmi.location', String(location));
            }
            return { success: result === 'true' || result === true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    /**
     * Mark Storyline slides as viewed
     * Storyline suspend_data format: may be compressed (gzip+base64 or custom)
     * Also uses DS.setVariable for slide tracking
     * @param {string} suspendData - Raw suspend_data (possibly compressed)
     * @returns {Promise<Object>} - Result with data, found, marked, etc.
     */
    async _markStorylineSlides(suspendData) {
        const result = {
            data: suspendData,
            found: 0,
            marked: 0,
            lastSlideId: null,
            compression: null,
            decompressed: false
        };

        if (!suspendData) {
            return result;
        }

        // Check for compression
        const compressionType = Utils.detectCompression(suspendData);
        result.compression = compressionType;

        let workingData = suspendData;

        // Try to decompress if compressed
        if (compressionType) {
            Logger.debug(`Storyline suspend_data compression detected: ${compressionType}`);

            try {
                const decompressResult = await Utils.decompressSuspendData(suspendData);

                if (decompressResult.error) {
                    Logger.warn(`Could not decompress Storyline data: ${decompressResult.error}`);
                    // Fall through to handle as-is or try alternative methods
                } else if (decompressResult.compressed) {
                    workingData = decompressResult.data;
                    result.decompressed = true;
                    Logger.debug('Successfully decompressed Storyline suspend_data');
                }
            } catch (e) {
                Logger.debug('Decompression failed, trying to process as-is', e);
            }
        }

        // Try to parse the (possibly decompressed) data
        try {
            // Storyline formats:
            // 1. JSON with slides/visited/v arrays
            // 2. Delimited format: viewed=1,2,3|lastviewedslide=3|...
            // 3. Key:value pairs

            if (workingData.includes('{') && workingData.includes('}')) {
                // JSON format
                const parsed = JSON.parse(workingData);

                // Look for slide arrays in various locations
                const slideArrays = [
                    parsed.slides, parsed.visited, parsed.v,
                    parsed.slideStates, parsed.viewedSlides
                ].filter(Boolean);

                for (const slides of slideArrays) {
                    if (Array.isArray(slides)) {
                        result.found = Math.max(result.found, slides.length);
                        // Mark all as viewed
                        for (let i = 0; i < slides.length; i++) {
                            if (typeof slides[i] === 'object') {
                                slides[i].viewed = true;
                                slides[i].completed = true;
                                slides[i].v = 1;
                            } else {
                                slides[i] = 1;
                            }
                            result.marked++;
                        }
                        result.lastSlideId = slides.length;
                    } else if (typeof slides === 'object') {
                        // Object with slide IDs as keys
                        const keys = Object.keys(slides);
                        result.found = Math.max(result.found, keys.length);
                        for (const key of keys) {
                            if (typeof slides[key] === 'object') {
                                slides[key].viewed = true;
                                slides[key].completed = true;
                            } else {
                                slides[key] = 1;
                            }
                            result.marked++;
                            result.lastSlideId = key;
                        }
                    }
                }

                workingData = JSON.stringify(parsed);

            } else if (workingData.includes('viewed=') || workingData.includes('lastviewedslide=')) {
                // Storyline uncompressed format: viewed=1,2,3|lastviewedslide=3|...
                const parts = workingData.split('|');
                const newParts = [];
                let slideCount = 0;

                for (const part of parts) {
                    if (part.startsWith('viewed=')) {
                        // Get existing viewed slides
                        const viewedStr = part.substring(7);
                        const viewed = viewedStr ? viewedStr.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n)) : [];

                        // Try to determine total slides from DS object
                        let totalSlides = Math.max(...viewed, 0);
                        if (window.DS?.VO) {
                            for (const obj of Object.values(window.DS.VO)) {
                                if (obj?.type === 'slide' || obj?.kind === 'slide') {
                                    totalSlides++;
                                }
                            }
                        }
                        totalSlides = Math.max(totalSlides, viewed.length, 10); // At least 10 slides

                        // Mark all slides as viewed (1-indexed)
                        const allViewed = [];
                        for (let i = 1; i <= totalSlides; i++) {
                            allViewed.push(i);
                        }
                        slideCount = totalSlides;
                        result.found = totalSlides;
                        result.marked = totalSlides;
                        newParts.push(`viewed=${allViewed.join(',')}`);

                    } else if (part.startsWith('lastviewedslide=')) {
                        // Set to last slide
                        const lastSlide = slideCount || 10;
                        newParts.push(`lastviewedslide=${lastSlide}`);
                        result.lastSlideId = lastSlide;
                    } else {
                        newParts.push(part);
                    }
                }

                workingData = newParts.join('|');

            } else if (workingData.includes(',') || workingData.includes('|')) {
                // Generic delimited format
                const delimiter = workingData.includes('|') ? '|' : ',';
                const parts = workingData.split(delimiter);
                result.found = parts.length;

                const marked = parts.map((part, idx) => {
                    result.marked++;
                    result.lastSlideId = idx + 1;
                    if (part.includes(':')) {
                        const [key] = part.split(':');
                        return `${key}:1`;
                    }
                    return '1';
                });
                workingData = marked.join(delimiter);
            }
        } catch (e) {
            Logger.debug('Could not parse Storyline suspend_data', e);
        }

        // Also check DS object for slide count (supplements parsed data)
        if (window.DS?.VO) {
            try {
                let slideCount = 0;
                for (const obj of Object.values(window.DS.VO)) {
                    if (obj?.type === 'slide' || obj?.kind === 'slide') {
                        slideCount++;
                    }
                }
                if (slideCount > result.found) {
                    result.found = slideCount;
                }
            } catch (e) {}
        }

        // Recompress if original was compressed
        if (result.decompressed && compressionType) {
            try {
                result.data = await Utils.recompressSuspendData(workingData, compressionType);
                Logger.debug('Recompressed Storyline suspend_data');
            } catch (e) {
                Logger.warn('Could not recompress, using uncompressed data', e);
                result.data = workingData;
            }
        } else {
            result.data = workingData;
        }

        return result;
    },

    /**
     * Set Storyline variables for slide completion
     */
    _setStorylineSlideVariables() {
        if (!window.DS || typeof window.DS.setVariable !== 'function') return;

        const completionVars = [
            // Common slide tracking variables
            'AllSlidesViewed', 'allSlidesViewed', 'SlidesViewed', 'slidesViewed',
            'CourseViewed', 'courseViewed', 'ContentViewed', 'contentViewed',
            'ModuleComplete', 'moduleComplete', 'AllContentViewed',
            // Scene completion
            'Scene1Complete', 'Scene2Complete', 'Scene3Complete',
            'scene1Complete', 'scene2Complete', 'scene3Complete'
        ];

        for (const varName of completionVars) {
            try {
                window.DS.setVariable(varName, true);
            } catch (e) {
                // Variable may not exist
            }
        }

        // Try to find and set slide count variables
        try {
            if (window.DS.VO) {
                let slideCount = 0;
                for (const obj of Object.values(window.DS.VO)) {
                    if (obj?.type === 'slide' || obj?.kind === 'slide') {
                        slideCount++;
                    }
                }
                if (slideCount > 0) {
                    window.DS.setVariable('SlidesViewedCount', slideCount);
                    window.DS.setVariable('TotalSlides', slideCount);
                    window.DS.setVariable('slidesViewedCount', slideCount);
                }
            }
        } catch (e) {}
    },

    /**
     * Mark Rise 360 blocks as viewed
     * Rise uses LZW-compressed JSON suspend_data with block completion states
     * @param {string} suspendData - Raw suspend_data (possibly LZW compressed)
     * @returns {Promise<Object>} - Result with data, found, marked, etc.
     */
    async _markRiseBlocks(suspendData) {
        const result = {
            data: suspendData,
            found: 0,
            marked: 0,
            lastSlideId: null,
            compression: null,
            decompressed: false
        };

        if (!suspendData) {
            return result;
        }

        // Check for LZW compression (Rise uses lzwcompress)
        const compressionType = Utils.detectCompression(suspendData);
        result.compression = compressionType;

        let workingData = suspendData;

        // Try to decompress if compressed
        if (compressionType) {
            Logger.debug(`Rise suspend_data compression detected: ${compressionType}`);

            try {
                const decompressResult = await Utils.decompressSuspendData(suspendData);

                if (decompressResult.error) {
                    Logger.warn(`Could not decompress Rise data: ${decompressResult.error}`);
                } else if (decompressResult.compressed) {
                    workingData = decompressResult.data;
                    result.decompressed = true;
                    Logger.debug('Successfully decompressed Rise suspend_data');
                }
            } catch (e) {
                Logger.debug('Decompression failed, trying to process as-is', e);
            }
        }

        // Parse and process the (possibly decompressed) JSON data
        try {
            const parsed = JSON.parse(workingData);

            // Rise 360 suspend_data structure:
            // { lessons: [{id, blocks: [{id, complete}]}], currentLesson, currentBlock }
            if (parsed.lessons && Array.isArray(parsed.lessons)) {
                for (const lesson of parsed.lessons) {
                    if (lesson.blocks && Array.isArray(lesson.blocks)) {
                        for (const block of lesson.blocks) {
                            result.found++;
                            block.complete = true;
                            block.viewed = true;
                            block.progress = 1;
                            result.marked++;
                            result.lastSlideId = block.id || lesson.id;
                        }
                    }
                    lesson.complete = true;
                    lesson.progress = 1;
                }
                // Set to last lesson/block
                parsed.currentLesson = parsed.lessons.length - 1;
                if (parsed.lessons.length > 0) {
                    const lastLesson = parsed.lessons[parsed.lessons.length - 1];
                    if (lastLesson.blocks && lastLesson.blocks.length > 0) {
                        parsed.currentBlock = lastLesson.blocks.length - 1;
                    }
                }
            }

            // Alternative Rise format with progress object
            if (parsed.progress && typeof parsed.progress === 'object') {
                for (const key of Object.keys(parsed.progress)) {
                    result.found++;
                    parsed.progress[key] = 1;
                    result.marked++;
                    result.lastSlideId = key;
                }
            }

            // Also handle top-level completion fields
            if (parsed.hasOwnProperty('complete')) {
                parsed.complete = true;
            }
            if (parsed.hasOwnProperty('completed')) {
                parsed.completed = true;
            }
            if (parsed.hasOwnProperty('progress')) {
                if (typeof parsed.progress === 'number') {
                    parsed.progress = 1;
                }
            }

            workingData = JSON.stringify(parsed);

        } catch (e) {
            Logger.debug('Could not parse Rise suspend_data as JSON', e);
        }

        // Recompress if original was compressed
        if (result.decompressed && compressionType) {
            try {
                result.data = await Utils.recompressSuspendData(workingData, compressionType);
                Logger.debug('Recompressed Rise suspend_data');
            } catch (e) {
                Logger.warn('Could not recompress, using uncompressed data', e);
                result.data = workingData;
            }
        } else {
            result.data = workingData;
        }

        return result;
    },

    /**
     * Mark Captivate slides as viewed
     * Captivate uses various formats including bookmark data
     */
    _markCaptivateSlides(suspendData) {
        const result = { data: suspendData, found: 0, marked: 0, lastSlideId: null };

        // Get slide count from Captivate API if available
        let totalSlides = 0;
        try {
            if (window.cp?.movie?.currentSlide !== undefined) {
                totalSlides = window.cp.movie.totalSlides || 0;
            } else if (window.cpInfoCurrentSlide !== undefined) {
                totalSlides = window.cpInfoSlideCount || 0;
            }
        } catch (e) {}

        if (suspendData) {
            try {
                // Captivate often uses | delimited format
                // Format: slideIndex|slideTime|quizData...
                if (suspendData.includes('|')) {
                    const parts = suspendData.split('|');
                    // First part is often current slide
                    if (parts.length > 0 && totalSlides > 0) {
                        parts[0] = String(totalSlides - 1); // Set to last slide
                        result.lastSlideId = totalSlides;
                    }
                    result.found = totalSlides || parts.length;
                    result.marked = result.found;
                    result.data = parts.join('|');
                } else if (suspendData.includes('{')) {
                    // JSON format
                    const parsed = JSON.parse(suspendData);
                    if (parsed.slideViews || parsed.visited) {
                        const views = parsed.slideViews || parsed.visited;
                        if (Array.isArray(views)) {
                            result.found = views.length;
                            for (let i = 0; i < views.length; i++) {
                                views[i] = true;
                                result.marked++;
                            }
                            result.lastSlideId = views.length;
                        }
                    }
                    if (parsed.currentSlide !== undefined && totalSlides > 0) {
                        parsed.currentSlide = totalSlides - 1;
                    }
                    result.data = JSON.stringify(parsed);
                }
            } catch (e) {
                Logger.debug('Could not parse Captivate suspend_data', e);
            }
        }

        // If we have slide count but no suspend_data, create basic viewed state
        if (totalSlides > 0 && result.found === 0) {
            result.found = totalSlides;
            result.marked = totalSlides;
            result.lastSlideId = totalSlides;
            // Create simple visited array
            const viewed = new Array(totalSlides).fill(true);
            result.data = JSON.stringify({ slideViews: viewed, currentSlide: totalSlides - 1 });
        }

        return result;
    },

    /**
     * Mark Lectora pages as viewed
     */
    _markLectoraPages(suspendData) {
        const result = { data: suspendData, found: 0, marked: 0, lastSlideId: null };

        // Try to get page count from Lectora
        let pageCount = 0;
        try {
            if (window.trivantis?.pages) {
                pageCount = Object.keys(window.trivantis.pages).length;
            } else if (window.TrivantisCore?.pageCount) {
                pageCount = window.TrivantisCore.pageCount;
            }
        } catch (e) {}

        if (suspendData) {
            try {
                // Lectora often uses comma-separated page IDs
                if (suspendData.includes(',')) {
                    const parts = suspendData.split(',');
                    result.found = pageCount || parts.length;

                    // If we know page count, mark all
                    if (pageCount > 0) {
                        const allPages = [];
                        for (let i = 1; i <= pageCount; i++) {
                            allPages.push(String(i));
                            result.marked++;
                        }
                        result.data = allPages.join(',');
                        result.lastSlideId = pageCount;
                    } else {
                        result.marked = parts.length;
                        result.lastSlideId = parts[parts.length - 1];
                    }
                } else if (suspendData.includes('{')) {
                    const parsed = JSON.parse(suspendData);
                    if (parsed.pagesVisited || parsed.pages) {
                        const pages = parsed.pagesVisited || parsed.pages;
                        if (typeof pages === 'object') {
                            const keys = Object.keys(pages);
                            result.found = pageCount || keys.length;
                            for (const key of keys) {
                                pages[key] = true;
                                result.marked++;
                                result.lastSlideId = key;
                            }
                        }
                    }
                    result.data = JSON.stringify(parsed);
                }
            } catch (e) {
                Logger.debug('Could not parse Lectora suspend_data', e);
            }
        }

        return result;
    },

    /**
     * Mark iSpring slides as viewed
     */
    _markISpringSlides(suspendData) {
        const result = { data: suspendData, found: 0, marked: 0, lastSlideId: null };

        // Get slide count from iSpring
        let totalSlides = 0;
        try {
            if (window.PresentationSettings?.slideCount) {
                totalSlides = window.PresentationSettings.slideCount;
            } else if (window.iSpring?.presentation?.slideCount) {
                totalSlides = window.iSpring.presentation.slideCount;
            }
        } catch (e) {}

        if (suspendData) {
            try {
                // iSpring often uses JSON format
                const parsed = JSON.parse(suspendData);

                if (parsed.slides || parsed.viewedSlides) {
                    const slides = parsed.slides || parsed.viewedSlides;
                    if (Array.isArray(slides)) {
                        result.found = totalSlides || slides.length;
                        // Mark all as viewed
                        for (let i = 0; i < (totalSlides || slides.length); i++) {
                            if (i < slides.length) {
                                if (typeof slides[i] === 'object') {
                                    slides[i].viewed = true;
                                } else {
                                    slides[i] = 1;
                                }
                            } else {
                                slides.push(1);
                            }
                            result.marked++;
                        }
                        result.lastSlideId = slides.length;
                    }
                }

                if (parsed.currentSlide !== undefined) {
                    parsed.currentSlide = (totalSlides || result.found) - 1;
                }

                result.data = JSON.stringify(parsed);
            } catch (e) {
                Logger.debug('Could not parse iSpring suspend_data', e);
            }
        }

        // Create default if we have slide count
        if (totalSlides > 0 && result.found === 0) {
            result.found = totalSlides;
            result.marked = totalSlides;
            result.lastSlideId = totalSlides;
            const viewedSlides = new Array(totalSlides).fill(1);
            result.data = JSON.stringify({
                viewedSlides,
                currentSlide: totalSlides - 1,
                progress: 1.0
            });
        }

        return result;
    },

    /**
     * Generic slide marking for unknown tools
     */
    _markGenericSlides(suspendData) {
        const result = { data: suspendData, found: 0, marked: 0, lastSlideId: null };

        if (!suspendData) return result;

        try {
            // Try JSON first
            if (suspendData.includes('{')) {
                const parsed = JSON.parse(suspendData);

                // Look for common patterns
                const slideKeys = ['slides', 'pages', 'viewed', 'visited', 'progress', 'screens'];
                for (const key of slideKeys) {
                    if (parsed[key]) {
                        if (Array.isArray(parsed[key])) {
                            result.found = parsed[key].length;
                            for (let i = 0; i < parsed[key].length; i++) {
                                parsed[key][i] = typeof parsed[key][i] === 'object' ?
                                    { ...parsed[key][i], viewed: true, complete: true } : 1;
                                result.marked++;
                            }
                            result.lastSlideId = parsed[key].length;
                        } else if (typeof parsed[key] === 'object') {
                            const keys = Object.keys(parsed[key]);
                            result.found = keys.length;
                            for (const k of keys) {
                                parsed[key][k] = 1;
                                result.marked++;
                                result.lastSlideId = k;
                            }
                        }
                        break;
                    }
                }

                result.data = JSON.stringify(parsed);
            } else {
                // Try delimited format
                const delimiters = ['|', ',', ';', ':'];
                for (const delim of delimiters) {
                    if (suspendData.includes(delim)) {
                        const parts = suspendData.split(delim);
                        result.found = parts.length;
                        const marked = parts.map((_, idx) => {
                            result.marked++;
                            result.lastSlideId = idx + 1;
                            return '1';
                        });
                        result.data = marked.join(delim);
                        break;
                    }
                }
            }
        } catch (e) {
            Logger.debug('Could not parse generic suspend_data', e);
        }

        return result;
    },

    /**
     * Complete course fully - objectives + slides + status
     * Convenience method that calls all completion functions
     * @param {Object} options
     * @param {number|string} options.sessionTime - Seconds, or 'auto' for estimation
     */
    async forceFullCompletion(options = {}) {
        const {
            apiIndex = 0,
            status = 'passed',
            score = 100,
            sessionTime = 'auto',  // 'auto' = estimate from content, number = seconds
            tool = null
        } = options;

        // ─────────────────────────────────────────────────────────
        // Determine session time (auto-estimate or use provided)
        // ─────────────────────────────────────────────────────────
        let finalSessionTime;
        let durationEstimate = null;

        if (sessionTime === 'auto' || sessionTime === 0 || sessionTime === null) {
            // Auto-estimate based on course content
            durationEstimate = this.estimateCourseDuration();
            finalSessionTime = durationEstimate.randomizedSeconds;
            Logger.info('Auto-estimated session time', {
                estimated: durationEstimate.estimatedSeconds,
                randomized: finalSessionTime,
                slides: durationEstimate.slideCount,
                confidence: durationEstimate.confidence
            });
        } else {
            finalSessionTime = sessionTime;
            // Validate user-provided time
            const validation = this.validateSessionTime(sessionTime);
            if (validation.warnings.length > 0) {
                Logger.warn('Session time warnings', validation.warnings);
            }
        }

        const result = {
            success: false,
            objectives: null,
            slides: null,
            completion: null,
            sessionTimeUsed: finalSessionTime,
            sessionTimeEstimate: durationEstimate,
            errors: [],
            warnings: []
        };

        Logger.info('Starting full course completion', { ...options, finalSessionTime });

        try {
            // Step 1: Complete all objectives
            result.objectives = await this.completeAllObjectives({
                apiIndex, status, score, commit: false
            });

            // Step 2: Mark all slides as viewed
            result.slides = await this.markAllSlidesViewed({
                apiIndex, tool, commit: false
            });

            // Step 3: Set final completion status with session time
            result.completion = await this.forceCompletion({
                apiIndex, status, score, sessionTime: finalSessionTime,
                terminate: false,
                fallbackToKitchenSink: true
            });

            // Aggregate errors
            if (result.objectives?.errors?.length) {
                result.errors.push(...result.objectives.errors);
            }
            if (result.slides?.errors?.length) {
                result.errors.push(...result.slides.errors);
            }
            if (result.completion?.errors?.length) {
                result.errors.push(...result.completion.errors);
            }

            result.success = result.completion?.success || false;
        } catch (e) {
            result.errors.push(`Full completion failed: ${e.message}`);
        }

        Logger.info('Full course completion finished', result);
        Messenger.send(MSG.FULL_COMPLETION_RESULT, result);
        return result;
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
                customLMS: { found: false, details: [] },  // DTS/TraX, JKO, etc.
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
        // Known Custom LMS Detection (DTS/TraX, JKO, DINFOS, etc.)
        // ─────────────────────────────────────────────────────────
        const domain = document.domain || window.location.hostname;
        const pathname = window.location.pathname;

        // Defense Travel System (DTS) / TraX
        if (/defensetravel\.dod\.mil/i.test(domain) ||
            /neowbtraining/i.test(pathname)) {
            discovery.findings.customLMS.found = true;
            discovery.findings.customLMS.details.push({
                type: 'DTS/TraX',
                name: 'Defense Travel System',
                domain: domain,
                endpoint: '/neowbtraining/wbtutils/utils.php',
                hasWBTT: document.cookie.includes('WBTT'),
                completionMethod: 'setUserTrainingRecord'
            });
        }

        // Check intercepted requests for known LMS patterns
        const completionReqs = NetworkInterceptor.getCompletionRequests();
        for (const req of completionReqs) {
            if (req.knownLMS && !discovery.findings.customLMS.details.some(d => d.type === req.knownLMS.id)) {
                discovery.findings.customLMS.found = true;
                discovery.findings.customLMS.details.push({
                    type: req.knownLMS.id,
                    name: req.knownLMS.name,
                    detectedVia: 'networkInterception',
                    url: req.url
                });
            }
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

        if (discovery.findings.customLMS.found) {
            for (const detail of discovery.findings.customLMS.details) {
                recs.push({
                    priority: 1,
                    type: 'customLMS',
                    lmsType: detail.type,
                    message: `${detail.name} detected - forceCompletion() will automatically handle completion`,
                    action: "forceCompletion({ status: 'passed', score: 100 })",
                    endpoint: detail.endpoint,
                    notes: detail.type === 'DTS/TraX'
                        ? 'Uses setUserTrainingRecord API with WBTT token'
                        : null
                });
            }
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

        // ─────────────────────────────────────────────────────────
        // Try Known Custom LMS (DTS/TraX, JKO, etc.)
        // ─────────────────────────────────────────────────────────
        if (shouldContinue()) {
            const customLMSResult = await this._tryKnownCustomLMS(score);
            if (customLMSResult.attempted) {
                results.attempts.push(customLMSResult);
                if (customLMSResult.success) {
                    results.successful.push(`customLMS:${customLMSResult.lmsType}`);
                    if (stopOnSuccess) results.stoppedEarly = true;
                } else {
                    results.failed.push({ type: 'customLMS', lmsType: customLMSResult.lmsType, error: customLMSResult.error });
                }
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
    },

    /**
     * Try known custom LMS completion methods
     * Detects DTS/TraX, JKO, DINFOS, etc. by domain or intercepted requests
     */
    async _tryKnownCustomLMS(score) {
        const result = {
            type: 'customLMS',
            attempted: false,
            lmsType: null,
            success: false,
            response: null,
            error: null
        };

        const domain = document.domain || window.location.hostname;

        // ─────────────────────────────────────────────────────────
        // Defense Travel System (DTS) / TraX
        // Domain: secure.defensetravel.dod.mil, *.defensetravel.dod.mil
        // ─────────────────────────────────────────────────────────
        if (/defensetravel\.dod\.mil/i.test(domain) ||
            /neowbtraining/i.test(window.location.pathname)) {

            result.attempted = true;
            result.lmsType = 'DTS/TraX';

            Logger.info('DTS/TraX detected by domain, attempting completion...');

            try {
                const dtsUrl = `https://${domain}/neowbtraining/wbtutils/utils.php`;
                const dtsReq = NetworkInterceptor._createDTSRequest({ url: dtsUrl }, score);

                if (!dtsReq.success) {
                    result.error = dtsReq.error || 'Failed to create DTS request';
                    return result;
                }

                const response = await NetworkInterceptor.replayRequest({
                    url: dtsReq.endpoint,
                    method: dtsReq.method,
                    body: dtsReq.body,
                    headers: dtsReq.headers
                });

                result.response = response;
                result.success = response.success;
                result.dtsInfo = dtsReq.dtsInfo;

                if (response.success) {
                    // Check for DTS-specific success response
                    try {
                        const parsed = JSON.parse(response.response);
                        if (parsed.successFailFlag === 'success') {
                            result.success = true;
                            result.ctuid = parsed.ctuid;
                            result.certUrl = `https://${domain}/neowbtraining/wbtutils/printcert.php?mode=print&printCtuid=${parsed.ctuid}`;
                            Logger.info('DTS completion successful', { ctuid: parsed.ctuid });
                        } else {
                            result.success = false;
                            result.error = parsed.successFailFlag || 'DTS returned failure';
                        }
                    } catch (e) {
                        // Non-JSON response, check status
                        result.success = response.status >= 200 && response.status < 300;
                    }
                } else {
                    result.error = response.error || 'Request failed';
                }
            } catch (e) {
                result.error = e.message;
                Logger.error('DTS completion error', e);
            }

            return result;
        }

        // ─────────────────────────────────────────────────────────
        // Check intercepted requests for known custom LMS
        // ─────────────────────────────────────────────────────────
        const completionReqs = NetworkInterceptor.getCompletionRequests();
        for (const req of completionReqs) {
            if (req.knownLMS) {
                result.attempted = true;
                result.lmsType = req.knownLMS.name;

                Logger.info(`Known LMS detected via interception: ${req.knownLMS.name}`);

                try {
                    const completionReq = NetworkInterceptor.createCompletionRequest({ score });
                    if (completionReq.success) {
                        const response = await NetworkInterceptor.replayRequest({
                            url: completionReq.endpoint,
                            method: completionReq.method,
                            body: completionReq.body,
                            headers: completionReq.headers
                        });

                        result.response = response;
                        result.success = response.success;
                    } else {
                        result.error = completionReq.error;
                    }
                } catch (e) {
                    result.error = e.message;
                }

                return result;
            }
        }

        return result;
    }
};


export { SCORMAPI };
