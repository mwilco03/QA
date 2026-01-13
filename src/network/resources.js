/**
 * Resource Discovery Module
 *
 * Discovers loaded resources and scripts on the page.
 */

import { CONFIG, AUTHORING_TOOL } from '../core/constants.js';
import { StateManager } from '../core/state.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const ResourceDiscovery = {
    discover() {
        Logger.info('Discovering resources...');
        const resources = new Map();

        document.querySelectorAll('script[src]').forEach(script => {
            this.addResource(resources, script.src, 'script');
        });

        if (performance.getEntriesByType) {
            performance.getEntriesByType('resource').forEach(entry => {
                if (/\.js($|\?)|\.json($|\?)/i.test(entry.name)) {
                    this.addResource(resources, entry.name, 'performance');
                }
            });
        }

        const result = Array.from(resources.values()).slice(0, CONFIG.MAX_RESOURCES);
        
        StateManager.set('resources', result);
        Logger.info(`Found ${result.length} resources`);
        
        return result;
    },

    addResource(map, url, source) {
        if (!Utils.isSameOrigin(url)) return;
        if (map.has(url)) return;

        // Skip known library files and SCORM runtime code
        const skipPatterns = [
            /jquery|angular|react|vue|lodash|backbone|moment/i,
            /scorm.*(?:api|runtime|wrapper|driver)/i,  // SCORM runtime libraries
            /lms.*(?:api|runtime|wrapper)/i,           // LMS API wrappers  
            /pipwerks|scormcloud|rustici/i,            // Common SCORM vendors
            /(?:min|bundle|vendor|polyfill)\.js/i,     // Bundled/minified files
            /(?:player|frame|loader)\.js/i,            // Player framework files
        ];
        
        if (skipPatterns.some(p => p.test(url))) {
            return;
        }

        let priority = PRIORITY.NORMAL;
        if (/data|quiz|question|slide|content/i.test(url)) {
            priority = PRIORITY.HIGH;
        }

        map.set(url, { url, type: url.includes('.json') ? 'json' : 'js', priority, source });
    },

    async analyze() {
        const resources = StateManager.get('resources');
        const items = [];

        const sorted = [...resources].sort((a, b) => {
            if (a.priority === PRIORITY.HIGH && b.priority !== PRIORITY.HIGH) return -1;
            if (b.priority === PRIORITY.HIGH && a.priority !== PRIORITY.HIGH) return 1;
            return 0;
        });

        for (const resource of sorted) {
            try {
                const response = await Utils.fetchWithTimeout(resource.url);
                if (!response.ok) continue;

                const text = await response.text();
                const found = this.analyzeContent(text, resource.url);
                items.push(...found);
            } catch (e) { /* Skip failed fetches */ }
        }

        return items;
    },

    analyzeContent(text, source) {
        const items = [];

        // Try JSON parse first - structured data is most reliable
        const json = Utils.safeJsonParse(text);
        if (json) {
            this.extractFromJson(json, source, items);
            return items;
        }

        // Skip pattern matching on files that look like pure code
        // (high ratio of code characters throughout)
        const sampleSize = Math.min(text.length, 2000);
        const sample = text.substring(0, sampleSize);
        const codeChars = (sample.match(/[{}\[\]();=<>!&|]/g) || []).length;
        if (codeChars / sampleSize > 0.1) {
            Logger.debug(`Skipping ${source} - appears to be code`);
            return items;
        }

        // Apply restrictive patterns with natural language validation
        for (const [type, patterns] of Object.entries(CONTENT_PATTERNS)) {
            for (const pattern of patterns) {
                // Reset regex state
                pattern.lastIndex = 0;
                const matches = text.matchAll(pattern);
                
                for (const match of matches) {
                    const content = match[1]?.trim();
                    
                    // Validate content is natural language, not code
                    if (!content || content.length < 15 || content.length > 500) continue;
                    if (!Utils.isNaturalLanguage(content)) continue;
                    
                    items.push({
                        type: type === 'questions' ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                        text: content,
                        source: `Pattern:${source}`,
                        correct: type === 'correct',
                        confidence: CONFIDENCE.LOW  // Pattern matches are low confidence
                    });
                }
            }
        }

        return items;
    },

    extractFromJson(obj, source, items, depth = 0) {
        if (!obj || depth > CONFIG.MAX_RECURSION_DEPTH) return;

        if (typeof obj === 'object' && !Array.isArray(obj)) {
            // Keys that typically contain question text
            const questionKeys = ['question', 'prompt', 'stem', 'query', 'questionText'];
            // Keys that typically contain answer text  
            const answerKeys = ['answer', 'response', 'options', 'choices', 'answerText'];
            // Keys that indicate correct answer
            const correctKeys = ['correctAnswer', 'correctResponse', 'correct'];

            for (const key of questionKeys) {
                const value = obj[key];
                if (value && typeof value === 'string' && value.length > 15) {
                    // Filter out code-like content
                    if (!Utils.isCodeLike(value)) {
                        items.push({
                            type: ITEM_TYPE.QUESTION,
                            text: value.trim(),
                            source: `JSON:${source}`,
                            confidence: CONFIDENCE.HIGH
                        });
                    }
                }
            }

            for (const key of correctKeys) {
                const value = obj[key];
                if (value && typeof value === 'string' && value.length > 2) {
                    if (!Utils.isCodeLike(value)) {
                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: value.trim(),
                            source: `JSON:${source}`,
                            correct: true,
                            confidence: CONFIDENCE.VERY_HIGH
                        });
                    }
                }
            }

            for (const key of answerKeys) {
                const value = obj[key];
                if (typeof value === 'string' && value.length > 2) {
                    if (!Utils.isCodeLike(value)) {
                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: value.trim(),
                            source: `JSON:${source}`,
                            correct: obj.isCorrect === true || obj.correct === true,
                            confidence: CONFIDENCE.HIGH
                        });
                    }
                } else if (Array.isArray(value)) {
                    value.forEach(item => {
                        if (typeof item === 'string' && !Utils.isCodeLike(item)) {
                            items.push({
                                type: ITEM_TYPE.ANSWER,
                                text: item.trim(),
                                source: `JSON:${source}`,
                                confidence: CONFIDENCE.MEDIUM
                            });
                        } else if (item && typeof item === 'object') {
                            this.extractFromJson(item, source, items, depth + 1);
                        }
                    });
                }
            }
        }

        // Recurse into arrays and nested objects
        if (Array.isArray(obj)) {
            obj.forEach(item => this.extractFromJson(item, source, items, depth + 1));
        } else if (typeof obj === 'object') {
            Object.values(obj).forEach(value => {
                if (value && typeof value === 'object') {
                    this.extractFromJson(value, source, items, depth + 1);
                }
            });
        }
    }
};


export { ResourceDiscovery };
