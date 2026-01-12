/**
 * LMS QA Validator - Content Script v6.1
 * VERBOSE LOGGING VERSION
 * Bridges page context (validator/extractor) with extension context (service worker)
 *
 * Key improvements:
 * - Waits for READY message before sending commands
 * - Command queue for pending operations
 * - Better frame/iframe detection
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // VERBOSE LOGGING
    // ═══════════════════════════════════════════════════════════════════════════

    const VERBOSE = true;

    const log = {
        info: (category, msg, data) => {
            console.log(`%c[LMS-QA]%c [${category}] ${msg}`, 'color: #3b82f6; font-weight: bold', 'color: inherit', data || '');
        },
        warn: (category, msg, data) => {
            console.warn(`%c[LMS-QA]%c [${category}] ${msg}`, 'color: #f59e0b; font-weight: bold', 'color: inherit', data || '');
        },
        error: (category, msg, data) => {
            console.error(`%c[LMS-QA]%c [${category}] ${msg}`, 'color: #ef4444; font-weight: bold', 'color: inherit', data || '');
        },
        verbose: (category, msg, data) => {
            if (VERBOSE) {
                console.log(`%c[LMS-QA]%c [${category}] ${msg}`, 'color: #8b5cf6; font-weight: bold', 'color: #888', data || '');
            }
        },
        table: (category, data) => {
            console.log(`%c[LMS-QA]%c [${category}]`, 'color: #3b82f6; font-weight: bold', 'color: inherit');
            console.table(data);
        },
        success: (category, msg, data) => {
            console.log(`%c[LMS-QA]%c [${category}] ✓ ${msg}`, 'color: #22c55e; font-weight: bold', 'color: #22c55e', data || '');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const PREFIX = 'LMS_QA_';
    const INJECT_TIMEOUT = 5000; // 5 seconds max wait for script ready

    const CMD = Object.freeze({
        SCAN: 'SCAN',
        TEST_API: 'TEST_API',
        SET_COMPLETION: 'SET_COMPLETION',
        EXPORT: 'EXPORT',
        GET_CMI_DATA: 'GET_CMI_DATA',
        GET_STATE: 'GET_STATE',
        AUTO_SELECT: 'AUTO_SELECT',
        INJECT: 'INJECT',
        PING: 'PING',
        DETECT_APIS: 'DETECT_APIS',
        GET_FRAME_INFO: 'GET_FRAME_INFO',
        SEED_EXTRACT: 'SEED_EXTRACT',
        DETECT_FRAMEWORK: 'DETECT_FRAMEWORK',
        COMPLETE_OBJECTIVES: 'COMPLETE_OBJECTIVES',
        MARK_SLIDES: 'MARK_SLIDES',
        FULL_COMPLETION: 'FULL_COMPLETION',
        ESTIMATE_DURATION: 'ESTIMATE_DURATION',
        GET_EXTRACTED_DATA: 'GET_EXTRACTED_DATA',
        GET_QUESTIONS: 'GET_QUESTIONS',
        GET_CORRECT_ANSWERS: 'GET_CORRECT_ANSWERS'
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    let isValidatorInjected = false;
    let isValidatorReady = false;
    let isExtractorInjected = false;
    let isExtractorReady = false;
    let launchParams = null;

    // Command queue - holds commands while waiting for scripts to be ready
    const validatorCommandQueue = [];
    const extractorCommandQueue = [];

    // Frame info
    let isTopFrame = true;
    try {
        isTopFrame = window === window.top;
    } catch (e) {
        isTopFrame = false; // Cross-origin iframe
    }

    const frameId = Math.random().toString(36).substr(2, 9);
    const frameType = isTopFrame ? 'TOP' : 'IFRAME';
    const frameUrl = window.location.href;

    // ═══════════════════════════════════════════════════════════════════════════
    // CMI5 LAUNCH PARAMETER DETECTION
    // ═══════════════════════════════════════════════════════════════════════════

    function detectLaunchParams() {
        try {
            const url = new URL(window.location.href);
            const params = {};

            // cmi5 standard params
            const cmi5Params = ['endpoint', 'fetch', 'actor', 'registration', 'activityId'];
            cmi5Params.forEach(p => {
                const val = url.searchParams.get(p);
                if (val) params[p] = val;
            });

            // Also check hash params (some LMS use hash)
            if (url.hash) {
                const hashParams = new URLSearchParams(url.hash.slice(1));
                cmi5Params.forEach(p => {
                    const val = hashParams.get(p);
                    if (val && !params[p]) params[p] = val;
                });
            }

            if (Object.keys(params).length > 0) {
                log.info('CMI5', 'Launch parameters detected!', params);
                launchParams = params;
                sendToExtension('CMI5_LAUNCH_DETECTED', params);
                return params;
            }
        } catch (e) {
            log.error('CMI5', `Error detecting launch params: ${e.message}`);
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FRAME ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════

    function analyzeFrame() {
        const analysis = {
            frameId,
            frameType,
            url: frameUrl,
            title: document.title || '(no title)',
            iframes: [],
            scripts: [],
            globals: [],
            forms: 0
        };

        // Count iframes
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach((iframe, i) => {
            try {
                analysis.iframes.push({
                    index: i,
                    src: iframe.src || '(no src)',
                    id: iframe.id || '(no id)',
                    name: iframe.name || '(no name)',
                    visible: iframe.offsetParent !== null
                });
            } catch (e) {}
        });

        // Sample scripts
        const scripts = document.querySelectorAll('script[src]');
        scripts.forEach(s => {
            const src = s.src || s.getAttribute('src');
            if (src) analysis.scripts.push(src);
        });

        // Check for known globals
        const globalChecks = ['API', 'API_1484_11', 'ADL', 'DS', 'cp', 'trivantis', 'iSpring', 'g_slideData'];
        globalChecks.forEach(g => {
            try {
                if (window[g]) analysis.globals.push(g);
            } catch (e) {}
        });

        // Check parent/top for SCORM API
        try {
            if (window.parent && window.parent !== window) {
                ['API', 'API_1484_11'].forEach(g => {
                    try {
                        if (window.parent[g]) analysis.globals.push(`parent.${g}`);
                    } catch (e) {}
                });
            }
        } catch (e) {}

        // Count forms
        analysis.forms = document.querySelectorAll('form, select, input[type="radio"], input[type="checkbox"]').length;

        return analysis;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE PASSING
    // ═══════════════════════════════════════════════════════════════════════════

    function sendToPage(command, payload = {}) {
        const msg = {
            type: `${PREFIX}${command}`,
            payload,
            frameId,
            timestamp: Date.now()
        };
        log.verbose('MSG→PAGE', `${command}`, payload);
        window.postMessage(msg, '*');
    }

    function sendToExtension(type, payload = {}) {
        const msg = {
            type,
            payload,
            frameId,
            frameType,
            url: frameUrl
        };
        log.verbose('MSG→EXT', `${type}`, payload);

        try {
            chrome.runtime.sendMessage(msg, (response) => {
                if (chrome.runtime.lastError) {
                    log.warn('MSG→EXT', `Error: ${chrome.runtime.lastError.message}`);
                } else if (response) {
                    log.verbose('MSG←EXT', 'Response received', response);
                }
            });
        } catch (e) {
            log.error('MSG→EXT', `Failed to send: ${e.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCRIPT INJECTION
    // ═══════════════════════════════════════════════════════════════════════════

    function injectScript(name, src) {
        return new Promise((resolve, reject) => {
            log.info('INJECT', `Injecting ${name}...`);

            const script = document.createElement('script');
            script.src = src;

            const timeout = setTimeout(() => {
                reject(new Error(`Timeout waiting for ${name} to load`));
            }, INJECT_TIMEOUT);

            script.onload = function() {
                clearTimeout(timeout);
                this.remove();
                log.success('INJECT', `${name} script loaded`);
                resolve();
            };

            script.onerror = function(e) {
                clearTimeout(timeout);
                log.error('INJECT', `Failed to inject ${name}`, e);
                reject(new Error(`Failed to load ${name}`));
            };

            (document.head || document.documentElement).appendChild(script);
        });
    }

    // Check if scripts are already injected in page context
    function checkExistingScripts() {
        // Use inline script to check page context globals
        const checkScript = document.createElement('script');
        checkScript.textContent = `
            window.postMessage({
                type: 'LMS_QA_SCRIPT_CHECK',
                validatorPresent: !!window.__LMS_QA_INJECTED__,
                extractorPresent: !!window.__LMS_QA_EXTRACTOR__
            }, '*');
        `;
        document.documentElement.appendChild(checkScript);
        checkScript.remove();
    }

    // Listen for script check response
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'LMS_QA_SCRIPT_CHECK') {
            if (event.data.validatorPresent && !isValidatorReady) {
                log.info('CHECK', 'Validator already present in page context');
                isValidatorInjected = true;
                isValidatorReady = true;
                processValidatorQueue();
            }
            if (event.data.extractorPresent && !isExtractorReady) {
                log.info('CHECK', 'Extractor already present in page context');
                isExtractorInjected = true;
                isExtractorReady = true;
                processExtractorQueue();
            }
        }
    }, { once: false });

    async function injectValidator() {
        if (isValidatorInjected && isValidatorReady) {
            log.verbose('INJECT', 'Validator already injected and ready');
            return true;
        }

        // First check if it's already in page context
        checkExistingScripts();
        await new Promise(r => setTimeout(r, 50));

        if (isValidatorReady) {
            log.info('INJECT', 'Validator was already present');
            return true;
        }

        try {
            await injectScript('lms-qa-validator.js', chrome.runtime.getURL('lib/lms-qa-validator.js'));
            isValidatorInjected = true;
            log.info('INJECT', 'Validator script injected, waiting for READY...');

            // Set a fallback timeout - process queue after 2 seconds if READY hasn't arrived
            setTimeout(() => {
                if (!isValidatorReady && validatorCommandQueue.length > 0) {
                    log.warn('INJECT', 'READY timeout - processing queue anyway');
                    isValidatorReady = true;
                    processValidatorQueue();
                }
            }, 2000);

            return true;
        } catch (e) {
            log.error('INJECT', `Validator injection failed: ${e.message}`);
            return false;
        }
    }

    async function injectTasksExtractor() {
        if (isExtractorInjected && isExtractorReady) {
            log.verbose('INJECT', 'TasksExtractor already injected and ready');
            return true;
        }

        // First check if it's already in page context
        checkExistingScripts();
        await new Promise(r => setTimeout(r, 50));

        if (isExtractorReady) {
            log.info('INJECT', 'Extractor was already present');
            return true;
        }

        try {
            await injectScript('tasks-extractor.js', chrome.runtime.getURL('lib/tasks-extractor.js'));
            isExtractorInjected = true;
            log.info('INJECT', 'TasksExtractor script injected, waiting for READY...');

            // Set a fallback timeout
            setTimeout(() => {
                if (!isExtractorReady && extractorCommandQueue.length > 0) {
                    log.warn('INJECT', 'Extractor READY timeout - processing queue anyway');
                    isExtractorReady = true;
                    processExtractorQueue();
                }
            }, 2000);

            return true;
        } catch (e) {
            log.error('INJECT', `TasksExtractor injection failed: ${e.message}`);
            return false;
        }
    }

    // Process queued commands when script becomes ready
    function processValidatorQueue() {
        if (validatorCommandQueue.length === 0) return;
        log.info('QUEUE', `Processing ${validatorCommandQueue.length} queued validator commands`);
        while (validatorCommandQueue.length > 0) {
            const { command, payload } = validatorCommandQueue.shift();
            log.verbose('QUEUE', `Sending queued command: ${command}`);
            sendToPage(command, payload);
        }
    }

    function processExtractorQueue() {
        if (extractorCommandQueue.length === 0) return;
        log.info('QUEUE', `Processing ${extractorCommandQueue.length} queued extractor commands`);
        while (extractorCommandQueue.length > 0) {
            const { command, payload } = extractorCommandQueue.shift();
            log.verbose('QUEUE', `Sending queued command: ${command}`);
            sendToPage(command, payload);
        }
    }

    // Send command to validator - SIMPLIFIED: just inject and send
    async function sendValidatorCommand(command, payload = {}) {
        // Always ensure validator is injected first
        if (!isValidatorInjected) {
            await injectValidator();
        }

        // If ready, send immediately
        if (isValidatorReady) {
            sendToPage(command, payload);
            return;
        }

        // Queue the command and wait for READY (with timeout fallback)
        log.verbose('QUEUE', `Queueing validator command: ${command}`);
        validatorCommandQueue.push({ command, payload });

        // If not injected yet, do it now
        if (!isValidatorInjected) {
            await injectValidator();
        }
    }

    // Send command to extractor - SIMPLIFIED
    async function sendExtractorCommand(command, payload = {}) {
        if (!isExtractorInjected) {
            await injectTasksExtractor();
        }

        if (isExtractorReady) {
            sendToPage(command, payload);
            return;
        }

        log.verbose('QUEUE', `Queueing extractor command: ${command}`);
        extractorCommandQueue.push({ command, payload });

        if (!isExtractorInjected) {
            await injectTasksExtractor();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PAGE MESSAGE HANDLER (from validator/extractor scripts)
    // ═══════════════════════════════════════════════════════════════════════════

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data?.type?.startsWith(PREFIX)) return;

        const { type, payload } = event.data;
        const messageType = type.replace(PREFIX, '');

        // Skip command messages (those go TO the page, not FROM it)
        if (messageType.startsWith('CMD_')) return;

        log.info('MSG←PAGE', messageType, payload);

        // Handle READY messages specially
        if (messageType === 'READY') {
            log.success('READY', 'Validator is ready!', payload);
            isValidatorReady = true;
            processValidatorQueue();
        }

        if (messageType === 'EXTRACTOR_READY') {
            log.success('READY', 'TasksExtractor is ready!', payload);
            isExtractorReady = true;
            processExtractorQueue();
        }

        // Forward all messages to extension
        sendToExtension(messageType, payload);
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTENSION MESSAGE HANDLER (from popup/service worker)
    // ═══════════════════════════════════════════════════════════════════════════

    const commandHandlers = {
        [CMD.PING]: () => {
            return {
                success: true,
                frameId,
                frameType,
                validatorInjected: isValidatorInjected,
                validatorReady: isValidatorReady,
                extractorInjected: isExtractorInjected,
                extractorReady: isExtractorReady,
                launchParams
            };
        },

        [CMD.SCAN]: async () => {
            log.info('CMD', '▶ SCAN requested');
            await sendValidatorCommand('CMD_SCAN');
            return { success: true, message: 'Scan command sent' };
        },

        [CMD.FULL_COMPLETION]: async (message) => {
            log.info('CMD', '▶ FULL_COMPLETION requested', message);
            const payload = {
                status: message.status || 'passed',
                score: message.score || 100,
                sessionTime: message.sessionTime || 300,
                launchParams
            };
            await sendValidatorCommand('CMD_FULL_COMPLETION', payload);
            return { success: true, message: 'Full completion command sent' };
        },

        [CMD.TEST_API]: async (message) => {
            log.info('CMD', '▶ TEST_API requested');
            await sendValidatorCommand('CMD_TEST_API', { apiIndex: message.apiIndex || 0 });
            return { success: true };
        },

        [CMD.SET_COMPLETION]: async (message) => {
            log.info('CMD', '▶ SET_COMPLETION requested', message);
            await sendValidatorCommand('CMD_SET_COMPLETION', {
                status: message.status || 'completed',
                score: message.score || 100,
                sessionTime: message.sessionTime || 300,
                apiIndex: message.apiIndex || 0
            });
            return { success: true };
        },

        [CMD.EXPORT]: async (message) => {
            log.info('CMD', '▶ EXPORT requested', message.format);
            await sendValidatorCommand('CMD_EXPORT', { format: message.format || 'json' });
            return { success: true };
        },

        [CMD.AUTO_SELECT]: async () => {
            log.info('CMD', '▶ AUTO_SELECT requested');
            await sendValidatorCommand('CMD_AUTO_SELECT');
            return { success: true };
        },

        [CMD.DETECT_FRAMEWORK]: () => {
            log.info('CMD', '▶ DETECT_FRAMEWORK requested');

            const detection = {
                framework: null,
                apis: [],
                potentialQA: 0,
                frameId,
                frameType,
                url: frameUrl
            };

            try {
                // Check globals
                if (window.DS || window.g_slideData) detection.framework = 'storyline';
                else if (window.cp || window.cpAPIInterface) detection.framework = 'captivate';
                else if (window.trivantis) detection.framework = 'lectora';
                else if (window.iSpring) detection.framework = 'ispring';
                else if (document.querySelector('[data-ba-component]')) detection.framework = 'rise';

                // Check APIs in various locations
                const checkApi = (win, prefix) => {
                    try {
                        ['API', 'API_1484_11', 'API_ADAPTER'].forEach(name => {
                            if (win[name]) {
                                detection.apis.push({ type: 'SCORM', location: name, where: prefix });
                            }
                        });
                        if (win.ADL) detection.apis.push({ type: 'xAPI', location: 'ADL', where: prefix });
                    } catch (e) {}
                };

                checkApi(window, 'window');
                try { if (window.parent !== window) checkApi(window.parent, 'parent'); } catch (e) {}
                try { if (window.top !== window) checkApi(window.top, 'top'); } catch (e) {}
                try { if (window.opener) checkApi(window.opener, 'opener'); } catch (e) {}

                detection.potentialQA = document.querySelectorAll('select, input[type="radio"], input[type="checkbox"]').length;

                log.info('DETECT', 'Framework detection complete', detection);

                // Also report to extension
                sendToExtension('FRAMEWORK_DETECTED', detection);
            } catch (e) {
                log.error('DETECT', 'Detection error', e.message);
            }

            return detection;
        },

        [CMD.GET_FRAME_INFO]: () => {
            const analysis = analyzeFrame();
            log.table('FRAME', analysis);
            return analysis;
        },

        [CMD.GET_EXTRACTED_DATA]: async () => {
            log.info('CMD', '▶ GET_EXTRACTED_DATA requested');
            await sendExtractorCommand('CMD_GET_EXTRACTED_DATA');
            return { success: true };
        },

        [CMD.INJECT]: async () => {
            log.info('CMD', '▶ INJECT (validator) requested');
            await injectValidator();
            return { success: true, validatorReady: isValidatorReady };
        },

        [CMD.GET_STATE]: async () => {
            log.info('CMD', '▶ GET_STATE requested');
            await sendValidatorCommand('CMD_GET_STATE');
            return { success: true };
        },

        [CMD.GET_CMI_DATA]: async () => {
            log.info('CMD', '▶ GET_CMI_DATA requested');
            await sendValidatorCommand('CMD_GET_CMI_DATA');
            return { success: true };
        },

        [CMD.DETECT_APIS]: async () => {
            log.info('CMD', '▶ DETECT_APIS requested');
            await sendValidatorCommand('CMD_DETECT_APIS');
            return { success: true };
        },

        [CMD.COMPLETE_OBJECTIVES]: async (message) => {
            log.info('CMD', '▶ COMPLETE_OBJECTIVES requested');
            const payload = { status: message.status || 'passed', score: message.score || 100 };
            await sendValidatorCommand('CMD_COMPLETE_OBJECTIVES', payload);
            return { success: true };
        },

        [CMD.MARK_SLIDES]: async (message) => {
            log.info('CMD', '▶ MARK_SLIDES requested');
            const payload = { tool: message.tool || null };
            await sendValidatorCommand('CMD_MARK_SLIDES', payload);
            return { success: true };
        }
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message?.type) return;

        log.info('MSG←EXT', `Command: ${message.type}`, message);

        const handler = commandHandlers[message.type];
        if (handler) {
            // Handle async handlers
            const result = handler(message);
            if (result instanceof Promise) {
                result.then(response => {
                    log.verbose('MSG→EXT', 'Async response', response);
                    sendResponse(response);
                }).catch(err => {
                    log.error('CMD', `Handler error: ${err.message}`);
                    sendResponse({ success: false, error: err.message });
                });
                return true; // Keep channel open
            } else {
                log.verbose('MSG→EXT', 'Sync response', result);
                sendResponse(result);
            }
        } else {
            log.warn('MSG←EXT', `Unknown command: ${message.type}`);
            sendResponse({ success: false, error: `Unknown command: ${message.type}` });
        }

        return true;
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('%c[LMS-QA] Content Script v6.1 Loaded', 'color: #22c55e; font-weight: bold; font-size: 14px');

    const frameAnalysis = analyzeFrame();
    log.info('INIT', `Frame: ${frameType} | ID: ${frameId}`);
    log.info('INIT', `URL: ${frameUrl.substring(0, 100)}${frameUrl.length > 100 ? '...' : ''}`);
    log.info('INIT', `iFrames: ${frameAnalysis.iframes.length} | Scripts: ${frameAnalysis.scripts.length} | Forms: ${frameAnalysis.forms}`);

    if (frameAnalysis.globals.length > 0) {
        log.success('INIT', `Globals found: ${frameAnalysis.globals.join(', ')}`);
    }

    if (frameAnalysis.scripts.length > 0) {
        log.verbose('SCRIPTS', `${frameAnalysis.scripts.length} external scripts found`);
        // Log first 5 scripts
        frameAnalysis.scripts.slice(0, 5).forEach(s => {
            const shortUrl = s.length > 80 ? '...' + s.substring(s.length - 77) : s;
            log.verbose('SCRIPTS', `  ${shortUrl}`);
        });
    }

    // Detect cmi5 launch params
    detectLaunchParams();

    // Check if scripts are already injected from previous extension load
    log.info('INIT', 'Checking for existing page scripts...');
    checkExistingScripts();

    // Auto-inject Tasks Extractor for network interception (in all frames)
    log.info('INIT', 'Auto-injecting TasksExtractor...');
    injectTasksExtractor().catch(e => {
        log.warn('INIT', `TasksExtractor auto-inject failed: ${e.message}`);
    });

    // Report to extension
    sendToExtension('CONTENT_SCRIPT_READY', {
        frameId,
        frameType,
        url: frameUrl,
        iframeCount: frameAnalysis.iframes.length,
        globals: frameAnalysis.globals,
        launchParams
    });

    // Log summary
    log.info('INIT', '═══════════════════════════════════════════════════════════════');
    log.info('INIT', 'Content script ready. Debug commands:');
    log.info('INIT', '  • Check validator: window.__LMS_QA_INJECTED__');
    log.info('INIT', '  • Check extractor: window.__LMS_QA_EXTRACTOR__');
    log.info('INIT', '═══════════════════════════════════════════════════════════════');

})();
