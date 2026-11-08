/* Локус — cookie-баннер и хранение выбора. Без внешних зависимостей. */
(() => {
  "use strict";
  const KEY = "locus:consent:v1";
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch (err) {
    saved = null;
  }
  if (saved && typeof saved === "object") window.LocusConsent = saved;

  const banner = document.createElement("div");
  banner.className = "cookie-banner";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Настройки cookie");
  banner.innerHTML = `
    <p><b>Cookie и данные.</b> Необходимые cookie держат вход и настройки. Аналитические и маркетинговые подключаем только с вашего согласия. Подробнее — <a href="legal.html#cookies">в политике</a>.</p>
    <div class="cookie-actions">
      <button type="button" class="btn btn--ghost" data-consent="necessary">Только необходимые</button>
      <button type="button" class="btn btn--ghost" data-consent="configure" aria-expanded="false">Настроить</button>
      <button type="button" class="btn btn--light" data-consent="all">Принять все</button>
    </div>
    <div class="cookie-details" id="cookieDetails" hidden>
      <label><input type="checkbox" data-cookie="analytics"> Аналитические — обезличенная статистика</label>
      <label><input type="checkbox" data-cookie="marketing"> Маркетинговые — ретаргетинг и пиксели</label>
      <button type="button" class="btn btn--light" data-consent="custom">Сохранить выбор</button>
    </div>`;
  document.body.prepend(banner);

  function paintSaved() {
    const current = window.LocusConsent;
    if (!current) return;
    const an = banner.querySelector('[data-cookie="analytics"]');
    const mk = banner.querySelector('[data-cookie="marketing"]');
    if (an) an.checked = Boolean(current.analytics);
    if (mk) mk.checked = Boolean(current.marketing);
  }
  paintSaved();

  if (!saved) window.setTimeout(() => banner.classList.add("is-visible"), 30);

  window.LocusCookieSettings = () => {
    paintSaved();
    banner.classList.add("is-visible");
  };

  function save(analytics, marketing) {
    const value = { necessary: true, analytics: Boolean(analytics), marketing: Boolean(marketing), ts: new Date().toISOString() };
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch (err) {
      /* если storage недоступен, выбор живёт до перезагрузки */
    }
    window.LocusConsent = value;
    banner.classList.remove("is-visible");
  }

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-cookie-settings]");
    if (trigger) {
      e.preventDefault();
      window.LocusCookieSettings();
    }
  });

  banner.querySelectorAll("[data-consent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.consent;
      if (action === "configure") {
        const details = banner.querySelector("#cookieDetails");
        if (!details) return;
        details.hidden = !details.hidden;
        btn.setAttribute("aria-expanded", String(!details.hidden));
        return;
      }
      if (action === "all") return save(true, true);
      if (action === "custom") {
        return save(
          banner.querySelector('[data-cookie="analytics"]')?.checked,
          banner.querySelector('[data-cookie="marketing"]')?.checked
        );
      }
      save(false, false);
    });
  });
})();
