/**
 * Unified Q&A Extractor v7.0
 *
 * Combines extraction patterns from:
 * - Storyline course data (storyline-console-extractor.js patterns)
 * - Storyline _data.js files (scenes/slides/interactions)
 * - xAPI/TLA network data (tasks-extractor.js patterns)
 * - Raw Storyline JSON structures
 *
 * Supports:
 * - Multiple choice / Multiple select questions
 * - Drag-drop / Sequence ordering questions (with position mapping)
 * - Hotspot questions
 * - Fill-in-the-blank questions
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
    // PATTERN 4: STORYLINE _DATA.JS EXTRACTION (scenes/slides/interactions)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Parse _data.js file content
     * Format: window.globalProvideData('data', '{...JSON...}')
     */
    function parseStorylineDataJS(content) {
        const match = content.match(/globalProvideData\s*\(\s*['"]data['"]\s*,\s*'(.+)'\s*\)/s);
        if (!match) {
            throw new Error('Could not find globalProvideData in _data.js');
        }
        let jsonStr = match[1]
            .replace(/\\'/g, "'")
            .replace(/\\\\"/g, '\\"')
            .replace(/\\\\n/g, '\\n')
            .replace(/\\\\t/g, '\\t')
            .replace(/\\\\r/g, '\\r');
        return JSON.parse(jsonStr);
    }

    /**
     * Extract sequence order for drag-drop/ordering questions
     * Maps choice IDs to their correct positions via statement matching
     */
    function extractSequenceOrder(interaction) {
        const sequenceMap = new Map();

        // Method 1: From answers with status="correct" containing eval rules
        if (interaction.answers) {
            for (const answer of interaction.answers) {
                if (answer.status === 'correct' && answer.eval) {
                    parseEvalForSequence(answer.eval, sequenceMap, interaction);
                }
            }
        }

        // Method 2: Direct choice-statement pairing (choice_xxx → statement_xxx)
        if (interaction.choices && interaction.statements) {
            for (const choice of interaction.choices) {
                const idSuffix = choice.id?.replace(/^choice_/, '');
                const matchingStatement = interaction.statements.find(s =>
                    s.id?.includes(idSuffix)
                );
                if (matchingStatement?.position) {
                    sequenceMap.set(choice.id, parseInt(matchingStatement.position, 10));
                }
            }
        }

        return sequenceMap;
    }

    function parseEvalForSequence(evalObj, sequenceMap, interaction) {
        if (!evalObj || typeof evalObj !== 'object') return;

        // Look for comparison operations mapping choices to positions
        if (evalObj.kind === 'comparison' || evalObj.type === 'comparison') {
            let choiceId = null, position = null;
            const left = evalObj.left || evalObj.lhs;
            const right = evalObj.right || evalObj.rhs;

            // Extract choice ID
            [left, right].forEach(val => {
                if (typeof val === 'string' && val.includes('choice_')) {
                    choiceId = val.match(/choice_[A-Za-z0-9]+/)?.[0];
                }
                if (typeof val === 'string' && val.includes('statement_')) {
                    const stmtId = val.match(/statement_[A-Za-z0-9]+/)?.[0];
                    const stmt = interaction.statements?.find(s => s.id === stmtId);
                    if (stmt?.position) position = parseInt(stmt.position, 10);
                }
                if (typeof val === 'number') position = val;
                if (typeof val === 'string' && /^\d+$/.test(val)) position = parseInt(val, 10);
            });

            if (choiceId && position) sequenceMap.set(choiceId, position);
        }

        // Recurse
        for (const key in evalObj) {
            if (Array.isArray(evalObj[key])) {
                evalObj[key].forEach(item => parseEvalForSequence(item, sequenceMap, interaction));
            } else if (typeof evalObj[key] === 'object') {
                parseEvalForSequence(evalObj[key], sequenceMap, interaction);
            }
        }
    }

    function extractFromStorylineDataJS(data) {
        const questions = [];

        if (!data.scenes) return questions;

        for (const scene of data.scenes) {
            if (!scene.slides) continue;

            for (const slide of scene.slides) {
                const questionText = cleanText((slide.title || '').replace(/<[^>]*>/g, ''));

                // Process interactions
                const interactions = slide.interactions || [];
                for (const interaction of interactions) {
                    const q = extractFromInteraction(interaction, questionText, slide.id);
                    if (q) questions.push(q);
                }

                // Process slide layers
                if (slide.slideLayers) {
                    for (const layer of slide.slideLayers) {
                        if (!layer.objects) continue;
                        for (const obj of layer.objects) {
                            if (obj.kind === 'sequencectrl' && obj.data?.itemlist) {
                                const q = extractFromSequenceCtrl(obj, questionText, slide.id);
                                if (q) questions.push(q);
                            }
                        }
                    }
                }
            }
        }

        return questions;
    }

    function extractFromInteraction(interaction, questionText, slideId) {
        const type = interaction.type?.toLowerCase() || '';
        const hasStatements = interaction.statements?.length > 0;
        const isSequence = type.includes('sequence') || type.includes('order') ||
                          type.includes('drag') || hasStatements;

        const sequenceMap = isSequence ? extractSequenceOrder(interaction) : new Map();
        const answers = [];

        if (interaction.choices) {
            for (const choice of interaction.choices) {
                const text = cleanText(choice.text || choice.label || '');
                if (!text) continue;

                const answer = {
                    id: choice.id,
                    text,
                    correct: false,
                    sequence: null
                };

                if (isSequence && sequenceMap.has(choice.id)) {
                    answer.sequence = sequenceMap.get(choice.id);
                    answer.correct = true;
                } else {
                    answer.correct = choice.correct === true || choice.isCorrect === true;
                }

                answers.push(answer);
            }
        }

        // Sort sequence answers by position
        if (isSequence) {
            answers.sort((a, b) => (a.sequence || 999) - (b.sequence || 999));
        }

        if (answers.length === 0) return null;

        const questionType = isSequence ? 'sequence' :
                            interaction.multiSelect ? 'multiple-select' : 'multiple-choice';

        return {
            slideId,
            questionId: interaction.id,
            question: questionText || interaction.prompt || '',
            questionType,
            answers,
            correctSequence: isSequence ? answers.filter(a => a.sequence).map(a => ({
                position: a.sequence,
                text: a.text
            })).sort((a, b) => a.position - b.position) : null,
            source: 'storyline-data'
        };
    }

    function extractFromSequenceCtrl(obj, questionText, slideId) {
        const answers = [];

        for (let i = 0; i < obj.data.itemlist.length; i++) {
            const item = obj.data.itemlist[i];
            const text = cleanText(item.textdata?.altText || item.textdata?.lmstext || '');
            if (text) {
                answers.push({
                    id: item.itemdata || `item_${i}`,
                    text,
                    correct: true,
                    sequence: i + 1
                });
            }
        }

        if (answers.length === 0) return null;

        return {
            slideId,
            questionId: obj.id,
            question: questionText,
            questionType: 'sequence',
            answers,
            correctSequence: answers.map(a => ({ position: a.sequence, text: a.text })),
            source: 'storyline-data'
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PATTERN 5: RAW STORYLINE JSON EXTRACTION
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
         * @param {Object|string} data - Data to extract from (object or _data.js content string)
         * @param {string} type - Data type: 'storyline', 'storyline-data', 'xapi-manifest', 'xapi-statements', 'raw'
         * @param {Object} options - Additional options (e.g., slideId)
         * @returns {Array} Extracted questions/answers
         */
        extract(data, type = 'auto', options = {}) {
            log.info(`Extracting Q&A (type: ${type})`);

            // Handle string input (likely _data.js content)
            if (typeof data === 'string') {
                if (data.includes('globalProvideData')) {
                    type = 'storyline-data-js';
                    data = parseStorylineDataJS(data);
                    type = 'storyline-data';
                }
            }

            // Auto-detect type
            if (type === 'auto') {
                if (data.taskGroups) type = 'xapi-manifest';
                else if (Array.isArray(data) && data[0]?.verb) type = 'xapi-statements';
                else if (data.scenes && data.scenes[0]?.slides) type = 'storyline-data';
                else if (data.slideLayers || data.objects) type = 'storyline';
                else type = 'raw';
                log.info(`Auto-detected type: ${type}`);
            }

            switch (type) {
                case 'storyline':
                    return extractFromStorylineData(data, options.slideId || 'unknown');
                case 'storyline-data':
                    return extractFromStorylineDataJS(data);
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
         * Parse _data.js file content and extract Q&A
         * @param {string} content - Contents of _data.js file
         * @returns {Array} Extracted questions
         */
        extractFromDataJS(content) {
            const data = parseStorylineDataJS(content);
            return extractFromStorylineDataJS(data);
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
                        output += `--- Question ${i + 1} [${q.slideId || 'N/A'}] ---\n`;
                        output += `Type: ${q.questionType || 'unknown'}\n`;
                        if (q.question) output += `Q: ${q.question}\n`;

                        // Handle sequence/ordering questions specially
                        if (q.correctSequence && q.correctSequence.length > 0) {
                            output += `\nCorrect Sequence:\n`;
                            q.correctSequence.forEach(item => {
                                output += `  ${item.position}. ${item.text}\n`;
                            });
                        } else if (q.answers) {
                            output += `\nAnswers:\n`;
                            q.answers.forEach((a, j) => {
                                const marker = a.correct ? '[X]' : '[ ]';
                                const seq = a.sequence ? ` (pos: ${a.sequence})` : '';
                                output += `  ${j + 1}. ${marker} ${a.text}${seq}\n`;
                            });
                        }
                        output += '\n';
                    });
                    return output;
                }

                case 'csv': {
                    let output = 'SlideID,Question,Answer,Correct,Sequence,Type,Source\n';
                    qa.forEach(q => {
                        if (q.answers) {
                            q.answers.forEach(a => {
                                const slideId = (q.slideId || '').replace(/"/g, '""');
                                const question = (q.question || '').replace(/"/g, '""');
                                const answer = (a.text || '').replace(/"/g, '""');
                                const sequence = a.sequence || '';
                                output += `"${slideId}","${question}","${answer}",${a.correct},${sequence},${q.questionType || ''},${q.source || ''}\n`;
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
         * @returns {Array} Questions with only correct answers (or sequence order)
         */
        getCorrectAnswers(qa) {
            return qa.map(q => {
                // For sequence questions, return the correct sequence
                if (q.correctSequence && q.correctSequence.length > 0) {
                    return {
                        slideId: q.slideId,
                        question: q.question,
                        questionType: q.questionType,
                        correctSequence: q.correctSequence,
                        correctAnswer: q.correctSequence.map(s => `${s.position}. ${s.text}`).join(' → '),
                        source: q.source
                    };
                }
                // For other questions, filter to correct answers
                return {
                    ...q,
                    answers: (q.answers || []).filter(a => a.correct),
                    correctAnswer: (q.answers || []).filter(a => a.correct).map(a => a.text).join(', ')
                };
            }).filter(q => q.answers?.length > 0 || q.correctSequence?.length > 0);
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
