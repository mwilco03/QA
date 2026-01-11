/**
 * LMS QA Validator - Content Script v3.0
 * Bridges page context (validator) with extension context (service worker)
 * 
 * @fileoverview Content script for message bridging and validator injection
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const PREFIX = 'LMS_QA_';
    
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
        ACTIVATE_SELECTOR: 'ACTIVATE_SELECTOR',
        DEACTIVATE_SELECTOR: 'DEACTIVATE_SELECTOR',
        APPLY_SELECTOR_RULE: 'APPLY_SELECTOR_RULE',
        DETECT_APIS: 'DETECT_APIS',
        GET_FRAME_INFO: 'GET_FRAME_INFO'
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    let isInjected = false;
    let isSelectorInjected = false;
    const isTopFrame = window === window.top;
    const frameId = Math.random().toString(36).substr(2, 9); // Unique ID for this frame

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGGING
    // ═══════════════════════════════════════════════════════════════════════════

    const log = {
        info: (msg) => console.log(`[LMS QA Content] ${msg}`),
        error: (msg) => console.error(`[LMS QA Content] ${msg}`),
        debug: (msg) => console.log(`[LMS QA Content] [DEBUG] ${msg}`)
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // VALIDATOR INJECTION
    // ═══════════════════════════════════════════════════════════════════════════

    function injectValidator() {
        if (isInjected) {
            sendToPage('CMD_GET_STATE');
            return;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('lib/lms-qa-validator.js');
        
        script.onload = function() {
            this.remove();
            isInjected = true;
            log.info('Validator injected');
        };
        
        script.onerror = function() {
            log.error('Failed to inject validator');
            sendToExtension('INJECTION_FAILED', { error: 'Failed to load validator script' });
        };

        (document.head || document.documentElement).appendChild(script);
    }

    function injectSelector(autoActivate = true, forceInject = false) {
        // Only inject in top frame unless explicitly forced (for iframe targeting)
        if (!isTopFrame && !forceInject) {
            log.debug('Skipping selector injection - not top frame');
            return false;
        }

        if (isSelectorInjected) {
            // Already injected, just send activation command
            if (autoActivate) {
                sendToPage('CMD_ACTIVATE_SELECTOR');
            }
            return true;
        }

        // Check if selector panel already exists (handles page reload cases)
        if (document.getElementById('lms-qa-selector-panel')) {
            log.debug('Selector panel already exists in DOM');
            isSelectorInjected = true;
            if (autoActivate) {
                sendToPage('CMD_ACTIVATE_SELECTOR');
            }
            return true;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('lib/element-selector.js');

        script.onload = function() {
            this.remove();
            isSelectorInjected = true;
            log.info('Element selector injected in ' + (isTopFrame ? 'top frame' : 'iframe'));

            // Send activation command after script loads (runs in page context via message)
            if (autoActivate) {
                sendToPage('CMD_ACTIVATE_SELECTOR');
            }
        };

        script.onerror = function() {
            log.error('Failed to inject element selector');
            sendToExtension('SELECTOR_INJECTION_FAILED', { error: 'Failed to load selector script' });
        };

        (document.head || document.documentElement).appendChild(script);
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE PASSING
    // ═══════════════════════════════════════════════════════════════════════════

    function sendToPage(command, payload = {}) {
        window.postMessage({
            type: `${PREFIX}${command}`,
            payload
        }, '*');
    }

    function sendToExtension(type, payload = {}) {
        chrome.runtime.sendMessage({
            type,
            payload,
            url: window.location.href
        }, (response) => {
            if (chrome.runtime.lastError) {
                log.debug(`Message error: ${chrome.runtime.lastError.message}`);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PAGE MESSAGE HANDLER
    // Forwards messages from validator (page context) to extension
    // ═══════════════════════════════════════════════════════════════════════════

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data?.type?.startsWith(PREFIX)) return;

        const { type, payload, timestamp } = event.data;
        const messageType = type.replace(PREFIX, '');

        // Skip command messages (those go TO the page, not FROM it)
        if (messageType.startsWith('CMD_')) return;

        log.debug(`From page: ${messageType}`);

        sendToExtension(messageType, payload);
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTENSION MESSAGE HANDLER
    // Handles commands from popup/service worker
    // ═══════════════════════════════════════════════════════════════════════════

    const commandHandlers = {
        [CMD.INJECT]: () => {
            injectValidator();
            return { success: true };
        },

        [CMD.SCAN]: () => {
            if (!isInjected) {
                injectValidator();
                setTimeout(() => sendToPage('CMD_SCAN'), 100);
            } else {
                sendToPage('CMD_SCAN');
            }
            return { success: true };
        },

        [CMD.TEST_API]: (message) => {
            sendToPage('CMD_TEST_API', { apiIndex: message.apiIndex || 0 });
            return { success: true };
        },

        [CMD.SET_COMPLETION]: (message) => {
            sendToPage('CMD_SET_COMPLETION', {
                status: message.status || 'completed',
                score: message.score || 100,
                apiIndex: message.apiIndex || 0
            });
            return { success: true };
        },

        [CMD.EXPORT]: (message) => {
            sendToPage('CMD_EXPORT', { format: message.format || 'json' });
            return { success: true };
        },

        [CMD.GET_CMI_DATA]: () => {
            sendToPage('CMD_GET_CMI_DATA');
            return { success: true };
        },

        [CMD.GET_STATE]: () => {
            sendToPage('CMD_GET_STATE');
            return { success: true };
        },

        [CMD.AUTO_SELECT]: () => {
            sendToPage('CMD_AUTO_SELECT');
            return { success: true };
        },

        [CMD.PING]: () => {
            return { success: true, injected: isInjected };
        },

        [CMD.ACTIVATE_SELECTOR]: (message) => {
            // forceFrame allows injection in iframes when explicitly targeted
            const forceInject = message?.forceFrame === true;
            const injected = injectSelector(true, forceInject);
            return { success: injected, isTopFrame, frameId };
        },

        [CMD.DEACTIVATE_SELECTOR]: () => {
            sendToPage('CMD_DEACTIVATE_SELECTOR');
            return { success: true };
        },

        [CMD.APPLY_SELECTOR_RULE]: (message) => {
            // Only apply in top frame unless explicitly forced
            const forceInject = message?.forceFrame === true;
            if (!isTopFrame && !forceInject) {
                log.debug('Skipping rule apply - not top frame');
                return { success: false, reason: 'not_top_frame' };
            }

            const hybrid = message.hybrid !== false; // Default to hybrid mode

            // For hybrid mode, ensure validator is injected for API detection
            if (hybrid && !isInjected) {
                injectValidator();
            }

            // Inject selector if not already, then send apply command
            if (!isSelectorInjected) {
                injectSelector(false, forceInject);
                // Wait longer if both scripts need to load
                const delay = (hybrid && !isInjected) ? 200 : 100;
                setTimeout(() => {
                    sendToPage('CMD_APPLY_RULE', { rule: message.rule, hybrid });
                }, delay);
            } else {
                sendToPage('CMD_APPLY_RULE', { rule: message.rule, hybrid });
            }
            return { success: true, isTopFrame, frameId };
        },

        [CMD.DETECT_APIS]: () => {
            if (!isInjected) {
                injectValidator();
                setTimeout(() => sendToPage('CMD_DETECT_APIS'), 100);
            } else {
                sendToPage('CMD_DETECT_APIS');
            }
            return { success: true };
        },

        [CMD.GET_FRAME_INFO]: () => {
            // Gather info about this frame and any child iframes
            const iframes = document.querySelectorAll('iframe');
            const frameInfo = {
                frameId,
                isTopFrame,
                url: window.location.href,
                title: document.title,
                hasContent: document.body?.innerText?.length > 100,
                childFrames: []
            };

            iframes.forEach((iframe, index) => {
                try {
                    const iframeSrc = iframe.src || iframe.getAttribute('src') || '';
                    const iframeName = iframe.name || iframe.id || `iframe-${index}`;
                    let canAccess = false;

                    // Try to access iframe document (will fail for cross-origin)
                    try {
                        canAccess = !!iframe.contentDocument;
                    } catch (e) {
                        canAccess = false;
                    }

                    frameInfo.childFrames.push({
                        index,
                        name: iframeName,
                        src: iframeSrc,
                        canAccess,
                        visible: iframe.offsetParent !== null
                    });
                } catch (e) {
                    // Ignore errors
                }
            });

            return frameInfo;
        }
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message?.type) return;

        const handler = commandHandlers[message.type];
        if (handler) {
            const response = handler(message);
            sendResponse(response);
        }

        return true;
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    log.info(`Content script loaded (${isTopFrame ? 'TOP FRAME' : 'iframe'}, id: ${frameId})`);

    // Report window relationship for better child/popup window detection
    try {
        const hasOpener = !!window.opener;
        const isPopup = window.opener && window.opener !== window;
        const windowName = window.name || '';

        if (hasOpener || isPopup || windowName) {
            sendToExtension('WINDOW_INFO', {
                hasOpener,
                isPopup,
                windowName,
                url: window.location.href
            });
            log.info(`Window info: opener=${hasOpener}, popup=${isPopup}, name=${windowName}`);
        }
    } catch (e) {
        // Cross-origin - can't access opener
    }

})();
