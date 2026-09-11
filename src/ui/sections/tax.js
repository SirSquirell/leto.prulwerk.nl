/**
 * Tax. A placeholder page on purpose: US-100 and up are v2, and a tax page that
 * shows a plausible figure it cannot verify is worse than one that shows none.
 * The disclaimer is the whole content, and it comes from copy.js.
 */

export function render(host, model, ui) {
  const { el, copy } = ui;
  void model;
  host.appendChild(
    ui.panel(
      'Tax',
      null,
      el('p', { class: 'why', text: copy.TAX_DISCLAIMER }),
      el('p', { class: 'why why--not', text: 'Tax figures arrive in the next version.' }),
    ),
  );
}
