(function () {
  "use strict";

  var el = document.getElementById("entry-content");
  if (!el) return;
  var id = el.getAttribute("data-entry-id");
  if (!id) return;

  var intervalMs = 2000;
  var maxAttempts = 30;
  var attempts = 0;

  function scheduleNext() {
    if (attempts < maxAttempts) setTimeout(check, intervalMs);
  }

  function check() {
    attempts++;
    fetch("/entries/" + id + "/status", {
      headers: { "Accept": "application/json" },
      credentials: "same-origin",
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.ready) {
          location.reload();
        } else {
          scheduleNext();
        }
      })
      .catch(scheduleNext);
  }

  setTimeout(check, intervalMs);
})();
