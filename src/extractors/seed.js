/**
 * Seed Extractor
 *
 * Extracts Q&A from seed text (user-provided or discovered content).
 */

import { ITEM_TYPE, QUESTION_TYPE, CONFIDENCE, CONTENT_PATTERNS } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

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


export { SeedExtractor };
