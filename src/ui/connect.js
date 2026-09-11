/**
 * First run and connect (US-10, US-82). Says what will happen before anything is
 * fetched, takes the key and the secret in password fields, and sends them to the
 * service worker, which is the only place that may store them. This module never
 * keeps the key: the fields are cleared as soon as the message is sent, and
 * nothing here logs, stores or echoes what was typed.
 */

const ENVS = [
  { id: 'live', label: 'Live account' },
  { id: 'demo', label: 'Practice account' },
];

/**
 * @param {HTMLElement} host
 * @param {{ el:Function, copy:object, send:Function, notices:object,
 *   noticeText:Function, openDemo:Function, onConnected:Function }} ctx
 */
export function renderConnect(host, ctx) {
  const { el, copy } = ctx;
  const firstRun = copy.FIRST_RUN;

  const keyField = el('input', {
    type: 'password',
    id: 'leto-key',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': 'leto-key-note',
  });
  const secretField = el('input', {
    type: 'password',
    id: 'leto-secret',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const envField = el(
    'select',
    { id: 'leto-env' },
    ENVS.map((env) => el('option', { value: env.id, text: env.label })),
  );
  const result = el('p', { class: 'result why', id: 'leto-result', role: 'status' });
  const connectButton = el('button', {
    type: 'button',
    class: 'btn btn--primary',
    text: firstRun.proceed,
  });

  connectButton.addEventListener('click', async () => {
    const key = keyField.value.trim();
    const secret = secretField.value.trim();
    const env = envField.value;
    if (!key) {
      say(result, 'Paste the key first.', 'error');
      return;
    }
    connectButton.disabled = true;
    say(result, 'Checking the key against one read endpoint.', null);
    const response = await ctx.send({ type: 'connect', key, secret, env });
    keyField.value = '';
    secretField.value = '';
    connectButton.disabled = false;
    if (!response) {
      say(result, 'The extension worker did not answer. Reload the page.', 'error');
      return;
    }
    if (response.ok === false) {
      say(result, ctx.noticeText({ code: response.code }), 'error');
      return;
    }
    say(result, 'Connected. Building the history.', 'ok');
    await ctx.onConnected();
  });

  host.replaceChildren(
    el('h1', { text: firstRun.title }),
    el(
      'div',
      { class: 'connect__body' },
      firstRun.body.map((paragraph) => el('p', { text: paragraph })),
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'leto-key', text: 'API key' }),
      keyField,
      el('p', {
        class: 'why why--not',
        id: 'leto-key-note',
        text: 'Trading 212 app, Settings, API. Tick only the read permissions. The key is stored in this browser and is never shown again.',
      }),
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'leto-secret', text: 'API secret' }),
      secretField,
      el('p', {
        class: 'why why--not',
        text: 'Leave empty if your key model has no secret.',
      }),
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'leto-env', text: 'Account' }),
      envField,
    ),
    el(
      'div',
      { class: 'actions' },
      connectButton,
      el('button', {
        type: 'button',
        class: 'btn',
        text: firstRun.demo,
        onclick: () => ctx.openDemo(),
      }),
    ),
    result,
  );
}

function say(node, text, level) {
  node.className = `result why${level ? ` result--${level}` : ''}`;
  node.textContent = text;
}
