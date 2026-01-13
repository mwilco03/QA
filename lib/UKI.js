/*
 * STORYLINE QUIZ EXTRACTOR v2.0
 * Works on Articulate Storyline courses
 *
 * v2.0 Changes:
 * - Expanded question detection (not just ? and "select")
 * - Expanded answer types (drag-drop, hotspot, buttons, etc.)
 * - Expanded correct answer indicators
 * - Better logging of what's detected and why
 *
 * Usage:
 * 1. Open course in browser
 * 2. Open DevTools Console (F12)
 * 3. Paste and run this entire script
 */

(async function StorylineExtractor() {
    console.log('=== STORYLINE QUIZ EXTRACTOR v2.0 ===\n');

    // ═══════════════════════════════════════════════════════════════════════════
    // DETECTION CONFIGURATION - Expand these to catch more patterns
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // Keywords that indicate text is a question prompt
        questionIndicators: [
            '?',                // Direct question mark
            'select',           // "Select the correct..."
            'choose',           // "Choose the best..."
            'which',            // "Which of the following..."
            'what',             // "What is the..."
            'identify',         // "Identify the..."
            'match',            // "Match the following..."
            'drag',             // "Drag items to..."
            'complete',         // "Complete the sentence..."
            'fill',             // "Fill in the blank..."
            'order',            // "Put in order..."
            'arrange',          // "Arrange the..."
            'indicate',         // "Indicate the..."
            'determine',        // "Determine which..."
            'find',             // "Find the..."
            'locate',           // "Locate the..."
            'click',            // "Click on the..."
            'true or false',    // T/F questions
            'correct answer',   // "The correct answer is..."
            'best answer',      // "The best answer..."
            'following',        // "Which of the following..."
            'statement',        // "Which statement..."
            'example',          // "Which example..."
            'describes',        // "Which best describes..."
            'represents',       // "Which represents..."
            'demonstrates',     // "Which demonstrates..."
        ],

        // Storyline accType values that represent answer choices
        answerAccTypes: [
            'checkbox',         // Multiple choice (multi-select)
            'radiobutton',      // Multiple choice (single-select)
            'button',           // Clickable buttons as answers
            'hotspot',          // Click areas on images
            'dragitem',         // Drag-and-drop source items
            'dropzone',         // Drag-and-drop target areas
            'droptarget',       // Alternative drop target naming
            'textentry',        // Fill-in-the-blank
            'textinput',        // Text input fields
            'input',            // Generic input
            'clickable',        // Generic clickable elements
            'selectable',       // Generic selectable elements
        ],

        // State names that indicate an answer is correct
        correctStateIndicators: [
            '_Review',              // Storyline standard
            '_Selected_Review',     // Storyline selected+correct
            'Correct',              // Generic correct
            'Right',                // Generic right
            'True',                 // For T/F
            'Yes',                  // For yes/no
            'Selected_Correct',     // Selected and correct
            'Drop_Correct',         // Correct drop target
            'Drag_Correct',         // Correct drag state
            'Match_Correct',        // Correct match
            'Answer_Correct',       // Correct answer state
        ],

        // State names that indicate an answer is INCORRECT (to filter out)
        incorrectStateIndicators: [
            'Incorrect',
            'Wrong',
            'False',
            'No',
            'Drop_Incorrect',
            'Drag_Incorrect',
        ],

        // Minimum text length thresholds
        minAnswerLength: 1,         // Answers can be short ("A", "True", etc.)
        minQuestionLength: 10,      // Questions should have some substance

        // Logging verbosity
        verbose: false,             // Set to true to see all detection details
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Find base URL automatically
    // ═══════════════════════════════════════════════════════════════════════════

    let scripts = performance.getEntriesByType('resource').map(r => r.name);
    let courseScript = scripts.find(s => s.includes('/html5/') || s.includes('/story_content/'));
    let baseUrl = courseScript?.match(/(.*?)\/html5\//)?.[1] ||
                  courseScript?.match(/(.*?)\/story_content\//)?.[1];

    if (!baseUrl) {
        // Try from DOM
        document.querySelectorAll('script[src]').forEach(s => {
            if (s.src.includes('/html5/')) baseUrl = s.src.match(/(.*?)\/html5\//)?.[1];
        });
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                iframe.contentDocument.querySelectorAll('script[src]').forEach(s => {
                    if (s.src.includes('/html5/')) baseUrl = s.src.match(/(.*?)\/html5\//)?.[1];
                });
            } catch(e) {}
        });
    }

    if (!baseUrl) {
        console.log('Could not find course URL. Please set manually:');
        console.log('  window.baseUrl = "YOUR_COURSE_URL";');
        console.log('  Then run script again.');
        return;
    }

    console.log('Base URL:', baseUrl);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Fetch data.js to get course structure
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\nFetching course data...');

    let dataResp = await fetch(baseUrl + '/html5/data/js/data.js');
    let dataText = await dataResp.text();

    // Parse data.js
    let dataMatch = dataText.match(/globalProvideData\s*\(\s*'data'\s*,\s*'(.+)'\s*\)/);
    if (!dataMatch) {
        console.log('Could not parse data.js');
        return;
    }

    let dataJson = dataMatch[1]
        .replace(/\\'/g, "'")
        .replace(/\\\\"/g, '\\"')
        .replace(/\\\\n/g, '\\n')
        .replace(/\\\\t/g, '\\t')
        .replace(/\\\\r/g, '\\r');

    let courseData = JSON.parse(dataJson);
    console.log('Course data loaded');

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Get ALL slide IDs (not just quiz slides)
    // ═══════════════════════════════════════════════════════════════════════════

    let slideIds = [];

    // First get explicit quiz slides
    courseData.quizzes?.forEach(quiz => {
        quiz.sliderefs?.forEach(ref => {
            let parts = ref.id.split('.');
            slideIds.push(parts[parts.length - 1]);
        });
    });

    // Then get ALL slides from scenes (questions can be anywhere)
    courseData.scenes?.forEach(scene => {
        scene.slides?.forEach(slide => {
            if (slide.id && !slideIds.includes(slide.id)) {
                slideIds.push(slide.id);
            }
        });
    });

    console.log('Found', slideIds.length, 'slides to check\n');

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Fetch each slide and extract Q&A
    // ═══════════════════════════════════════════════════════════════════════════

    let allQA = [];
    let stats = {
        slidesProcessed: 0,
        slidesWithQA: 0,
        totalQuestions: 0,
        totalAnswers: 0,
        totalCorrect: 0,
        byType: {},         // Count by accType
        skipped: [],        // Items skipped and why
    };

    for (let i = 0; i < slideIds.length; i++) {
        let slideId = slideIds[i];

        try {
            let resp = await fetch(`${baseUrl}/html5/data/js/${slideId}.js`);
            if (!resp.ok) continue;

            let text = await resp.text();
            let match = text.match(/globalProvideData\s*\(\s*'slide'\s*,\s*'(.+)'\s*\)/);
            if (!match) continue;

            let jsonStr = match[1]
                .replace(/\\'/g, "'")
                .replace(/\\\\"/g, '\\"')
                .replace(/\\\\n/g, '\\n')
                .replace(/\\\\t/g, '\\t')
                .replace(/\\\\r/g, '\\r');

            let slideData = JSON.parse(jsonStr);
            stats.slidesProcessed++;

            let qa = extractQA(slideData, slideId, CONFIG, stats);

            if (qa.answers.length > 0) {
                allQA.push(qa);
                stats.slidesWithQA++;
                stats.totalQuestions++;
                stats.totalAnswers += qa.answers.length;
                stats.totalCorrect += qa.answers.filter(a => a.correct).length;

                let correctCount = qa.answers.filter(a => a.correct).length;
                console.log(`[${i+1}/${slideIds.length}] ${slideId}: ${qa.answers.length} answers (${correctCount} correct)${qa.questionType ? ' [' + qa.questionType + ']' : ''}`);
            }
        } catch(e) {
            if (CONFIG.verbose) console.log(`Error on ${slideId}:`, e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: Output results
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n=== RESULTS ===');
    console.log('Slides processed:', stats.slidesProcessed);
    console.log('Slides with Q&A:', stats.slidesWithQA);
    console.log('Questions found:', stats.totalQuestions);
    console.log('Total answers:', stats.totalAnswers);
    console.log('Correct answers:', stats.totalCorrect);

    if (Object.keys(stats.byType).length > 0) {
        console.log('\nAnswer types found:');
        Object.entries(stats.byType).sort((a,b) => b[1] - a[1]).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
    }

    console.log('\n=== QUESTIONS & ANSWERS ===\n');

    allQA.forEach((qa, i) => {
        console.log(`--- Question ${i + 1} [${qa.slideId}]${qa.questionType ? ' (' + qa.questionType + ')' : ''} ---`);
        if (qa.question) console.log('Q:', qa.question);
        qa.answers.forEach((a, j) => {
            let marker = a.correct ? 'CORRECT' : '';
            let typeInfo = a.accType ? ` (${a.accType})` : '';
            console.log(`  ${j + 1}. ${a.correct ? '[X]' : '[ ]'} ${a.text}${typeInfo}`);
        });
        console.log('');
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Save to window for further analysis
    // ═══════════════════════════════════════════════════════════════════════════

    window.allQA = allQA;
    window.courseData = courseData;
    window.extractorStats = stats;
    window.extractorConfig = CONFIG;

    console.log('=== SAVED ===');
    console.log('window.allQA - all questions/answers');
    console.log('window.courseData - full course data');
    console.log('window.extractorStats - detection statistics');
    console.log('window.extractorConfig - detection configuration');
    console.log('\nRun exportQA("json") to download results');
    console.log('Run exportQA("txt") for readable format');

    // ═══════════════════════════════════════════════════════════════════════════
    // Export function
    // ═══════════════════════════════════════════════════════════════════════════

    window.exportQA = function(format = 'json') {
        let qa = window.allQA;
        let output = '';
        let filename = 'answer_key';
        let type = 'application/json';

        if (format === 'json') {
            output = JSON.stringify(qa, null, 2);
            filename = 'answer_key.json';
            type = 'application/json';
        } else {
            output = '=== ANSWER KEY ===\n\n';
            qa.forEach((q, i) => {
                output += `--- Question ${i + 1} [${q.slideId}]${q.questionType ? ' (' + q.questionType + ')' : ''} ---\n`;
                if (q.question) output += `Q: ${q.question}\n`;
                q.answers.forEach((a, j) => {
                    output += `${j + 1}. ${a.correct ? '[X] CORRECT' : '[ ]'} ${a.text}\n`;
                });
                output += '\n';
            });
            output += '\n=== CORRECT ANSWERS ONLY ===\n\n';
            qa.forEach((q, i) => {
                let correct = q.answers.filter(a => a.correct);
                if (correct.length) {
                    output += `Q${i+1}: ${correct.map(a => a.text).join(' | ')}\n`;
                }
            });
            filename = 'answer_key.txt';
            type = 'text/plain';
        }

        let blob = new Blob([output], {type});
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        console.log('Downloaded', filename);
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // Q&A EXTRACTION FUNCTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractQA(obj, slideId, config, stats) {
        let result = {
            slideId,
            question: '',
            questionType: null,
            answers: [],
            rawElements: []     // Store raw data for debugging
        };

        // Track what we find
        let foundElements = [];

        function extractText(obj) {
            // Primary method: textLib
            if (obj.textLib?.[0]?.vartext?.blocks) {
                return obj.textLib[0].vartext.blocks
                    .flatMap(b => b.spans?.map(s => s.text) || [])
                    .join('')
                    .replace(/\\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
            // Fallback: rawText
            if (obj.rawText) {
                return obj.rawText.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
            }
            // Fallback: text property
            if (typeof obj.text === 'string') {
                return obj.text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
            }
            // Fallback: title
            if (typeof obj.title === 'string') {
                return obj.title.trim();
            }
            // Fallback: label
            if (typeof obj.label === 'string') {
                return obj.label.trim();
            }
            // Fallback: accText (accessibility text)
            if (typeof obj.accText === 'string') {
                return obj.accText.trim();
            }
            return '';
        }

        function isCorrectAnswer(obj) {
            if (!obj.states || !Array.isArray(obj.states)) return false;

            // Check for correct indicators in state names
            let hasCorrect = obj.states.some(s =>
                config.correctStateIndicators.some(ind =>
                    s.name?.toLowerCase().includes(ind.toLowerCase())
                )
            );

            // Check it's not ALL incorrect states
            let allIncorrect = obj.states.every(s =>
                config.incorrectStateIndicators.some(ind =>
                    s.name?.toLowerCase().includes(ind.toLowerCase())
                )
            );

            return hasCorrect && !allIncorrect;
        }

        function isQuestionText(text) {
            if (!text || text.length < config.minQuestionLength) return false;

            let lowerText = text.toLowerCase();
            return config.questionIndicators.some(ind =>
                lowerText.includes(ind.toLowerCase())
            );
        }

        function isAnswerType(accType) {
            if (!accType) return false;
            return config.answerAccTypes.some(t =>
                accType.toLowerCase() === t.toLowerCase()
            );
        }

        function search(obj, path = '') {
            if (!obj || typeof obj !== 'object') return;

            let text = extractText(obj);
            let accType = obj.accType;

            // Check if this is an answer element
            if (isAnswerType(accType) && text && text.length >= config.minAnswerLength) {
                let correct = isCorrectAnswer(obj);

                result.answers.push({
                    text,
                    correct,
                    accType,
                    states: obj.states?.map(s => s.name) || []
                });

                // Track stats
                stats.byType[accType] = (stats.byType[accType] || 0) + 1;

                // Determine question type from answer type
                if (!result.questionType) {
                    if (accType === 'checkbox') result.questionType = 'multiple-select';
                    else if (accType === 'radiobutton') result.questionType = 'multiple-choice';
                    else if (accType === 'dragitem' || accType === 'dropzone' || accType === 'droptarget') result.questionType = 'drag-drop';
                    else if (accType === 'hotspot') result.questionType = 'hotspot';
                    else if (accType === 'textentry' || accType === 'textinput') result.questionType = 'fill-in';
                    else if (accType === 'button') result.questionType = 'button-choice';
                }

                if (config.verbose) {
                    console.log(`  Found answer: "${text.substring(0, 40)}..." [${accType}] correct=${correct}`);
                }
            }

            // Check if this is question text
            if (accType === 'text' || !accType) {
                if (isQuestionText(text)) {
                    // Keep the longest/most complete question text
                    if (!result.question || text.length > result.question.length) {
                        result.question = text;
                        if (config.verbose) {
                            console.log(`  Found question: "${text.substring(0, 50)}..."`);
                        }
                    }
                }
            }

            // Recurse into children
            for (let key in obj) {
                if (Array.isArray(obj[key])) {
                    obj[key].forEach((item, idx) => search(item, `${path}.${key}[${idx}]`));
                } else if (typeof obj[key] === 'object') {
                    search(obj[key], `${path}.${key}`);
                }
            }
        }

        search(obj);
        return result;
    }

})();
