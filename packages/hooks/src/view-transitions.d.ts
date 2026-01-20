/**
 * View Transitions API Type Declarations
 * 
 * The View Transitions API is a relatively new browser feature.
 * This file adds TypeScript type declarations for the API.
 */

interface ViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

interface Document {
  startViewTransition?(callback: () => void | Promise<void>): ViewTransition;
}
