/**
 * Extractor Registry
 *
 * Central registry for all content extractors.
 * Handles detection and routing to appropriate extractor.
 */

import { Logger, AUTHORING_TOOL } from '../core/index.js';

const extractors = new Map();

export const ExtractorRegistry = {
    /**
     * Register an extractor
     * @param {string} toolId - Tool identifier from AUTHORING_TOOL
     * @param {Object} extractor - Extractor instance with detect/extract methods
     */
    register(toolId, extractor) {
        if (!toolId) {
            throw new Error('Extractor must have toolId');
        }
        extractors.set(toolId, extractor);
        Logger.debug(`Registered extractor: ${toolId}`);
    },

    /**
     * Get extractor by tool ID
     * @param {string} toolId
     * @returns {Object|null}
     */
    get(toolId) {
        return extractors.get(toolId) || null;
    },

    /**
     * Alias for get (for compatibility)
     */
    getExtractor(toolId) {
        return this.get(toolId);
    },

    /**
     * Detect which tool created the current page
     * @returns {string|null} Tool ID or null
     */
    detectTool() {
        const priority = [
            AUTHORING_TOOL.STORYLINE,
            AUTHORING_TOOL.RISE,
            AUTHORING_TOOL.CAPTIVATE,
            AUTHORING_TOOL.LECTORA,
            AUTHORING_TOOL.ISPRING,
            AUTHORING_TOOL.GENERIC
        ];

        for (const toolId of priority) {
            const extractor = extractors.get(toolId);
            try {
                if (extractor?.detect?.()) {
                    Logger.info(`Detected authoring tool: ${toolId}`);
                    return toolId;
                }
            } catch (e) {
                Logger.debug(`Detection error for ${toolId}: ${e.message}`);
            }
        }

        return null;
    },

    /**
     * Detect which extractor(s) can handle current page
     * @returns {Array<Object>} Array of matching extractors with toolIds
     */
    detectAll() {
        const matches = [];
        for (const [toolId, extractor] of extractors) {
            try {
                if (extractor.detect?.()) {
                    matches.push({ toolId, extractor });
                }
            } catch (e) {
                Logger.debug(`Detection error for ${toolId}: ${e.message}`);
            }
        }
        return matches;
    },

    /**
     * Extract using specific tool
     * @param {string} toolId - Tool identifier
     * @returns {Promise<Array>} Extracted items
     */
    async extract(toolId) {
        const extractor = extractors.get(toolId);
        if (!extractor) {
            Logger.warn(`No extractor registered for: ${toolId}`);
            return [];
        }

        try {
            Logger.info(`Running ${toolId} extractor`);
            const items = await extractor.extract();
            Logger.info(`${toolId} extracted ${items?.length || 0} items`);
            return items || [];
        } catch (e) {
            Logger.error(`${toolId} extraction error: ${e.message}`);
            return [];
        }
    },

    /**
     * Run all matching extractors and combine results
     * @returns {Promise<Array>} Combined extraction results
     */
    async extractAll() {
        const matches = this.detectAll();
        Logger.info(`Found ${matches.length} matching extractors`);

        const results = [];
        for (const { toolId, extractor } of matches) {
            try {
                const items = await extractor.extract();
                if (items?.length) {
                    results.push(...items);
                }
            } catch (e) {
                Logger.error(`${toolId} extraction error: ${e.message}`);
            }
        }

        return results;
    },

    /**
     * Get list of registered extractor IDs
     * @returns {Array<string>}
     */
    list() {
        return Array.from(extractors.keys());
    }
};
