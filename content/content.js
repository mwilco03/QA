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
        DETECT_APIS: 'DETECT_APIS',
        GET_FRAME_INFO: 'GET_FRAME_INFO',
        ADVANCE_MEDIA: 'ADVANCE_MEDIA',
        CLICK_ADVANCE: 'CLICK_ADVANCE',
        TOGGLE_PANEL: 'TOGGLE_PANEL',
        SHOW_PANEL: 'SHOW_PANEL'
    });

    const LMS_HOSTS = /myworkday\.com|workday\.com|cornerstoneondemand|csod\.com|sumtotalsystems|successfactors|docebosaas|talentlms|litmos|skillsoft|moodle|blackboard|canvas|storyline|articulate|scorm|cmi5|aicc/i;

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    let isInjected = false;
    let isPanelInjected = false;
    const isTopFrame = window === window.top;
    const frameId = Math.random().toString(36).substr(2, 9);

    function isLikelyChromelessPopup() {
        try {
            if (!window.opener || window.opener === window) return false;
            // Chrome's window.open with feature string strips toolbar/menubar.
            // toolbar visibility is hard to detect reliably across browsers, but
            // outerHeight - innerHeight is a useful heuristic: full chrome adds
            // ~80-120px, a chromeless popup adds only ~30-50px.
            const chromeHeight = window.outerHeight - window.innerHeight;
            return chromeHeight < 60;
        } catch { return false; }
    }

    function shouldAutoShowPanel() {
        if (!isTopFrame) return false;
        try {
            const url = window.location.href;
            if (LMS_HOSTS.test(url)) return true;
            if (isLikelyChromelessPopup()) return true;
            return false;
        } catch { return false; }
    }

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

    function injectPanel() {
        if (!isTopFrame) return false;
        if (isPanelInjected) return true;

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('lib/in-page-panel.js');
        script.onload = function() {
            this.remove();
            isPanelInjected = true;
            log.info('In-page panel injected');
        };
        script.onerror = function() {
            log.error('Failed to inject panel');
        };
        (document.head || document.documentElement).appendChild(script);
        return true;
    }

    function togglePanel() {
        if (!isPanelInjected) {
            injectPanel();
            return;
        }
        // Panel is already in the page — tell it to toggle visibility
        const script = document.createElement('script');
        script.textContent = 'window.LMS_QA_PANEL && window.LMS_QA_PANEL.toggle();';
        (document.head || document.documentElement).appendChild(script);
        script.remove();
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

        // Panel asks us to inject the validator
        if (messageType === 'PANEL_REQUEST_INJECT') {
            injectValidator();
            return;
        }

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

        [CMD.DETECT_APIS]: () => {
            if (!isInjected) {
                injectValidator();
                setTimeout(() => sendToPage('CMD_DETECT_APIS'), 100);
            } else {
                sendToPage('CMD_DETECT_APIS');
            }
            return { success: true };
        },

        [CMD.ADVANCE_MEDIA]: (message) => {
            if (!isInjected) {
                injectValidator();
                setTimeout(() => sendToPage('CMD_ADVANCE_MEDIA', { mode: message.mode || 'end' }), 100);
            } else {
                sendToPage('CMD_ADVANCE_MEDIA', { mode: message.mode || 'end' });
            }
            return { success: true };
        },

        [CMD.CLICK_ADVANCE]: (message) => {
            if (!isInjected) {
                injectValidator();
                setTimeout(() => sendToPage('CMD_CLICK_ADVANCE', { allMatching: !!message.allMatching }), 100);
            } else {
                sendToPage('CMD_CLICK_ADVANCE', { allMatching: !!message.allMatching });
            }
            return { success: true };
        },

        [CMD.TOGGLE_PANEL]: () => {
            togglePanel();
            return { success: true };
        },

        [CMD.SHOW_PANEL]: () => {
            injectPanel();
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

    // Auto-show the in-page panel on LMS pages and chromeless popup windows
    // where the extension toolbar icon is not reachable. This is the main fix
    // for Workday Learning's launched popup window.
    if (shouldAutoShowPanel()) {
        const start = () => injectPanel();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
    }

})();
