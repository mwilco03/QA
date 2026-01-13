/**
 * Extractors Module Index
 *
 * Exports the registry and base extractor factory.
 * Individual extractors are registered at initialization.
 */

export { createExtractor } from './base.js';
export { ExtractorRegistry } from './registry.js';

// Import and register all extractors
// These will be added as separate files are created
// import { StorylineExtractor } from './storyline.js';
// import { RiseExtractor } from './rise.js';
// etc.
