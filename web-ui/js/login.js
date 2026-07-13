// web-ui/js/login.js — handles /login.html (login + signup in one form).
// Reads ALLOWED_REGISTRATION from /api/info and toggles the signup UI.

(function () {
  var loginForm = document.getElementById("login-form");
  var signupForm = document.getElementById("signup-form");
  var signupContainer = document.getElementById("signup-container");
  var resultEl = document.getElementById("result");
  var nextUrl = sessionStorage.getItem("login_next") || "/entries";

  function show(msg, kind) {
    if (!resultEl) return;
    resultEl.textContent = msg;
    resultEl.className = "alert alert-" + (kind || "error");
  }

  // Toggle signup availability based on server flag.
  fetch("/api/info", { credentials: "same-origin" })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (info) {
      if (info && info.allowed_registration === false && signupContainer) {
        signupContainer.classList.add("hidden");
        var note = document.createElement("p");
        note.className = "text-muted";
        note.textContent = "New account registration is disabled.";
        signupContainer.parentNode.appendChild(note);
      }
    })
    .catch(function () {});

  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      show("");
      try {
        await window.api("/api/auth/login", {
          method: "POST",
          body: {
            username: loginForm.username.value,
            password: loginForm.password.value,
          },
        });
        window.location.href = nextUrl;
      } catch (err) {
        show(err.message);
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      show("");
      if (signupForm.password.value.length < 8) {
        show("Password must be at least 8 characters.");
        return;
      }
      try {
        await window.api("/api/auth/signup", {
          method: "POST",
          body: {
            username: signupForm.username.value,
            password: signupForm.password.value,
            email: signupForm.email ? signupForm.email.value : undefined,
          },
        });
        window.location.href = nextUrl;
      } catch (err) {
        show(err.message);
      }
    });
  }
})();
