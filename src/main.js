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
import { ExtractorRegistry, createExtractor } from './extractors/index.js';

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
    // REGISTER EXTRACTORS
    // TODO: These will be imported from separate files as they're migrated
    // ═══════════════════════════════════════════════════════════════════════════

    // Storyline Extractor (placeholder - full implementation to be migrated)
    ExtractorRegistry.register(createExtractor({
        toolId: AUTHORING_TOOL.STORYLINE,
        detect: () => !!(
            window.DS ||
            window.globalProvideData ||
            window.g_slideData ||
            window.player ||
            document.querySelector('[data-acc-type]')
        ),
        extract: async () => {
            // TODO: Migrate full Storyline extraction logic
            Logger.info('Storyline extractor running (modular version)');
            const items = [];

            // Basic DS extraction
            if (window.DS?.VO) {
                for (const [id, obj] of Object.entries(window.DS.VO)) {
                    if (obj.accType && ['radiobutton', 'checkbox'].includes(obj.accType)) {
                        items.push({
                            type: ITEM_TYPE.ANSWER,
                            text: obj.accText || obj.rawText || '',
                            source: 'storyline:DS',
                            id
                        });
                    }
                }
            }

            return items;
        },
        getInfo: () => ({
            hasDS: !!window.DS,
            hasGlobalProvideData: typeof window.globalProvideData === 'function',
            hasPlayer: !!window.player
        })
    }));

    // Generic DOM Extractor
    ExtractorRegistry.register(createExtractor({
        toolId: AUTHORING_TOOL.GENERIC,
        detect: () => true, // Always available as fallback
        extract: async () => {
            const items = [];
            // Extract from form elements
            document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(el => {
                const label = document.querySelector(`label[for="${el.id}"]`);
                if (label) {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: label.textContent.trim(),
                        correct: Utils.isCorrectAnswer(el),
                        source: 'generic:form'
                    });
                }
            });
            return items;
        }
    }));

    // ═══════════════════════════════════════════════════════════════════════════
    // COMMAND HANDLER
    // ═══════════════════════════════════════════════════════════════════════════

    Messenger.listen(async (type, payload) => {
        switch (type) {
            case MSG.CMD_SCAN:
                StateManager.set('scanning', true);
                Messenger.send(MSG.SCAN_STARTED, {});
                try {
                    const items = await ExtractorRegistry.extractAll();
                    StateManager.set('qa', items);
                    Messenger.send(MSG.SCAN_COMPLETE, {
                        items,
                        count: items.length
                    });
                } catch (e) {
                    Messenger.send(MSG.SCAN_ERROR, { error: e.message });
                } finally {
                    StateManager.set('scanning', false);
                }
                break;

            case MSG.CMD_GET_STATE:
                Messenger.send(MSG.STATE, StateManager.get());
                break;

            // TODO: Migrate remaining command handlers
            default:
                Logger.debug(`Unhandled command: ${type}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.LMS_QA = {
        version: VERSION,
        getState: () => StateManager.get(),
        getQA: () => StateManager.get('qa'),
        scan: async () => {
            const items = await ExtractorRegistry.extractAll();
            StateManager.set('qa', items);
            return items;
        },
        getAPIs: () => StateManager.get('apis'),
        getLogs: () => Logger.getLogs(),

        // Expose internals for debugging
        _debug: {
            StateManager,
            Logger,
            Utils,
            ExtractorRegistry,
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
