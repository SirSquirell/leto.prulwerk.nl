/**
 * Notices (US-60, US-61) and the three account actions. Everything the
 * reconstruction is unsure about, grouped by level, with the code, the count and
 * the one sentence a user can act on. The bug report is built by report.js, which
 * owns the allowlist; this page only copies what it returns.
 */

const LEVELS = [
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'note', label: 'Notes' },
  { id: 'ok', label: 'Confirmed' },
];

export function render(host, model, ui) {
  const { el } = ui;
  const notices = model.notices || [];

  const groups = LEVELS.map((level) => {
    const rows = notices.filter((notice) => notice.level === level.id);
    if (!rows.length) return null;
    return ui.panel(
      level.label,
      `${rows.length}`,
      el(
        'div',
        { class: 'noticelist' },
        rows.map((notice) =>
          el(
            'div',
            { class: 'notice' },
            el(
              'span',
              { class: `notice__code mono notice__code--${level.id}` },
              notice.code,
              Number.isFinite(Number(notice.count)) && Number(notice.count) > 0
                ? el('span', { class: 'sub', text: ` ×${notice.count}` })
                : null,
            ),
            el('span', { class: 'notice__text', text: ui.noticeText(notice) }),
          ),
        ),
      ),
    );
  }).filter(Boolean);

  if (!groups.length) {
    groups.push(
      ui.panel('Nothing to report', null, el('p', { class: 'why', text: 'No notices were raised.' })),
    );
  }

  /* ------------------------------------------------------------ actions */

  const said = el('p', { class: 'why', role: 'status' });

  const copyButton = el('button', {
    type: 'button',
    class: 'btn',
    text: 'Copy bug report',
  });
  copyButton.addEventListener('click', async () => {
    let report;
    try {
      report = ui.buildReport({ model, version: ui.version });
    } catch (error) {
      said.textContent = `The report could not be built: ${error && error.message}`;
      return;
    }
    try {
      await navigator.clipboard.writeText(String(report));
      said.textContent = 'Copied.';
    } catch {
      said.textContent = 'The clipboard refused. Select the report below and copy it by hand.';
      const box = el('textarea', {
        rows: 12,
        readonly: true,
        style: 'width: 100%; font-family: var(--mono); font-size: 12px;',
      });
      box.value = String(report);
      said.after(box);
    }
  });

  const disconnectButton = el('button', {
    type: 'button',
    class: 'btn',
    text: 'Disconnect',
  });
  disconnectButton.addEventListener('click', async () => {
    const code = await ui.disconnect();
    said.textContent = code
      ? ui.noticeText({ code })
      : 'The key is deleted. Every figure stays, frozen at the last sync.';
  });

  const wipeButton = el('button', {
    type: 'button',
    class: 'btn btn--danger',
    text: 'Wipe everything',
  });
  wipeButton.addEventListener('click', async () => {
    const sure = window.confirm(
      'Wipe deletes the key and every stored row. It cannot be undone and the history has to be fetched again. Continue?',
    );
    if (!sure) return;
    const code = await ui.wipe();
    if (code) said.textContent = ui.noticeText({ code });
  });

  host.appendChild(el('div', { class: 'grid3' }, groups));
  host.appendChild(
    ui.panel(
      'This account',
      null,
      el('div', { class: 'actions' }, copyButton, disconnectButton, wipeButton),
      said,
      el('p', {
        class: 'why why--not',
        text: 'The bug report carries codes, counts and versions. No amount, no quantity, no instrument, no account id.',
      }),
      el('p', {
        class: 'why why--not',
        text: 'Disconnect deletes the key and keeps the data. Wipe deletes both and is irreversible.',
      }),
    ),
  );
}
