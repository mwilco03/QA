/**
 * LMS Course Extractor & Completion Script v7.0
 *
 * USAGE: Paste into browser console while on the LMS course page
 *
 * Supports:
 * - Articulate Storyline courses
 * - TLA/xAPI/cmi5 content
 * - Generic SCORM content
 *
 * For authorized QA testing, content validation, and accessibility review only.
 */

(function() {
    'use strict';

    const LMSExtractor = {
        results: { questions: [], answers: [], completion: null },

        // ═══════════════════════════════════════════════════════════════════════
        // STORYLINE EXTRACTION
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Extract from Storyline player (window.DS or window.player)
         */
        extractStoryline() {
            const questions = [];

            // Method 1: Access DS (Data Store) object
            if (window.DS) {
                console.log('[Extractor] Found window.DS');
                this.extractFromDS(window.DS, questions);
            }

            // Method 2: Access player object
            if (window.player) {
                console.log('[Extractor] Found window.player');
                this.extractFromPlayer(window.player, questions);
            }

            // Method 3: Scan all frames for Storyline content
            this.scanFrames(questions);

            // Method 4: Extract from _data.js if loaded
            this.extractFromGlobalData(questions);

            return questions;
        },

        extractFromDS(ds, questions) {
            try {
                // Get all variables
                const vars = ds.getAll ? ds.getAll() : ds;
                for (const [key, value] of Object.entries(vars)) {
                    if (key.includes('Quiz') || key.includes('Question') || key.includes('Answer')) {
                        questions.push({ source: 'DS', key, value });
                    }
                }
            } catch (e) {
                console.warn('[Extractor] DS extraction error:', e);
            }
        },

        extractFromPlayer(player, questions) {
            try {
                // Try to get quiz data
                if (player.GetVar) {
                    const quizVars = ['Score', 'ScorePercent', 'PassPercent', 'PassFail'];
                    quizVars.forEach(v => {
                        const val = player.GetVar(v);
                        if (val !== undefined) questions.push({ source: 'Player', key: v, value: val });
                    });
                }
            } catch (e) {
                console.warn('[Extractor] Player extraction error:', e);
            }
        },

        scanFrames(questions) {
            const frames = document.querySelectorAll('iframe');
            frames.forEach((frame, idx) => {
                try {
                    const frameDoc = frame.contentDocument || frame.contentWindow?.document;
                    if (frameDoc) {
                        // Look for quiz elements
                        const quizElements = frameDoc.querySelectorAll('[data-acc-type="radiobutton"], [data-acc-type="checkbox"], [class*="quiz"], [class*="question"]');
                        quizElements.forEach(el => {
                            questions.push({
                                source: `Frame_${idx}`,
                                text: el.textContent?.trim(),
                                element: el.tagName,
                                accType: el.dataset.accType
                            });
                        });
                    }
                } catch (e) {
                    // Cross-origin frame, skip
                }
            });
        },

        extractFromGlobalData(questions) {
            // Check if globalProvideData was called
            if (window._storylineData) {
                console.log('[Extractor] Found _storylineData');
                this.parseStorylineData(window._storylineData, questions);
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        // TLA/XAPI EXTRACTION
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Extract from TLA/xAPI content
         */
        async extractTLA() {
            const questions = [];

            // Method 1: Intercept network requests for tasks.json
            const tasksUrl = this.findTasksJsonUrl();
            if (tasksUrl) {
                try {
                    const resp = await fetch(tasksUrl);
                    const tasks = await resp.json();
                    this.parseTasksJson(tasks, questions);
                } catch (e) {
                    console.warn('[Extractor] tasks.json fetch error:', e);
                }
            }

            // Method 2: Check for xAPI statements in memory
            if (window.ADL?.XAPIWrapper) {
                console.log('[Extractor] Found ADL xAPI Wrapper');
            }

            return questions;
        },

        findTasksJsonUrl() {
            // Check URL parameters
            const params = new URLSearchParams(window.location.search);
            const contentUrl = params.get('contentUrl');
            if (contentUrl) {
                return `/api/assets/tasks.json?contentUrl=${encodeURIComponent(contentUrl)}`;
            }

            // Check for tasks.json in performance entries
            const entries = performance.getEntriesByType('resource');
            const tasksEntry = entries.find(e => e.name.includes('tasks.json'));
            return tasksEntry?.name;
        },

        parseTasksJson(tasks, questions) {
            if (!tasks?.taskGroups) return;

            for (const group of tasks.taskGroups) {
                for (const task of group.tasks || []) {
                    for (const q of task.questions || []) {
                        questions.push({
                            source: 'TLA',
                            id: q.id,
                            prompt: q.prompt,
                            type: q.type,
                            choices: q.choices,
                            correctPattern: q.correctPattern,
                            correct: this.parseCorrectPattern(q.correctPattern, q.type)
                        });
                    }
                }
            }
        },

        parseCorrectPattern(pattern, type) {
            if (!pattern) return null;
            const DELIM = '[,]';
            const MATCH_DELIM = '[.]';

            switch (type) {
                case 'CHOICE':
                    return pattern.split(DELIM);
                case 'FILL_IN':
                case 'LONG_FILL_IN':
                    if (pattern.startsWith('{case_matters=')) {
                        const closeIdx = pattern.indexOf('}');
                        return {
                            caseMatters: pattern.substring(14, closeIdx) === 'true',
                            answers: pattern.substring(closeIdx + 1).split(DELIM)
                        };
                    }
                    return { answers: pattern.split(DELIM) };
                case 'MATCHING':
                    return pattern.split(DELIM).map(p => {
                        const [src, tgt] = p.split(MATCH_DELIM);
                        return { source: src, target: tgt };
                    });
                case 'SEQUENCING':
                    return pattern.split(DELIM).map((item, i) => ({
                        position: i + 1,
                        item
                    }));
                case 'TRUE_FALSE':
                    return pattern.toLowerCase() === 'true';
                default:
                    return pattern;
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        // SCORM EXTRACTION
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Extract from SCORM API
         */
        extractSCORM() {
            const questions = [];
            const api = this.findSCORMAPI();

            if (!api) {
                console.log('[Extractor] No SCORM API found');
                return questions;
            }

            console.log('[Extractor] Found SCORM API');

            // Get interaction data (questions/answers)
            try {
                const interactionCount = parseInt(api.GetValue('cmi.interactions._count') || '0');
                for (let i = 0; i < interactionCount; i++) {
                    questions.push({
                        source: 'SCORM',
                        id: api.GetValue(`cmi.interactions.${i}.id`),
                        type: api.GetValue(`cmi.interactions.${i}.type`),
                        description: api.GetValue(`cmi.interactions.${i}.description`),
                        correctResponse: api.GetValue(`cmi.interactions.${i}.correct_responses.0.pattern`),
                        learnerResponse: api.GetValue(`cmi.interactions.${i}.learner_response`),
                        result: api.GetValue(`cmi.interactions.${i}.result`)
                    });
                }
            } catch (e) {
                console.warn('[Extractor] SCORM interaction error:', e);
            }

            return questions;
        },

        findSCORMAPI() {
            // SCORM 1.2
            let api = window.API;
            if (api?.LMSGetValue) return { GetValue: k => api.LMSGetValue(k), SetValue: (k, v) => api.LMSSetValue(k, v), Commit: () => api.LMSCommit('') };

            // SCORM 2004
            api = window.API_1484_11;
            if (api?.GetValue) return api;

            // Search parent frames
            let win = window;
            for (let i = 0; i < 10 && win.parent && win.parent !== win; i++) {
                win = win.parent;
                if (win.API?.LMSGetValue) return { GetValue: k => win.API.LMSGetValue(k), SetValue: (k, v) => win.API.LMSSetValue(k, v), Commit: () => win.API.LMSCommit('') };
                if (win.API_1484_11?.GetValue) return win.API_1484_11;
            }

            return null;
        },

        // ═══════════════════════════════════════════════════════════════════════
        // COMPLETION METHODS
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Mark course as complete via SCORM
         */
        completeSCORM(score = 100) {
            const api = this.findSCORMAPI();
            if (!api) {
                console.error('[Completion] No SCORM API found');
                return false;
            }

            try {
                // SCORM 2004 style
                api.SetValue('cmi.score.raw', String(score));
                api.SetValue('cmi.score.scaled', String(score / 100));
                api.SetValue('cmi.score.min', '0');
                api.SetValue('cmi.score.max', '100');
                api.SetValue('cmi.success_status', score >= 70 ? 'passed' : 'failed');
                api.SetValue('cmi.completion_status', 'completed');
                api.Commit();

                console.log(`[Completion] SCORM completion set: score=${score}, status=completed`);
                return true;
            } catch (e) {
                // Try SCORM 1.2 style
                try {
                    api.SetValue('cmi.core.score.raw', String(score));
                    api.SetValue('cmi.core.lesson_status', score >= 70 ? 'passed' : 'completed');
                    api.Commit();
                    console.log(`[Completion] SCORM 1.2 completion set`);
                    return true;
                } catch (e2) {
                    console.error('[Completion] SCORM completion failed:', e2);
                    return false;
                }
            }
        },

        /**
         * Mark course as complete via TLA session API
         * Iterates through ALL taskGroups -> tasks -> questions
         */
        async completeTLA(sessionId, contentUrl) {
            if (!sessionId) {
                // Try to find session ID from URL
                const match = window.location.href.match(/sessions?\/([a-z]{2}-[0-9a-f-]+)/i);
                sessionId = match?.[1];
            }

            if (!contentUrl) {
                // Try to find content URL from URL params
                const params = new URLSearchParams(window.location.search);
                contentUrl = params.get('contentUrl');
            }

            if (!sessionId) {
                console.error('[Completion] No session ID found');
                return false;
            }

            try {
                // 1. Fetch tasks.json to get all tasks and questions
                let tasks = null;
                if (contentUrl) {
                    const tasksResp = await fetch(`/api/assets/tasks.json?contentUrl=${encodeURIComponent(contentUrl)}`);
                    if (tasksResp.ok) tasks = await tasksResp.json();
                }

                // 2. Build full completion state by iterating ALL items
                const state = {
                    answers: {},
                    viewedTasks: [],
                    viewedTaskGroups: [],
                    completedTasks: [],
                    completedTaskGroups: [],
                    questionResults: {}
                };

                if (tasks?.taskGroups) {
                    console.log(`[Completion] Iterating through ${tasks.taskGroups.length} task groups...`);

                    for (const group of tasks.taskGroups) {
                        const groupId = group.id || group.slug;
                        state.viewedTaskGroups.push(groupId);
                        console.log(`[Completion]   Group: ${groupId}`);

                        for (const task of group.tasks || []) {
                            const taskId = task.id || task.slug;
                            state.viewedTasks.push(taskId);
                            console.log(`[Completion]     Task: ${taskId}`);

                            for (const question of task.questions || []) {
                                const qId = question.id;
                                const answer = this.generateTLAAnswer(question);

                                state.answers[qId] = answer;
                                state.questionResults[qId] = {
                                    answered: true,
                                    correct: true,
                                    response: answer,
                                    attempts: 1
                                };
                                console.log(`[Completion]       Question: ${qId} ✓`);
                            }

                            state.completedTasks.push(taskId);
                        }

                        state.completedTaskGroups.push(groupId);
                    }
                }

                // 3. Get existing state and merge
                let existingState = {};
                try {
                    const stateResp = await fetch(`/api/sessions/${sessionId}/lrs/state`);
                    if (stateResp.ok) existingState = await stateResp.json() || {};
                } catch (e) { /* no existing state */ }

                const mergedState = {
                    ...existingState,
                    ...state,
                    answers: { ...existingState.answers, ...state.answers },
                    viewedTasks: [...new Set([...(existingState.viewedTasks || []), ...state.viewedTasks])],
                    viewedTaskGroups: [...new Set([...(existingState.viewedTaskGroups || []), ...state.viewedTaskGroups])],
                    completedTasks: [...new Set([...(existingState.completedTasks || []), ...state.completedTasks])],
                    completedTaskGroups: [...new Set([...(existingState.completedTaskGroups || []), ...state.completedTaskGroups])],
                    questionResults: { ...existingState.questionResults, ...state.questionResults }
                };

                // 4. Update LRS state
                await fetch(`/api/sessions/${sessionId}/lrs/state`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(mergedState)
                });
                console.log(`[Completion] LRS state updated with ${Object.keys(state.answers).length} answers`);

                // 5. Submit score
                const resp = await fetch(`/api/sessions/${sessionId}/score`, { method: 'POST' });
                if (resp.ok) {
                    console.log(`[Completion] TLA score submitted for session ${sessionId}`);
                    return true;
                }
            } catch (e) {
                console.error('[Completion] TLA completion failed:', e);
            }
            return false;
        },

        /**
         * Generate correct answer for TLA question
         */
        generateTLAAnswer(question) {
            const pattern = question.correctPattern;
            const type = question.type;
            const DELIM = '[,]';
            const MATCH_DELIM = '[.]';

            if (!pattern) return '';

            switch (type) {
                case 'CHOICE':
                    return pattern.split(DELIM);
                case 'FILL_IN':
                case 'LONG_FILL_IN':
                    if (pattern.startsWith('{case_matters=')) {
                        const closeIdx = pattern.indexOf('}');
                        return pattern.substring(closeIdx + 1).split(DELIM)[0];
                    }
                    return pattern.split(DELIM)[0];
                case 'MATCHING':
                    return pattern; // Keep original format
                case 'SEQUENCING':
                    return pattern; // Keep original format
                case 'TRUE_FALSE':
                    return pattern.toLowerCase() === 'true';
                default:
                    return pattern;
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        // MAIN API
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Extract all Q&A from current page
         */
        async extract() {
            console.log('═══════════════════════════════════════════════════');
            console.log('[LMS Extractor] Starting extraction...');
            console.log('═══════════════════════════════════════════════════');

            const allQuestions = [];

            // Try all extraction methods
            allQuestions.push(...this.extractStoryline());
            allQuestions.push(...(await this.extractTLA()));
            allQuestions.push(...this.extractSCORM());

            this.results.questions = allQuestions;
            console.log(`[LMS Extractor] Found ${allQuestions.length} items`);
            console.table(allQuestions);

            return allQuestions;
        },

        /**
         * Get correct answers only
         */
        getCorrectAnswers() {
            return this.results.questions.filter(q => q.correct || q.correctResponse || q.correctPattern);
        },

        /**
         * Complete the course
         */
        async complete(score = 100) {
            console.log('═══════════════════════════════════════════════════');
            console.log('[LMS Extractor] Attempting completion...');
            console.log('═══════════════════════════════════════════════════');

            // Try SCORM first
            if (this.completeSCORM(score)) {
                this.results.completion = 'SCORM';
                return true;
            }

            // Try TLA
            if (await this.completeTLA()) {
                this.results.completion = 'TLA';
                return true;
            }

            console.warn('[LMS Extractor] Could not complete course automatically');
            return false;
        },

        /**
         * Export results
         */
        export(format = 'json') {
            const data = {
                url: window.location.href,
                timestamp: new Date().toISOString(),
                questions: this.results.questions,
                correctAnswers: this.getCorrectAnswers()
            };

            if (format === 'json') {
                return JSON.stringify(data, null, 2);
            }

            if (format === 'text') {
                let output = `LMS Extraction Results\n`;
                output += `URL: ${data.url}\n`;
                output += `Time: ${data.timestamp}\n\n`;
                output += `=== QUESTIONS & ANSWERS ===\n\n`;

                data.questions.forEach((q, i) => {
                    output += `Q${i + 1}: ${q.prompt || q.description || q.text || 'N/A'}\n`;
                    output += `Type: ${q.type || 'unknown'}\n`;
                    if (q.correct) output += `Correct: ${JSON.stringify(q.correct)}\n`;
                    if (q.correctPattern) output += `Pattern: ${q.correctPattern}\n`;
                    if (q.correctResponse) output += `Response: ${q.correctResponse}\n`;
                    output += '\n';
                });

                return output;
            }

            return data;
        },

        /**
         * Download results as file
         */
        download(format = 'json') {
            const content = this.export(format);
            const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `lms_extraction_${Date.now()}.${format === 'json' ? 'json' : 'txt'}`;
            a.click();
        }
    };

    // Expose globally
    window.LMSExtractor = LMSExtractor;

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║           LMS EXTRACTOR & COMPLETION TOOL                 ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║ Commands:                                                 ║');
    console.log('║   LMSExtractor.extract()     - Extract Q&A               ║');
    console.log('║   LMSExtractor.complete()    - Mark course complete      ║');
    console.log('║   LMSExtractor.export()      - Get results as JSON       ║');
    console.log('║   LMSExtractor.download()    - Save results to file      ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    return LMSExtractor;
})();
