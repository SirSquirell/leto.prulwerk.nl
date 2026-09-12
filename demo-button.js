// The extension's content script announces itself with a `leto:ready` event carrying
// its version, and opens the demo on `leto:open-demo`. Nothing else crosses. The button
// is a plain link to /demo/, so without the extension, and with JavaScript off, it still
// works: the same app served as a page on the same generated fixtures. Same origin, no
// server figure, nothing fetched but the fixtures.
(function () {
  var btn = document.getElementById('demo');
  var state = document.getElementById('demostate');
  var ver = document.getElementById('ver');
  var present = false;
  function setText(el, text) { if (el) el.textContent = text; }
  document.addEventListener('leto:ready', function (e) {
    present = true;
    var v = e && e.detail && typeof e.detail.version === 'string' ? e.detail.version.slice(0, 20) : '';
    if (v) setText(ver, v);
    setText(btn, 'Open the demo in Leto');
    setText(state, 'Extension found' + (v ? ' (' + v + ')' : '') + '. The demo opens in a new tab on generated data.');
  });
  document.addEventListener('leto:demo-open', function () { setText(state, 'Demo opened in a new tab.'); });
  if (btn) {
    btn.addEventListener('click', function (ev) {
      // With the extension installed the demo opens in it. Without it the link does its
      // own work and this handler stays out of the way.
      if (!present) return;
      ev.preventDefault();
      document.dispatchEvent(new CustomEvent('leto:open-demo'));
    });
  }
})();
