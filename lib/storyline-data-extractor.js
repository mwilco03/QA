#!/usr/bin/env node
/**
 * Storyline Data Extractor v7.0
 *
 * Extracts Q&A from Articulate Storyline _data.js files
 *
 * Methodology:
 * 1. Parse _data.js: window.globalProvideData('data', '{...JSON...}')
 * 2. Navigate: scenes[] → slides[] → interactions[]
 * 3. Extract: choices[], statements[], answers[]
 * 4. For ordering questions: map choice IDs to statement positions
 *
 * Usage:
 *   Node.js: node storyline-data-extractor.js <path-to-_data.js> [search-term]
 *   Browser: StorylineExtractor.extractFromDataJS(dataJsContent)
 */

(function(global) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // PARSER: Extract JSON from _data.js
    // ═══════════════════════════════════════════════════════════════════════════

    function parseDataJS(content) {
        // Match: window.globalProvideData('data', '{...}')
        const match = content.match(/globalProvideData\s*\(\s*['"]data['"]\s*,\s*'(.+)'\s*\)/s);
        if (!match) {
            throw new Error('Could not find globalProvideData in _data.js');
        }

        // Unescape the JSON string
        let jsonStr = match[1]
            .replace(/\\'/g, "'")
            .replace(/\\\\"/g, '\\"')
            .replace(/\\\\n/g, '\\n')
            .replace(/\\\\t/g, '\\t')
            .replace(/\\\\r/g, '\\r');

        return JSON.parse(jsonStr);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TEXT EXTRACTION HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function cleanText(text) {
        if (!text) return '';
        return text
            .replace(/<[^>]*>/g, '')  // Remove HTML tags
            .replace(/\\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function extractTextFromBlocks(textLib) {
        if (!textLib?.[0]?.vartext?.blocks) return '';
        return textLib[0].vartext.blocks
            .flatMap(b => b.spans?.map(s => s.text) || [])
            .join('')
            .trim();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // QUESTION TYPE DETECTION
    // ═══════════════════════════════════════════════════════════════════════════

    function detectQuestionType(interaction) {
        const type = interaction.type?.toLowerCase() || '';
        const hasStatements = interaction.statements && interaction.statements.length > 0;
        const hasChoices = interaction.choices && interaction.choices.length > 0;

        if (type.includes('sequence') || type.includes('order')) return 'sequence';
        if (type.includes('drag') || type.includes('drop')) return 'drag-drop';
        if (type.includes('match')) return 'matching';
        if (type.includes('hotspot')) return 'hotspot';
        if (type.includes('text') || type.includes('fill')) return 'fill-in';

        // Infer from structure
        if (hasStatements && hasChoices) return 'sequence';
        if (interaction.multiSelect) return 'multiple-select';

        return 'multiple-choice';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEQUENCE/ORDERING EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Extract correct sequence order from answers
     * For ordering questions, answers with status="correct" contain
     * evaluation rules that map choice IDs to positions (statements)
     */
    function extractSequenceOrder(interaction) {
        const sequenceMap = new Map(); // choiceId -> position

        // Method 1: From answers with evaluation rules
        if (interaction.answers) {
            for (const answer of interaction.answers) {
                if (answer.status === 'correct' && answer.eval) {
                    // eval contains rules like: choice_xxx matches statement_xxx
                    // where statement_xxx has a position property
                    parseEvalRules(answer.eval, sequenceMap, interaction);
                }
            }
        }

        // Method 2: From direct choice-statement pairing
        // Sometimes choice IDs match statement IDs directly
        if (interaction.choices && interaction.statements) {
            for (const choice of interaction.choices) {
                const choiceId = choice.id;
                // Find matching statement (same ID suffix pattern)
                const idSuffix = choiceId.replace(/^choice_/, '');
                const matchingStatement = interaction.statements.find(s =>
                    s.id?.includes(idSuffix)
                );
                if (matchingStatement && matchingStatement.position) {
                    sequenceMap.set(choiceId, parseInt(matchingStatement.position, 10));
                }
            }
        }

        // Method 3: From answer correctResponse
        if (interaction.answers) {
            for (const answer of interaction.answers) {
                if (answer.correctResponse) {
                    // correctResponse might be an array of choice IDs in order
                    if (Array.isArray(answer.correctResponse)) {
                        answer.correctResponse.forEach((choiceId, idx) => {
                            sequenceMap.set(choiceId, idx + 1);
                        });
                    }
                }
            }
        }

        return sequenceMap;
    }

    function parseEvalRules(evalObj, sequenceMap, interaction) {
        if (!evalObj) return;

        // Recursively search for choice-statement mappings
        function search(obj) {
            if (!obj || typeof obj !== 'object') return;

            // Look for comparison operations
            if (obj.kind === 'comparison' || obj.type === 'comparison') {
                const left = obj.left || obj.lhs;
                const right = obj.right || obj.rhs;

                // Check if this maps a choice to a statement/position
                if (left && right) {
                    let choiceId = null;
                    let position = null;

                    // Extract choice ID
                    if (typeof left === 'string' && left.includes('choice_')) {
                        choiceId = left.match(/choice_[A-Za-z0-9]+/)?.[0];
                    }
                    if (typeof right === 'string' && right.includes('choice_')) {
                        choiceId = right.match(/choice_[A-Za-z0-9]+/)?.[0];
                    }

                    // Extract position from statement reference
                    if (typeof left === 'string' && left.includes('statement_')) {
                        const stmtId = left.match(/statement_[A-Za-z0-9]+/)?.[0];
                        position = findStatementPosition(stmtId, interaction);
                    }
                    if (typeof right === 'string' && right.includes('statement_')) {
                        const stmtId = right.match(/statement_[A-Za-z0-9]+/)?.[0];
                        position = findStatementPosition(stmtId, interaction);
                    }

                    // Direct position number
                    if (typeof left === 'number') position = left;
                    if (typeof right === 'number') position = right;
                    if (typeof left === 'string' && /^\d+$/.test(left)) position = parseInt(left, 10);
                    if (typeof right === 'string' && /^\d+$/.test(right)) position = parseInt(right, 10);

                    if (choiceId && position) {
                        sequenceMap.set(choiceId, position);
                    }
                }
            }

            // Recurse into nested structures
            for (const key in obj) {
                if (Array.isArray(obj[key])) {
                    obj[key].forEach(item => search(item));
                } else if (typeof obj[key] === 'object') {
                    search(obj[key]);
                }
            }
        }

        search(evalObj);
    }

    function findStatementPosition(statementId, interaction) {
        if (!interaction.statements || !statementId) return null;
        const statement = interaction.statements.find(s => s.id === statementId);
        return statement?.position ? parseInt(statement.position, 10) : null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractQuestions(data) {
        const questions = [];

        if (!data.scenes) {
            console.warn('No scenes found in data');
            return questions;
        }

        for (const scene of data.scenes) {
            if (!scene.slides) continue;

            for (const slide of scene.slides) {
                // Extract question from slide title
                const questionText = cleanText(slide.title || '');

                // Skip non-question slides
                if (!slide.interactions && !slide.slideLayers) continue;

                // Process interactions directly on slide
                if (slide.interactions) {
                    for (const interaction of slide.interactions) {
                        const q = extractFromInteraction(interaction, questionText, slide.id);
                        if (q) questions.push(q);
                    }
                }

                // Process slide layers (questions might be in layers)
                if (slide.slideLayers) {
                    for (const layer of slide.slideLayers) {
                        if (layer.objects) {
                            for (const obj of layer.objects) {
                                if (obj.kind === 'sequencectrl' || obj.interactions) {
                                    const q = extractFromObject(obj, questionText, slide.id);
                                    if (q) questions.push(q);
                                }
                            }
                        }
                    }
                }
            }
        }

        return questions;
    }

    function extractFromInteraction(interaction, questionText, slideId) {
        const questionType = detectQuestionType(interaction);
        const isSequence = questionType === 'sequence' || questionType === 'drag-drop';

        // Get sequence mapping for ordering questions
        const sequenceMap = isSequence ? extractSequenceOrder(interaction) : new Map();

        // Extract choices/answers
        const answers = [];

        if (interaction.choices) {
            for (const choice of interaction.choices) {
                const text = cleanText(choice.text || choice.label || extractTextFromBlocks(choice.textLib));
                if (!text) continue;

                const answer = {
                    id: choice.id,
                    text: text,
                    correct: false,
                    sequence: null
                };

                // For sequence questions, add position
                if (isSequence && sequenceMap.has(choice.id)) {
                    answer.sequence = sequenceMap.get(choice.id);
                    answer.correct = true; // Has a defined position = part of correct answer
                }

                // For non-sequence, check if marked correct
                if (!isSequence) {
                    answer.correct = choice.correct === true ||
                                    choice.isCorrect === true ||
                                    choice.status === 'correct';
                }

                answers.push(answer);
            }
        }

        // Sort sequence answers by position
        if (isSequence) {
            answers.sort((a, b) => (a.sequence || 999) - (b.sequence || 999));
        }

        // Check if any answers marked correct from interaction.answers
        if (interaction.answers && !isSequence) {
            for (const ans of interaction.answers) {
                if (ans.status === 'correct' && ans.choiceId) {
                    const found = answers.find(a => a.id === ans.choiceId);
                    if (found) found.correct = true;
                }
            }
        }

        if (answers.length === 0) return null;

        return {
            slideId,
            questionId: interaction.id,
            question: questionText || interaction.prompt || interaction.question || '',
            questionType,
            answers,
            correctSequence: isSequence ? answers.filter(a => a.sequence).map(a => ({
                position: a.sequence,
                text: a.text
            })).sort((a, b) => a.position - b.position) : null,
            source: 'storyline-data'
        };
    }

    function extractFromObject(obj, questionText, slideId) {
        // Handle sequencectrl objects (drag-drop ordering)
        if (obj.kind === 'sequencectrl' && obj.data?.itemlist) {
            const answers = [];

            for (let i = 0; i < obj.data.itemlist.length; i++) {
                const item = obj.data.itemlist[i];
                const text = cleanText(
                    item.textdata?.altText ||
                    item.textdata?.lmstext ||
                    extractTextFromBlocks(item.textLib)
                );

                if (text) {
                    answers.push({
                        id: item.itemdata || `item_${i}`,
                        text,
                        correct: true, // All items in sequence are part of answer
                        sequence: i + 1 // Position in list = correct sequence
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
                correctSequence: answers.map(a => ({
                    position: a.sequence,
                    text: a.text
                })),
                source: 'storyline-data'
            };
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OUTPUT FORMATTING
    // ═══════════════════════════════════════════════════════════════════════════

    function formatOutput(questions, format = 'json') {
        switch (format) {
            case 'json':
                return JSON.stringify(questions, null, 2);

            case 'text': {
                let output = `=== STORYLINE Q&A EXTRACTION ===\n`;
                output += `Total Questions: ${questions.length}\n\n`;

                questions.forEach((q, i) => {
                    output += `━━━ Question ${i + 1} [${q.slideId || 'N/A'}] ━━━\n`;
                    output += `Type: ${q.questionType}\n`;
                    if (q.question) output += `Q: ${q.question}\n`;

                    if (q.questionType === 'sequence' && q.correctSequence) {
                        output += `\nCorrect Sequence:\n`;
                        q.correctSequence.forEach(item => {
                            output += `  ${item.position}. ${item.text}\n`;
                        });
                    } else {
                        output += `\nAnswers:\n`;
                        q.answers.forEach((a, j) => {
                            const marker = a.correct ? '[✓]' : '[ ]';
                            const seq = a.sequence ? ` (pos: ${a.sequence})` : '';
                            output += `  ${j + 1}. ${marker} ${a.text}${seq}\n`;
                        });
                    }
                    output += '\n';
                });

                return output;
            }

            case 'csv': {
                let output = 'SlideID,Question,QuestionType,Answer,Correct,Sequence\n';
                questions.forEach(q => {
                    q.answers.forEach(a => {
                        const question = (q.question || '').replace(/"/g, '""');
                        const answer = (a.text || '').replace(/"/g, '""');
                        output += `"${q.slideId}","${question}","${q.questionType}","${answer}",${a.correct},${a.sequence || ''}\n`;
                    });
                });
                return output;
            }

            default:
                return JSON.stringify(questions, null, 2);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEARCH/FILTER
    // ═══════════════════════════════════════════════════════════════════════════

    function searchQuestions(questions, term) {
        if (!term) return questions;
        const lower = term.toLowerCase();
        return questions.filter(q =>
            q.question?.toLowerCase().includes(lower) ||
            q.slideId?.toLowerCase().includes(lower) ||
            q.answers?.some(a => a.text?.toLowerCase().includes(lower))
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    const StorylineExtractor = {
        /**
         * Extract Q&A from _data.js file content
         * @param {string} content - Contents of _data.js file
         * @returns {Array} Extracted questions
         */
        extractFromDataJS(content) {
            const data = parseDataJS(content);
            return extractQuestions(data);
        },

        /**
         * Extract Q&A from parsed JSON data
         * @param {Object} data - Parsed Storyline data
         * @returns {Array} Extracted questions
         */
        extractFromJSON(data) {
            return extractQuestions(data);
        },

        /**
         * Search questions by term
         * @param {Array} questions - Questions to search
         * @param {string} term - Search term
         * @returns {Array} Matching questions
         */
        search(questions, term) {
            return searchQuestions(questions, term);
        },

        /**
         * Format output
         * @param {Array} questions - Questions to format
         * @param {string} format - 'json', 'text', or 'csv'
         * @returns {string} Formatted output
         */
        format(questions, format = 'json') {
            return formatOutput(questions, format);
        },

        /**
         * Get only sequence/ordering questions
         * @param {Array} questions - All questions
         * @returns {Array} Sequence questions with correct order
         */
        getSequenceQuestions(questions) {
            return questions.filter(q =>
                q.questionType === 'sequence' || q.questionType === 'drag-drop'
            );
        },

        /**
         * Get correct answers summary
         * @param {Array} questions - All questions
         * @returns {Array} Summary of correct answers
         */
        getCorrectAnswers(questions) {
            return questions.map(q => {
                if (q.questionType === 'sequence' && q.correctSequence) {
                    return {
                        slideId: q.slideId,
                        question: q.question,
                        type: q.questionType,
                        correctAnswer: q.correctSequence.map(s => `${s.position}. ${s.text}`).join(' → ')
                    };
                }
                return {
                    slideId: q.slideId,
                    question: q.question,
                    type: q.questionType,
                    correctAnswer: q.answers.filter(a => a.correct).map(a => a.text).join(', ')
                };
            });
        },

        // Expose helpers
        parseDataJS,
        cleanText
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CLI INTERFACE (Node.js)
    // ═══════════════════════════════════════════════════════════════════════════

    if (typeof require !== 'undefined' && require.main === module) {
        const fs = require('fs');
        const path = require('path');

        const args = process.argv.slice(2);
        if (args.length === 0) {
            console.log('Usage: node storyline-data-extractor.js <path-to-_data.js> [search-term] [--format=json|text|csv]');
            console.log('\nExamples:');
            console.log('  node storyline-data-extractor.js _data.js');
            console.log('  node storyline-data-extractor.js _data.js "ASOM"');
            console.log('  node storyline-data-extractor.js _data.js "HAS-1.2.3"');
            console.log('  node storyline-data-extractor.js _data.js --format=text');
            process.exit(1);
        }

        const filePath = args[0];
        let searchTerm = null;
        let format = 'json';

        for (let i = 1; i < args.length; i++) {
            if (args[i].startsWith('--format=')) {
                format = args[i].split('=')[1];
            } else {
                searchTerm = args[i];
            }
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            let questions = StorylineExtractor.extractFromDataJS(content);

            console.error(`[INFO] Extracted ${questions.length} questions`);

            if (searchTerm) {
                questions = StorylineExtractor.search(questions, searchTerm);
                console.error(`[INFO] Found ${questions.length} matching "${searchTerm}"`);
            }

            const output = StorylineExtractor.format(questions, format);
            console.log(output);

            // Also write to file
            const outFile = path.basename(filePath, '.js') + '_questions.' + (format === 'csv' ? 'csv' : format === 'text' ? 'txt' : 'json');
            fs.writeFileSync(outFile, output);
            console.error(`[INFO] Written to ${outFile}`);

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
        window.StorylineExtractor = StorylineExtractor;
        console.log('[StorylineExtractor] Loaded. Use StorylineExtractor.extractFromDataJS(content)');
    }

    // Node.js module
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = StorylineExtractor;
    }

    return StorylineExtractor;

})(typeof window !== 'undefined' ? window : global);
