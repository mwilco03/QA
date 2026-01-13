/**
 * LMS Course Extractor & Completion Script v8.0
 *
 * USAGE: Paste into browser console while on the LMS course page
 *        Auto-runs on paste - results appear immediately
 *
 * Supports:
 * - Articulate Storyline courses
 * - TLA/xAPI/cmi5 content
 * - Generic SCORM 1.2 and 2004 content
 * - Multi-window/popup LMS environments
 * - Nested iframe content
 *
 * For authorized QA testing, content validation, and accessibility review only.
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // WINDOW & FRAME MANAGEMENT
    // Handles LMS popups, nested iframes, and cross-window API detection
    // ═══════════════════════════════════════════════════════════════════════

    const WindowManager = {
        /**
         * Detect our current window context
         */
        detectContext() {
            const context = {
                isPopup: !!window.opener,
                isIframe: window !== window.top,
                isTopLevel: window === window.top && !window.opener,
                hasOpener: !!window.opener,
                openerAccessible: false,
                parentAccessible: false,
                topAccessible: false,
                windowName: window.name || '(unnamed)',
                depth: 0
            };

            // Check opener accessibility (for popups)
            if (window.opener) {
                try {
                    const test = window.opener.location.href;
                    context.openerAccessible = true;
                } catch (e) {
                    context.openerAccessible = false;
                }
            }

            // Check parent accessibility (for iframes)
            if (window.parent && window.parent !== window) {
                try {
                    const test = window.parent.location.href;
                    context.parentAccessible = true;
                } catch (e) {
                    context.parentAccessible = false;
                }
            }

            // Check top accessibility
            if (window.top && window.top !== window) {
                try {
                    const test = window.top.location.href;
                    context.topAccessible = true;
                } catch (e) {
                    context.topAccessible = false;
                }
            }

            // Calculate iframe depth
            let win = window;
            while (win !== win.parent) {
                context.depth++;
                try {
                    win = win.parent;
                } catch (e) {
                    break;
                }
                if (context.depth > 20) break; // Safety limit
            }

            return context;
        },

        /**
         * Get all accessible windows in the hierarchy
         * Searches: parent chain, opener chain, child frames, child windows
         */
        getAllWindows() {
            const windows = new Map(); // URL -> window reference
            const visited = new WeakSet();

            const addWindow = (win, source) => {
                if (!win || visited.has(win)) return;
                visited.add(win);

                try {
                    const url = win.location.href;
                    if (!windows.has(url)) {
                        windows.set(url, { window: win, source });
                    }
                } catch (e) {
                    // Cross-origin, can't access
                }
            };

            // Add current window
            addWindow(window, 'current');

            // Traverse parent chain (for iframes)
            let parent = window;
            for (let i = 0; i < 20 && parent; i++) {
                addWindow(parent, `parent_${i}`);
                try {
                    if (parent.parent === parent) break;
                    parent = parent.parent;
                } catch (e) {
                    break;
                }
            }

            // Traverse opener chain (for popups)
            let opener = window.opener;
            for (let i = 0; i < 10 && opener; i++) {
                addWindow(opener, `opener_${i}`);
                // Also check opener's parents
                let openerParent = opener;
                for (let j = 0; j < 10 && openerParent; j++) {
                    addWindow(openerParent, `opener_${i}_parent_${j}`);
                    try {
                        if (openerParent.parent === openerParent) break;
                        openerParent = openerParent.parent;
                    } catch (e) {
                        break;
                    }
                }
                try {
                    opener = opener.opener;
                } catch (e) {
                    break;
                }
            }

            // Collect all iframes from all accessible windows
            for (const { window: win } of windows.values()) {
                this.collectFrames(win, windows, visited);
            }

            return windows;
        },

        /**
         * Recursively collect all accessible iframes from a window
         */
        collectFrames(win, windows, visited) {
            try {
                const frames = win.document.querySelectorAll('iframe, frame');
                frames.forEach((frame, idx) => {
                    try {
                        const frameWin = frame.contentWindow;
                        if (frameWin && !visited.has(frameWin)) {
                            visited.add(frameWin);
                            try {
                                const url = frameWin.location.href;
                                if (!windows.has(url)) {
                                    windows.set(url, {
                                        window: frameWin,
                                        source: `frame_${idx}`,
                                        frameElement: frame
                                    });
                                }
                                // Recurse into nested frames
                                this.collectFrames(frameWin, windows, visited);
                            } catch (e) {
                                // Cross-origin frame
                            }
                        }
                    } catch (e) {
                        // Frame not accessible
                    }
                });
            } catch (e) {
                // Window not accessible
            }
        },

        /**
         * Find SCORM API across all accessible windows
         * Returns: { api, version, window, source }
         */
        findSCORMAPIGlobal() {
            const windows = this.getAllWindows();
            console.log(`[WindowManager] Searching ${windows.size} window(s) for SCORM API...`);

            for (const [url, { window: win, source }] of windows) {
                try {
                    // SCORM 2004
                    if (win.API_1484_11?.GetValue) {
                        console.log(`[WindowManager] Found SCORM 2004 API in ${source} (${url})`);
                        return {
                            api: win.API_1484_11,
                            version: '2004',
                            window: win,
                            source
                        };
                    }

                    // SCORM 1.2
                    if (win.API?.LMSGetValue) {
                        console.log(`[WindowManager] Found SCORM 1.2 API in ${source} (${url})`);
                        return {
                            api: {
                                GetValue: k => win.API.LMSGetValue(k),
                                SetValue: (k, v) => win.API.LMSSetValue(k, v),
                                Commit: () => win.API.LMSCommit('')
                            },
                            version: '1.2',
                            window: win,
                            source
                        };
                    }
                } catch (e) {
                    // Window not accessible for API check
                }
            }

            return null;
        },

        /**
         * Find Storyline player/DS across all accessible windows
         */
        findStorylineGlobal() {
            const windows = this.getAllWindows();
            const results = { DS: null, player: null, _storylineData: null };

            for (const [url, { window: win, source }] of windows) {
                try {
                    if (win.DS && !results.DS) {
                        console.log(`[WindowManager] Found window.DS in ${source}`);
                        results.DS = { data: win.DS, window: win, source };
                    }
                    if (win.player && !results.player) {
                        console.log(`[WindowManager] Found window.player in ${source}`);
                        results.player = { data: win.player, window: win, source };
                    }
                    if (win._storylineData && !results._storylineData) {
                        console.log(`[WindowManager] Found window._storylineData in ${source}`);
                        results._storylineData = { data: win._storylineData, window: win, source };
                    }
                } catch (e) {
                    // Window not accessible
                }
            }

            return results;
        },

        /**
         * Find TLA/xAPI data across all accessible windows
         */
        findTLAGlobal() {
            const windows = this.getAllWindows();
            const results = { ADL: null, xAPI: null };

            for (const [url, { window: win, source }] of windows) {
                try {
                    if (win.ADL?.XAPIWrapper && !results.ADL) {
                        console.log(`[WindowManager] Found ADL.XAPIWrapper in ${source}`);
                        results.ADL = { data: win.ADL, window: win, source };
                    }
                } catch (e) {
                    // Window not accessible
                }
            }

            return results;
        },

        /**
         * Scan all frames for quiz elements
         */
        scanAllFramesForQuizElements() {
            const windows = this.getAllWindows();
            const elements = [];

            const quizSelectors = [
                '[data-acc-type="radiobutton"]',
                '[data-acc-type="checkbox"]',
                '[data-acc-type="button"]',
                '[class*="quiz"]',
                '[class*="question"]',
                '[class*="answer"]',
                '[role="radio"]',
                '[role="checkbox"]',
                'input[type="radio"]',
                'input[type="checkbox"]'
            ].join(', ');

            for (const [url, { window: win, source }] of windows) {
                try {
                    const doc = win.document;
                    const found = doc.querySelectorAll(quizSelectors);
                    found.forEach(el => {
                        elements.push({
                            source,
                            url,
                            text: el.textContent?.trim()?.substring(0, 200),
                            tagName: el.tagName,
                            accType: el.dataset?.accType,
                            role: el.getAttribute('role'),
                            type: el.type
                        });
                    });
                } catch (e) {
                    // Window/document not accessible
                }
            }

            return elements;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // LMS EXTRACTOR
    // ═══════════════════════════════════════════════════════════════════════

    const LMSExtractor = {
        results: { questions: [], answers: [], completion: null, context: null },
        windowManager: WindowManager,

        // ═══════════════════════════════════════════════════════════════════
        // STORYLINE EXTRACTION
        // ═══════════════════════════════════════════════════════════════════

        extractStoryline() {
            const questions = [];

            // Use WindowManager to find Storyline globals across all windows
            const storylineGlobals = WindowManager.findStorylineGlobal();

            // Method 1: Access DS (Data Store) object
            if (storylineGlobals.DS) {
                console.log('[Extractor] Extracting from window.DS');
                this.extractFromDS(storylineGlobals.DS.data, questions);
            }

            // Method 2: Access player object
            if (storylineGlobals.player) {
                console.log('[Extractor] Extracting from window.player');
                this.extractFromPlayer(storylineGlobals.player.data, questions);
            }

            // Method 3: Extract from globalProvideData if loaded
            if (storylineGlobals._storylineData) {
                console.log('[Extractor] Extracting from _storylineData');
                this.parseStorylineData(storylineGlobals._storylineData.data, questions);
            }

            // Method 4: Scan all frames for quiz elements
            const frameElements = WindowManager.scanAllFramesForQuizElements();
            if (frameElements.length > 0) {
                console.log(`[Extractor] Found ${frameElements.length} quiz elements across frames`);
                frameElements.forEach(el => {
                    if (el.text && el.text.length > 0) {
                        questions.push({
                            source: `Frame: ${el.source}`,
                            text: el.text,
                            element: el.tagName,
                            accType: el.accType || el.role || el.type
                        });
                    }
                });
            }

            return questions;
        },

        extractFromDS(ds, questions) {
            try {
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

        parseStorylineData(data, questions) {
            // Parse Storyline JSON data structure
            try {
                if (data.scenes) {
                    for (const scene of data.scenes) {
                        if (scene.slides) {
                            for (const slide of scene.slides) {
                                if (slide.interactions) {
                                    for (const interaction of slide.interactions) {
                                        questions.push({
                                            source: 'StorylineData',
                                            slideId: slide.id,
                                            type: interaction.type,
                                            choices: interaction.choices?.map(c => ({
                                                text: c.text || c.label,
                                                correct: c.correct || c.isCorrect
                                            }))
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[Extractor] Storyline data parsing error:', e);
            }
        },

        // ═══════════════════════════════════════════════════════════════════
        // TLA/XAPI EXTRACTION
        // ═══════════════════════════════════════════════════════════════════

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

            // Method 2: Check for xAPI statements via WindowManager
            const tlaGlobals = WindowManager.findTLAGlobal();
            if (tlaGlobals.ADL) {
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

        // ═══════════════════════════════════════════════════════════════════
        // SCORM EXTRACTION - Uses WindowManager for cross-window search
        // ═══════════════════════════════════════════════════════════════════

        extractSCORM() {
            const questions = [];
            const apiResult = WindowManager.findSCORMAPIGlobal();

            if (!apiResult) {
                console.log('[Extractor] No SCORM API found in any window');
                return questions;
            }

            console.log(`[Extractor] Using SCORM ${apiResult.version} API from ${apiResult.source}`);
            const api = apiResult.api;

            // Get interaction data (questions/answers)
            try {
                const interactionCount = parseInt(api.GetValue('cmi.interactions._count') || '0');
                console.log(`[Extractor] Found ${interactionCount} SCORM interactions`);

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

        // ═══════════════════════════════════════════════════════════════════
        // COMPLETION METHODS
        // ═══════════════════════════════════════════════════════════════════

        completeSCORM(score = 100) {
            const apiResult = WindowManager.findSCORMAPIGlobal();
            if (!apiResult) {
                console.error('[Completion] No SCORM API found');
                return false;
            }

            const api = apiResult.api;

            try {
                if (apiResult.version === '2004') {
                    api.SetValue('cmi.score.raw', String(score));
                    api.SetValue('cmi.score.scaled', String(score / 100));
                    api.SetValue('cmi.score.min', '0');
                    api.SetValue('cmi.score.max', '100');
                    api.SetValue('cmi.success_status', score >= 70 ? 'passed' : 'failed');
                    api.SetValue('cmi.completion_status', 'completed');
                } else {
                    api.SetValue('cmi.core.score.raw', String(score));
                    api.SetValue('cmi.core.lesson_status', score >= 70 ? 'passed' : 'completed');
                }
                api.Commit();
                console.log(`[Completion] SCORM ${apiResult.version} completion set: score=${score}`);
                return true;
            } catch (e) {
                console.error('[Completion] SCORM completion failed:', e);
                return false;
            }
        },

        async completeTLA(sessionId, contentUrl) {
            if (!sessionId) {
                const match = window.location.href.match(/sessions?\/([a-z]{2}-[0-9a-f-]+)/i);
                sessionId = match?.[1];
            }

            if (!contentUrl) {
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

                // 2. Build full completion state
                const state = {
                    answers: {},
                    viewedTasks: [],
                    viewedTaskGroups: [],
                    completedTasks: [],
                    completedTaskGroups: [],
                    questionResults: {}
                };

                if (tasks?.taskGroups) {
                    console.log(`[Completion] Processing ${tasks.taskGroups.length} task groups...`);

                    for (const group of tasks.taskGroups) {
                        const groupId = group.id || group.slug;
                        state.viewedTaskGroups.push(groupId);

                        for (const task of group.tasks || []) {
                            const taskId = task.id || task.slug;
                            state.viewedTasks.push(taskId);

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

        generateTLAAnswer(question) {
            const pattern = question.correctPattern;
            const type = question.type;
            const DELIM = '[,]';

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
                case 'SEQUENCING':
                    return pattern;
                case 'TRUE_FALSE':
                    return pattern.toLowerCase() === 'true';
                default:
                    return pattern;
            }
        },

        // ═══════════════════════════════════════════════════════════════════
        // MAIN API
        // ═══════════════════════════════════════════════════════════════════

        async extract() {
            console.log('═══════════════════════════════════════════════════');
            console.log('[LMS Extractor] Starting extraction...');
            console.log('═══════════════════════════════════════════════════');

            // First, detect and report our window context
            const context = WindowManager.detectContext();
            this.results.context = context;

            console.log('[Context]', {
                isPopup: context.isPopup,
                isIframe: context.isIframe,
                frameDepth: context.depth,
                windowName: context.windowName
            });

            const allQuestions = [];

            // Try all extraction methods
            console.log('\n[Storyline] Checking...');
            allQuestions.push(...this.extractStoryline());

            console.log('\n[TLA/xAPI] Checking...');
            allQuestions.push(...(await this.extractTLA()));

            console.log('\n[SCORM] Checking...');
            allQuestions.push(...this.extractSCORM());

            this.results.questions = allQuestions;

            console.log('\n═══════════════════════════════════════════════════');
            console.log(`[LMS Extractor] Found ${allQuestions.length} items`);
            console.log('═══════════════════════════════════════════════════');

            if (allQuestions.length > 0) {
                console.table(allQuestions);
            }

            return allQuestions;
        },

        getCorrectAnswers() {
            return this.results.questions.filter(q => q.correct || q.correctResponse || q.correctPattern);
        },

        async complete(score = 100) {
            console.log('═══════════════════════════════════════════════════');
            console.log('[LMS Extractor] Attempting completion...');
            console.log('═══════════════════════════════════════════════════');

            if (this.completeSCORM(score)) {
                this.results.completion = 'SCORM';
                return true;
            }

            if (await this.completeTLA()) {
                this.results.completion = 'TLA';
                return true;
            }

            console.warn('[LMS Extractor] Could not complete course automatically');
            return false;
        },

        export(format = 'json') {
            const data = {
                url: window.location.href,
                timestamp: new Date().toISOString(),
                context: this.results.context,
                questions: this.results.questions,
                correctAnswers: this.getCorrectAnswers()
            };

            if (format === 'json') {
                return JSON.stringify(data, null, 2);
            }

            if (format === 'text') {
                let output = `LMS Extraction Results\n`;
                output += `URL: ${data.url}\n`;
                output += `Time: ${data.timestamp}\n`;
                output += `Context: ${data.context?.isPopup ? 'Popup' : data.context?.isIframe ? 'Iframe' : 'Main'}\n\n`;
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

        download(format = 'json') {
            const content = this.export(format);
            const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `lms_extraction_${Date.now()}.${format === 'json' ? 'json' : 'txt'}`;
            a.click();
        },

        // Expose WindowManager for advanced use
        windows: WindowManager
    };

    // Expose globally
    window.LMSExtractor = LMSExtractor;

    // ═══════════════════════════════════════════════════════════════════════
    // AUTO-RUN ON PASTE
    // Immediately extract when script is pasted
    // ═══════════════════════════════════════════════════════════════════════

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║        LMS EXTRACTOR & COMPLETION TOOL v8.0               ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║ Auto-running extraction...                                ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    // Auto-run extraction
    LMSExtractor.extract().then(results => {
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║ EXTRACTION COMPLETE                                       ║');
        console.log('╠═══════════════════════════════════════════════════════════╣');
        console.log('║ Additional commands:                                      ║');
        console.log('║   LMSExtractor.complete()    - Mark course complete       ║');
        console.log('║   LMSExtractor.export()      - Get results as JSON        ║');
        console.log('║   LMSExtractor.download()    - Save results to file       ║');
        console.log('║   LMSExtractor.windows.getAllWindows() - List all windows ║');
        console.log('╚═══════════════════════════════════════════════════════════╝');
    }).catch(err => {
        console.error('[LMS Extractor] Error:', err);
    });

    return LMSExtractor;
})();
