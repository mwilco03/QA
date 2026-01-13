/**
 * Unified Q&A Extractor v1.0
 *
 * Combines extraction patterns from:
 * - Storyline course data (UKI.js patterns)
 * - xAPI/TLA network data (tasks-extractor.js patterns)
 * - Raw Storyline JSON structures
 *
 * Usage:
 *   Browser Console: Paste and run, then call window.UnifiedQAExtractor.extract()
 *   Node.js: const extractor = require('./unified-qa-extractor.js')
 */

(function(global) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // Question indicator keywords
        questionIndicators: [
            '?', 'select', 'choose', 'which', 'what', 'identify', 'match',
            'drag', 'complete', 'fill', 'order', 'arrange', 'indicate',
            'determine', 'find', 'locate', 'click', 'true or false',
            'correct answer', 'best answer', 'following', 'statement',
            'example', 'describes', 'represents', 'demonstrates'
        ],

        // Storyline accessibility types that indicate answers
        answerAccTypes: [
            'checkbox', 'radiobutton', 'button', 'hotspot',
            'dragitem', 'dropzone', 'droptarget', 'textentry',
            'textinput', 'input', 'clickable', 'selectable'
        ],

        // State names indicating correct answers
        correctStateIndicators: [
            '_Review', '_Selected_Review', 'Correct', 'Right', 'True',
            'Yes', 'Selected_Correct', 'Drop_Correct', 'Drag_Correct',
            'Match_Correct', 'Answer_Correct'
        ],

        // State names indicating incorrect answers
        incorrectStateIndicators: [
            'Incorrect', 'Wrong', 'False', 'No',
            'Drop_Incorrect', 'Drag_Incorrect'
        ],

        // Navigation buttons to exclude
        excludeButtonText: [
            'continue', 'next', 'back', 'previous', 'submit', 'exit',
            'close', 'menu', 'home', 'restart', 'replay', 'review',
            'try again', 'start', 'begin', 'finish', 'done', 'ok',
            'cancel', 'skip', 'play', 'pause', 'stop', 'forward', 'rewind'
        ],

        // xAPI verbs
        xapiVerbs: {
            ANSWERED: 'http://adlnet.gov/expapi/verbs/answered',
            COMPLETED: 'http://adlnet.gov/expapi/verbs/completed',
            PASSED: 'http://adlnet.gov/expapi/verbs/passed',
            FAILED: 'http://adlnet.gov/expapi/verbs/failed'
        },

        // Minimum lengths
        minAnswerLength: 1,
        minQuestionLength: 10,

        // Logging
        verbose: false
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const log = {
        info: (msg, data) => console.log(`[QAExtractor] ${msg}`, data || ''),
        verbose: (msg, data) => CONFIG.verbose && console.log(`[QAExtractor] ${msg}`, data || ''),
        warn: (msg, data) => console.warn(`[QAExtractor] ${msg}`, data || ''),
        error: (msg, data) => console.error(`[QAExtractor] ${msg}`, data || '')
    };

    function cleanText(text) {
        if (!text) return '';
        return text
            .replace(/\\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isNavigationButton(text) {
        const lower = text.toLowerCase().trim();
        return CONFIG.excludeButtonText.some(exc =>
            lower === exc || lower.includes(exc)
        );
    }

    function isQuestionText(text) {
        if (!text || text.length < CONFIG.minQuestionLength) return false;
        const lower = text.toLowerCase();
        return CONFIG.questionIndicators.some(ind => lower.includes(ind.toLowerCase()));
    }

    function isAnswerType(accType) {
        if (!accType) return false;
        return CONFIG.answerAccTypes.some(t =>
            accType.toLowerCase() === t.toLowerCase()
        );
    }

    function hasCorrectState(states) {
        if (!states || !Array.isArray(states)) return false;
        const hasCorrect = states.some(s =>
            CONFIG.correctStateIndicators.some(ind =>
                s.name?.toLowerCase().includes(ind.toLowerCase())
            )
        );
        const allIncorrect = states.every(s =>
            CONFIG.incorrectStateIndicators.some(ind =>
                s.name?.toLowerCase().includes(ind.toLowerCase())
            )
        );
        return hasCorrect && !allIncorrect;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PATTERN 1: STORYLINE DATA EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractFromStorylineData(slideData, slideId) {
        const result = {
            slideId,
            question: '',
            questionType: null,
            answers: [],
            source: 'storyline'
        };

        function extractText(obj) {
            if (obj.textLib?.[0]?.vartext?.blocks) {
                return obj.textLib[0].vartext.blocks
                    .flatMap(b => b.spans?.map(s => s.text) || [])
                    .join('');
            }
            if (obj.rawText) return obj.rawText;
            if (typeof obj.text === 'string') return obj.text;
            if (typeof obj.title === 'string') return obj.title;
            if (typeof obj.label === 'string') return obj.label;
            if (typeof obj.accText === 'string') return obj.accText;
            return '';
        }

        function search(obj) {
            if (!obj || typeof obj !== 'object') return;

            const text = cleanText(extractText(obj));
            const accType = obj.accType;

            // Check for answer elements
            if (isAnswerType(accType) && text && text.length >= CONFIG.minAnswerLength) {
                // Skip navigation buttons
                if (accType === 'button' && isNavigationButton(text)) {
                    log.verbose(`Skipped nav button: "${text}"`);
                    return;
                }

                // Skip duplicates
                if (result.answers.some(a => a.text === text)) {
                    log.verbose(`Skipped duplicate: "${text}"`);
                    return;
                }

                const correct = hasCorrectState(obj.states);

                result.answers.push({
                    text,
                    correct,
                    accType,
                    states: obj.states?.map(s => s.name) || []
                });

                // Determine question type
                if (!result.questionType) {
                    if (accType === 'checkbox') result.questionType = 'multiple-select';
                    else if (accType === 'radiobutton') result.questionType = 'multiple-choice';
                    else if (['dragitem', 'dropzone', 'droptarget'].includes(accType)) result.questionType = 'drag-drop';
                    else if (accType === 'hotspot') result.questionType = 'hotspot';
                    else if (['textentry', 'textinput'].includes(accType)) result.questionType = 'fill-in';
                    else if (accType === 'button') result.questionType = 'button-choice';
                }
            }

            // Check for question text
            if ((accType === 'text' || !accType) && isQuestionText(text)) {
                if (!result.answers.some(a => a.text === text)) {
                    if (!result.question || text.length > result.question.length) {
                        result.question = text;
                    }
                }
            }

            // Recurse
            for (const key in obj) {
                if (Array.isArray(obj[key])) {
                    obj[key].forEach(item => search(item));
                } else if (typeof obj[key] === 'object') {
                    search(obj[key]);
                }
            }
        }

        search(slideData);
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PATTERN 2: XAPI/TLA MANIFEST EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractFromTasksManifest(manifest) {
        const questions = [];

        if (!manifest?.taskGroups) {
            log.verbose('No taskGroups found in manifest');
            return questions;
        }

        for (const group of manifest.taskGroups) {
            if (!group.tasks) continue;

            for (const task of group.tasks) {
                if (!task.questions) continue;

                for (const q of task.questions) {
                    questions.push({
                        id: q.id,
                        question: q.prompt || q.question || '',
                        questionType: q.type || 'CHOICE',
                        answers: (q.choices || []).map(c => ({
                            id: c.id,
                            text: c.text || c.label || '',
                            correct: c.correct || false
                        })),
                        taskId: task.id,
                        taskTitle: task.title,
                        source: 'xapi-manifest'
                    });
                }
            }
        }

        log.info(`Extracted ${questions.length} questions from manifest`);
        return questions;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PATTERN 3: XAPI STATEMENT EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractFromXAPIStatements(statements) {
        const answers = new Map();

        for (const statement of statements) {
            const verbId = statement.verb?.id;
            const result = statement.result;

            if (verbId === CONFIG.xapiVerbs.ANSWERED && result) {
                const objectId = statement.object?.id || '';
                const questionIdMatch = objectId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
                const questionId = questionIdMatch ? questionIdMatch[1] : objectId;

                answers.set(questionId, {
                    questionId,
                    response: result.response,
                    success: result.success,
                    score: result.score,
                    timestamp: statement.timestamp,
                    source: 'xapi-statement'
                });

                if (result.success === true) {
                    log.info(`Correct answer found for Q ${questionId.substring(0, 8)}...: "${result.response}"`);
                }
            }
        }

        return Array.from(answers.values());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PATTERN 4: RAW STORYLINE JSON EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractFromRawStorylineJSON(json) {
        const questions = [];

        function findSequenceControls(obj, path = '') {
            if (!obj || typeof obj !== 'object') return;

            // Look for sequencectrl (ordering questions) or quiz-like structures
            if (obj.kind === 'sequencectrl' && obj.data?.itemlist) {
                const q = {
                    slideId: path,
                    question: '',
                    questionType: 'sequence',
                    answers: [],
                    source: 'storyline-raw'
                };

                for (const item of obj.data.itemlist) {
                    if (item.textdata) {
                        q.answers.push({
                            text: cleanText(item.textdata.altText || item.textdata.lmstext || ''),
                            correct: null, // Sequence order determines correctness
                            id: item.itemdata
                        });
                    }
                }

                if (q.answers.length > 0) {
                    questions.push(q);
                }
            }

            // Look for quiz slide patterns
            if (obj.kind === 'slide' && obj.title) {
                const titleText = obj.title.replace(/<[^>]*>/g, '').trim();
                if (isQuestionText(titleText)) {
                    // This slide might be a question
                    log.verbose(`Potential question slide: ${titleText.substring(0, 50)}...`);
                }
            }

            // Look for choice patterns in quiz structures
            if (obj.choices && Array.isArray(obj.choices)) {
                const q = {
                    id: obj.id,
                    question: obj.prompt || obj.question || '',
                    questionType: obj.type || 'choice',
                    answers: obj.choices.map(c => ({
                        text: c.text || c.label || '',
                        correct: c.correct || false,
                        id: c.id
                    })),
                    source: 'storyline-raw'
                };
                questions.push(q);
            }

            // Recurse
            for (const key in obj) {
                if (Array.isArray(obj[key])) {
                    obj[key].forEach((item, idx) => findSequenceControls(item, `${path}.${key}[${idx}]`));
                } else if (typeof obj[key] === 'object') {
                    findSequenceControls(obj[key], `${path}.${key}`);
                }
            }
        }

        findSequenceControls(json);
        return questions;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN EXTRACTION API
    // ═══════════════════════════════════════════════════════════════════════════

    const UnifiedQAExtractor = {
        config: CONFIG,

        /**
         * Extract Q&A from any supported data format
         * @param {Object} data - Data to extract from
         * @param {string} type - Data type: 'storyline', 'xapi-manifest', 'xapi-statements', 'raw'
         * @param {Object} options - Additional options (e.g., slideId)
         * @returns {Array} Extracted questions/answers
         */
        extract(data, type = 'auto', options = {}) {
            log.info(`Extracting Q&A (type: ${type})`);

            // Auto-detect type
            if (type === 'auto') {
                if (data.taskGroups) type = 'xapi-manifest';
                else if (Array.isArray(data) && data[0]?.verb) type = 'xapi-statements';
                else if (data.slideLayers || data.objects) type = 'storyline';
                else type = 'raw';
                log.info(`Auto-detected type: ${type}`);
            }

            switch (type) {
                case 'storyline':
                    return extractFromStorylineData(data, options.slideId || 'unknown');
                case 'xapi-manifest':
                    return extractFromTasksManifest(data);
                case 'xapi-statements':
                    return extractFromXAPIStatements(data);
                case 'raw':
                    return extractFromRawStorylineJSON(data);
                default:
                    log.error(`Unknown extraction type: ${type}`);
                    return [];
            }
        },

        /**
         * Merge Q&A from multiple sources
         * @param {Array} qaArrays - Arrays of Q&A results
         * @returns {Array} Merged and deduplicated results
         */
        merge(...qaArrays) {
            const merged = new Map();
            const flat = qaArrays.flat();

            for (const qa of flat) {
                const key = qa.question || qa.id || qa.slideId || JSON.stringify(qa.answers);
                if (!merged.has(key)) {
                    merged.set(key, qa);
                } else {
                    // Merge answers from different sources
                    const existing = merged.get(key);
                    if (qa.answers && existing.answers) {
                        const existingTexts = new Set(existing.answers.map(a => a.text));
                        for (const answer of qa.answers) {
                            if (!existingTexts.has(answer.text)) {
                                existing.answers.push(answer);
                            }
                        }
                    }
                }
            }

            return Array.from(merged.values());
        },

        /**
         * Export Q&A to various formats
         * @param {Array} qa - Q&A data
         * @param {string} format - Output format: 'json', 'text', 'csv'
         * @returns {string} Formatted output
         */
        export(qa, format = 'json') {
            switch (format) {
                case 'json':
                    return JSON.stringify(qa, null, 2);

                case 'text': {
                    let output = '=== EXTRACTED Q&A ===\n\n';
                    qa.forEach((q, i) => {
                        output += `--- Question ${i + 1} ---\n`;
                        if (q.question) output += `Q: ${q.question}\n`;
                        if (q.answers) {
                            q.answers.forEach((a, j) => {
                                output += `  ${j + 1}. ${a.correct ? '[X]' : '[ ]'} ${a.text}\n`;
                            });
                        }
                        output += '\n';
                    });
                    return output;
                }

                case 'csv': {
                    let output = 'Question,Answer,Correct,Type,Source\n';
                    qa.forEach(q => {
                        if (q.answers) {
                            q.answers.forEach(a => {
                                const question = (q.question || '').replace(/"/g, '""');
                                const answer = (a.text || '').replace(/"/g, '""');
                                output += `"${question}","${answer}",${a.correct},${q.questionType || ''},${q.source || ''}\n`;
                            });
                        }
                    });
                    return output;
                }

                default:
                    return JSON.stringify(qa);
            }
        },

        /**
         * Download Q&A as a file (browser only)
         * @param {Array} qa - Q&A data
         * @param {string} format - Output format
         * @param {string} filename - Output filename
         */
        download(qa, format = 'json', filename = 'qa_export') {
            if (typeof document === 'undefined') {
                log.error('Download only available in browser environment');
                return;
            }

            const content = this.export(qa, format);
            const ext = format === 'csv' ? 'csv' : format === 'text' ? 'txt' : 'json';
            const type = format === 'csv' ? 'text/csv' : format === 'text' ? 'text/plain' : 'application/json';

            const blob = new Blob([content], { type });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${filename}.${ext}`;
            a.click();
            log.info(`Downloaded ${filename}.${ext}`);
        },

        /**
         * Get correct answers only
         * @param {Array} qa - Q&A data
         * @returns {Array} Questions with only correct answers
         */
        getCorrectAnswers(qa) {
            return qa.map(q => ({
                ...q,
                answers: (q.answers || []).filter(a => a.correct)
            })).filter(q => q.answers.length > 0);
        },

        /**
         * Get statistics about extracted Q&A
         * @param {Array} qa - Q&A data
         * @returns {Object} Statistics
         */
        getStats(qa) {
            const stats = {
                totalQuestions: qa.length,
                totalAnswers: 0,
                correctAnswers: 0,
                byType: {},
                bySource: {}
            };

            for (const q of qa) {
                const answers = q.answers || [];
                stats.totalAnswers += answers.length;
                stats.correctAnswers += answers.filter(a => a.correct).length;

                const type = q.questionType || 'unknown';
                stats.byType[type] = (stats.byType[type] || 0) + 1;

                const source = q.source || 'unknown';
                stats.bySource[source] = (stats.bySource[source] || 0) + 1;
            }

            return stats;
        },

        // Enable verbose logging
        setVerbose(enabled) {
            CONFIG.verbose = enabled;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════════════════════════════════════════

    // Browser global
    if (typeof window !== 'undefined') {
        window.UnifiedQAExtractor = UnifiedQAExtractor;
        log.info('UnifiedQAExtractor loaded. Use window.UnifiedQAExtractor.extract(data) to extract Q&A');
    }

    // Node.js module
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = UnifiedQAExtractor;
    }

    // Return for IIFE
    return UnifiedQAExtractor;

})(typeof window !== 'undefined' ? window : global);
