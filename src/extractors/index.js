/**
 * Extractors Module Index
 *
 * Exports the registry and all extractors.
 * Registers extractors at import time.
 */

import { AUTHORING_TOOL } from '../core/constants.js';
import { createExtractor } from './base.js';
import { ExtractorRegistry } from './registry.js';

// Import all extractors
import { StorylineExtractor } from './storyline.js';
import { RiseExtractor } from './rise.js';
import { CaptivateExtractor } from './captivate.js';
import { LectoraExtractor } from './lectora.js';
import { iSpringExtractor } from './ispring.js';
import { DOMQuizExtractor } from './dom-quiz.js';
import { StorylineDOMExtractor } from './storyline-dom.js';
import { SeedExtractor } from './seed.js';

// Register all extractors
ExtractorRegistry.register(AUTHORING_TOOL.STORYLINE, StorylineExtractor);
ExtractorRegistry.register(AUTHORING_TOOL.RISE, RiseExtractor);
ExtractorRegistry.register(AUTHORING_TOOL.CAPTIVATE, CaptivateExtractor);
ExtractorRegistry.register(AUTHORING_TOOL.LECTORA, LectoraExtractor);
ExtractorRegistry.register(AUTHORING_TOOL.ISPRING, iSpringExtractor);

// Export everything
export { createExtractor } from './base.js';
export { ExtractorRegistry } from './registry.js';
export { StorylineExtractor } from './storyline.js';
export { RiseExtractor } from './rise.js';
export { CaptivateExtractor } from './captivate.js';
export { LectoraExtractor } from './lectora.js';
export { iSpringExtractor } from './ispring.js';
export { DOMQuizExtractor } from './dom-quiz.js';
export { StorylineDOMExtractor } from './storyline-dom.js';
export { SeedExtractor } from './seed.js';
