/**
 * Base Extractor
 *
 * Common interface all extractors must implement.
 * This ensures consistency and allows the registry to work with any extractor.
 */

import { Logger } from '../core/index.js';

/**
 * Create an extractor with standard interface
 * @param {Object} config - Extractor configuration
 * @param {string} config.toolId - Unique identifier (from AUTHORING_TOOL)
 * @param {Function} config.detect - Returns true if this extractor should handle the page
 * @param {Function} config.extract - Extracts Q&A items, returns array
 * @param {Function} [config.getInfo] - Optional: returns tool-specific info
 */
export function createExtractor({ toolId, detect, extract, getInfo }) {
    return {
        toolId,

        /**
         * Detect if this extractor should handle current page
         * @returns {boolean}
         */
        detect() {
            try {
                return detect();
            } catch (e) {
                Logger.debug(`${toolId} detection error: ${e.message}`);
                return false;
            }
        },

        /**
         * Extract Q&A items from page
         * @returns {Promise<Array>} Array of extracted items
         */
        async extract() {
            try {
                Logger.info(`Running ${toolId} extractor`);
                const items = await extract();
                Logger.info(`${toolId} extracted ${items.length} items`);
                return items;
            } catch (e) {
                Logger.error(`${toolId} extraction error: ${e.message}`);
                return [];
            }
        },

        /**
         * Get tool-specific information
         * @returns {Object|null}
         */
        getInfo() {
            if (getInfo) {
                try {
                    return getInfo();
                } catch (e) {
                    Logger.debug(`${toolId} getInfo error: ${e.message}`);
                }
            }
            return null;
        }
    };
}
