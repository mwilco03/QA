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
     * @param {Object} extractor - Extractor instance with detect/extract methods
     */
    register(extractor) {
        if (!extractor.toolId) {
            throw new Error('Extractor must have toolId');
        }
        extractors.set(extractor.toolId, extractor);
        Logger.debug(`Registered extractor: ${extractor.toolId}`);
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
     * Detect which extractor(s) can handle current page
     * @returns {Array<Object>} Array of matching extractors
     */
    detectAll() {
        const matches = [];
        for (const [id, extractor] of extractors) {
            if (extractor.detect()) {
                matches.push(extractor);
            }
        }
        return matches;
    },

    /**
     * Detect primary extractor for current page
     * @returns {Object|null}
     */
    detectPrimary() {
        // Check in order of specificity
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
            if (extractor?.detect()) {
                return extractor;
            }
        }

        return null;
    },

    /**
     * Run all matching extractors and combine results
     * @returns {Promise<Array>} Combined extraction results
     */
    async extractAll() {
        const matches = this.detectAll();
        Logger.info(`Found ${matches.length} matching extractors`);

        const results = [];
        for (const extractor of matches) {
            const items = await extractor.extract();
            results.push(...items);
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
