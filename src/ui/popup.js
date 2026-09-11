/**
 * The extension popup: connection state, last sync, two buttons. It reads the
 * worker's status and the manifest version and nothing else. No amount and no
 * quantity may appear here (DESIGN-BRIEF), so it never opens a store.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function token(name) {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return '';
  }
}

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.appendChild(typeof kid === 'object' && kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function mark(size) {
  const svg = svgEl('svg', {
    width: size,
    height: size,
    viewBox: '0 0 512 512',
    role: 'img',
    'aria-label': 'Leto',
  });
  svg.appendChild(svgEl('rect', { width: 512, height: 512, rx: 96, fill: token('--ink') }));
  svg.appendChild(
    svgEl('path', {
      d: 'M368 320 A124 124 0 1 1 256 144',
      fill: 'none',
      stroke: token('--surface'),
      'stroke-width': 56,
      'stroke-linecap': 'round',
    }),
  );
  svg.appendChild(
    svgEl('path', {
      d: 'M256 144 A124 124 0 0 1 368 320',
      fill: 'none',
      stroke: token('--accent-fill'),
      'stroke-width': 56,
      'stroke-linecap': 'round',
    }),
  );
  return svg;
}

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError;
        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function version() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

function relative(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The dot is about the connection, never about a figure. */
function describe(status) {
  if (!status) return { level: 'error', head: 'The worker did not answer', why: 'Reload the extension.' };
  if (!status.hasCredential) {
    return {
      level: 'warn',
      head: 'Not connected',
      why: 'Open Leto to paste a read-only key, or to see the demo.',
    };
  }
  if (status.syncState && status.syncState.step) {
    return {
      level: 'warn',
      head: 'Syncing',
      why: `Step ${status.syncState.step}. One request at a time; it can take a while on the first run.`,
    };
  }
  if (status.lastError && status.lastError.code) {
    return {
      level: 'error',
      head: 'The last sync stopped',
      why: `${status.lastError.code}. Open Leto to see what to do.`,
    };
  }
  const rel = status.lastSyncAt ? relative(status.lastSyncAt) : null;
  return {
    level: 'ok',
    head: 'Connected to Trading 212',
    why: rel ? `Last sync ${rel}.` : 'No sync has completed yet.',
  };
}

async function render() {
  const host = document.getElementById('popup');
  if (!host) return;
  const status = await send({ type: 'status' });
  const state = describe(status);

  const openButton = el('button', {
    type: 'button',
    class: 'popup__btn popup__btn--primary',
    text: 'Open Leto',
  });
  openButton.addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/app.html') });
    } catch {
      /* nothing else the popup can do */
    }
  });

  const syncButton = el('button', {
    type: 'button',
    class: 'popup__btn',
    text: 'Sync now',
    disabled: !status || !status.hasCredential || null,
  });
  syncButton.addEventListener('click', async () => {
    syncButton.disabled = true;
    syncButton.textContent = 'Syncing';
    await send({ type: 'sync' });
    render();
  });

  host.replaceChildren(
    el(
      'div',
      { class: 'popup__top' },
      el('div', { class: 'popup__brand' }, mark(24), el('span', { class: 'popup__word', text: 'Leto' })),
      el('span', { class: 'popup__version', text: version() }),
    ),
    el(
      'div',
      { class: 'popup__state' },
      el(
        'div',
        { class: 'popup__line' },
        el('span', { class: `popup__dot popup__dot--${state.level}` }),
        el('span', { class: 'popup__head', text: state.head }),
      ),
      el('p', { class: 'popup__why', text: state.why }),
    ),
    el('div', { class: 'popup__actions' }, openButton, syncButton),
  );
}

render();
