// Typed errors. Every throw that crosses a module boundary is a LetoError whose
// `code` is one of the notice codes in `notices.js`, so the UI can always say
// something true about a failure without parsing a message string.
// This module may not import anything: it is the bottom of the dependency graph.

export class LetoError extends Error {
  /**
   * @param {string} code a notice code from `notices.js`
   * @param {Record<string, unknown>} [params] values for the notice sentence
   * @param {string} [message] developer-facing detail, never shown to a user
   */
  constructor(code, params = {}, message) {
    super(message || code);
    this.name = 'LetoError';
    this.code = code;
    this.params = params;
  }
}
