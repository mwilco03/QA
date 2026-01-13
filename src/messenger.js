/**
 * Messenger Module
 *
 * Handles communication between page context and extension.
 * Uses window.postMessage for cross-context messaging.
 */

import { MSG, VERSION } from './core/constants.js';
import { Logger } from './core/logger.js';

export const Messenger = {
    /**
     * Send message to extension
     * @param {string} type - Message type from MSG constants
     * @param {*} payload - Message payload
     */
    send(type, payload) {
        window.postMessage({
            type: MSG.PREFIX + type,
            payload,
            source: 'lms-qa-validator',
            version: VERSION
        }, '*');
    },

    /**
     * Listen for commands from extension
     * @param {Function} handler - Handler function(type, payload)
     */
    listen(handler) {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;

            const { type, payload } = event.data || {};
            if (!type) return;

            // Handle commands
            if (type.startsWith('LMS_QA_CMD_')) {
                Logger.debug(`Received command: ${type}`, payload);
                handler(type, payload);
            }
        });
    }
};
