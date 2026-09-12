/**
 * The app shell: one router over the seven sections, the top bar, the period
 * control, the amounts switch and the sync button. It owns no arithmetic and no
 * copy: numbers come from format.js, sentences from copy.js, figures from
 * datasource.js, and every colour from tokens.css read at runtime so a chart
 * never carries a literal colour.
 *
 * Nothing here writes to the network or to a store. The only outward calls are
 * chrome.runtime messages to the service worker (sync, status, connect,
 * disconnect, wipe).
 */

import * as copy from './copy.js';
import * as fmt from './format.js';
import { MASK } from './anon.js';
import * as periodsMod from './periods.js';
import { loadModel } from './datasource.js';
import * as charts from './charts.js';
import { buildReport } from './report.js';
import { NOTICES, render as renderNotice } from '../lib/notices.js';
import { renderConnect } from './connect.js';
import { isExtensionPage } from './host.js';

import * as overview from './sections/overview.js';
import * as performance from './sections/performance.js';
import * as composition from './sections/composition.js';
import * as income from './sections/income.js';
import * as holdings from './sections/holdings.js';
import * as tax from './sections/tax.js';
import * as noticesSection from './sections/notices.js';

const SECTIONS = {
  overview,
  performance,
  composition,
  income,
  holdings,
  tax,
  notices: noticesSection,
};

const PERIOD_IDS = Array.isArray(periodsMod.PERIODS)
  ? periodsMod.PERIODS.slice()
  : Object.keys(periodsMod.PERIODS || copy.PERIODS);

const SLOT_COUNT = 7;
const POLL_MS = 2000;

/* ------------------------------------------------------------------ storage */

/** localStorage is a convenience, never a source of truth, and throws in some
 * profiles; every read and write is guarded. */
function readPref(key, fallback) {
  try {
    const value = window.localStorage.getItem(`leto.${key}`);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    window.localStorage.setItem(`leto.${key}`, String(value));
  } catch {
    /* a profile that blocks storage still works, it just forgets */
  }
}

/* -------------------------------------------------------------------- state */

const state = {
  model: null,
  loadError: null,
  section: 'overview',
  period: PERIOD_IDS.includes(readPref('period', 'ALL')) ? readPref('period', 'ALL') : 'ALL',
  masked: readPref('masked', '0') === '1',
  demo: false,
  status: null,
  frozen: false,
  syncing: false,
  syncNote: null,
  screen: 'app',
  view: {
    compositionMode: readPref('compositionMode', 'currency'),
    holdingsFilter: readPref('holdingsFilter', 'open'),
    holdingsSort: readPref('holdingsSort', 'value'),
    holdingsDir: readPref('holdingsDir', 'desc'),
    dateA: null,
    dateB: null,
  },
};

let pollTimer = null;

/* ------------------------------------------------------------------ DOM kit */

/**
 * @param {string} tag
 * @param {Record<string, unknown>|null} [attrs] `class`, `text`, `dataset`, an
 *   `onclick`-style listener, or any attribute; null and false are skipped.
 * @param {...unknown} kids nodes, strings, arrays; null and false are skipped.
 */
export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = String(value);
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(node, kids);
  return node;
}

function append(node, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false || kid === '') continue;
    if (Array.isArray(kid)) {
      append(node, kid);
      continue;
    }
    node.appendChild(
      typeof kid === 'object' && kid.nodeType ? kid : document.createTextNode(String(kid)),
    );
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  return node;
}

/** The Leto mark: the 512 card with the ring, its two arcs in tokens. */
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

/* ------------------------------------------------------------------- tokens */

/** A reference to a token, never its value: charts.js writes it verbatim into a
 * presentation attribute, so a chart follows the theme without being redrawn and
 * no file outside tokens.css ever holds a colour. */
export function token(name) {
  return `var(${name})`;
}

function slotColour(index) {
  return token(`--slot-${(index % SLOT_COUNT) + 1}`);
}

/* ---------------------------------------------------------------- messaging */

/** One place that talks to the service worker. Resolves null outside the
 * extension (the demo runs from a plain server), so no page needs to branch. */
function send(message) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(null);
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError;
        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** True only on the extension's own page. The demo host serves a copy of this app
 * (US-81); there the connect screen must never render (US-83). */
function insideExtension() {
  try {
    return isExtensionPage(window.location.protocol, typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null);
  } catch {
    return false;
  }
}

function manifestVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- format shims */

/** format.js owns every string; these wrappers only add the account currency and
 * the mask, and survive a helper that is not there yet. */
function money(value, options = {}) {
  const currency = (state.model && state.model.currency) || 'EUR';
  return fmt.fmtMoney(value, currency, { masked: state.masked, ...options });
}

function pct(value, options = {}) {
  return fmt.fmtPct(value, { digits: 1, ...options });
}

function qty(value, precision, options = {}) {
  return fmt.fmtQty(value, precision, { masked: state.masked, ...options });
}

/* ----------------------------------------------------------------- periods  */

function guard(fn, fallback) {
  try {
    const out = fn();
    return out === undefined || out === null ? fallback : out;
  } catch {
    return fallback;
  }
}

function currentSlice() {
  const result = state.model && state.model.result;
  if (!result || !Array.isArray(result.days) || result.days.length === 0) return null;
  const today = state.model.today || result.days[result.days.length - 1];
  const fallback = {
    days: result.days,
    value: result.value,
    paidIn: result.paidIn,
    netExternal: result.netExternal,
    pnl: result.pnl,
    estimated: result.estimated,
    startIndex: 0,
    anchorIndex: 0,
  };
  return guard(() => periodsMod.sliceResult(result, state.period, today), fallback) || fallback;
}

/** periodReturn from periods.js, with a chained fallback so a missing helper
 * degrades to the same identity instead of an empty page. */
function periodReturn(result, startIndex, endIndex) {
  const fallback = () => {
    let abs = 0;
    for (let i = startIndex; i <= endIndex; i += 1) abs += Number(result.pnl[i]) || 0;
    let factor = 1;
    for (let i = Math.max(1, startIndex); i <= endIndex; i += 1) {
      const base = Number(result.value[i - 1]) || 0;
      if (base > 0) factor *= 1 + (Number(result.pnl[i]) || 0) / base;
    }
    return { resultAbs: abs, resultPct: factor - 1 };
  };
  return guard(() => periodsMod.periodReturn(result, startIndex, endIndex), null) || fallback();
}

/** Strips the five characters that could end an attribute or open a tag, for a
 * label that is about to be interpolated into a generated SVG string. */
function safeLabel(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[<>&"']/g, '');
}

/* ------------------------------------------------------------------- charts */

function describeOf(chart, fallback) {
  const raw = chart && chart.describe;
  const text = typeof raw === 'function' ? guard(() => raw(), fallback) : raw;
  return typeof text === 'string' && text ? text : fallback;
}

/** Inserts a chart's generated SVG string. The string comes from charts.js, which
 * is local code; every label that reaches it is escaped by the caller. With
 * amounts off the money tick labels are made transparent, so the number never
 * reaches a readable position on screen even if charts.js drew one. */
function mountChart(chart, { label, money: isMoney = false } = {}) {
  const hide = isMoney && state.masked;
  const wrap = el('div', { class: `chart${hide ? ' chart--masked' : ''}` });
  const template = document.createElement('template');
  template.innerHTML = String((chart && chart.svg) || '');
  const svg = template.content.querySelector('svg');
  if (!svg) return wrap;
  const plain = label || 'Chart';
  svg.setAttribute('role', 'img');
  /* charts.js writes the first, last, minimum and maximum value into describe(),
   * so with amounts off the description is replaced, not just the tick labels
   * (US-70 AC1: the number does not reach the DOM). */
  svg.setAttribute('aria-label', hide ? `${plain}. Amounts are hidden.` : describeOf(chart, plain));
  if (hide) blankValueLabels(svg);
  wrap.appendChild(svg);
  return wrap;
}

/** Removes the y tick labels of a money chart. A y label is one charts.js marked
 * as such, or, failing that, a text node in the left gutter of the viewBox. */
function blankValueLabels(svg) {
  const viewBox = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  const width = Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : 1000;
  const height = Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : 300;
  for (const text of svg.querySelectorAll('text')) {
    const marked =
      text.dataset.axis === 'y' ||
      (text.getAttribute('class') || '').split(/\s+/).includes('y-label');
    const x = Number(text.getAttribute('x'));
    const y = Number(text.getAttribute('y'));
    const onXAxis = Number.isFinite(y) && y > height - 14;
    const inGutter = Number.isFinite(x) && x < width * 0.06 && !onXAxis;
    if (marked || inGutter) {
      text.setAttribute('fill', 'transparent');
      text.setAttribute('aria-hidden', 'true');
      text.textContent = MASK;
    }
  }
}

/* ------------------------------------------------------------------- pieces */

/**
 * One KPI block in the grammar of the brief: label, the figure, what it measures
 * and what it does not mean.
 * @param {{ figure?:object, label?:string, value:string, extra?:unknown,
 *   positive?:boolean, head?:boolean, last?:boolean }} spec
 */
function kpi(spec) {
  const figure = spec.figure || {};
  const classes = ['kpi'];
  if (spec.head) classes.push('kpi--head');
  if (spec.last) classes.push('kpi--last');
  return el(
    'div',
    { class: classes.join(' ') },
    el('span', { class: 'lbl', text: spec.label || figure.label || '' }),
    el('span', {
      class: `kpi__v mono${spec.positive ? ' pos' : ''}`,
      text: spec.value,
    }),
    spec.extra ? el('p', { class: 'why' }, spec.extra) : null,
    figure.is ? el('p', { class: 'why', text: figure.is }) : null,
    figure.not ? el('p', { class: 'why why--not', text: figure.not }) : null,
  );
}

function panel(headLeft, headRight, ...body) {
  return el(
    'section',
    { class: 'panel' },
    headLeft || headRight
      ? el(
          'div',
          { class: 'panel__head' },
          typeof headLeft === 'string' ? el('span', { class: 'lbl', text: headLeft }) : headLeft,
          typeof headRight === 'string'
            ? el('span', { class: 'lbl', text: headRight })
            : headRight,
        )
      : null,
    ...body,
  );
}

/**
 * A table inside its own horizontal scroller, so a wide table never widens the
 * page.
 * @param {{ columns:Array<{key:string,label:string,numeric?:boolean,sortable?:boolean}>,
 *   rows:Array<Record<string, unknown>>, foot?:Array<unknown>,
 *   sort?:{key:string,dir:string}, onsort?:(key:string)=>void, caption?:string }} spec
 */
function table(spec) {
  const head = el(
    'tr',
    null,
    spec.columns.map((column) => {
      const cell = el('th', { class: column.numeric ? 'n' : null });
      if (column.sortable && spec.onsort) {
        if (spec.sort && spec.sort.key === column.key) {
          cell.setAttribute('aria-sort', spec.sort.dir === 'asc' ? 'ascending' : 'descending');
        }
        cell.appendChild(
          el('button', {
            type: 'button',
            text: column.label,
            onclick: () => spec.onsort(column.key),
          }),
        );
      } else {
        cell.textContent = column.label;
      }
      return cell;
    }),
  );
  const body = el(
    'tbody',
    null,
    spec.rows.map((row) =>
      el(
        'tr',
        { class: row._class || null },
        spec.columns.map((column) => {
          const value = row[column.key];
          const cell = el('td', { class: column.numeric ? 'n' : null });
          append(cell, [value]);
          return cell;
        }),
      ),
    ),
  );
  return el(
    'div',
    { class: 'tablewrap' },
    el(
      'table',
      null,
      spec.caption ? el('caption', { class: 'lbl', text: spec.caption }) : null,
      el('thead', null, head),
      body,
      spec.foot ? el('tfoot', null, spec.foot) : null,
    ),
  );
}

function segmented(options, active, onpick, ariaLabel) {
  return el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': ariaLabel || 'Options' },
    options.map((option) =>
      el('button', {
        type: 'button',
        text: option.label,
        title: option.title || null,
        'aria-pressed': option.id === active ? 'true' : 'false',
        onclick: () => onpick(option.id),
      }),
    ),
  );
}

/* ------------------------------------------------------------------ top bar */

function relativeTime(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function statusText() {
  if (state.demo) return 'Demo data';
  if (state.syncNote) return state.syncNote;
  const at = state.status && state.status.lastSyncAt;
  if (state.frozen) return `Frozen at ${at ? fmt.fmtDate(String(at).slice(0, 10)) : 'the last sync'}`;
  const rel = at ? relativeTime(at) : null;
  return rel ? `Synced ${rel}` : 'Not synced yet';
}

function topbar() {
  const currency = (state.model && state.model.currency) || null;
  const bits = [currency, statusText()].filter(Boolean).join(' · ');

  const tabs = el(
    'nav',
    { class: 'tabs', 'aria-label': 'Sections' },
    copy.SECTIONS.map((section) =>
      el('button', {
        type: 'button',
        class: 'tab',
        text: section.label,
        'aria-current': section.id === state.section ? 'page' : null,
        onclick: () => navigate(section.id),
      }),
    ),
  );

  return el(
    'header',
    { class: 'topbar' },
    el(
      'div',
      { class: 'topbar__left' },
      el('div', { class: 'brand' }, mark(22), el('span', { class: 'brand__word', text: 'Leto' })),
      tabs,
    ),
    el(
      'div',
      { class: 'topbar__right' },
      el('span', { class: 'status', text: bits }),
      el('button', {
        type: 'button',
        class: 'btn',
        text: state.masked ? 'Amounts off' : 'Amounts shown',
        'aria-pressed': state.masked ? 'true' : 'false',
        onclick: toggleMask,
      }),
      state.demo
        ? null
        : el('button', {
            type: 'button',
            class: 'btn',
            text: state.syncing ? 'Syncing' : 'Sync',
            disabled: state.syncing || null,
            onclick: startSync,
          }),
    ),
  );
}

/* --------------------------------------------------------------------- bars */

/** Rule: every error-level notice sits at the top of every section until it is
 * resolved (US-60 AC2); a demo note is a quiet strip in the same place. */
function bars() {
  const notices = (state.model && state.model.notices) || [];
  const rows = [];
  for (const notice of notices) {
    if (notice.level !== 'error') continue;
    rows.push(
      el(
        'div',
        { class: 'bar bar--error', role: 'alert' },
        el('span', { class: 'bar__code', text: notice.code }),
        el('span', { text: noticeText(notice) }),
      ),
    );
  }
  if (state.frozen) {
    const at = state.status && state.status.lastSyncAt;
    rows.push(
      el(
        'div',
        { class: 'bar bar--frozen' },
        el('span', { class: 'bar__code', text: 'DISCONNECTED' }),
        el('span', {
          text: `The key is deleted and the figures are frozen at ${
            at ? fmt.fmtDate(String(at).slice(0, 10)) : 'the last sync'
          }. Nothing was removed.`,
        }),
      ),
    );
  }
  const demoNote = notices.find((notice) => notice.code === 'DEMO_DATA');
  if (demoNote || state.demo) {
    rows.push(
      el(
        'div',
        { class: 'bar bar--note' },
        el('span', { class: 'bar__code', text: 'DEMO_DATA' }),
        el('span', { text: demoNote ? noticeText(demoNote) : NOTICES.DEMO_DATA.text }),
      ),
    );
  }
  return rows.length ? el('div', { class: 'bars' }, rows) : null;
}

function noticeText(notice) {
  if (notice && typeof notice.text === 'string' && notice.text) return notice.text;
  return guard(() => renderNotice(notice.code, notice), notice.code);
}

/* ------------------------------------------------------------------ actions */

function navigate(id) {
  if (!SECTIONS[id]) return;
  state.section = id;
  try {
    window.location.hash = `#${id}`;
  } catch {
    render();
    return;
  }
  render();
}

function setPeriod(id) {
  state.period = id;
  writePref('period', id);
  render();
}

function toggleMask() {
  state.masked = !state.masked;
  writePref('masked', state.masked ? '1' : '0');
  render();
}

function setView(key, value) {
  state.view[key] = value;
  if (key !== 'dateA' && key !== 'dateB') writePref(key, value);
}

async function startSync() {
  if (state.syncing) return;
  state.syncing = true;
  state.syncNote = 'Syncing';
  render();
  const done = send({ type: 'sync' });
  pollStatus();
  const result = await done;
  state.syncing = false;
  stopPolling();
  if (result && result.ok === false) {
    state.syncNote = `Sync stopped: ${result.code}`;
  } else {
    state.syncNote = null;
  }
  await refreshStatus();
  await reload();
}

function pollStatus() {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    const status = await send({ type: 'status' });
    if (!status) return;
    state.status = status;
    if (status.syncState && status.syncState.step) {
      state.syncNote = `Syncing: ${status.syncState.step}`;
    } else if (!state.syncing) {
      stopPolling();
    }
    const bar = document.querySelector('.status');
    if (bar) bar.textContent = [state.model && state.model.currency, statusText()].filter(Boolean).join(' · ');
  }, POLL_MS);
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshStatus() {
  const status = await send({ type: 'status' });
  if (status) state.status = status;
}

async function disconnect() {
  const result = await send({ type: 'disconnect' });
  if (result && result.ok === false) return result.code;
  state.frozen = true;
  render();
  return null;
}

async function wipe() {
  const result = await send({ type: 'wipe' });
  if (result && result.ok === false) return result.code;
  try {
    window.location.hash = '';
    window.location.reload();
  } catch {
    state.model = null;
    state.screen = 'connect';
    render();
  }
  return null;
}

/* ---------------------------------------------------------------- rendering */

const root = document.getElementById('app');

function sectionUi() {
  return {
    el,
    append,
    token,
    slotColour,
    mark,
    kpi,
    panel,
    table,
    segmented,
    mountChart,
    describeOf,
    charts,
    copy,
    fmt,
    MASK,
    money,
    pct,
    qty,
    safeLabel,
    date: (iso) => (iso ? fmt.fmtDate(iso) : '—'),
    dateRange: (a, b) => fmt.fmtDateRange(a, b),
    days: (n) => fmt.fmtDays(n),
    periods: periodsMod,
    periodReturn,
    slice: currentSlice,
    guard,
    state,
    view: state.view,
    setView,
    masked: state.masked,
    period: state.period,
    periodLabel: copy.PERIODS[state.period] || state.period,
    send,
    buildReport,
    version: manifestVersion() || (state.model && state.model.meta && state.model.meta.version) || '0.0.0',
    disconnect,
    wipe,
    refresh: () => render(),
    navigate,
    notices: NOTICES,
    noticeText,
  };
}

function pagehead(section) {
  const slice = currentSlice();
  const showPeriod = section.id !== 'tax' && section.id !== 'notices';
  const range =
    slice && slice.days.length
      ? `${fmt.fmtDateRange(slice.days[0], slice.days[slice.days.length - 1])} · ${fmt.fmtDays(
          slice.days.length,
        )}`
      : null;
  const line = [copy.PERIODS[state.period] || state.period, range].filter(Boolean).join(' · ');
  return el(
    'div',
    { class: 'pagehead' },
    el(
      'div',
      { class: 'pagehead__titles' },
      el('span', { class: 'lbl', text: showPeriod ? line : 'Leto' }),
      el('h1', { text: section.title || section.label }),
    ),
    showPeriod
      ? segmented(
          PERIOD_IDS.map((id) => ({ id, label: id, title: copy.PERIODS[id] || id })),
          state.period,
          setPeriod,
          'Period',
        )
      : null,
  );
}

function render() {
  if (!root) return;
  root.replaceChildren();
  root.removeAttribute('aria-busy');

  if (state.screen === 'outside') {
    root.appendChild(
      el(
        'header',
        { class: 'topbar' },
        el(
          'div',
          { class: 'topbar__left' },
          el('div', { class: 'brand' }, mark(22), el('span', { class: 'brand__word', text: 'Leto' })),
        ),
      ),
    );
    root.appendChild(
      el(
        'div',
        { class: 'connect' },
        el('h1', { text: copy.OUTSIDE.title }),
        el(
          'div',
          { class: 'connect__body' },
          copy.OUTSIDE.body.map((paragraph) => el('p', { text: paragraph })),
        ),
        el(
          'div',
          { class: 'actions' },
          el('a', { class: 'btn btn--primary', href: '/demo/', text: copy.OUTSIDE.demo }),
        ),
      ),
    );
    return;
  }

  if (state.screen === 'connect') {
    root.appendChild(
      el(
        'header',
        { class: 'topbar' },
        el(
          'div',
          { class: 'topbar__left' },
          el('div', { class: 'brand' }, mark(22), el('span', { class: 'brand__word', text: 'Leto' })),
        ),
      ),
    );
    const host = el('div', { class: 'connect' });
    root.appendChild(host);
    renderConnect(host, {
      el,
      copy,
      send,
      notices: NOTICES,
      noticeText,
      openDemo: () => {
        try {
          window.location.search = '?demo=1';
        } catch {
          /* nothing else to do */
        }
      },
      onConnected: async () => {
        state.screen = 'app';
        await refreshStatus();
        await reload();
      },
    });
    return;
  }

  const meta = copy.SECTIONS.find((s) => s.id === state.section) || copy.SECTIONS[0];
  root.appendChild(topbar());
  const barRow = bars();
  if (barRow) root.appendChild(barRow);
  root.appendChild(pagehead(meta));

  const main = el('main', { class: 'main', id: 'main' });
  root.appendChild(main);

  if (state.loadError) {
    main.appendChild(
      el(
        'div',
        { class: 'bar bar--error', role: 'alert' },
        el('span', { class: 'bar__code', text: 'UPSTREAM_ERROR' }),
        el('span', { text: `The figures could not be built: ${state.loadError}` }),
      ),
    );
    return;
  }
  if (!state.model) {
    main.appendChild(el('p', { class: 'why', text: 'No figures yet. Run a sync.' }));
    return;
  }

  const section = SECTIONS[state.section];
  try {
    section.render(main, state.model, sectionUi());
  } catch (error) {
    main.replaceChildren(
      el(
        'div',
        { class: 'bar bar--error', role: 'alert' },
        el('span', { class: 'bar__code', text: 'UPSTREAM_ERROR' }),
        el('span', { text: `This section could not be drawn: ${error && error.message}` }),
      ),
    );
  }
}

/* --------------------------------------------------------------------- boot */

async function reload() {
  try {
    if (state.demo) {
      state.model = await loadModel({
        demo: true,
        fetchJson: (url) => fetch(new URL(url, import.meta.url)).then((response) => response.json()),
      });
    } else {
      const { openStore } = await import('../lib/store.js');
      const store = await openStore();
      state.model = await loadModel({
        demo: false,
        store,
        today: new Date().toISOString().slice(0, 10),
      });
    }
    state.loadError = null;
  } catch (error) {
    state.model = null;
    state.loadError = (error && error.code) || (error && error.message) || 'unknown';
  }
  render();
}

function readHash() {
  const id = String(window.location.hash || '').replace(/^#/, '');
  if (SECTIONS[id]) state.section = id;
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  state.demo = params.get('demo') === '1';
  readHash();
  window.addEventListener('hashchange', () => {
    readHash();
    render();
  });
  try {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => render());
  } catch {
    /* a browser without matchMedia keeps the light palette */
  }

  if (state.demo) {
    await reload();
    return;
  }

  if (!insideExtension()) {
    state.screen = 'outside';
    render();
    return;
  }

  const status = await send({ type: 'status' });
  state.status = status;
  if (!status || !status.hasCredential) {
    state.screen = 'connect';
    render();
    return;
  }
  render();
  await reload();
  if (status.syncState) {
    state.syncNote = `Syncing: ${status.syncState.step}`;
    pollStatus();
  }
}

boot();
