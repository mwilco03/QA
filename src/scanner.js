/**
 * Scanner Module
 *
 * Orchestrates the extraction process across all extractors.
 */

import { MSG, ITEM_TYPE, AUTHORING_TOOL } from './core/constants.js';
import { StateManager } from './core/state.js';
import { Logger } from './core/logger.js';
import { Utils } from './core/utils.js';
import { Messenger } from './messenger.js';
import { ExtractorRegistry } from './extractors/registry.js';
import { DOMQuizExtractor } from './extractors/dom-quiz.js';
import { StorylineDOMExtractor } from './extractors/storyline-dom.js';

const Scanner = {
    async run() {
        if (StateManager.get('scanning')) {
            Logger.warn('Scan already in progress');
            return;
        }

        const endTimer = Logger.time('Full scan');
        StateManager.reset();
        StateManager.set('scanning', true);

        Messenger.send(MSG.SCAN_STARTED);

        try {
            // Step 1: Discover APIs
            this.reportProgress(1, 7, 'Discovering LMS APIs...');
            SCORMAPI.discover();

            // Step 2: Deep framework detection (scripts, globals, SVG, meta)
            this.reportProgress(2, 7, 'Analyzing page for authoring framework...');
            const detection = FrameworkDetector.detect();
            const detectedTool = detection.tool || ExtractorRegistry.detectTool();
            StateManager.set('tool', detectedTool);
            StateManager.set('frameworkEvidence', detection.evidence);

            // Build detection message
            const toolNames = {
                storyline: 'Articulate Storyline',
                rise: 'Articulate Rise 360',
                captivate: 'Adobe Captivate',
                lectora: 'Lectora',
                ispring: 'iSpring',
                camtasia: 'Camtasia',
                generic: 'Generic LMS'
            };
            const toolName = toolNames[detectedTool] || detectedTool;
            Logger.info(`Framework detected: ${toolName}`, { confidence: detection.confidence, evidence: detection.evidence });

            // Step 3: Extract SVG text content
            this.reportProgress(3, 7, 'Extracting SVG text content...');
            const svgTexts = FrameworkDetector.extractSVGText();
            Logger.debug(`Found ${svgTexts.length} SVG text elements`);

            // Step 4: Run tool-specific extraction
            this.reportProgress(4, 7, `Extracting Q&A from ${toolName}...`);
            const extractorResult = await ExtractorRegistry.extract(detectedTool);
            const extractorItems = extractorResult.items || [];
            const groupedQuestions = extractorResult.questions || [];

            // Step 5: Extract from Storyline accessibility DOM (if applicable)
            this.reportProgress(5, 7, 'Scanning accessibility DOM...');
            const storylineDOMItems = StorylineDOMExtractor.extract();

            // Step 6: Scan DOM for generic quiz forms
            this.reportProgress(6, 7, 'Scanning DOM for quiz forms...');
            const domQuizzes = DOMQuizExtractor.extract();
            const domItems = DOMQuizExtractor.toQAItems(domQuizzes);

            // Step 7: Analyze embedded resources
            this.reportProgress(7, 7, 'Analyzing resources...');
            ResourceDiscovery.discover();
            const resourceItems = await ResourceDiscovery.analyze();

            // Combine all items
            const allItems = Utils.dedupeBy(
                [...extractorItems, ...storylineDOMItems, ...domItems, ...resourceItems],
                item => `${item.type}:${item.text.substring(0, 50)}`
            );

            // Store results
            StateManager.set('qa', allItems);
            StateManager.set('groupedQuestions', groupedQuestions);
            StateManager.set('scanning', false);
            StateManager.set('lastScan', Date.now());

            const scanTime = endTimer();
            const report = Reporter.generate();
            report.scanTime = scanTime;

            Logger.info('Scan complete', {
                tool: detectedTool,
                apis: report.apis.length,
                questions: report.qa.questions,
                correct: report.qa.correct,
                time: `${scanTime.toFixed(0)}ms`
            });

            Messenger.send(MSG.SCAN_COMPLETE, report);

        } catch (error) {
            StateManager.set('scanning', false);
            Logger.error('Scan failed', { error: error.message });
            Messenger.send(MSG.SCAN_ERROR, { error: error.message });
        }
    },

    reportProgress(step, total, message) {
        Messenger.send(MSG.PROGRESS, { step, total, message });
    }
};


export { Scanner };
