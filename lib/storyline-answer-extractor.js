#!/usr/bin/env node
/**
 * Storyline Answer Extractor
 *
 * Extracts correct answers from Articulate Storyline exam files using
 * dynamic reference resolution (no hardcoded IDs or magic strings).
 *
 * Methodology:
 *   1. Extract JSON from globalProvideData wrapper
 *   2. Navigate: scenes[] -> slides[] -> interactions[]
 *   3. For each interaction, find answers where status === "correct"
 *   4. Resolve answer types:
 *      - kind: "equals" -> multiple choice/response (choiceid -> choice text)
 *      - kind: "pair"   -> sequence/ordering (choiceid + statementid -> position mapping)
 *
 * Usage:
 *   Node.js:  node storyline-answer-extractor.js <path-to-data.js> [search-term]
 *   Browser:  StorylineAnswerExtractor.extract(content) or .run()
 */

(function(global) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: JSON EXTRACTION FROM globalProvideData WRAPPER
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Extract and parse JSON from Storyline's globalProvideData wrapper
     * @param {string} content - Raw file content
     * @returns {Object} Parsed JSON data
     */
    function parseGlobalProvideData(content) {
        // Match: window.globalProvideData('data', '{...escaped JSON...}')
        const match = content.match(/globalProvideData\s*\(\s*['"]data['"]\s*,\s*'(.+)'\s*\)/s);
        if (!match) {
            throw new Error('Could not find globalProvideData in content');
        }

        // Unescape JavaScript string encoding
        let jsonStr = match[1]
            .replace(/\\'/g, "'")           // \' -> '
            .replace(/\\\\"/g, '\\"')       // \\" -> \"
            .replace(/\\\\n/g, '\\n')       // \\n -> \n
            .replace(/\\\\t/g, '\\t')       // \\t -> \t
            .replace(/\\\\r/g, '\\r');      // \\r -> \r

        return JSON.parse(jsonStr);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: REFERENCE RESOLUTION (NO MAGIC STRINGS)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Find choice text by ID - handles various ID formats
     * @param {Array} choices - Array of choice objects
     * @param {string} choiceId - ID like "choices.choice_6FTlB66V8x5" or "choice_6FTlB66V8x5"
     * @returns {string|null} Choice display text
     */
    function findChoiceText(choices, choiceId) {
        if (!choices || !choiceId) return null;

        // Normalize: "choices.choice_X" -> "choice_X" -> "X"
        const cleanId = choiceId
            .replace('choices.', '')
            .replace('choice_', '');

        for (const choice of choices) {
            const choiceClean = (choice.id || '').replace('choice_', '');
            if (choiceClean === cleanId || choice.id === choiceId || choice.id === `choice_${cleanId}`) {
                return choice.lmstext || choice.text || choice.label || null;
            }
        }
        return null;
    }

    /**
     * Find statement position by ID - for ordering questions
     * @param {Array} statements - Array of statement objects
     * @param {string} statementId - ID like "statements.statement_6Sz8lyXVzi5"
     * @returns {string|null} Position number (as string, e.g., "1", "2")
     */
    function findStatementPosition(statements, statementId) {
        if (!statements || !statementId) return null;

        // Normalize: "statements.statement_X" -> "statement_X" -> "X"
        const cleanId = statementId
            .replace('statements.', '')
            .replace('statement_', '');

        for (const stmt of statements) {
            const stmtClean = (stmt.id || '').replace('statement_', '');
            if (stmtClean === cleanId || stmt.id === statementId || stmt.id === `statement_${cleanId}`) {
                return stmt.lmstext || stmt.text || stmt.position || null;
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3: ANSWER EXTRACTION BY KIND
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Extract correct answers from an interaction
     * @param {Object} interaction - Interaction object with answers[], choices[], statements[]
     * @returns {Array} Correct answers (text for equals, {position, text} for pairs)
     */
    function extractCorrectAnswers(interaction) {
        const correctAnswers = [];

        for (const answer of interaction.answers || []) {
            // Only process correct answers
            if (answer.status !== 'correct') continue;

            // Navigate: answer.evaluate.statements[]
            for (const evalStmt of answer.evaluate?.statements || []) {
                if (evalStmt.kind === 'equals') {
                    // Multiple choice/response: just need the choice text
                    const text = findChoiceText(interaction.choices, evalStmt.choiceid);
                    if (text) {
                        correctAnswers.push(text);
                    }
                } else if (evalStmt.kind === 'pair') {
                    // Sequence/ordering: map choice to position
                    const text = findChoiceText(interaction.choices, evalStmt.choiceid);
                    const position = findStatementPosition(interaction.statements, evalStmt.statementid);
                    if (text && position) {
                        correctAnswers.push({
                            position: position,
                            text: text
                        });
                    }
                }
                // Extensible: add more kinds here as discovered
            }
        }

        return correctAnswers;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 4: MAIN EXTRACTION - NAVIGATE DATA STRUCTURE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Extract all questions and answers from Storyline data
     * @param {Object} data - Parsed Storyline JSON data
     * @param {string} [searchTerm] - Optional filter term
     * @returns {Array} Array of question objects
     */
    function extractQuestions(data, searchTerm = null) {
        const results = [];

        // Navigate: scenes[] -> slides[] -> interactions[]
        for (const scene of data.scenes || []) {
            for (const slide of scene.slides || []) {
                for (const interaction of slide.interactions || []) {

                    // Optional: filter by search term
                    if (searchTerm) {
                        const searchLower = searchTerm.toLowerCase();
                        const questionText = (interaction.lmstext || '').toLowerCase();
                        if (!questionText.includes(searchLower)) {
                            continue;
                        }
                    }

                    // Extract correct answers using kind-based dispatch
                    const correctAnswers = extractCorrectAnswers(interaction);

                    // Skip interactions with no correct answers
                    if (correctAnswers.length === 0) continue;

                    // Build result object
                    results.push({
                        question_id: interaction.id,
                        question_text: (interaction.lmstext || '').replace(/\\n/g, '\n').trim(),
                        question_type: interaction.type || 'unknown',
                        choices: (interaction.choices || []).map(c => c.lmstext || c.text || ''),
                        correct_answers: correctAnswers,
                        slide_id: slide.id,
                        scene_id: scene.id
                    });
                }
            }
        }

        return results;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5: STRUCTURE ENUMERATION (FOR UNKNOWN DATA)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Enumerate data structure for debugging/discovery
     * @param {Object} obj - Object to enumerate
     * @param {number} depth - Current depth
     * @param {number} maxDepth - Maximum depth to traverse
     */
    function enumerateStructure(obj, depth = 0, maxDepth = 3) {
        if (depth > maxDepth) return;
        const indent = '  '.repeat(depth);

        for (const [key, value] of Object.entries(obj || {})) {
            const type = Array.isArray(value) ? 'array' : typeof value;
            let preview = '';

            if (type === 'array') {
                preview = `[${value.length} items]`;
            } else if (type === 'object' && value !== null) {
                preview = '{...}';
            } else if (type === 'string') {
                preview = value.substring(0, 50) + (value.length > 50 ? '...' : '');
            } else {
                preview = String(value);
            }

            console.log(`${indent}${key}: (${type}) ${preview}`);

            if (type === 'object' && value !== null) {
                enumerateStructure(value, depth + 1, maxDepth);
            } else if (type === 'array' && value.length > 0 && typeof value[0] === 'object') {
                console.log(`${indent}  [0]:`);
                enumerateStructure(value[0], depth + 2, maxDepth);
            }
        }
    }

    /**
     * Find all interaction paths in the data structure
     * @param {Object} obj - Object to search
     * @param {string} path - Current path
     */
    function findInteractions(obj, path = 'data') {
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => findInteractions(item, `${path}[${i}]`));
        } else if (obj && typeof obj === 'object') {
            if (obj.interactions && Array.isArray(obj.interactions)) {
                console.log(`Found interactions at: ${path}.interactions (${obj.interactions.length} items)`);
                if (obj.interactions[0]) {
                    console.log('  Sample keys:', Object.keys(obj.interactions[0]).join(', '));
                }
            }
            for (const [key, value] of Object.entries(obj)) {
                findInteractions(value, `${path}.${key}`);
            }
        }
    }

    /**
     * Find and display answer patterns in the data
     * @param {Object} obj - Object to search
     * @param {string} path - Current path
     */
    function findAnswerPatterns(obj, path = 'data') {
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => findAnswerPatterns(item, `${path}[${i}]`));
        } else if (obj && typeof obj === 'object') {
            if (obj.answers && Array.isArray(obj.answers)) {
                console.log(`\nAnswers at: ${path}`);
                obj.answers.forEach(ans => {
                    console.log(`  Status: ${ans.status}, Points: ${ans.points || 'N/A'}`);
                    if (ans.evaluate?.statements) {
                        ans.evaluate.statements.forEach(stmt => {
                            console.log(`    Kind: ${stmt.kind}`, JSON.stringify(stmt));
                        });
                    }
                });
            }
            for (const [key, value] of Object.entries(obj)) {
                findAnswerPatterns(value, `${path}.${key}`);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 6: OUTPUT FORMATTING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Format questions as human-readable text
     * @param {Array} questions - Array of question objects
     * @returns {string} Formatted output
     */
    function formatText(questions) {
        let output = '';

        questions.forEach((q, i) => {
            output += '================================================================================\n';
            output += `QUESTION ${i + 1}: ${q.question_text.split('\n')[0]}\n`;
            if (q.question_text.includes('\n')) {
                output += q.question_text.split('\n').slice(1).join('\n') + '\n';
            }
            output += '================================================================================\n';
            output += `Type: ${q.question_type}\n`;
            output += `ID: ${q.question_id}\n\n`;

            output += 'CHOICES:\n';
            q.choices.forEach((choice, j) => {
                output += `  ${j + 1}. ${choice}\n`;
            });

            output += '\nCORRECT ANSWER';
            if (q.correct_answers.length > 1) output += 'S';
            output += ':\n';

            // Check if answers are position-based (sequence question)
            const isSequence = q.correct_answers.some(a => typeof a === 'object' && a.position);

            if (isSequence) {
                // Sort by position and display as ordered list
                const sorted = [...q.correct_answers].sort((a, b) =>
                    parseInt(a.position) - parseInt(b.position)
                );
                sorted.forEach(ans => {
                    output += `  Position ${ans.position}: ${ans.text}\n`;
                });
            } else {
                q.correct_answers.forEach(ans => {
                    output += `  * ${ans}\n`;
                });
            }

            output += '\n';
        });

        return output;
    }

    /**
     * Format questions as JSON
     * @param {Array} questions - Array of question objects
     * @returns {string} JSON string
     */
    function formatJSON(questions) {
        return JSON.stringify(questions, null, 2);
    }

    /**
     * Format questions as CSV
     * @param {Array} questions - Array of question objects
     * @returns {string} CSV string
     */
    function formatCSV(questions) {
        let output = 'QuestionID,QuestionText,QuestionType,CorrectAnswers\n';

        questions.forEach(q => {
            const questionText = q.question_text.replace(/"/g, '""').replace(/\n/g, ' ');
            let answersText;

            const isSequence = q.correct_answers.some(a => typeof a === 'object' && a.position);
            if (isSequence) {
                const sorted = [...q.correct_answers].sort((a, b) =>
                    parseInt(a.position) - parseInt(b.position)
                );
                answersText = sorted.map(a => `${a.position}:${a.text}`).join(' | ');
            } else {
                answersText = q.correct_answers.join(' | ');
            }
            answersText = answersText.replace(/"/g, '""');

            output += `"${q.question_id}","${questionText}","${q.question_type}","${answersText}"\n`;
        });

        return output;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    const StorylineAnswerExtractor = {
        /**
         * Extract questions from globalProvideData file content
         * @param {string} content - File content
         * @param {string} [searchTerm] - Optional filter
         * @returns {Array} Extracted questions
         */
        extract(content, searchTerm = null) {
            const data = parseGlobalProvideData(content);
            return extractQuestions(data, searchTerm);
        },

        /**
         * Extract questions from already-parsed JSON data
         * @param {Object} data - Parsed Storyline data
         * @param {string} [searchTerm] - Optional filter
         * @returns {Array} Extracted questions
         */
        extractFromJSON(data, searchTerm = null) {
            return extractQuestions(data, searchTerm);
        },

        /**
         * Auto-discover and extract from browser context
         * @returns {Promise<Array>} Extracted questions
         */
        async run() {
            console.log('[StorylineAnswerExtractor] Auto-discovering data...');

            // Try window.DS first (often available in Storyline)
            if (typeof window !== 'undefined' && window.DS) {
                console.log('[StorylineAnswerExtractor] Found window.DS');
                const questions = extractQuestions(window.DS);
                console.log(`[StorylineAnswerExtractor] Extracted ${questions.length} questions`);
                return questions;
            }

            // Try to fetch data.js
            const paths = [
                './html5/data/js/data.js',
                '../html5/data/js/data.js',
                'html5/data/js/data.js',
                './data.js'
            ];

            for (const path of paths) {
                try {
                    const response = await fetch(path);
                    if (response.ok) {
                        const content = await response.text();
                        if (content.includes('globalProvideData')) {
                            console.log(`[StorylineAnswerExtractor] Found data at: ${path}`);
                            const questions = this.extract(content);
                            console.log(`[StorylineAnswerExtractor] Extracted ${questions.length} questions`);
                            return questions;
                        }
                    }
                } catch (e) {
                    // Continue to next path
                }
            }

            throw new Error('Could not find Storyline data. Try: StorylineAnswerExtractor.extract(content)');
        },

        /**
         * Format output
         * @param {Array} questions - Questions to format
         * @param {string} format - 'json', 'text', or 'csv'
         * @returns {string} Formatted output
         */
        format(questions, format = 'json') {
            switch (format.toLowerCase()) {
                case 'text':
                case 'txt':
                    return formatText(questions);
                case 'csv':
                    return formatCSV(questions);
                case 'json':
                default:
                    return formatJSON(questions);
            }
        },

        /**
         * Quick summary of correct answers
         * @param {Array} questions - Questions array
         * @returns {Array} Simplified answer list
         */
        getAnswerKey(questions) {
            return questions.map(q => {
                const isSequence = q.correct_answers.some(a => typeof a === 'object' && a.position);
                if (isSequence) {
                    const sorted = [...q.correct_answers].sort((a, b) =>
                        parseInt(a.position) - parseInt(b.position)
                    );
                    return {
                        question: q.question_text.split('\n')[0],
                        type: q.question_type,
                        answer: sorted.map(a => `${a.position}. ${a.text}`).join(' -> ')
                    };
                }
                return {
                    question: q.question_text.split('\n')[0],
                    type: q.question_type,
                    answer: q.correct_answers.join(', ')
                };
            });
        },

        // Expose utilities for debugging
        parseGlobalProvideData,
        enumerateStructure,
        findInteractions,
        findAnswerPatterns,
        findChoiceText,
        findStatementPosition
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // NODE.JS CLI
    // ═══════════════════════════════════════════════════════════════════════════

    if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
        const fs = require('fs');
        const path = require('path');

        const args = process.argv.slice(2);

        if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
            console.log(`
Storyline Answer Extractor
==========================

Extract correct answers from Articulate Storyline exam files.

Usage:
  node storyline-answer-extractor.js <data.js> [options]

Arguments:
  <data.js>           Path to Storyline data file (contains globalProvideData)

Options:
  --search=<term>     Filter questions containing <term>
  --format=<fmt>      Output format: json (default), text, csv
  --enumerate         Show data structure (for debugging)
  --output=<file>     Write output to file
  -h, --help          Show this help

Examples:
  node storyline-answer-extractor.js ./html5/data/js/data.js
  node storyline-answer-extractor.js data.js --format=text
  node storyline-answer-extractor.js data.js --search="collection plan"
  node storyline-answer-extractor.js data.js --enumerate
`);
            process.exit(0);
        }

        // Parse arguments
        const filePath = args.find(a => !a.startsWith('--'));
        const searchArg = args.find(a => a.startsWith('--search='));
        const formatArg = args.find(a => a.startsWith('--format='));
        const outputArg = args.find(a => a.startsWith('--output='));
        const enumerate = args.includes('--enumerate');

        const searchTerm = searchArg ? searchArg.split('=')[1] : null;
        const format = formatArg ? formatArg.split('=')[1] : 'json';
        const outputFile = outputArg ? outputArg.split('=')[1] : null;

        if (!filePath) {
            console.error('Error: Please provide a data file path');
            process.exit(1);
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = parseGlobalProvideData(content);

            // Enumeration mode for debugging
            if (enumerate) {
                console.log('=== DATA STRUCTURE ===\n');
                enumerateStructure(data, 0, 2);
                console.log('\n=== INTERACTION PATHS ===\n');
                findInteractions(data);
                console.log('\n=== ANSWER PATTERNS ===');
                findAnswerPatterns(data);
                process.exit(0);
            }

            // Normal extraction
            const questions = extractQuestions(data, searchTerm);
            console.error(`[INFO] Extracted ${questions.length} questions`);

            if (searchTerm) {
                console.error(`[INFO] Filtered by: "${searchTerm}"`);
            }

            const output = StorylineAnswerExtractor.format(questions, format);

            if (outputFile) {
                fs.writeFileSync(outputFile, output);
                console.error(`[INFO] Written to: ${outputFile}`);
            } else {
                console.log(output);
            }

        } catch (err) {
            console.error(`[ERROR] ${err.message}`);
            process.exit(1);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    // Browser global
    if (typeof window !== 'undefined') {
        window.StorylineAnswerExtractor = StorylineAnswerExtractor;
        console.log('[StorylineAnswerExtractor] Ready. Use: StorylineAnswerExtractor.run() or .extract(content)');
    }

    // Node.js module
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = StorylineAnswerExtractor;
    }

    // ES6 module support
    if (typeof global !== 'undefined') {
        global.StorylineAnswerExtractor = StorylineAnswerExtractor;
    }

    return StorylineAnswerExtractor;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
