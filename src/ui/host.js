/**
 * Where this page is running. The app is served twice: as the extension's own page,
 * and as a copy on the demo site (US-81). Only the first may ever ask for the key.
 *
 * A page served over http or https can never carry the `chrome-extension:` protocol,
 * and `chrome.runtime.id` exists only inside an extension context, so a website can
 * satisfy neither. Pure: it takes what it needs and touches no global (rule 9).
 */

/**
 * @param {string|null|undefined} protocol `location.protocol`, e.g. 'https:'
 * @param {unknown} runtimeId `chrome.runtime.id`, or anything at all
 * @returns {boolean} true only for the extension's own page
 */
export function isExtensionPage(protocol, runtimeId) {
  return protocol === 'chrome-extension:' && typeof runtimeId === 'string' && runtimeId.length > 0;
}
