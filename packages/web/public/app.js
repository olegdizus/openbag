// Wallabag CF — progressive enhancement
// All forms work without JS via standard POST + redirect.
// This script intercepts forms marked [data-enhance] and updates the DOM
// in-place instead of reloading the page.

(function () {
  "use strict";

  function enhanceSubmit(e) {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.hasAttribute("data-enhance")) return;

    const confirmMsg = form.getAttribute("data-confirm");
    if (confirmMsg && !window.confirm(confirmMsg)) {
      e.preventDefault();
      return;
    }

    e.preventDefault();

    const targetId = form.getAttribute("data-target");
    const target = targetId ? document.getElementById(targetId) : null;

    fetch(form.action, {
      method: form.method || "POST",
      body: new FormData(form),
      headers: { "X-Requested-With": "XMLHttpRequest" },
      redirect: "follow",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (html) {
        if (html === "") {
          if (target) target.remove();
          return;
        }
        if (!target) {
          window.location.reload();
          return;
        }
        const tmp = document.createElement("div");
        tmp.innerHTML = html.trim();
        const next = tmp.firstElementChild;
        if (next) target.replaceWith(next);
        else target.outerHTML = html;
      })
      .catch(function () {
        // Fall back to native form submission.
        form.removeAttribute("data-enhance");
        form.submit();
      });
  }

  document.addEventListener("submit", enhanceSubmit);

  // "Copy to clipboard" buttons — marked with [data-copy].
  document.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    e.preventDefault();
    const text = btn.getAttribute("data-copy") || "";
    const done = function () {
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(function () { btn.textContent = original; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (err) {}
      document.body.removeChild(ta);
    }
  });
})();
