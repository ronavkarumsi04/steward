/**
 * `@steward/browser` — a real browser an agent can drive, with a closed vocabulary, a bounded lifetime and a
 * recorded view.
 *
 * The package owns three things and nothing else: the action vocabulary (`actions.ts`), where a browser may be
 * pointed (`policy.ts`), and the provider that actually runs one (`provider.ts`, `playwright-provider.ts`).
 * Sessions are rows that live in `@steward/core`'s `BrowserService`; this package holds pages, and pages are a
 * cache.
 */

export * from "./actions.js";
export * from "./policy.js";
export * from "./provider.js";

/**
 * `PlaywrightBrowserProvider` is deliberately **not** re-exported here, and the reason is the whole point of the
 * package's design rather than tidiness.
 *
 * A re-export is a static import: every consumer of `@steward/browser` — the API, the worker, and the single-origin
 * Next deployment that serves the API in-process — would load the browser engine at start-up, and a bundler would
 * have to resolve and ship it. That is wrong twice over. Most stacks run with `BROWSER_PROVIDER=auto` and no
 * Chromium at all, where the honest answer is `DisabledBrowserProvider`; and the engine is a heavy Node dependency
 * with native-ish files that a bundler cannot resolve. Importing this package is a statement about what a browser
 * session *is*: the vocabulary, the address policy, and the negotiation. `browserProviderFromEnv` imports the
 * engine itself, at the moment a browser is actually configured, so an installation without one never pays for it.
 * The provider's own tests import the module by path, which is exactly the coupling they want.
 */
