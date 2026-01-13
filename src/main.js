/**
 * LMS QA Validator - Main Entry Point
 *
 * This is the entry point for the bundler.
 * All modules are imported and assembled here.
 *
 * Architecture:
 * - /core: Constants, state, logging, utilities (shared by all)
 * - /extractors: Tool-specific content extractors
 * - /api: SCORM/xAPI detection and completion
 * - /network: Request interception and analysis
 * - messenger.js: Extension communication
 */

import {
    VERSION,
    CONFIG,
    PATHS,
    MSG,
    AUTHORING_TOOL,
    LMS_STANDARD,
    ITEM_TYPE,
    QUESTION_TYPE
} from './core/constants.js';

import { StateManager } from './core/state.js';
import { Logger } from './core/logger.js';
import { Utils } from './core/utils.js';
import { Messenger } from './messenger.js';

// Import extractors (registration happens in index.js)
import {
    ExtractorRegistry,
    DOMQuizExtractor,
    StorylineDOMExtractor,
    SeedExtractor
} from './extractors/index.js';

// Import API module
import { SCORMAPI } from './api/scorm.js';

// Import scanner, reporter, exporter
import { Scanner } from './scanner.js';
import { Reporter } from './reporter.js';
import { Exporter } from './exporter.js';

// Prevent double injection
if (window.__LMS_QA_INJECTED__) {
    console.log('[LMS QA] Already injected, skipping');
} else {
    window.__LMS_QA_INJECTED__ = true;

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    Logger.info(`LMS QA Validator v${VERSION} initializing`);

    // ═══════════════════════════════════════════════════════════════════════════
    // COMMAND HANDLER
    // ═══════════════════════════════════════════════════════════════════════════

    Messenger.listen(async (type, payload) => {
        switch (type) {
            case MSG.CMD_SCAN:
                StateManager.set('scanning', true);
                Messenger.send(MSG.SCAN_STARTED, {});
                try {
                    const result = await Scanner.scan();
                    StateManager.set('qa', result.items);
                    Messenger.send(MSG.SCAN_COMPLETE, {
                        items: result.items,
                        count: result.items.length,
                        tool: result.tool,
                        summary: result.summary
                    });
                } catch (e) {
                    Logger.error('Scan failed', { error: e.message });
                    Messenger.send(MSG.SCAN_ERROR, { error: e.message });
                } finally {
                    StateManager.set('scanning', false);
                }
                break;

            case MSG.CMD_GET_STATE:
                Messenger.send(MSG.STATE, StateManager.get());
                break;

            case MSG.CMD_GET_CMI_DATA:
                const cmiData = SCORMAPI.getCmiData();
                Messenger.send(MSG.CMI_DATA, cmiData);
                break;

            case MSG.CMD_DETECT_APIS:
                const apis = SCORMAPI.discover();
                Messenger.send(MSG.APIS_DETECTED, { apis });
                break;

            case MSG.CMD_TEST_API:
                SCORMAPI.test(payload?.apiIndex || 0);
                break;

            case MSG.CMD_SET_COMPLETION:
                SCORMAPI.setCompletion(payload || {});
                break;

            case MSG.CMD_FORCE_COMPLETION:
                await SCORMAPI.forceCompletion(payload || {});
                break;

            case MSG.CMD_AUTO_SELECT:
                const count = DOMQuizExtractor.autoSelect();
                Messenger.send(MSG.AUTO_SELECT_RESULT, { count });
                break;

            case MSG.CMD_EXPORT:
                const exportData = Exporter.export(payload?.format || 'json');
                Messenger.send('EXPORT_RESULT', exportData);
                break;

            case MSG.CMD_SEED_EXTRACT:
                const seedResult = await SeedExtractor.extractFromSeed(payload?.seedText);
                Messenger.send(MSG.SEED_EXTRACT_RESULT, seedResult);
                break;

            default:
                Logger.debug(`Unhandled command: ${type}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.LMS_QA = {
        version: VERSION,

        // State
        getState: () => StateManager.get(),
        getQA: () => StateManager.get('qa'),
        getAPIs: () => StateManager.get('apis'),
        getLogs: () => Logger.getLogs(),

        // Scanning
        scan: () => Scanner.scan(),

        // API operations
        testAPI: (index) => SCORMAPI.test(index),
        setCompletion: (opts) => SCORMAPI.setCompletion(opts),
        forceCompletion: (opts) => SCORMAPI.forceCompletion(opts),

        // DOM operations
        getDOMQuizzes: () => DOMQuizExtractor.extract(),
        autoSelect: () => DOMQuizExtractor.autoSelect(),

        // Storyline specific
        getStorylineDOM: () => StorylineDOMExtractor.extract(),
        isStorylinePage: () => StorylineDOMExtractor.isStorylinePage(),

        // Seed extraction
        seedExtract: (seedText) => SeedExtractor.extractFromSeed(seedText),
        clearSeedCache: () => SeedExtractor.clearCache(),

        // Export
        export: (format) => Exporter.export(format),

        // Expose internals for debugging
        _debug: {
            StateManager,
            Logger,
            Utils,
            ExtractorRegistry,
            SCORMAPI,
            Scanner,
            Reporter,
            Exporter,
            DOMQuizExtractor,
            StorylineDOMExtractor,
            SeedExtractor,
            CONFIG,
            PATHS
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // READY
    // ═══════════════════════════════════════════════════════════════════════════

    Messenger.send(MSG.READY, { version: VERSION, url: window.location.href });
    Logger.info(`Ready. Use window.LMS_QA to interact.`);
}
