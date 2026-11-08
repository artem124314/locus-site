/* Локус — демо-вход и регистрация (без бэкенда) */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const normalizeCardInput = (value) => {
    const text = String(value || "").trim();
    return text && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? "https://" + text : text;
  };

  const isYandexCardUrl = (value) => {
    try {
      const u = new URL(normalizeCardInput(value));
      if (!/^https?:$/.test(u.protocol)) return false;
      if (!/(^|\.)yandex\.(ru|com|by|kz|uz|com\.tr|com\.ge|az)$/i.test(u.hostname)) return false;
      return /^\/(?:maps|profile|sprav|business)(?:\/|$)/i.test(u.pathname);
    } catch {
      return false;
    }
  };

  const session = window.LocusSession;
  if (!session) return;

  const params = new URLSearchParams(window.location.search);
  const wantsAudit = params.get("audit") === "1" || params.get("next") === "app.html#audit";
  const rawNext = params.get("next") || (wantsAudit ? "app.html#audit" : "app.html");
  const next = /^app\.html(?:[#?].*)?$/.test(rawNext) ? rawNext : "app.html";
  const hashMode = window.location.hash.replace("#", "") === "signup";

  const loginForm = $("#loginForm");
  const signupForm = $("#signupForm");
  const tabLogin = $("#tabLogin");
  const tabSignup = $("#tabSignup");
  const title = $("#authTitle");
  const sub = $("#authSub");
  const alreadyNote = $("#alreadyNote");
  const alreadyName = $("#alreadyName");

  function setMode(mode) {
    const isSignup = mode === "signup";
    loginForm.hidden = isSignup;
    signupForm.hidden = !isSignup;
    tabLogin.setAttribute("aria-selected", String(!isSignup));
    tabSignup.setAttribute("aria-selected", String(isSignup));
    title.textContent = isSignup
      ? (wantsAudit ? "Аудит почти готов" : "Начнём с карточки")
      : "Вход в Локус";
    sub.textContent = isSignup
      ? (wantsAudit
        ? "Аккаунт открывает разбор этой точки. Отдельного пробного запаса нет. Карта не нужна."
        : "Аккаунт открывает кабинет карточки. Отдельного пробного запаса нет. Карта не нужна.")
      : "Войдите, чтобы открыть карточку, отзывы и очередь публикации.";
    const flow = $("#auditFlow");
    if (flow) flow.hidden = !(wantsAudit && isSignup);
    $("#loginMsg").textContent = "";
    $("#signupMsg").textContent = "";
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("mode");
      url.hash = isSignup ? "signup" : "";
      window.history.replaceState({}, "", url);
    } catch (err) {
      /* noop */
    }
    const field = isSignup ? $("#signupName") : $("#loginEmail");
    if (field) setTimeout(() => field.focus({ preventScroll: true }), 30);
  }

  function fail(el, text) {
    el.textContent = text;
    const form = el.closest("form");
    const input = form?.querySelector('input[aria-invalid="true"]') || form?.querySelector("input");
    input?.focus();
  }

  function isValidLogin(value) {
    return /^[\p{L}\p{N}._@+-]{2,40}$/u.test(value);
  }

  const apiProbe = fetch("/api/health", { headers: { Accept: "application/json" } })
    .then((r) => r.ok)
    .catch(() => false);

  let authBusy = false;
  let signupOpened = false;

  function submitControl(form) {
    return form?.querySelector('button[type="submit"]') || null;
  }

  function lockForm(form) {
    authBusy = true;
    const button = submitControl(form);
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
  }

  function unlockForm(form) {
    authBusy = false;
    const button = submitControl(form);
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  async function finish(data, kind, payload) {
    const apiUp = await apiProbe;
    if (apiUp) {
      const endpoint = kind === "demo" ? "/api/auth/demo" : kind === "login" ? "/api/auth/login" : "/api/auth/signup";
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: kind === "demo" ? { Accept: "application/json" } : { "Content-Type": "application/json" },
          body: kind === "demo" ? undefined : JSON.stringify(payload),
        });
        if (res.ok) {
          if (kind === "signup") {
            signupOpened = true;
            const body = await res.json().catch(() => null);
            if (body?.localMail?.link) sessionStorage.setItem("locus:local-mail", body.localMail.link);
            if (body?.intake?.notice) sessionStorage.setItem("locus:intake-notice", body.intake.notice);
          }
          window.location.assign(next);
          return true;
        }
        const err = await res.json().catch(() => ({}));
        if (kind === "signup" && res.status === 409) {
          if (signupOpened) {
            window.location.assign(next);
            return true;
          }
          const email = String(payload?.email || "").trim();
          try {
            const me = await fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
            if (me.ok) {
              const sessionData = await me.json();
              const current = String(sessionData?.user?.email || "").trim().toLowerCase();
              if (current && current === email.toLowerCase()) {
                signupOpened = true;
                window.location.assign(next);
                return true;
              }
            }
          } catch { /* сессии этой регистрации нет */ }
          setMode("login");
          const loginEmail = $("#loginEmail");
          if (loginEmail) loginEmail.value = email;
          const loginMsg = $("#loginMsg");
          if (loginMsg) loginMsg.textContent = "Такой логин уже есть. Войдите с паролем, который задавали при регистрации.";
          return false;
        }
        const msg = kind === "signup" ? $("#signupMsg") : $("#loginMsg");
        if (msg) msg.textContent = err.error || "Не удалось войти. Проверьте данные и попробуйте снова.";
        return false;
      } catch (err) {
        /* сервер недоступен — работаем как локальное демо */
      }
    }
    session.set(data);
    window.location.assign(next);
    return true;
  }

  /* ---------- вкладки ---------- */
  tabLogin.addEventListener("click", () => setMode("login"));
  tabSignup.addEventListener("click", () => setMode("signup"));
  if (params.get("mode") === "signup" || hashMode) setMode("signup");

  /* ---------- уже вошли ---------- */
  const current = session.get();
  if (current) {
    alreadyNote.hidden = false;
    alreadyName.textContent = current.name;
    const email = $("#loginEmail");
    if (email) email.value = current.email;
  } else {
    fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.user) return;
        alreadyNote.hidden = false;
        alreadyName.textContent = data.user.name;
        const email = $("#loginEmail");
        if (email) email.value = data.user.email;
      })
      .catch(() => {});
  }

  let prefEmail = params.get("email") || "";
  try {
    const stored = sessionStorage.getItem("locus:prefill-email");
    if (stored) {
      prefEmail = stored;
      sessionStorage.removeItem("locus:prefill-email");
    }
  } catch (err) {
    /* noop */
  }
  if (prefEmail && !current && $("#loginEmail")) {
    $("#loginEmail").value = prefEmail;
  }
  let prefCard = params.get("card") || "";
  try {
    const storedCard = sessionStorage.getItem("locus:prefill-card");
    if (!prefCard && storedCard) prefCard = storedCard;
    if (prefCard && !current && $("#signupCard")) {
      $("#signupCard").value = prefCard;
      sessionStorage.removeItem("locus:prefill-card");
      setTimeout(() => previewCard(prefCard), 100);
    }
  } catch (err) { /* noop */ }

  async function previewCard(rawUrl) {
    const url = normalizeCardInput(rawUrl);
    const company = $("#signupCompany");
    if (!url || !isYandexCardUrl(url) || !company || company.value.trim()) return;
    try {
      const res = await fetch(`/api/card/preview?url=${encodeURIComponent(url)}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = await res.json();
      const name = String(data?.card?.name || "").trim();
      if (name && company && company.dataset.touched !== "1") {
        company.value = name;
        company.classList.add("is-autofilled");
        const note = $("#signupCardNote");
        if (note) note.textContent = `Название с карточки: ${name}`;
      }
    } catch { /* карточка не прочиталась — заполним вручную */ }
  }

  let previewTimer = 0;
  $("#signupCompany")?.addEventListener("input", (event) => {
    if (event.isTrusted) event.target.dataset.touched = "1";
  });
  $("#signupCard")?.addEventListener("input", () => {
    clearTimeout(previewTimer);
    const value = ($("#signupCard")?.value || "").trim();
    if (!isYandexCardUrl(value)) return;
    previewTimer = setTimeout(() => previewCard(value), 600);
  });
  $("#signupCard")?.addEventListener("blur", () => {
    clearTimeout(previewTimer);
    previewCard(($("#signupCard")?.value || "").trim());
  });

  $("#alreadyOut")?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (err) {
      /* локальный демо-режим */
    }
    session.clear();
    alreadyNote.hidden = true;
    $("#loginEmail").value = "";
    $("#loginPassword").value = "";
  });

  /* ---------- вход ---------- */
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (authBusy) return;
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    const msg = $("#loginMsg");
    if (!isValidLogin(email)) {
      fail(msg, "Логин: от 2 до 40 знаков, без пробелов.");
      $("#loginEmail").setAttribute("aria-invalid", "true");
      return;
    }
    $("#loginEmail").removeAttribute("aria-invalid");
    if (password.length < 6) {
      fail(msg, "Пароль короче шести символов.");
      $("#loginPassword").setAttribute("aria-invalid", "true");
      return;
    }
    $("#loginPassword").removeAttribute("aria-invalid");
    msg.textContent = "";
    if (authBusy) return;
    lockForm(loginForm);

    const isDemo = email === session.DEMO.email;
    const name = isDemo ? session.DEMO.name : session.nameFromEmail(email);
    let opened = false;
    try {
      opened = await finish(
        {
          name,
          fullName: isDemo ? session.DEMO.fullName : name,
          email,
          company: session.DEMO.company,
          role: "Владелец",
          plan: "Самостоятельный",
        },
        "login",
        { login: email, email, password }
      );
    } finally {
      if (!opened) unlockForm(loginForm);
    }
  });

  /* ---------- регистрация ---------- */
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (authBusy) return;
    const name = $("#signupName").value.trim();
    const companyField = $("#signupCompany");
    const company = companyField.value.trim();
    const companyTouched = companyField.dataset.touched === "1";
    const email = $("#signupLogin").value.trim();
    const cardUrl = normalizeCardInput($("#signupCard")?.value || "");
    const password = $("#signupPassword").value;
    const agree = $("#signupAgree").checked;
    const pdConsent = $("#signupPd").checked;
    const marketingConsent = $("#signupMarketing").checked;
    const msg = $("#signupMsg");

    if (name.length < 2) {
      fail(msg, "Напишите, как к вам обращаться.");
      $("#signupName").setAttribute("aria-invalid", "true");
      return;
    }
    $("#signupName").removeAttribute("aria-invalid");
    if (company.length < 2) {
      fail(msg, "Укажите название бизнеса — оно попадёт в карточку.");
      $("#signupCompany").setAttribute("aria-invalid", "true");
      return;
    }
    $("#signupCompany").removeAttribute("aria-invalid");
    if (!isValidLogin(email)) {
      fail(msg, "Логин: от 2 до 40 знаков, без пробелов.");
      $("#signupLogin").setAttribute("aria-invalid", "true");
      return;
    }
    $("#signupLogin").removeAttribute("aria-invalid");
    if (password.length < 6) {
      fail(msg, "Пароль должен быть не короче шести символов.");
      $("#signupPassword").setAttribute("aria-invalid", "true");
      return;
    }
    $("#signupPassword").removeAttribute("aria-invalid");
    if (wantsAudit && !cardUrl) {
      fail(msg, "Вставьте ссылку на карточку — без неё не сможем показать аудит.");
      $("#signupCard").setAttribute("aria-invalid", "true");
      return;
    }
    if (cardUrl && !isYandexCardUrl(cardUrl)) {
      fail(msg, "Ссылка должна вести на карточку в Яндекс.Картах.");
      $("#signupCard").setAttribute("aria-invalid", "true");
      return;
    }
    $("#signupCard")?.removeAttribute("aria-invalid");
    if (cardUrl && $("#signupCard")) $("#signupCard").value = cardUrl;
    if (!agree) {
      fail(msg, "Примите условия сервиса — без этого не можем создать аккаунт.");
      $("#signupAgree").focus();
      return;
    }
    if (!pdConsent) {
      fail(msg, "Нужно отдельное согласие на обработку персональных данных.");
      $("#signupPd").focus();
      return;
    }
    msg.textContent = "";
    if (authBusy) return;
    lockForm(signupForm);
    let opened = false;
    try {
      opened = await finish(
        {
          name,
          fullName: name,
          email,
          company,
          role: "Владелец",
          plan: "Самостоятельный",
        },
        "signup",
        { name, company, companyTouched, login: email, cardUrl, password, offerAccepted: agree, pdConsent, marketingConsent }
      );
    } finally {
      if (!opened) unlockForm(signupForm);
    }
  });

  /* ---------- демо ---------- */
  $("#demoBtn").addEventListener("click", async () => {
    await finish({ ...session.DEMO }, "demo");
  });

  /* ---------- очистка ошибок при вводе ---------- */
  document.querySelectorAll(".auth-form input").forEach((input) => {
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      const msg = input.closest("form")?.querySelector(".auth-msg");
      if (msg) msg.textContent = "";
    });
  });

  /* «Посмотреть демо» с лендинга: один переход и сразу кабинет */
  if (params.get("demo") === "1") {
    const btn = $("#demoBtn");
    if (btn) setTimeout(() => btn.click(), 120);
  }

  const resetBox = $("#resetBox");
  const resetTokenFromUrl = params.get("reset") || "";
  if (resetTokenFromUrl && resetBox) {
    resetBox.hidden = false;
    resetBox.dataset.token = resetTokenFromUrl;
  }
  if (params.get("verify")) {
    fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: params.get("verify") }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        const msg = $("#loginMsg");
        if (msg) msg.textContent = ok ? "Можно входить." : (data.error || "Ссылка не подошла.");
      })
      .catch(() => {});
  }
  $("#forgotLink")?.addEventListener("click", async (event) => {
    event.preventDefault();
    const email = $("#loginEmail").value.trim();
    const msg = $("#loginMsg");
    if (!isValidLogin(email)) {
      if (msg) msg.textContent = "Сначала укажите логин.";
      return;
    }
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ login: email }),
      });
      const data = await res.json();
      const link = data.localMail?.link || "";
      if (msg) msg.textContent = link ? `${data.localMail.note} ${link}` : (data.note || data.error || "Ссылка не выдана.");
      if (link && resetBox) {
        const token = new URL(link, window.location.origin).searchParams.get("reset") || "";
        resetBox.hidden = false;
        resetBox.dataset.token = token;
      }
    } catch {
      if (msg) msg.textContent = "Не удалось отправить ссылку. Попробуйте ещё раз.";
    }
  });
  const yandexMsg = $("#yandexMsg");
  if (params.get("oauth") === "error" && yandexMsg) {
    yandexMsg.textContent = params.get("msg") || "Войти через Яндекс не удалось.";
  }
  $("#yandexAuth")?.addEventListener("click", () => {
    if (!$("#oauthOffer")?.checked || !$("#oauthPd")?.checked) {
      if (yandexMsg) yandexMsg.textContent = "Нужны условия сервиса и согласие на данные. Счёт выставляется на этот аккаунт.";
      return;
    }
    const q = new URLSearchParams();
    q.set("offer", "1");
    q.set("pd", "1");
    if ($("#oauthMarketing")?.checked) q.set("marketing", "1");
    q.set("next", next);
    const plan = params.get("plan");
    if (plan) q.set("plan", plan);
    const card = $("#signupCard")?.value || "";
    if (card) q.set("card", card);
    window.location.assign(`/api/auth/yandex?${q.toString()}`);
  });

  $("#resetSubmit")?.addEventListener("click", async () => {
    const msg = $("#loginMsg");
    const token = resetBox?.dataset.token || "";
    const password = $("#resetPassword")?.value || "";
    if (password.length < 6) {
      if (msg) msg.textContent = "Пароль короче шести символов.";
      return;
    }
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (msg) msg.textContent = data.error || "Не удалось сменить пароль.";
        return;
      }
      if (msg) msg.textContent = "Пароль обновлён. Войдите с новым паролем.";
      if ($("#loginPassword")) $("#loginPassword").value = "";
      if (resetBox) resetBox.hidden = true;
    } catch {
      if (msg) msg.textContent = "Сервер не ответил.";
    }
  });
})();
