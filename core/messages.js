/**
 * LMS QA Validator - Intent-Based Messaging
 *
 * Implements Directive #7: Make messaging intent-based
 * Replace "do work" messages with intent messages (REQUEST_EXTRACTION, STORE_RULES)
 * Components should request outcomes, not control execution.
 *
 * @fileoverview Intent-based message definitions and handlers
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE INTENTS (What components want, not how to do it)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Intent types - high-level actions that components can request
 * @enum {string}
 */
const Intent = Object.freeze({
    // Extraction intents
    REQUEST_EXTRACTION: 'REQUEST_EXTRACTION',      // Request Q&A extraction
    REQUEST_DETECTION: 'REQUEST_DETECTION',        // Request tool/API detection
    REQUEST_NETWORK_DATA: 'REQUEST_NETWORK_DATA',  // Request network-intercepted data

    // Result intents
    PROVIDE_RESULTS: 'PROVIDE_RESULTS',            // Provide extraction results
    PROVIDE_DETECTION: 'PROVIDE_DETECTION',        // Provide detection results
    PROVIDE_NETWORK_DATA: 'PROVIDE_NETWORK_DATA',  // Provide network data

    // Storage intents
    STORE_RESULTS: 'STORE_RESULTS',                // Store extraction results
    RETRIEVE_RESULTS: 'RETRIEVE_RESULTS',          // Retrieve stored results
    CLEAR_RESULTS: 'CLEAR_RESULTS',                // Clear stored results

    // SCORM/xAPI intents
    REQUEST_COMPLETION: 'REQUEST_COMPLETION',      // Request course completion
    REQUEST_API_TEST: 'REQUEST_API_TEST',          // Test SCORM/xAPI API

    // Export intents
    REQUEST_EXPORT: 'REQUEST_EXPORT',              // Export data

    // Session intents
    SESSION_START: 'SESSION_START',                // Session started
    SESSION_UPDATE: 'SESSION_UPDATE',              // Session state updated
    SESSION_END: 'SESSION_END',                    // Session ended

    // Status intents
    STATUS_UPDATE: 'STATUS_UPDATE',                // Status changed
    PROGRESS_UPDATE: 'PROGRESS_UPDATE',            // Progress changed
    ERROR_OCCURRED: 'ERROR_OCCURRED'               // Error occurred
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Message structure
 * @typedef {Object} Message
 * @property {string} id - Unique message ID
 * @property {Intent} intent - Message intent
 * @property {Object} payload - Intent-specific payload
 * @property {string} source - Source component identifier
 * @property {string} [target] - Target component (optional, for routing)
 * @property {number} timestamp - Creation timestamp
 * @property {string} [correlationId] - For request/response correlation
 */

/**
 * Generate a unique message ID
 * @returns {string}
 */
function generateMessageId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `msg_${timestamp}_${random}`;
}

/**
 * Create a message
 * @param {Intent} intent - Message intent
 * @param {Object} payload - Message payload
 * @param {string} source - Source component
 * @param {Object} [options] - Additional options
 * @returns {Message}
 */
function createMessage(intent, payload, source, options = {}) {
    if (!Object.values(Intent).includes(intent)) {
        throw new Error(`Invalid intent: ${intent}`);
    }

    return {
        id: generateMessageId(),
        intent,
        payload: payload || {},
        source,
        target: options.target || null,
        timestamp: Date.now(),
        correlationId: options.correlationId || null
    };
}

/**
 * Create a response message (correlates to a request)
 * @param {Message} request - Original request message
 * @param {Intent} responseIntent - Response intent
 * @param {Object} payload - Response payload
 * @param {string} source - Source component
 * @returns {Message}
 */
function createResponse(request, responseIntent, payload, source) {
    return createMessage(responseIntent, payload, source, {
        correlationId: request.id,
        target: request.source
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INTENT PAYLOADS (Type definitions for each intent)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Payload schemas for each intent
 */
const IntentPayloads = {
    [Intent.REQUEST_EXTRACTION]: {
        required: [],
        optional: ['sessionId', 'options']
    },

    [Intent.PROVIDE_RESULTS]: {
        required: ['results'],
        optional: ['sessionId']
    },

    [Intent.REQUEST_COMPLETION]: {
        required: ['status'],
        optional: ['score', 'sessionTime', 'apiIndex']
    },

    [Intent.REQUEST_EXPORT]: {
        required: ['format'],
        optional: ['data', 'filename']
    },

    [Intent.STATUS_UPDATE]: {
        required: ['status'],
        optional: ['message', 'data']
    },

    [Intent.PROGRESS_UPDATE]: {
        required: ['step', 'total'],
        optional: ['message', 'percent']
    },

    [Intent.ERROR_OCCURRED]: {
        required: ['error'],
        optional: ['context', 'recoverable']
    }
};

/**
 * Validate message payload against schema
 * @param {Message} message - Message to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validatePayload(message) {
    const schema = IntentPayloads[message.intent];
    const errors = [];

    if (!schema) {
        return { valid: true, errors: [] }; // Unknown intent, allow any payload
    }

    // Check required fields
    for (const field of schema.required || []) {
        if (!(field in message.payload)) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE BUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a message bus for intent-based communication
 * Components subscribe to intents, not specific message types
 *
 * @returns {Object} Message bus instance
 */
function createMessageBus() {
    const handlers = new Map();          // intent -> Set<handler>
    const pendingResponses = new Map();  // correlationId -> {resolve, reject, timeout}

    return {
        /**
         * Subscribe to an intent
         * @param {Intent} intent - Intent to subscribe to
         * @param {Function} handler - Handler function(message) => void|Promise
         * @returns {Function} Unsubscribe function
         */
        subscribe(intent, handler) {
            if (!handlers.has(intent)) {
                handlers.set(intent, new Set());
            }
            handlers.get(intent).add(handler);

            return () => {
                const intentHandlers = handlers.get(intent);
                if (intentHandlers) {
                    intentHandlers.delete(handler);
                }
            };
        },

        /**
         * Publish a message
         * @param {Message} message - Message to publish
         */
        async publish(message) {
            // Check for pending response
            if (message.correlationId && pendingResponses.has(message.correlationId)) {
                const pending = pendingResponses.get(message.correlationId);
                clearTimeout(pending.timeout);
                pendingResponses.delete(message.correlationId);
                pending.resolve(message);
                return;
            }

            // Dispatch to handlers
            const intentHandlers = handlers.get(message.intent);
            if (intentHandlers) {
                for (const handler of intentHandlers) {
                    try {
                        await handler(message);
                    } catch (error) {
                        console.error(`Handler error for ${message.intent}:`, error);
                    }
                }
            }
        },

        /**
         * Request with response (async/await pattern)
         * @param {Message} request - Request message
         * @param {number} [timeout=30000] - Response timeout in ms
         * @returns {Promise<Message>} Response message
         */
        request(request, timeout = 30000) {
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    pendingResponses.delete(request.id);
                    reject(new Error(`Request timeout: ${request.intent}`));
                }, timeout);

                pendingResponses.set(request.id, {
                    resolve,
                    reject,
                    timeout: timeoutId
                });

                this.publish(request);
            });
        },

        /**
         * Get all subscribed intents
         */
        getSubscribedIntents() {
            return Array.from(handlers.keys());
        },

        /**
         * Clear all handlers
         */
        clear() {
            handlers.clear();
            pendingResponses.forEach(p => clearTimeout(p.timeout));
            pendingResponses.clear();
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHROME EXTENSION ADAPTER
// Adapts intent-based messaging to Chrome extension messaging
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a Chrome extension messaging adapter
 * Bridges intent-based messages with Chrome's messaging APIs
 *
 * @param {Object} bus - Message bus instance
 * @param {string} componentId - This component's identifier
 * @returns {Object} Chrome adapter
 */
function createChromeAdapter(bus, componentId) {
    const PREFIX = 'LMS_QA_';

    return {
        /**
         * Send intent to content script
         * @param {number} tabId - Target tab ID
         * @param {Intent} intent - Intent to send
         * @param {Object} payload - Message payload
         * @returns {Promise<any>}
         */
        async sendToContent(tabId, intent, payload) {
            const message = createMessage(intent, payload, componentId);
            return new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tabId, {
                    type: `${PREFIX}${intent}`,
                    ...message
                }, response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
        },

        /**
         * Send intent to service worker
         * @param {Intent} intent - Intent to send
         * @param {Object} payload - Message payload
         * @returns {Promise<any>}
         */
        async sendToBackground(intent, payload) {
            const message = createMessage(intent, payload, componentId);
            return chrome.runtime.sendMessage({
                type: `${PREFIX}${intent}`,
                ...message
            });
        },

        /**
         * Post intent to page context
         * @param {Intent} intent - Intent to send
         * @param {Object} payload - Message payload
         */
        postToPage(intent, payload) {
            const message = createMessage(intent, payload, componentId);
            window.postMessage({
                type: `${PREFIX}${intent}`,
                ...message
            }, '*');
        },

        /**
         * Listen for Chrome messages and convert to intents
         * @param {Function} [filter] - Optional message filter
         */
        startListening(filter) {
            // Listen for Chrome extension messages
            chrome.runtime.onMessage.addListener((chromeMessage, sender, sendResponse) => {
                if (!chromeMessage.type?.startsWith(PREFIX)) return;

                // Extract intent from type
                const intent = chromeMessage.type.replace(PREFIX, '');
                if (!Object.values(Intent).includes(intent)) return;

                if (filter && !filter(chromeMessage)) return;

                // Convert to Message and publish
                const message = {
                    id: chromeMessage.id || generateMessageId(),
                    intent,
                    payload: chromeMessage.payload || chromeMessage,
                    source: chromeMessage.source || (sender.tab ? `tab:${sender.tab.id}` : 'background'),
                    timestamp: chromeMessage.timestamp || Date.now(),
                    correlationId: chromeMessage.correlationId
                };

                bus.publish(message);

                // Keep channel open for async response
                return true;
            });

            // Listen for window messages (page context)
            if (typeof window !== 'undefined') {
                window.addEventListener('message', (event) => {
                    if (event.source !== window) return;
                    if (!event.data?.type?.startsWith(PREFIX)) return;

                    const intent = event.data.type.replace(PREFIX, '');
                    if (!Object.values(Intent).includes(intent)) return;

                    if (filter && !filter(event.data)) return;

                    const message = {
                        id: event.data.id || generateMessageId(),
                        intent,
                        payload: event.data.payload || event.data,
                        source: event.data.source || 'page',
                        timestamp: event.data.timestamp || Date.now(),
                        correlationId: event.data.correlationId
                    };

                    bus.publish(message);
                });
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an extraction request message
 */
function requestExtraction(source, options = {}) {
    return createMessage(Intent.REQUEST_EXTRACTION, options, source);
}

/**
 * Create a results message
 */
function provideResults(source, results, sessionId = null) {
    return createMessage(Intent.PROVIDE_RESULTS, { results, sessionId }, source);
}

/**
 * Create a status update message
 */
function statusUpdate(source, status, message = '', data = null) {
    return createMessage(Intent.STATUS_UPDATE, { status, message, data }, source);
}

/**
 * Create a progress update message
 */
function progressUpdate(source, step, total, message = '') {
    return createMessage(Intent.PROGRESS_UPDATE, { step, total, message, percent: (step / total) * 100 }, source);
}

/**
 * Create an error message
 */
function errorOccurred(source, error, context = null, recoverable = false) {
    return createMessage(Intent.ERROR_OCCURRED, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
        context,
        recoverable
    }, source);
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Intent,
        generateMessageId,
        createMessage,
        createResponse,
        validatePayload,
        createMessageBus,
        createChromeAdapter,
        IntentPayloads,
        // Convenience functions
        requestExtraction,
        provideResults,
        statusUpdate,
        progressUpdate,
        errorOccurred
    };
}

if (typeof window !== 'undefined') {
    window.LMSQAMessages = {
        Intent,
        generateMessageId,
        createMessage,
        createResponse,
        validatePayload,
        createMessageBus,
        createChromeAdapter,
        IntentPayloads,
        requestExtraction,
        provideResults,
        statusUpdate,
        progressUpdate,
        errorOccurred
    };
}
