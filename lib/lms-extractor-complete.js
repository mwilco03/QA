/**
 * LMS Course Extractor v9.1 - Fire and Forget
 * Paste in console, get object back. Silent unless error.
 * Supports append mode: paste again to add more extractions.
 */
(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // CONFIG - All patterns/paths here, not in function bodies
    // ═══════════════════════════════════════════════════════════════════════
    const CONFIG = {
        // URL patterns for resource discovery
        patterns: {
            storylineBase: /(.+?)\/html5\//,
            storylineContent: /\/story_content\//,
            dataJs: /\/data\/js\//,
            tasksJson: /tasks\.json/,
            sessionId: /sessions?\/([a-z]{2}-[0-9a-f-]+)/i,
            globalProvide: /globalProvideData\s*\(\s*['"](\w+)['"]\s*,\s*'(.+)'\s*\)/s
        },
        // API endpoint templates
        endpoints: {
            tasksJson: (contentUrl) => `/api/assets/tasks.json?contentUrl=${encodeURIComponent(contentUrl)}`,
            lrsState: (sid) => `/api/sessions/${sid}/lrs/state`,
            score: (sid) => `/api/sessions/${sid}/score`
        },
        // TLA correctPattern delimiters
        delimiters: {
            choice: '[,]',
            match: '[.]',
            casePrefix: '{case_matters='
        },
        // Question detection keywords
        questionIndicators: ['?', 'select', 'choose', 'which', 'what', 'identify', 'match', 'drag', 'complete', 'fill', 'order', 'arrange', 'true or false', 'correct answer', 'best answer'],
        // Storyline state indicators
        correctStates: ['_Review', '_Selected_Review', 'Correct', 'Right', 'True', 'Selected_Correct', 'Drop_Correct', 'Drag_Correct'],
        incorrectStates: ['Incorrect', 'Wrong', 'False', 'No', 'Drop_Incorrect', 'Drag_Incorrect'],
        answerTypes: ['checkbox', 'radiobutton', 'button', 'hotspot', 'dragitem', 'dropzone', 'droptarget', 'textentry', 'textinput'],
        excludeNav: ['continue', 'next', 'back', 'previous', 'submit', 'exit', 'close', 'menu', 'home', 'restart', 'replay', 'review', 'try again', 'start', 'begin', 'finish', 'done', 'ok', 'cancel'],
        // Known variable patterns
        quizVars: ['Results.ScorePoints', 'Results.ScorePercent', 'Results.PassPercent', 'Results.PassPoints', 'Score', 'ScorePercent', 'PassFail', 'Complete'],
        playerVars: ['Progress', 'Complete', 'CurrentSlide', 'SlideNumber', 'TotalSlides'],
        // Limits
        maxParentDepth: 20,
        maxOpenerDepth: 10,
        maxQuestionProbe: 50,
        minQuestionLength: 10,
        minAnswerLength: 1
    };

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

            for (const [url, { window: win, source }] of windows) {
                try {
                    if (win.API_1484_11?.GetValue) {
                        return { api: win.API_1484_11, version: '2004', window: win, source };
                    }
                    if (win.API?.LMSGetValue) {
                        return {
                            api: { GetValue: k => win.API.LMSGetValue(k), SetValue: (k, v) => win.API.LMSSetValue(k, v), Commit: () => win.API.LMSCommit('') },
                            version: '1.2', window: win, source
                        };
                    }
                } catch (e) { /* inaccessible */ }
            }
            return null;
        },

        /**
         * Find Storyline player/DS across all accessible windows
         * Real Storyline globals: DS (GetVar/SetVar), player (GetVar)
         */
        findStorylineGlobal() {
            const windows = this.getAllWindows();
            const results = { DS: null, player: null };

            for (const [url, { window: win, source }] of windows) {
                try {
                    if (win.DS?.GetVar && !results.DS) {
                        results.DS = { data: win.DS, window: win, source };
                    }
                    if (win.player?.GetVar && !results.player) {
                        results.player = { data: win.player, window: win, source };
                    }
                } catch (e) { /* inaccessible */ }
            }

            return results;
        },

        /**
         * Find TLA/xAPI data across all accessible windows
         */
        findTLAGlobal() {
            const windows = this.getAllWindows();
            const results = { ADL: null };

            for (const [url, { window: win, source }] of windows) {
                try {
                    if (win.ADL?.XAPIWrapper && !results.ADL) {
                        results.ADL = { data: win.ADL, window: win, source };
                    }
                } catch (e) { /* inaccessible */ }
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

        async extractStoryline() {
            const questions = [];
            const storylineGlobals = WindowManager.findStorylineGlobal();

            // Try to fetch and parse slide data for grouped Q&A
            const baseUrl = this.discoverStorylineBase();
            if (baseUrl) {
                try {
                    const dataResp = await fetch(baseUrl + '/html5/data/js/data.js');
                    if (dataResp.ok) {
                        const dataText = await dataResp.text();
                        const slideIds = this.extractSlideIds(dataText);

                        // Fetch each slide and extract grouped Q&A
                        for (const slideId of slideIds) {
                            try {
                                const slideResp = await fetch(`${baseUrl}/html5/data/js/${slideId}.js`);
                                if (slideResp.ok) {
                                    const slideText = await slideResp.text();
                                    const qa = this.extractQAFromSlide(slideText, slideId);
                                    if (qa && qa.answers.length > 0) {
                                        questions.push(qa);
                                    }
                                }
                            } catch (e) { /* slide fetch failed */ }
                        }
                    }
                } catch (e) { /* data.js fetch failed */ }
            }

            // Fallback: DS variables (flat extraction)
            if (questions.length === 0 && storylineGlobals.DS) {
                this.extractFromDS(storylineGlobals.DS.data, questions);
            }

            // Fallback: Player variables
            if (questions.length === 0 && storylineGlobals.player) {
                this.extractFromPlayer(storylineGlobals.player.data, questions);
            }

            return questions;
        },

        discoverStorylineBase() {
            // Check performance entries for Storyline paths
            const entries = performance.getEntriesByType('resource');
            for (const entry of entries) {
                const match = entry.name.match(CONFIG.patterns.storylineBase);
                if (match) return match[1];
            }
            // Check script tags
            const scripts = document.querySelectorAll('script[src]');
            for (const script of scripts) {
                const match = script.src.match(CONFIG.patterns.storylineBase);
                if (match) return match[1];
            }
            // Try current location
            const locMatch = window.location.href.match(CONFIG.patterns.storylineBase);
            if (locMatch) return locMatch[1];
            return null;
        },

        extractSlideIds(dataText) {
            const ids = [];
            const match = dataText.match(CONFIG.patterns.globalProvide);
            if (match) {
                try {
                    const data = JSON.parse(match[2].replace(/\\'/g, "'"));
                    if (data.scenes) {
                        data.scenes.forEach(scene => {
                            (scene.slides || []).forEach(slide => {
                                if (slide.id) ids.push(slide.id);
                            });
                        });
                    }
                } catch (e) { /* parse failed */ }
            }
            return ids;
        },

        extractQAFromSlide(slideText, slideId) {
            const result = { source: 'Storyline', slideId, question: '', questionType: null, answers: [] };

            const match = slideText.match(CONFIG.patterns.globalProvide);
            if (!match) return null;

            let slideData;
            try { slideData = JSON.parse(match[2].replace(/\\'/g, "'")); }
            catch (e) { return null; }

            const extractText = (obj) => {
                if (obj?.textLib?.[0]?.vartext?.blocks) {
                    return obj.textLib[0].vartext.blocks
                        .flatMap(b => b.spans?.map(s => s.text) || [])
                        .join('').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
                }
                return obj?.rawText?.trim() || obj?.text?.trim() || obj?.title?.trim() || obj?.accText?.trim() || '';
            };

            const isCorrect = (obj) => {
                if (!obj?.states?.length) return false;
                const hasCorrect = obj.states.some(s => CONFIG.correctStates.some(ind => s.name?.toLowerCase().includes(ind.toLowerCase())));
                const allIncorrect = obj.states.every(s => CONFIG.incorrectStates.some(ind => s.name?.toLowerCase().includes(ind.toLowerCase())));
                return hasCorrect && !allIncorrect;
            };

            const isQuestion = (text) => {
                if (!text || text.length < CONFIG.minQuestionLength) return false;
                const lower = text.toLowerCase();
                return CONFIG.questionIndicators.some(ind => lower.includes(ind));
            };

            const search = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                const text = extractText(obj);
                const accType = obj.accType?.toLowerCase();

                // Check for answer element
                if (accType && CONFIG.answerTypes.includes(accType) && text?.length >= CONFIG.minAnswerLength) {
                    const lower = text.toLowerCase();
                    if (accType === 'button' && CONFIG.excludeNav.some(exc => lower.includes(exc))) return;
                    if (result.answers.some(a => a.text === text)) return;

                    result.answers.push({ text, correct: isCorrect(obj), accType });

                    // Infer question type
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
                if ((!accType || accType === 'text') && isQuestion(text)) {
                    if (!result.answers.some(a => a.text === text)) {
                        if (!result.question || text.length > result.question.length) {
                            result.question = text;
                        }
                    }
                }

                // Recurse
                for (const key in obj) {
                    if (Array.isArray(obj[key])) obj[key].forEach(item => search(item));
                    else if (typeof obj[key] === 'object') search(obj[key]);
                }
            };

            search(slideData);
            return result;
        },

        extractFromDS(ds, questions) {
            if (typeof ds.GetVar !== 'function') return;

            // Probe known quiz variables from CONFIG
            CONFIG.quizVars.forEach(varName => {
                try {
                    const val = ds.GetVar(varName);
                    if (val != null && val !== '') {
                        questions.push({ source: 'DS', key: varName, value: val });
                    }
                } catch (e) { /* doesn't exist */ }
            });

            // Probe numbered question variables
            for (let i = 1; i <= CONFIG.maxQuestionProbe; i++) {
                ['Answer', 'Correct', 'Response', 'Points', 'Selected'].forEach(suffix => {
                    try {
                        const val = ds.GetVar(`Q${i}_${suffix}`);
                        if (val != null && val !== '') {
                            questions.push({ source: 'DS', key: `Q${i}_${suffix}`, value: val });
                        }
                    } catch (e) { /* doesn't exist */ }
                });
            }
        },

        extractFromPlayer(player, questions) {
            if (typeof player.GetVar !== 'function') return;

            // Probe quiz + player variables from CONFIG
            [...CONFIG.quizVars, ...CONFIG.playerVars].forEach(varName => {
                try {
                    const val = player.GetVar(varName);
                    if (val != null && val !== '') {
                        questions.push({ source: 'Player', key: varName, value: val });
                    }
                } catch (e) { /* doesn't exist */ }
            });

            // Access internal variable store if exposed
            const vars = player._variables || player.variables;
            if (vars && typeof vars === 'object') {
                Object.entries(vars).forEach(([key, value]) => {
                    if (typeof value !== 'function') {
                        questions.push({ source: 'Player_Internal', key, value });
                    }
                });
            }

            // Probe numbered question variables
            for (let i = 1; i <= CONFIG.maxQuestionProbe; i++) {
                ['Answer', 'Correct', 'Response', 'Points', 'Selected'].forEach(suffix => {
                    try {
                        const val = player.GetVar(`Question${i}_${suffix}`);
                        if (val != null && val !== '') {
                            questions.push({ source: 'Player', key: `Question${i}_${suffix}`, value: val });
                        }
                    } catch (e) { /* doesn't exist */ }
                });
            }
        },

        parseStorylineData(data, questions) {
            // Parse globalProvideData format (fetched slide JS)
            const extractText = (obj) => {
                if (obj?.textLib?.[0]?.vartext?.blocks) {
                    return obj.textLib[0].vartext.blocks
                        .flatMap(b => b.spans?.map(s => s.text) || [])
                        .join('').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
                }
                return obj?.rawText?.trim() || obj?.text?.trim() || obj?.title?.trim() || obj?.accText?.trim() || '';
            };

            const isCorrect = (obj) => {
                if (!obj?.states?.length) return false;
                return obj.states.some(s => CONFIG.correctStates.some(ind => s.name?.toLowerCase().includes(ind.toLowerCase())));
            };

            const searchObject = (obj, slideId = 'unknown') => {
                if (!obj || typeof obj !== 'object') return;
                const text = extractText(obj);
                const accType = obj.accType?.toLowerCase();

                if (accType && CONFIG.answerTypes.includes(accType) && text) {
                    const lowerText = text.toLowerCase();
                    if (accType === 'button' && CONFIG.excludeNav.some(exc => lowerText.includes(exc))) return;
                    if (questions.some(q => q.text === text && q.slideId === slideId)) return;

                    questions.push({ source: 'SlideData', slideId, text, accType, correct: isCorrect(obj) });
                }

                for (const key in obj) {
                    if (Array.isArray(obj[key])) obj[key].forEach(item => searchObject(item, slideId));
                    else if (typeof obj[key] === 'object') searchObject(obj[key], slideId);
                }
            };

            if (data.scenes) {
                data.scenes.forEach(scene => (scene.slides || []).forEach(slide => searchObject(slide, slide.id)));
            } else {
                searchObject(data, data.slideId || 'slide');
            }
        },

        // ═══════════════════════════════════════════════════════════════════
        // TLA/XAPI EXTRACTION
        // ═══════════════════════════════════════════════════════════════════

        async extractTLA() {
            const questions = [];

            // Discover tasks.json from performance entries or URL params
            const tasksUrl = this.findTasksJsonUrl();
            if (tasksUrl) {
                try {
                    const resp = await fetch(tasksUrl);
                    if (resp.ok) this.parseTasksJson(await resp.json(), questions);
                } catch (e) { /* fetch failed */ }
            }

            // xAPI wrapper if available
            const tlaGlobals = WindowManager.findTLAGlobal();
            if (tlaGlobals.ADL) {
                await this.extractFromXAPI(tlaGlobals.ADL.data, questions);
            }

            return questions;
        },

        async extractFromXAPI(ADL, questions) {
            const wrapper = ADL?.XAPIWrapper;
            if (!wrapper) return;

            const config = wrapper.lrs || wrapper.Config || {};

            // Query statements
            if (typeof wrapper.getStatements === 'function') {
                try {
                    const result = wrapper.getStatements({ verb: 'http://adlnet.gov/expapi/verbs/answered', limit: 100 });
                    (result?.statements || []).forEach(stmt => {
                        questions.push({
                            source: 'xAPI', id: stmt.object?.id,
                            verb: stmt.verb?.display?.['en-US'] || stmt.verb?.id,
                            response: stmt.result?.response, success: stmt.result?.success
                        });
                    });
                } catch (e) { /* query failed */ }
            }

            // Cached statements
            const cached = wrapper.statements || wrapper._statements;
            if (Array.isArray(cached)) {
                cached.forEach(stmt => {
                    questions.push({
                        source: 'xAPI_Cached', id: stmt.object?.id,
                        response: stmt.result?.response, success: stmt.result?.success
                    });
                });
            }

            // State data
            if (typeof wrapper.getState === 'function') {
                try {
                    const activityId = config.activityId || window.location.href.split('?')[0];
                    const state = wrapper.getState(activityId, { stateId: 'progress' });
                    if (state) questions.push({ source: 'xAPI_State', data: state });
                } catch (e) { /* no state */ }
            }
        },

        findTasksJsonUrl() {
            // Check URL params first
            const contentUrl = new URLSearchParams(window.location.search).get('contentUrl');
            if (contentUrl) return CONFIG.endpoints.tasksJson(contentUrl);

            // Discover from performance entries
            const entries = performance.getEntriesByType('resource');
            const tasksEntry = entries.find(e => CONFIG.patterns.tasksJson.test(e.name));
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
            const D = CONFIG.delimiters;

            switch (type) {
                case 'CHOICE':
                    return pattern.split(D.choice);
                case 'FILL_IN':
                case 'LONG_FILL_IN':
                    if (pattern.startsWith(D.casePrefix)) {
                        const closeIdx = pattern.indexOf('}');
                        return { caseMatters: pattern.substring(D.casePrefix.length, closeIdx) === 'true', answers: pattern.substring(closeIdx + 1).split(D.choice) };
                    }
                    return { answers: pattern.split(D.choice) };
                case 'MATCHING':
                    return pattern.split(D.choice).map(p => { const [src, tgt] = p.split(D.match); return { source: src, target: tgt }; });
                case 'SEQUENCING':
                    return pattern.split(D.choice).map((item, i) => ({ position: i + 1, item }));
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
            if (!apiResult) return questions;

            const api = apiResult.api;
            const count = parseInt(api.GetValue('cmi.interactions._count') || '0');

            for (let i = 0; i < count; i++) {
                questions.push({
                    source: 'SCORM',
                    id: api.GetValue(`cmi.interactions.${i}.id`),
                    type: api.GetValue(`cmi.interactions.${i}.type`),
                    correctResponse: api.GetValue(`cmi.interactions.${i}.correct_responses.0.pattern`),
                    learnerResponse: api.GetValue(`cmi.interactions.${i}.learner_response`),
                    result: api.GetValue(`cmi.interactions.${i}.result`)
                });
            }

            return questions;
        },

        // ═══════════════════════════════════════════════════════════════════
        // COMPLETION METHODS
        // ═══════════════════════════════════════════════════════════════════

        completeSCORM(score = 100) {
            const apiResult = WindowManager.findSCORMAPIGlobal();
            if (!apiResult) return false;

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
                return true;
            } catch (e) {
                console.error('SCORM completion failed:', e);
                return false;
            }
        },

        async completeTLA(sessionId, contentUrl) {
            if (!sessionId) {
                const match = window.location.href.match(CONFIG.patterns.sessionId);
                sessionId = match?.[1];
            }
            if (!contentUrl) contentUrl = new URLSearchParams(window.location.search).get('contentUrl');
            if (!sessionId) return false;

            try {
                // Fetch tasks
                let tasks = null;
                if (contentUrl) {
                    const tasksResp = await fetch(CONFIG.endpoints.tasksJson(contentUrl));
                    if (tasksResp.ok) tasks = await tasksResp.json();
                }

                // Build completion state
                const state = { answers: {}, viewedTasks: [], viewedTaskGroups: [], completedTasks: [], completedTaskGroups: [], questionResults: {} };

                if (tasks?.taskGroups) {
                    for (const group of tasks.taskGroups) {
                        const groupId = group.id || group.slug;
                        state.viewedTaskGroups.push(groupId);
                        for (const task of group.tasks || []) {
                            const taskId = task.id || task.slug;
                            state.viewedTasks.push(taskId);
                            for (const question of task.questions || []) {
                                const answer = this.generateTLAAnswer(question);
                                state.answers[question.id] = answer;
                                state.questionResults[question.id] = { answered: true, correct: true, response: answer, attempts: 1 };
                            }
                            state.completedTasks.push(taskId);
                        }
                        state.completedTaskGroups.push(groupId);
                    }
                }

                // Merge with existing state
                let existingState = {};
                try {
                    const stateResp = await fetch(CONFIG.endpoints.lrsState(sessionId));
                    if (stateResp.ok) existingState = await stateResp.json() || {};
                } catch (e) { /* no existing state */ }

                const mergedState = {
                    ...existingState, ...state,
                    answers: { ...existingState.answers, ...state.answers },
                    viewedTasks: [...new Set([...(existingState.viewedTasks || []), ...state.viewedTasks])],
                    viewedTaskGroups: [...new Set([...(existingState.viewedTaskGroups || []), ...state.viewedTaskGroups])],
                    completedTasks: [...new Set([...(existingState.completedTasks || []), ...state.completedTasks])],
                    completedTaskGroups: [...new Set([...(existingState.completedTaskGroups || []), ...state.completedTaskGroups])],
                    questionResults: { ...existingState.questionResults, ...state.questionResults }
                };

                // Update LRS state and submit score
                await fetch(CONFIG.endpoints.lrsState(sessionId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mergedState) });
                const resp = await fetch(CONFIG.endpoints.score(sessionId), { method: 'POST' });
                return resp.ok;
            } catch (e) {
                console.error('TLA completion failed:', e);
                return false;
            }
        },

        generateTLAAnswer(question) {
            const pattern = question.correctPattern;
            if (!pattern) return '';
            const D = CONFIG.delimiters;

            switch (question.type) {
                case 'CHOICE': return pattern.split(D.choice);
                case 'FILL_IN':
                case 'LONG_FILL_IN':
                    if (pattern.startsWith(D.casePrefix)) {
                        const closeIdx = pattern.indexOf('}');
                        return pattern.substring(closeIdx + 1).split(D.choice)[0];
                    }
                    return pattern.split(D.choice)[0];
                case 'MATCHING':
                case 'SEQUENCING': return pattern;
                case 'TRUE_FALSE': return pattern.toLowerCase() === 'true';
                default: return pattern;
            }
        },

        // ═══════════════════════════════════════════════════════════════════
        // MAIN API - Silent extraction, returns object
        // ═══════════════════════════════════════════════════════════════════

        async extract(options = {}) {
            const append = options.append ?? true; // Default: append mode ON
            this.results.context = WindowManager.detectContext();

            const newQuestions = [];
            newQuestions.push(...(await this.extractStoryline()));
            newQuestions.push(...(await this.extractTLA()));
            newQuestions.push(...this.extractSCORM());

            if (append && this.results.questions.length > 0) {
                // Dedupe by slideId or id
                const existingIds = new Set(this.results.questions.map(q => q.slideId || q.id || JSON.stringify(q)));
                newQuestions.forEach(q => {
                    const key = q.slideId || q.id || JSON.stringify(q);
                    if (!existingIds.has(key)) {
                        this.results.questions.push(q);
                        existingIds.add(key);
                    }
                });
            } else {
                this.results.questions = newQuestions;
            }

            return this.results;
        },

        getCorrectAnswers() {
            return this.results.questions.filter(q =>
                q.correct === true ||
                q.correctResponse ||
                q.correctPattern ||
                (q.answers && q.answers.some(a => a.correct))
            );
        },

        // Get flat list of all correct answer texts
        getCorrectAnswerTexts() {
            const texts = [];
            this.results.questions.forEach(q => {
                if (q.answers) {
                    q.answers.filter(a => a.correct).forEach(a => texts.push({ question: q.question, answer: a.text, slideId: q.slideId }));
                }
                if (q.correct && typeof q.correct === 'object') {
                    texts.push({ question: q.prompt || q.id, answer: q.correct, type: q.type });
                }
            });
            return texts;
        },

        async complete(score = 100) {
            if (this.completeSCORM(score)) { this.results.completion = 'SCORM'; return true; }
            if (await this.completeTLA()) { this.results.completion = 'TLA'; return true; }
            return false;
        },

        // Clear results (disable append for fresh start)
        clear() {
            this.results = { questions: [], answers: [], completion: null, context: null };
            return this;
        },

        windows: WindowManager
    };

    // ═══════════════════════════════════════════════════════════════════════
    // APPEND MODE: Preserve existing results if already loaded
    // ═══════════════════════════════════════════════════════════════════════
    if (window.LMSExtractor?.results?.questions?.length > 0) {
        // Transfer existing results to new instance
        LMSExtractor.results = window.LMSExtractor.results;
    }

    // Expose globally for follow-up calls
    window.LMSExtractor = LMSExtractor;

    // Fire and forget: auto-run, return object for inspection
    return LMSExtractor.extract();
})();
