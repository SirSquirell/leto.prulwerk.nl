// The extension's content script announces itself with a `leto:ready` event carrying
// its version, and opens the demo on `leto:open-demo`. Nothing else crosses. Without
// the extension the button leads to /demo/, the same app served as a page.
(function () {
  var btn = document.getElementById('demo');
  var state = document.getElementById('demostate');
  var ver = document.getElementById('ver');
  var present = false;
  function setText(el, text) { el.textContent = text; }
  document.addEventListener('leto:ready', function (e) {
    present = true;
    var v = e && e.detail && typeof e.detail.version === 'string' ? e.detail.version.slice(0, 20) : '';
    if (v) setText(ver, v);
    setText(state, 'Extension found' + (v ? ' (' + v + ')' : '') + '. The demo opens in a new tab on generated data.');
  });
  document.addEventListener('leto:demo-open', function () { setText(state, 'Demo opened in a new tab.'); });
  btn.addEventListener('click', function () {
    if (present) {
      document.dispatchEvent(new CustomEvent('leto:open-demo'));
      return;
    }
    // Without the extension the same app runs here as a page, on the same generated
    // fixtures. Same origin, no server figure, nothing fetched but the fixtures.
    window.location.href = '/demo/';
  });
  setTimeout(function () {
    if (!present) {
      setText(btn, 'Open the web demo');
      setText(state, 'Not installed yet. The web demo runs the same app on generated data; install to see your own account.');
    }
  }, 2500);
})();
