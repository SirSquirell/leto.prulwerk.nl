// Amounts off (US-70). The mask is a fixed-width replacement, never a blur, so the
// number never reaches the DOM in any form. State (on/off) lives in the app; these
// two functions are pure and always return the same mask regardless of input.

/** Fixed width, five bullets, the same string every time. */
export const MASK = '•••••';

/** @param {string} text @returns {string} */
export function maskAmount(text) {
  void text;
  return MASK;
}

/** @param {string} text @returns {string} */
export function maskQty(text) {
  void text;
  return MASK;
}
