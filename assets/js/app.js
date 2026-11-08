/* Локус — кабинет: демо-логика без бэкенда */
(() => {
  "use strict";
  try {
    document.documentElement.dataset.theme = localStorage.getItem("locus:theme") === "dark" ? "dark" : "light";
  } catch {
    document.documentElement.dataset.theme = "light";
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cardImageSrc = (src) => {
    const value = String(src || "").trim().replace(/\{size\}/gi, "XXL_height");
    return /^https:\/\/avatars\.mds\.yandex\.net\/get-(?:altay|sprav-products)\//i.test(value)
      ? `/api/card-image?u=${encodeURIComponent(value)}`
      : value;
  };

  /* ---------- toast ---------- */
  const stack = $("#toastStack");
  function apiMissingText() {
    return "API не отвечает. Обновите страницу. Для локальной копии запустите сервер кабинета.";
  }

  function liveErrorText(err, fallback = "Запрос не выполнен.") {
    if (!serverActive) return apiMissingText();
    const status = Number(err?.status) || 0;
    const message = String(err?.message || fallback).trim() || fallback;
    if (status && !message.includes(String(status))) return `${status}: ${message}`;
    return message;
  }

  function auditIsPaid(audit) {
    if (!audit || typeof audit !== "object") return false;
    if (audit.billing?.status === "paid") return true;
    return Object.prototype.hasOwnProperty.call(audit, "paywall") && audit.paywall == null;
  }

  function toast(title, text = "") {
    if (!stack) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = '<span class="tick" aria-hidden="true">✓</span><div><strong></strong><span></span></div>';
    el.querySelector("strong").textContent = title;
    el.querySelector("span:last-child").textContent = text;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("toast--out");
      setTimeout(() => el.remove(), 260);
    }, 4200);
  }

  /* ---------- сессия ---------- */
  const auth = window.LocusSession;
  const currentSession = auth ? auth.get() : null;
  const sessionLabel = $("#sessionLabel");
  const sessionAction = $("#sessionAction");

  let serverActive = false;
  let sessionChecked = false;
  let auditBillingKnown = false;
  let auditFindings = [];
  let auditPayPlan = "";
  let activeOrgId = null;
  let selectedPalette = 0;
  let paletteTouched = false;
  let selectedLook = "";
  let selectedStory = 0;
  let generatedStoryImageId = null;
  const productPhotoChoices = new Map();
  let currentUserEmail = "";
  let currentOrgPlan = "Стартовый";
  let currentLimits = null;

  function planContents(limits, planName) {
    const plan = limits?.plan || planName || "Стартовый";
    const table = {
      "Стартовый": { replies: 60, stories: 30, products: 30, phrases: 100, images: 24, texts: 60 },
      "Самостоятельный": { replies: 300, stories: 150, products: 150, phrases: 500, images: 60, texts: 300 },
      "Автоматический": { replies: 1000, stories: 500, products: 600, phrases: 2000, images: 120, texts: 1000 },
    };
    const row = table[plan] || table["Стартовый"];
    const spec = limits && (limits.plan === plan || !limits.plan) ? { ...row, ...limits } : row;
    const extraPoint = Number(spec.extraPoint) || (plan === "Автоматический" ? 2500 : plan === "Самостоятельный" ? 1900 : 1200);
    const auto = plan === "Автоматический" ? "Автопилот в кабинете. " : "Автопилота нет. ";
    const extra = `${auto}Следующая точка — ${extraPoint.toLocaleString("ru-RU")} ₽.`;
    return `${spec.replies} ответов · ${spec.stories} сторис · ${spec.products} позиций · ${spec.images} изображений · ${spec.phrases} фраз · ${spec.texts} текстов. ${extra}`;
  }

  function paintPlanIncludes(limits, planName) {
    const line = $("#planIncludes");
    if (line) line.textContent = planContents(limits, planName);
  }
  let currentCardUrl = "";
  let currentOrg = null;
  let currentCardMeta = null;
  let currentCardImages = [];
  let cardImagesLoaded = false;
  let currentBrandbook = null;
  let brandbookMeta = null;
  let autopilotData = null;
  let autopilotReport = null;
  let autopilotBusy = false;
  let calendarData = null;
  let calendarMonth = new Date().toISOString().slice(0, 7);
  let calendarSelected = "";
  let clients = [];
  let clientSummary = {};
  let selectedClientId = null;
  let editingClientId = null;
  let serverStoryVariants = [];
  let storyCtaTouched = false;
  let storyToneTouched = false;
  let notificationItems = [];
  let notificationsUnread = 0;
  const readNotificationKeys = new Set();
  const initials = (name) => (auth ? auth.initials(name) : String(name || "А").slice(0, 1));

  function applyIdentity({ name, fullName, role, orgName, label }) {
    if (sessionLabel) sessionLabel.textContent = label;
    if (sessionAction) {
      sessionAction.textContent = "Выйти";
      sessionAction.href = "#";
      if (sessionAction.dataset.bound !== "1") {
        sessionAction.dataset.bound = "1";
        sessionAction.addEventListener("click", async (e) => {
          e.preventDefault();
          if (serverActive) {
            try {
              await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
            } catch (err) {
              /* локальный демо-режим */
            }
          }
          if (auth) auth.clear();
          window.location.assign("index.html?logout=1");
        });
      }
    }
    const displayName = fullName || name;
    if ($("#sideUserName")) $("#sideUserName").textContent = displayName;
    if ($("#sideUserRole")) $("#sideUserRole").textContent = role || "Владелец";
    if ($("#sideAvatar")) $("#sideAvatar").textContent = initials(name);
    if ($("#topUserName")) $("#topUserName").textContent = name;
    if ($("#topAvatar")) $("#topAvatar").textContent = initials(name);
    if ($("#sideCompanyName") && orgName) $("#sideCompanyName").textContent = orgName;
  }

  function renderOrgSwitcher(orgs, activeId) {
    const select = $("#orgSelect");
    if (!select) return;
    const list = Array.isArray(orgs) ? orgs : [];
    select.innerHTML = list.map((org) => `<option value="${org.id}"${org.id === activeId ? " selected" : ""}>${esc(org.name)}${org.city ? ` · ${esc(org.city)}` : ""}</option>`).join("");
    select.hidden = list.length < 2;
    if (select.dataset.bound !== "1") {
      select.dataset.bound = "1";
      select.addEventListener("change", async () => {
        const id = Number(select.value);
        if (!id) return;
        try {
          await apiJson(`/api/orgs/${id}/activate`, { method: "POST" });
          window.location.reload();
        } catch (err) {
          toast("Организация", err.message || "Не удалось переключить");
        }
      });
    }
  }

  function updateSideStatus(org, autopilot = null) {
    const el = $("#sideStatus");
    if (!el) return;
    const dot = '<span class="dot"></span>';
    if (autopilot?.settings?.status === "connected") {
      const mode = autopilot.settings.mode === "auto" ? "цикл в кабинете" : autopilot.settings.mode === "sms" ? "SMS" : "очередь";
      el.innerHTML = `${dot} Автопилот · ${mode}`;
      return;
    }
    el.innerHTML = org?.yandexUrl ? `${dot} Ссылка есть · тексты отправляет аккаунт представителя` : `${dot} Ссылки на карточку нет`;
  }

  if (currentSession) {
    applyIdentity({
      name: currentSession.name,
      fullName: currentSession.fullName || currentSession.name,
      role: `${currentSession.role || "Владелец"} · сессия`,
      label: `Вы вошли как ${currentSession.name} · сохранённая сессия`,
    });
  }

  fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !data.user) return;
      serverActive = true;
      const org = data.orgs.find((o) => o.id === data.activeOrgId) || data.orgs[0];
      activeOrgId = org?.id || data.activeOrgId || null;
      currentUserEmail = data.user.email || "";
      currentOrgPlan = data.limits?.plan || org?.plan || "Стартовый";
      currentLimits = data.limits || null;
      paintPlanIncludes(currentLimits, currentOrgPlan);
      currentOrg = org || null;
      currentCardUrl = org?.yandexUrl || "";
      if (activeOrgId) {
        if ($("#sheetAudit")) $("#sheetAudit").href = `/api/orgs/${activeOrgId}/audit-sheet`;
        if ($("#sheetReport")) $("#sheetReport").href = `/api/orgs/${activeOrgId}/report-sheet`;
        if ($("#sheetInvoice")) $("#sheetInvoice").href = `/api/orgs/${activeOrgId}/invoice-sheet`;
        if ($("#analyticsReport")) $("#analyticsReport").href = `/api/orgs/${activeOrgId}/report-sheet`;
      }
      paintCardSurfaces(currentOrg);
      renderOrgSwitcher(data.orgs, activeOrgId);
      updateSideStatus(org);
      if ($("#accountName")) $("#accountName").textContent = data.user.name || "—";
      if ($("#accountEmail")) $("#accountEmail").textContent = data.user.email || "—";
      if ($("#supportEmail") && String(data.user.email || "").includes("@")) $("#supportEmail").value = data.user.email;
      if ($("#accountOrg")) $("#accountOrg").textContent = org?.name || "—";
      if ($("#accountPlan")) $("#accountPlan").textContent = `Тариф «${data.limits?.plan || org?.plan || "Стартовый"}»`;
      if ($("#accountRole")) {
        const roleLabels = { owner: "Владелец", manager: "Менеджер", viewer: "Наблюдатель" };
        $("#accountRole").textContent = roleLabels[org?.role] || "Владелец";
      }
      applyOrgVoice(org);
      applyIdentity({
        name: data.user.name.split(" ")[0] || data.user.name,
        fullName: data.user.name,
        role: org?.role === "viewer" ? "Наблюдатель" : org?.role === "manager" ? "Менеджер" : "Владелец",
        orgName: data.user.email === "demo@locus.ru" && org?.name ? `Демо · ${org.name}` : org?.name,
        label: data.user.email === "demo@locus.ru"
          ? `Демо · ${data.user.name.split(" ")[0]}`
          : `Вы вошли как ${data.user.name.split(" ")[0]} · защищённая сессия`,
      });
      if ($("#ovOrg") && org) {
        const hour = new Date().getHours();
        const greeting = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
        const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
        const who = data.user.name.split(" ")[0] || "";
        $("#ovOrg").textContent = [`${greeting}${who ? `, ${who}` : ""}`, org.name, org.city, today].filter(Boolean).join(" · ");
      }
      const storyLimit = Number(data.limits?.stories || 0);
      const storyUsed = Number(data.limits?.usedStories || 0);
      const storyHead = document.querySelector("#storyQuota");
      if (storyHead && org) {
        storyHead.textContent = `${storyUsed} из ${storyLimit} в этом месяце · серия для «${org.name}»`;
      }
      const storyCounter = $("#storyCounter");
      if (storyCounter && storyLimit) storyCounter.textContent = `осталось ${Math.max(0, storyLimit - storyUsed)} публикаций`;
      const plaque = document.querySelector(".plan-mini");
      if (plaque) plaque.hidden = true;
      const onboard = $("#onboarding");
      const linkMissing = Boolean(org && org.publicCard === false);
      if (onboard && org && (!org.city || !org.address || sessionStorage.getItem("locus:fill-open") || linkMissing)) {
        onboard.hidden = false;
        if (linkMissing && $("#fillUrl") && org.yandexUrl && !$("#fillUrl").value) $("#fillUrl").value = org.yandexUrl;
        loadFill();
      } else if (onboard) {
        onboard.hidden = true;
      }
      let intakeNotice = "";
      try { intakeNotice = sessionStorage.getItem("locus:intake-notice") || ""; } catch { intakeNotice = ""; }
      if (intakeNotice) {
        try { sessionStorage.removeItem("locus:intake-notice"); } catch { /* уже показали */ }
        if (onboard) onboard.hidden = false;
        const intakeMsg = $("#fillMsg");
        if (intakeMsg && !intakeMsg.textContent.trim()) intakeMsg.textContent = intakeNotice;
        toast("Нужны данные", intakeNotice);
      }
      const verifyBox = $("#verifyBox");
      if (verifyBox) verifyBox.hidden = true;
      loadInvoices();
      loadSupportTickets();
      applySettings();
      applyUsage(data.limits || {});
      if ($("#planCardSub")) $("#planCardSub").textContent = "";
      if ($("#trialChip")) $("#trialChip").hidden = true;
      if ($("#invoiceIssue")) $("#invoiceIssue").hidden = true;
      if ($("#invoiceNote")) $("#invoiceNote").hidden = true;
      applyPriceCopy();
      setTimeout(checkWeeklyNewsReminder, 1600);
      setTimeout(loadOverview, 0);
      setTimeout(loadBrandbook, 0);
      setTimeout(loadClientBadge, 0);
      setTimeout(refreshNotifications, 900);
      if (location.hash === "#cabinet") setTimeout(loadCabinet, 0);
      if (location.hash === "#autopilot") setTimeout(loadAutopilot, 0);
      if (location.hash === "#audit") loadAudit();
      if (location.hash === "#reviews") loadReviews();
      if (location.hash === "#clients") loadClients();
      if (location.hash === "#brandbook") loadBrandbook();
      if (location.hash === "#stories") loadStorySeries();
      if (location.hash === "#images" || location.hash === "#media") setTimeout(loadImages, 0);
      if (location.hash === "#prices") setTimeout(loadPrices, 0);
      if (location.hash === "#storefront") setTimeout(loadStorefront, 0);
      if (location.hash === "#news") setTimeout(loadNews, 0);
      if (location.hash === "#semantics") setTimeout(loadSemantics, 0);
      if (location.hash === "#analytics") setTimeout(loadAnalytics, 0);
    })
    .catch(() => {})
    .finally(() => { sessionChecked = true; });

  $("#onboardClose")?.addEventListener("click", () => {
    const onboard = $("#onboarding");
    if (onboard) onboard.hidden = true;
    sessionStorage.removeItem("locus:fill-open");
  });

  let fillManual = false;
  let reviewLinkNeeded = false;

  function countText(known, value) {
    if (known === false) return "нет данных";
    if (known === true) return String(value ?? 0);
    return "";
  }

  function renderFill(data) {
    const report = $("#fillReport");
    const gapsBox = $("#fillGaps");
    const onboard = $("#onboarding");
    if (!report || !gapsBox) return;
    const counts = data.counts || {};
    const bits = [];
    if (data.imported?.city || counts.reviewsKnown || counts.photosKnown || counts.ratingsKnown) {
      const reviews = countText(counts.reviewsKnown, counts.reviews);
      const ratings = countText(counts.ratingsKnown, counts.ratings);
      const photos = countText(counts.photosKnown, counts.photos);
      if (reviews) bits.push(`отзывы ${reviews}`);
      if (ratings) bits.push(`оценки ${ratings}`);
      if (photos) bits.push(`фото ${photos}`);
    }
    const unread = Array.isArray(data.unread) ? data.unread : [];
    const previews = Array.isArray(data.previews) ? data.previews.slice(0, 3) : [];
    const productLine = data.products?.collapsed
      ? `Прайс: ${data.products.visible} с ценой на экране, ещё ${data.products.collapsed} свёрнуты.`
      : "";
    report.hidden = !bits.length && !unread.length && !previews.length && !productLine;
    report.innerHTML = [
      bits.length ? `<p>С карточки: ${esc(bits.join(", "))}. Это не статус публикации.</p>` : "",
      productLine ? `<p>${esc(productLine)}</p>` : "",
      unread.map((line) => `<p>${esc(line)}</p>`).join(""),
      previews.map((preview) => {
        const snippet = preview.snippet || {};
        const price = snippet.price ? `${snippet.price} ₽` : "цены в сниппете нет";
        return `<article class="fill-snippet"><b>${esc(snippet.title || "Черновик ответа")}</b><span>${esc(price)}</span><span class="fill-snippet-cta">${esc(snippet.cta || "")}</span><span class="fill-snippet-status small">${esc(snippet.note || "")}</span></article>`;
      }).join(""),
      previews.length ? `<button class="btn btn--small" type="button" id="fillEnqueue">Поставить черновики в очередь</button>` : "",
    ].join("");
    $("#fillEnqueue")?.addEventListener("click", async () => {
      const msg = $("#fillMsg");
      if (msg) msg.textContent = "Ставим в очередь…";
      try {
        const next = await apiJson(`/api/orgs/${activeOrgId}/fill`, { method: "POST", body: { action: "enqueue-replies" } });
        if (msg) msg.textContent = `В очереди ${next.queued || 0}. В Яндекс.Картах их ещё нет: нужен скриншот после публикации.`;
        renderFill(next);
        loadOverview();
      } catch (err) {
        if (msg) msg.textContent = err.message || "Не удалось поставить в очередь.";
      }
    });
    const gaps = (data.started || fillManual) && Array.isArray(data.gaps) ? data.gaps : [];
    const shown = fillManual ? gaps.filter((gap) => gap.kind !== "note").slice(0, 1) : gaps;
    gapsBox.hidden = !shown.length;
    gapsBox.innerHTML = shown.map((gap) => {
      if (gap.kind === "note") return `<div class="fill-gap"><p>${esc(gap.question)}</p></div>`;
      if (gap.kind === "accept") {
        return `<form class="fill-gap" data-gap="${esc(gap.id)}">
          <p>${esc(gap.question)}</p>
          <textarea name="value" rows="4">${esc(gap.draft || "")}</textarea>
          <div class="onboard-fill__actions">
            <button class="btn btn--small" type="submit">Принять</button>
          </div>
        </form>`;
      }
      if (gap.kind === "choice") {
        const options = (gap.options || []).map((option) => `<button class="btn btn--ghost btn--small" type="button" data-choice="${esc(option)}">${esc(option)}</button>`).join("");
        return `<form class="fill-gap" data-gap="${esc(gap.id)}">
          <p>${esc(gap.question)}</p>
          <div class="onboard-fill__actions">${options}</div>
        </form>`;
      }
      return `<form class="fill-gap" data-gap="${esc(gap.id)}">
        <label>${esc(gap.question)}
          <input name="value" required>
        </label>
        <button class="btn btn--small" type="submit">Сохранить</button>
      </form>`;
    }).join("");
    gapsBox.querySelectorAll("form").forEach((form) => {
      form.addEventListener("submit", (event) => submitFillGap(event, form.dataset.gap, form.querySelector("[name=value]")?.value || "да"));
      form.querySelectorAll("[data-choice]").forEach((button) => {
        button.addEventListener("click", () => submitFillGap(null, form.dataset.gap, button.dataset.choice));
      });
    });
    if (onboard && (data.started || shown.length || bits.length)) {
      onboard.hidden = false;
      sessionStorage.setItem("locus:fill-open", "1");
    }
    const linkStillOpen = currentOrg?.publicCard === false || reviewLinkNeeded;
    if (onboard && data.started && !shown.length && !previews.length && !linkStillOpen) onboard.hidden = true;
    if (linkStillOpen && onboard) onboard.hidden = false;
    const intakeMsg = $("#fillMsg");
    if (intakeMsg && !intakeMsg.textContent.trim() && data.intake?.notice) {
      intakeMsg.textContent = data.intake.notice;
      if (onboard) onboard.hidden = false;
    }
  }

  async function loadFill() {
    if (!activeOrgId || !$("#fillGaps")) return;
    try {
      renderFill(await apiJson(`/api/orgs/${activeOrgId}/fill`));
    } catch (err) {
      const msg = $("#fillMsg");
      if (msg) msg.textContent = err.message || "Не удалось открыть заполнение.";
    }
  }

  async function submitFillGap(event, id, value) {
    event?.preventDefault();
    const msg = $("#fillMsg");
    if (!activeOrgId) return;
    if (msg) msg.textContent = "Сохраняем…";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/fill`, { method: "POST", body: { answer: { id, value } } });
      if (msg) msg.textContent = "Сохранено. Дальше только то, что ещё не прочитано.";
      const fresh = await apiJson("/api/me");
      applyUsage(fresh.limits || {});
      const freshOrg = (fresh.orgs || []).find((item) => item.id === activeOrgId) || fresh.orgs?.[0];
      if (freshOrg && $("#ovOrg")) {
        const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
        $("#ovOrg").textContent = [freshOrg.name, freshOrg.city, today].filter(Boolean).join(", ");
      }
      renderFill(data);
      loadOverview();
    } catch (err) {
      if (msg) msg.textContent = err.message || "Не удалось сохранить.";
    }
  }

  $("#fillManual")?.addEventListener("click", async () => {
    fillManual = true;
    const msg = $("#fillMsg");
    if (msg) msg.textContent = "Ссылка не читается. Один вопрос за раз.";
    await loadFill();
  });

  $("#fillCard")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("#fillMsg");
    if (!activeOrgId) {
      if (msg) msg.textContent = "Сначала войдите в кабинет.";
      return;
    }
    const url = String($("#fillUrl")?.value || "").trim();
    if (msg) msg.textContent = "Читаем карточку…";
    fillManual = false;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/fill`, { method: "POST", body: { url } });
      if (msg) msg.textContent = data.imported?.city
        ? `Прочитано: ${data.imported.city}. Пустые поля, которые уже есть на карточке, не спрашиваем.`
        : "Карточка прочитана. Ниже только пропуски.";
      const fresh = await apiJson("/api/me");
      applyUsage(fresh.limits || {});
      const freshOrg = (fresh.orgs || []).find((item) => item.id === activeOrgId) || fresh.orgs?.[0];
      if (freshOrg) {
        currentOrg = freshOrg;
        currentCardUrl = freshOrg.yandexUrl || currentCardUrl;
        renderPublicCardPhotos();
      }
      if (freshOrg && $("#ovOrg")) {
        const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
        $("#ovOrg").textContent = [freshOrg.name, freshOrg.city, today].filter(Boolean).join(", ");
      }
      renderFill(data);
      loadOverview();
    } catch (err) {
      fillManual = true;
      if (msg) msg.textContent = `${err.message || "Карточка не прочиталась."} Ответьте на один вопрос.`;
      await loadFill();
    }
  });

  if (!currentSession && sessionAction) {
    sessionAction.textContent = "Войти";
    sessionAction.href = "login.html?next=app.html";
  }

  /* ---------- navigation ---------- */
  const viewIds = ["overview", "autopilot", "cabinet", "calendar", "reviews", "clients", "brandbook", "stories", "storefront", "prices", "images", "news", "semantics", "audit", "analytics", "settings"];
  const legacyViews = { media: "images", plan: "overview" };
  const sidebar = $("#sidebar");
  const scrim = $("#scrim");
  const burger = $("#topbarBurger");

  function closeSidebar() {
    sidebar?.classList.remove("is-open");
    scrim?.classList.remove("is-open");
    if (scrim) scrim.hidden = true;
    burger?.setAttribute("aria-expanded", "false");
  }
  function openSidebar() {
    sidebar?.classList.add("is-open");
    if (scrim) { scrim.hidden = false; scrim.classList.add("is-open"); }
    burger?.setAttribute("aria-expanded", "true");
  }
  const mobileSearchBtn = $("#mobileSearchBtn");
  function closeMobileSearch() {
    $(".search")?.classList.remove("is-open");
    mobileSearchBtn?.setAttribute("aria-expanded", "false");
  }
  mobileSearchBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const box = $(".search");
    const open = !box?.classList.contains("is-open");
    box?.classList.toggle("is-open", open);
    mobileSearchBtn.setAttribute("aria-expanded", String(open));
    if (open) setTimeout(() => $("#globalSearch")?.focus(), 40);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search") && !event.target.closest("#mobileSearchBtn")) closeMobileSearch();
  });
  burger?.addEventListener("click", () => {
    closeMobileSearch();
    if (sidebar?.classList.contains("is-open")) closeSidebar();
    else openSidebar();
  });
  scrim?.addEventListener("click", closeSidebar);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSidebar(); closeMobileSearch(); }
  });

  function showView(id, updateHash = true) {
    closeSidebar();
    id = legacyViews[id] || id;
    if (!viewIds.includes(id)) id = "overview";
    $$(".view").forEach((v) => (v.hidden = v.id !== `view-${id}`));
    $$(".side-link").forEach((link) => {
      if (link.dataset.view === id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (updateHash && location.hash !== `#${id}`) history.pushState({ view: id }, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    if (id === "overview") { setTimeout(loadOverview, 0); loadAudit(); }
    if (id === "autopilot") setTimeout(loadAutopilot, 0);
    if (id === "cabinet") setTimeout(loadCabinet, 0);
    if (id === "calendar") setTimeout(loadCalendar, 0);
    if (id === "audit") loadAudit();
    if (id === "reviews") loadReviews();
    if (id === "clients") loadClients();
    if (id === "brandbook") loadBrandbook();
    if (id === "stories") loadStorySeries();
    if (id === "images") setTimeout(loadImages, 0);
    if (id === "storefront") setTimeout(loadStorefront, 0);
    if (id === "prices") setTimeout(loadPrices, 0);
    if (id === "news") setTimeout(loadNews, 0);
    if (id === "semantics") {
      loadSemantics();
      requestAnimationFrame(() => semMap?.invalidateSize());
    }
    if (id === "analytics") loadAnalytics();
    paintSemCarry(id);
    closeSidebar();
  }

  function paintSemCarry(viewId) {
    let raw = null;
    try { raw = JSON.parse(sessionStorage.getItem("locus:sem-carry") || "null"); } catch { raw = null; }
    const host = document.querySelector(`#view-${viewId} .page-head`);
    const old = $("#semCarry");
    if (!raw || raw.view !== viewId || !host) {
      old?.remove();
      return;
    }
    const bar = old || document.createElement("p");
    bar.id = "semCarry";
    bar.className = "sem-carry";
    bar.textContent = `Фраза «${raw.phrase}» идёт ${raw.hint}. В Яндекс её переносите вы.`;
    host.appendChild(bar);
    if (viewId === "news" && $("#newsCustomTopic") && !String($("#newsCustomTopic").value || "").trim()) {
      $("#newsCustomTopic").value = raw.phrase;
    }
  }

  window.addEventListener("popstate", () => {
    const id = (location.hash || "#overview").slice(1) || "overview";
    showView(id, false);
  });

  /* ---------- уведомления ---------- */
  let generatedNotices = [];
  try {
    const storedNotes = JSON.parse(sessionStorage.getItem("locus:gen-notes") || "[]");
    generatedNotices = Array.isArray(storedNotes) ? storedNotes.filter((row) => row && row.title && row.text) : [];
  } catch { generatedNotices = []; }

  function noteGenerated({ target, kind, title, text, key }) {
    const item = {
      target: target || "overview",
      icon: kind === "text" ? "spark" : "image",
      tone: "green",
      title: String(title || "").trim(),
      text: String(text || "").trim(),
      time: "Только что",
      unread: true,
      key: key || `gen:${Date.now()}`,
    };
    if (!item.title || !item.text) return;
    generatedNotices = [item, ...generatedNotices.filter((row) => row.key !== item.key)].slice(0, 8);
    try { sessionStorage.setItem("locus:gen-notes", JSON.stringify(generatedNotices)); } catch { /* сессия закрыта */ }
    notificationItems = [item, ...notificationItems.filter((row) => row.key !== item.key)];
    renderNotifications();
  }

  const imageJobQueue = [];
  let imageJobRunning = false;
  const IMAGE_QUEUE_MAX = 3;

  function enqueueImageJob(label, run) {
    if (imageJobQueue.length + (imageJobRunning ? 1 : 0) >= IMAGE_QUEUE_MAX) {
      toast("Очередь занята", "Сейчас уже три кадра. Следующий можно поставить, когда один закончится.");
      return false;
    }
    imageJobQueue.push({ label, run });
    if (imageJobRunning) toast("В очереди", label);
    pumpImageJobs();
    return true;
  }

  function pumpImageJobs() {
    if (imageJobRunning) return;
    const job = imageJobQueue.shift();
    if (!job) return;
    imageJobRunning = true;
    Promise.resolve()
      .then(() => job.run())
      .catch(() => {})
      .finally(() => {
        imageJobRunning = false;
        pumpImageJobs();
      });
  }

  function closeNotifications() {
    const panel = $("#notifPanel");
    if (!panel) return;
    panel.hidden = true;
    $("#notifBtn")?.setAttribute("aria-expanded", "false");
  }

  function renderNotifications() {
    const list = $("#notifList");
    if (!list) return;
    if (!notificationItems.length) {
      list.innerHTML = `<div class="notif-empty">Пока тихо. Новые отзывы и напоминания появятся здесь.</div>`;
    } else {
      list.innerHTML = notificationItems.map((item, index) => `
        <button class="notif-item${item.unread && !readNotificationKeys.has(item.key) ? " is-unread" : ""}" type="button" data-notif-index="${index}">
          <span class="notif-ico ${item.tone === "accent" ? "notif-ico--accent" : item.tone === "green" ? "notif-ico--green" : ""}">
            <svg aria-hidden="true"><use href="#i-${item.icon}"/></svg>
          </span>
          <span class="notif-copy">
            <strong>${esc(item.title)}</strong>
            <span>${esc(item.text)}</span>
            <span class="notif-time">${esc(item.time)}</span>
          </span>
        </button>`).join("");
    }
    notificationsUnread = notificationItems.filter((item) => item.unread && !readNotificationKeys.has(item.key)).length;
    const count = $("#notifCount");
    const wrap = $(".notif-wrap");
    if (count) {
      count.textContent = String(notificationsUnread);
      count.hidden = notificationsUnread === 0;
    }
    wrap?.classList.toggle("has-count", notificationsUnread > 0);
    $("#notifBtn")?.setAttribute("aria-label", notificationsUnread
      ? `Уведомления: ${notificationsUnread} новых`
      : "Уведомления");
  }

  function calendarDueMs(task) {
    const date = String(task?.date || "");
    const time = String(task?.time || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    if (/^\d{2}:\d{2}$/.test(time)) return Date.parse(`${date}T${time}:00.000Z`);
    return Date.parse(`${date}T23:59:59.000Z`);
  }

  function overdueCalendarNotes(tasks, nowMs = Date.now()) {
    const closed = new Set(["done", "cancelled"]);
    return (Array.isArray(tasks) ? tasks : [])
      .filter((task) => task && task.kind === "queue" && String(task.title || "").trim() && !closed.has(String(task.status || "")))
      .map((task) => ({ task, due: calendarDueMs(task) }))
      .filter((row) => Number.isFinite(row.due) && row.due < nowMs)
      .sort((a, b) => a.due - b.due)
      .map(({ task }) => ({
        target: "calendar",
        icon: "clock",
        tone: "accent",
        title: String(task.title).trim(),
        text: "Время прошло, задача не сделана.",
        time: "Просрочено",
        unread: true,
        key: `overdue:${task.id}`,
      }));
  }

  async function refreshNotifications() {
    if (!serverActive || !activeOrgId) {
      renderNotifications();
      return;
    }
    try {
      const month = new Date().toISOString().slice(0, 7);
      const prevDate = new Date();
      prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
      const prevMonth = prevDate.toISOString().slice(0, 7);
      const [overview, news, stories, analytics, calendarNow, calendarPrev] = await Promise.all([
        apiJson(`/api/orgs/${activeOrgId}/overview`),
        apiJson(`/api/orgs/${activeOrgId}/news`).catch(() => ({ news: [] })),
        apiJson(`/api/orgs/${activeOrgId}/stories`).catch(() => ({ stories: [] })),
        apiJson(`/api/orgs/${activeOrgId}/analytics?days=7`).catch(() => ({ journal: [] })),
        apiJson(`/api/orgs/${activeOrgId}/calendar?month=${month}`).catch(() => ({ tasks: [] })),
        apiJson(`/api/orgs/${activeOrgId}/calendar?month=${prevMonth}`).catch(() => ({ tasks: [] })),
      ]);
      const overdue = overdueCalendarNotes([...(calendarNow.tasks || []), ...(calendarPrev.tasks || [])]);
      const kpis = overview.kpis || {};
      const waiting = Number(kpis.new || 0);
      const fresh = (overview.reviews || []).filter((review) => !review.reply_status || review.reply_status === "draft");
      const names = fresh.map((review) => String(review.author || "").trim()).filter(Boolean).slice(0, 2);
      const items = [];
      if (waiting > 0) {
        items.push({
          target: "reviews",
          icon: "chat",
          tone: "accent",
          title: `${waiting} ${pluralRu(waiting, "отзыв ждёт", "отзыва ждут", "отзывов ждут")} ответа`,
          text: names.length ? `${names.join(", ")}${waiting > names.length ? " и ещё " + (waiting - names.length) : ""} — начните с негативных.` : "Откройте отзывы и ответьте без спешки.",
          time: "Сейчас",
          unread: true,
          key: `reviews:${waiting}`,
        });
      } else {
        items.push({
          target: "reviews",
          icon: "chat",
          tone: "green",
          title: "Все отзывы отвечены",
          text: "Новых обращений нет.",
          time: "Сейчас",
          unread: false,
          key: "reviews:0",
        });
      }
      const newsRows = Array.isArray(news.news) ? news.news : [];
      const draftNews = newsRows.find((row) => row.status === "draft");
      const queuedNews = newsRows.find((row) => row.status === "queued");
      if (draftNews) {
        items.push({
          target: "news", icon: "spark", tone: "accent",
          title: "Черновик новости ждёт публикации",
          text: draftNews.headline || "Проверьте текст и поставьте в очередь.",
          time: "Напоминание",
          unread: true,
          key: `news:draft:${draftNews.id}`,
        });
      } else if (queuedNews) {
        items.push({
          target: "news", icon: "spark", tone: "green",
          title: "Новость уже в очереди",
          text: "Сервис читает текст и отправляет его аккаунтом представителя. Если включено согласование, сначала бот.",
          time: "В работе",
          unread: false,
          key: `news:queued:${queuedNews.id}`,
        });
      } else {
        items.push({
          target: "news", icon: "spark", tone: "",
          title: "Новость недели",
          text: "Одна публикация в неделю поддерживает карточку живой.",
          time: "Напоминание",
          unread: true,
          key: "news:weekly",
        });
      }
      const storyRows = Array.isArray(stories.stories) ? stories.stories : [];
      items.push({
        target: "stories", icon: "image", tone: storyRows.length ? "green" : "accent",
        title: storyRows.length ? "Сторис готовы к публикации" : "Соберите сторис на сегодня",
        text: storyRows.length ? "Выберите вариант, добавьте кадр и опубликуйте." : "Три варианта под нишу — за пару минут.",
        time: storyRows.length ? "Можно публиковать" : "Напоминание",
        unread: !storyRows.length,
        key: `stories:${storyRows.length}`,
      });
      items.push({
        target: "audit", icon: "check", tone: "",
        title: "Проверка карточки",
        text: "5 блоков: адрес, категории, прайс, фото и публикации.",
        time: "Раз в неделю",
        unread: false,
        key: "audit:weekly",
      });
      const freshNotes = generatedNotices.filter((row) => row && row.title && row.text);
      const seenTitles = new Set(freshNotes.map((row) => row.title));
      const serverNotes = (analytics.journal || []).flatMap((row) => {
        if (row.type !== "image_generated" && row.type !== "reply_generated") return [];
        const title = String(row.detail || "").trim();
        const text = row.type === "image_generated" ? "Кадр собран." : "Черновик ответа собран.";
        if (!title || !text || seenTitles.has(title)) return [];
        seenTitles.add(title);
        const target = title.startsWith("Новости") ? "news"
          : title.startsWith("Витрина") ? "storefront"
          : title.startsWith("Прайс") ? "prices"
          : title.startsWith("Отзывы") ? "reviews"
          : "stories";
        return [{
          target,
          icon: row.type === "image_generated" ? "image" : "spark",
          tone: "green",
          title,
          text,
          time: "Собрано",
          unread: true,
          key: `evt:${row.type}:${row.at || title}`,
        }];
      });
      notificationItems = [...overdue, ...freshNotes, ...serverNotes, ...items];
      renderNotifications();
    } catch {
      renderNotifications();
    }
  }

  function openNotifications() {
    const panel = $("#notifPanel");
    const btn = $("#notifBtn");
    if (!panel) return;
    panel.hidden = false;
    btn?.setAttribute("aria-expanded", "true");
    renderNotifications();
    refreshNotifications();
  }

  $("#notifBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const panel = $("#notifPanel");
    if (panel?.hidden) openNotifications();
    else closeNotifications();
  });
  $("#notifReadAll")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const unread = notificationItems.filter((item) => item.unread && !readNotificationKeys.has(item.key)).length;
    notificationItems.forEach((item) => item.key && readNotificationKeys.add(item.key));
    renderNotifications();
    toast("Уведомления прочитаны", unread ? `Отметили ${unread} ${pluralRu(unread, "пункт", "пункта", "пунктов")}.` : "Новых уведомлений нет.");
  });
  $("#notifPanel")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-notif-index]");
    const direct = event.target.closest("[data-notif-target]");
    event.stopPropagation();
    if (item) {
      const entry = notificationItems[Number(item.dataset.notifIndex)];
      if (entry) {
        closeNotifications();
        showView(entry.target);
      }
      return;
    }
    if (direct) {
      closeNotifications();
      showView(direct.dataset.notifTarget);
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".notif-wrap")) closeNotifications();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNotifications();
  });

  async function loadOverview() {
    if (!serverActive || !activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/overview`);
      const k = data.kpis || {};
      const emptyOverview = k.reviewsKnown == null && Number(k.total || 0) === 0;
      if ($("#ovRating")) $("#ovRating").innerHTML = `${k.rating != null ? String(k.rating).replace(".", ",") : "—"}<small>/ 5</small>`;
      if ($("#ovRatingFoot")) $("#ovRatingFoot").innerHTML = emptyOverview ? '<span class="delta">—</span> нет оценок' : '<span class="delta">средняя</span> по отзывам в кабинете';
      const answerPct = Number(k.total || 0) ? Math.round((Number(k.done || 0) / Number(k.total)) * 100) : 0;
      if ($("#ovOnTime")) $("#ovOnTime").innerHTML = emptyOverview ? "—" : `${answerPct}<small>%</small>`;
      if ($("#ovOnTimeFoot")) $("#ovOnTimeFoot").innerHTML = emptyOverview ? '<span class="delta">—</span> нет ответов' : `<span class="delta">${Number(k.done || 0)} из ${Number(k.total || 0)}</span> в кабинете`;
      if ($("#ovShows")) $("#ovShows").textContent = String(k.publications ?? 0);
      if ($("#ovShowsFoot")) $("#ovShowsFoot").innerHTML = '<span class="delta">в карточке</span> новости и сторис';
      const tone = data.tone || {};
      if ($("#ovToneCard")) {
        const totalRated = Number(tone.five || 0) + Number(tone.four || 0) + Number(tone.low || 0);
        const rows = $$("#ovToneCard .tone-row");
        const values = [Number(tone.five || 0), Number(tone.four || 0), Number(tone.low || 0)];
        rows.forEach((row, index) => {
          const value = values[index] || 0;
          const pct = totalRated ? Math.max(3, Math.round((value / totalRated) * 100)) : 0;
          const num = row.querySelector("b");
          const bar = row.querySelector(".bar i");
          if (num) num.textContent = String(value);
          if (bar) bar.style.width = `${pct}%`;
        });
        if ($("#ovToneFoot")) $("#ovToneFoot").textContent = totalRated
          ? `${Number(tone.negativeOpen || 0)} негативных без ответа · средняя ${k.rating ? String(k.rating).replace(".", ",") : "—"} по ${totalRated} оценкам`
          : "Оценок пока нет.";
      }
      const card = data.card || {};
      if ($("#ovFocusCard")) {
        const rows = $$("#ovFocusCard .focus-row");
        const pubs = Number(k.publications || 0);
        const answeredPct = Number(k.total || 0) ? Math.round((Number(k.done || 0) / Number(k.total)) * 100) : 0;
        if (rows[0]) {
          rows[0].querySelector("b").textContent = "—";
          const sub = rows[0].querySelector("strong + span");
          if (sub) sub.textContent = "оценка в разделе Проверка";
        }
        if (rows[1]) {
          rows[1].querySelector("b").textContent = `${pubs}/4`;
          const sub = rows[1].querySelector("strong + span");
          if (sub) sub.textContent = pubs ? "новости и сторис в карточке" : "нужна 1 новость в неделю";
        }
        if (rows[2]) {
          rows[2].querySelector("b").textContent = `${answeredPct}%`;
          const sub = rows[2].querySelector("strong + span");
          if (sub) sub.textContent = `отвечено ${Number(k.done || 0)} из ${Number(k.total || 0)}`;
        }
        if ($("#ovFocusSub")) $("#ovFocusSub").textContent = "цель — 90% ответов";
      }
      if ($("#ovPassportPrices")) $("#ovPassportPrices").textContent = `${Number(card.products || 0)} позиций${Number(card.productsNoDescription || 0) ? ` · ${Number(card.productsNoDescription)} без описания` : " · все с описанием"}`;
      const profileCard = currentOrg?.card;
      if ($("#ovPassportCategories")) {
        const main = profileCard?.rubricMain?.value || "";
        const extra = Array.isArray(profileCard?.rubricsSecondary) ? profileCard.rubricsSecondary.filter(Boolean) : [];
        $("#ovPassportCategories").textContent = main
          ? `${main}${extra.length ? ` · ${extra.join(", ")}` : " · вторичных нет, можно две"}`
          : (profileCard?.rubricMain?.ask || "Какая основная рубрика? Вторичных не больше двух.");
      }
      if ($("#ovPassportFeatures")) {
        const list = Array.isArray(profileCard?.features) ? profileCard.features : [];
        $("#ovPassportFeatures").textContent = list.length
          ? list.slice(0, 4).join(", ")
          : (profileCard?.featuresAsk || "Какие особенности указать отдельно от рубрик?");
      }
      if ($("#ovPassportCta")) {
        const pubs = Number(card.publications || 0);
        const dest = profileCard?.booking?.url || profileCard?.booking?.ask || "Куда ведёт кнопка записи? Ссылку не придумываем.";
        $("#ovPassportCta").textContent = `${dest} · ${pubs} ${pluralRu(pubs, "публикация", "публикации", "публикаций")}`;
      }
      if ($("#ovPassportCount")) $("#ovPassportCount").textContent = "6 блоков";
      const series = Array.isArray(data.series) ? data.series : [];
      const seriesTotal = series.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
      if ($("#ovChartBody")) $("#ovChartBody").hidden = seriesTotal === 0;
      if ($("#ovChartEmpty")) $("#ovChartEmpty").hidden = seriesTotal !== 0;
      if ($("#ovChartSub")) $("#ovChartSub").textContent = seriesTotal ? "действия Локуса · 14 дней" : "пока нет действий";
      if ($("#ovChart")) {
        const max = Math.max(1, ...series.map((row) => Number(row.value) || 0));
        $("#ovChart").innerHTML = series.map((row) => `<div class="an-bar${row.value ? " is-filled" : ""}" title="${esc(row.label)}: ${row.value}"><i style="height:${Math.max(4, Math.round((Number(row.value) || 0) / max * 100))}%"></i><span>${esc(row.label)}</span></div>`).join("");
      }
      if ($("#ovToneFoot")) $("#ovToneFoot").hidden = emptyOverview;
      if ($("#ovToneEmpty")) $("#ovToneEmpty").hidden = !emptyOverview;
      $$("#ovToneCard .tone-row").forEach((row) => (row.hidden = emptyOverview));
      $$("#ovFocusCard .focus-list").forEach((row) => (row.hidden = emptyOverview));
      if ($("#ovFocusSub")) $("#ovFocusSub").textContent = emptyOverview ? "пока нет шагов" : "3 направления";
      if ($("#ovFocusEmpty")) $("#ovFocusEmpty").hidden = !emptyOverview;
      if ($("#ovReviews")) {
        $("#ovReviews").textContent = k.reviewsKnown === false
          ? "нет данных"
          : k.reviewsKnown === true
            ? String(k.reviewsOnCard ?? 0)
            : String(k.total || 0);
      }
      const mapsCount = Number(k.mapsReviews || 0);
      const mapsWaiting = Number(k.mapsWaiting ?? 0);
      if ($("#ovWaiting")) {
        const onCard = k.reviewsKnown === true;
        const waitingText = onCard
          ? "на карточке"
          : k.reviewsKnown === false
            ? "нет данных"
            : !mapsCount
              ? "тексты не собраны"
              : mapsWaiting
                ? `${mapsWaiting} ждут ответа`
                : "все отвечены";
        $("#ovWaiting").textContent = waitingText;
        $("#ovWaiting").classList.toggle("delta--warn", !onCard && (Boolean(mapsWaiting) || !mapsCount || k.reviewsKnown === false));
      }
      if ($("#ovReviewsNote")) {
        const cabinet = `${Number(k.total || 0)} в кабинете${Number(k.new || 0) ? ` · ${Number(k.new)} без ответа` : ""}`;
        $("#ovReviewsNote").textContent = k.reviewsKnown === true
          ? (k.reviewTextsKnown === false ? "· тексты не прочитаны" : `· ${cabinet}`)
          : "";
      }
      if ($("#reviewBadge")) {
        $("#reviewBadge").textContent = String(mapsWaiting || 0);
        $("#reviewBadge").hidden = !mapsWaiting;
      }
      if ($("#revSummary")) {
        $("#revSummary").textContent = mapsCount
          ? `${mapsCount} с карточки, ${mapsWaiting} ждут ответа, источник: Яндекс.Карты`
          : "Нужна ссылка на карточку в Яндекс.Картах — без неё отзывы не собираются.";
      }
      const waiting = mapsWaiting;
      if ($("#ovReplyQuick")) {
        $("#ovReplyQuick").hidden = false;
        $("#ovReplyQuick").textContent = !mapsCount
          ? "Нужна ссылка на карточку"
          : waiting
            ? `Ответить на ${waiting} ${waiting === 1 ? "отзыв" : waiting < 5 ? "отзыва" : "отзывов"}`
            : "Все отзывы отвечены";
      }
      const hoursNow = String(data.org?.hours || "").trim();
      const primaryBtn = $("#ovActionPrimaryBtn");
      const holes = cardHoles(data.org, data.kpis);
      if (holes.length) {
        const first = holes[0];
        if ($("#ovActionReviews")) $("#ovActionReviews").textContent = "Исправить ошибки";
        if ($("#ovActionReviewsSub")) $("#ovActionReviewsSub").textContent = holes.map((hole) => hole.label).join(", ");
        if (primaryBtn) {
          primaryBtn.textContent = "Исправить";
          if (first.action) {
            primaryBtn.dataset.action = first.action;
            delete primaryBtn.dataset.view;
          } else {
            primaryBtn.dataset.view = first.view;
            delete primaryBtn.dataset.action;
          }
        }
      } else if (!hoursNow) {
        if ($("#ovActionReviews")) $("#ovActionReviews").textContent = "Указать часы работы";
        if ($("#ovActionReviewsSub")) $("#ovActionReviewsSub").textContent = "гость не видит, когда вы открыты";
        if (primaryBtn) {
          primaryBtn.textContent = "Указать";
          primaryBtn.dataset.action = "hours";
          delete primaryBtn.dataset.view;
        }
      } else {
        if ($("#ovActionReviews")) $("#ovActionReviews").textContent = waiting ? `Ответить на ${waiting} ${waiting === 1 ? "отзыв" : waiting < 5 ? "отзыва" : "отзывов"}` : "Все отзывы отвечены";
        if ($("#ovActionReviewsSub")) $("#ovActionReviewsSub").textContent = waiting ? `${waiting} ждут ответа · начните с негативных` : "Новых отзывов нет";
        if (primaryBtn) {
          primaryBtn.textContent = waiting ? "Ответить" : "Открыть";
          primaryBtn.dataset.view = "reviews";
          delete primaryBtn.dataset.action;
        }
      }
      paintPassport(data.org || {});
      markOverviewToday();
      if ($("#ovNewsTopic") && data.org?.category) {
        $("#ovNewsTopic").textContent = `3 мин · тема под категорию «${data.org.category}»`;
      }
      try {
        const sem = await apiJson(`/api/orgs/${activeOrgId}/semantics`);
        const rows = Array.isArray(sem.semantics) ? sem.semantics.slice(0, 4) : [];
        const box = $("#overviewQueries");
        if (box) {
          const estimated = rows.some((row) => !row.source || row.source === "estimate");
          if ($("#ovQueryNote")) $("#ovQueryNote").textContent = rows.length
            ? (estimated ? "оценка спроса, не выгрузка Wordstat" : "частотность из подключённого источника")
            : "нет данных, пока нет Wordstat";
          box.innerHTML = rows.length
            ? rows.map((row, index) => `<div class="mini-list-row"><span class="rank">${String(index + 1).padStart(2, "0")}</span><span class="q">${esc(row.phrase)}</span><b>${freqText(row)}</b></div>`).join("")
            : `<div class="mini-list-row"><span class="rank">—</span><span class="q">Ядро ещё не собрано</span><b>нет данных</b></div>`;
        }
      } catch {
        /* ядро не влияет на KPI */
      }
    } catch {
      /* демо-значения остаются, если API недоступен */
    }
  }

  let analyticsDays = 30;

  function analyticsRelative(iso) {
    const t = new Date(iso || 0).getTime();
    if (!t) return "—";
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "только что";
    if (min < 60) return `${min} мин назад`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} ч назад`;
    return `${Math.round(h / 24)} дн назад`;
  }

  function renderAnalytics(data) {
    const view = $("#view-analytics");
    if (!view) return;
    const empty = $("#analyticsEmpty");
    const isEmpty = Boolean(data.empty);
    view.querySelectorAll(".kpis, .grid, .an-disclaimer").forEach((el) => { el.hidden = isEmpty; });
    if (empty) empty.hidden = !isEmpty;
    if (isEmpty) return;
    const period = data.period || { days: analyticsDays };
    if ($("#anPeriod")) $("#anPeriod").textContent = `Последние ${period.days} дней · действия Локуса, а не Яндекс.Бизнес`;
    if ($("#anKpis")) {
      $("#anKpis").innerHTML = (data.kpis || []).map((kpi, i) => `<article class="kpi an-kpi an-kpi--${i}">
        <div class="kpi-top">${esc(kpi.label)}</div>
        <div class="kpi-value">${esc(kpi.value)}</div>
        <div class="kpi-foot">${esc(kpi.foot || "")}</div>
      </article>`).join("");
    }
    const series = Array.isArray(data.series) ? data.series : [];
    const max = Math.max(1, ...series.map((x) => Number(x.value) || 0));
    const total = series.reduce((sum, x) => sum + (Number(x.value) || 0), 0);
    if ($("#anChartTotal")) $("#anChartTotal").textContent = `${total} действий`;
    if ($("#anChart")) {
      $("#anChart").innerHTML = series.length
        ? series.map((x, i) => {
            const h = Math.max(4, Math.round((Number(x.value) || 0) / max * 100));
            const show = period.days <= 14 || i % Math.ceil(period.days / 10) === 0 || i === series.length - 1;
            return `<div class="an-bar${x.value ? " is-filled" : ""}" title="${esc(x.label)}: ${x.value}"><i style="height:${h}%"></i><span>${show ? esc(x.label) : ""}</span></div>`;
          }).join("")
        : `<p class="field-hint">Пока нет действий за период.</p>`;
    }
    if ($("#anSources")) {
      const sources = Array.isArray(data.sources) ? data.sources : [];
      const maxSource = Math.max(1, ...sources.map((x) => Number(x.value) || 0));
      $("#anSources").innerHTML = sources.length
        ? sources.map((src) => `<div class="an-source"><span class="sname">${esc(src.name)}</span><span class="sbar"><i style="width:${Math.round((Number(src.value) || 0) / maxSource * 100)}%"></i></span><b>${src.value}</b></div>`).join("")
        : `<p class="field-hint">Действий за период нет.</p>`;
    }
    if ($("#anJournal")) {
      const journal = Array.isArray(data.journal) ? data.journal : [];
      $("#anJournal").innerHTML = journal.length
        ? journal.map((row) => `<div class="an-journal-row"><span class="an-journal-ico">${row.type?.startsWith("appeal") ? "!" : row.type?.startsWith("reply") ? "↩" : row.type?.startsWith("news") ? "▤" : "·"}</span><div><strong>${esc(row.label)}</strong><small>${esc(row.detail || "")}</small></div><time>${esc(analyticsRelative(row.at))}</time></div>`).join("")
        : `<p class="field-hint">Журнал пока пуст.</p>`;
    }
    if ($("#anContent")) {
      const c = data.content || {};
      const answered = c.reviews ? Math.round((Number(c.answered || 0) / Number(c.reviews)) * 100) : 0;
      $("#anContent").innerHTML = `<div class="an-content-row"><span>Отзывы</span><b>${c.reviews ?? 0}</b></div><div class="an-content-row"><span>С ответом</span><b>${answered}%</b></div><div class="an-content-row"><span>Новости</span><b>${c.news ?? 0}</b></div><div class="an-content-row"><span>Позиции прайса</span><b>${c.products ?? 0}</b></div>`;
    }
    if ($("#anNext")) {
      const c = data.content || {};
      const steps = [];
      if ((c.reviews || 0) > (c.answered || 0)) steps.push({ label: "Ответить на отзывы без ответа", hint: `${Math.max(0, (c.reviews || 0) - (c.answered || 0))} ждут`, view: "reviews" });
      if ((c.publications || 0) < 4) steps.push({ label: "Собрать 4 новости по шаблонам", hint: "ритм раз в неделю", view: "news" });
      if ((c.appeals || 0) > 0) steps.push({ label: "Проверить очередь обращений", hint: "поддержка Яндекса", view: "reviews" });
      if (!steps.length) steps.push({ label: "Проверить карточку через месяц", hint: "сравнить динамику", view: "audit" });
      $("#anNext").innerHTML = steps.slice(0, 3).map((step, i) => `<button class="an-next-row" type="button" data-goto="${step.view}"><span class="rank">${String(i + 1).padStart(2, "0")}</span><span><strong>${esc(step.label)}</strong><small>${esc(step.hint)}</small></span><span>→</span></button>`).join("");
    }
    if ($("#anNote")) $("#anNote").textContent = data.note || "Данные Locus: действия в кабинете и публикации. Показы, позиции и звонки из Яндекс.Карт сюда не входят.";
    $$("#view-analytics [data-an-days]").forEach((btn) => {
      const active = Number(btn.dataset.anDays) === Number(period.days);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  async function loadAnalytics(days = analyticsDays) {
    if (!serverActive || !activeOrgId) return;
    analyticsDays = Number(days) || 30;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/analytics?days=${analyticsDays}`);
      renderAnalytics(data);
    } catch (err) {
      if ($("#analyticsEmpty")) {
        $("#analyticsEmpty").hidden = false;
        $("#analyticsEmpty p").textContent = liveErrorText(err, "Не удалось загрузить аналитику.");
      }
    }
  }

  $$("#view-analytics [data-an-days]").forEach((btn) => {
    btn.addEventListener("click", () => loadAnalytics(Number(btn.dataset.anDays)));
  });

  function setPassportItem(id, ok, text) {
    const item = $(`#${id}`);
    if (!item) return;
    item.classList.toggle("is-ok", ok);
    item.classList.toggle("is-warn", !ok);
    const mark = item.querySelector(".passport-mark");
    const note = item.querySelector("span:last-child");
    if (mark) mark.textContent = ok ? "✓" : "!";
    if (note) note.textContent = text;
  }

  function paintPassport(org) {
    const name = String(org.name || "").trim();
    const address = String(org.address || "").trim();
    const phone = String(org.phone || "").trim();
    const hours = String(org.hours || "").trim();
    const site = String(org.site || "").trim();
    const missingContacts = [!name && "нет названия", !address && "нет адреса", !phone && "нет телефона"].filter(Boolean);
    setPassportItem("ovPassContacts", missingContacts.length === 0, missingContacts.length ? missingContacts.join(", ") : "заполнено");
    const hoursSite = !hours && !site
      ? "нет часов и сайта"
      : !hours
        ? "нет часов · сайт есть"
        : !site
          ? "часы есть · нет сайта"
          : "заполнено";
    setPassportItem("ovPassHours", Boolean(hours && site), hoursSite);
    const form = $("#ovHoursForm");
    const parts = currentOrg?.card?.hours;
    const hoursKnown = Boolean(hours || parts?.weekdays || parts?.weekends || parts?.holidays);
    if (form) form.hidden = hoursKnown;
    const weekdays = $("#ovHoursWeekdays");
    const weekends = $("#ovHoursWeekends");
    const holidays = $("#ovHoursHolidays");
    if (weekdays && document.activeElement !== weekdays) weekdays.value = parts?.weekdays || "";
    if (weekends && document.activeElement !== weekends) weekends.value = parts?.weekends || "";
    if (holidays && document.activeElement !== holidays) holidays.value = parts?.holidays || "";
    paintCardSurfaces(org?.card ? org : currentOrg);
    paintCardFace(org);
    const queue = $("#navQueue");
    if (queue) queue.hidden = true;
  }

  function cardSlotValue(card, id) {
    const photos = card?.photos;
    if (!photos) return "";
    if (Array.isArray(photos)) return String(photos.find((item) => item.id === id)?.value || "").trim();
    return String(photos[id] || "").trim();
  }

  function usableImage(src) {
    const value = String(src || "").trim();
    if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
    return "";
  }

  function cardHoles(org, kpis = {}) {
    const holes = [];
    if (!String(org?.hours || "").trim()) holes.push({ label: "часы", action: "hours" });
    if (!String(org?.phone || "").trim()) holes.push({ label: "телефон", view: "cabinet" });
    if (!cardSlotValue(org?.card, "logo")) holes.push({ label: "логотип", view: "cabinet" });
    if (Number(kpis.productsNoPrice) > 0) holes.push({ label: "прайс без цены", view: "prices" });
    if (kpis.photosKnown && Number(kpis.photosOnCard) < 3) holes.push({ label: "меньше трёх фото", view: "images" });
    return holes;
  }

  function paintCardFace(org) {
    const name = String(org?.name || "").trim();
    const city = String(org?.city || "").trim();
    const address = String(org?.address || "").trim();
    const hours = String(org?.hours || "").trim();
    const category = String(org?.category || org?.card?.rubricMain?.value || "").trim();
    const phone = String(org?.phone || "").trim();
    if ($("#cardFaceRating")) $("#cardFaceRating").textContent = org?.venueRating || "Оценка заведения не указана";
    if ($("#cardFaceName")) $("#cardFaceName").textContent = name || "Название появится с карточки";
    if ($("#cardFaceMeta")) $("#cardFaceMeta").textContent = [category, address || city, phone].filter(Boolean).join(" · ");
    if ($("#cardFaceHours")) $("#cardFaceHours").textContent = hours || "";
    const rubrics = Array.isArray(org?.card?.rubricsSecondary) ? org.card.rubricsSecondary.filter(Boolean) : [];
    if ($("#cardFaceRubrics")) $("#cardFaceRubrics").textContent = [category, ...rubrics].filter(Boolean).join(", ");
    const photo = $("#cardFacePhoto");
    const logo = usableImage(cardSlotValue(org?.card, "logo"));
    const cover = usableImage(org?.card?.cover || org?.publicImages?.[0]);
    const yandex = (Array.isArray(currentCardImages) ? currentCardImages : []).map(usableImage).find(Boolean) || "";
    const src = cardImageSrc(logo || cover || yandex);
    if (photo) photo.innerHTML = src ? `<img src="${esc(src)}" alt="${esc(name || "Фото карточки")}">` : "Фото появится с карточки";
  }

  function markOverviewToday() {
    const today = (new Date().getDay() + 6) % 7;
    $$("#nextActions .week-day").forEach((btn) => {
      btn.classList.toggle("is-today", Number(btn.dataset.dow) === today);
      btn.classList.remove("is-done");
    });
  }

  function openHoursEditor() {
    const form = $("#ovHoursForm");
    if (!form) return;
    form.hidden = false;
    form.scrollIntoView({ block: "nearest" });
    $("#ovHoursWeekdays")?.focus();
  }

  document.addEventListener("click", (e) => {
    const hoursBtn = e.target.closest("[data-action='hours']");
    if (hoursBtn) { openHoursEditor(); return; }
    const moreWorlds = e.target.closest("[data-look-more]");
    if (moreWorlds) {
      e.preventDefault();
      const pages = Math.max(1, Number(lookCatalog?.pages) || lookSlice().pages);
      lookPageIndex = (lookPageIndex + 1) % pages;
      paintLookHosts();
      renderStories();
      const slice = lookSlice();
      toast("Другие три", `Миры ${slice.page * slice.size + 1}–${slice.page * slice.size + slice.worlds.length} из ${slice.total}.`);
      return;
    }
    const worldBtn = e.target.closest("[data-look-world]");
    if (worldBtn) {
      lookWorldId = worldBtn.dataset.lookWorld || "";
      paintLookHosts();
      renderStories();
      return;
    }
    const variantBtn = e.target.closest("[data-look-variant]");
    if (variantBtn) { applyVariant(variantBtn.dataset.lookVariant); return; }
    const lookBtn = e.target.closest("[data-look]");
    if (lookBtn) { applyLook(lookBtn.dataset.look); return; }
    const viewBtn = e.target.closest("[data-view]");
    if (viewBtn) {
      showView(viewBtn.dataset.view);
      const focusId = viewBtn.dataset.focus;
      if (focusId) {
        const field = document.getElementById(focusId);
        const details = field?.closest("details");
        if (details) details.open = true;
        setTimeout(() => field?.focus(), 80);
      }
      return;
    }
    const weekDay = e.target.closest(".week-day");
    if (weekDay) {
      const day = Number(weekDay.dataset.dow);
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + (Number.isFinite(day) ? day : 0));
      const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
      calendarSelected = key;
      calendarMonth = key.slice(0, 7);
      showView("calendar");
      return;
    }
    const gotoBtn = e.target.closest("[data-goto]");
    if (gotoBtn) { showView(gotoBtn.dataset.goto); return; }
    const tariffLink = e.target.closest("[data-open-tariffs]");
    if (tariffLink) { e.preventDefault(); openTariffs(); return; }
    const integration = e.target.closest("[data-integration]");
    if (integration) {
      e.preventDefault();
      showView(integration.dataset.integration || "settings");
      return;
    }
    const ruleGo = e.target.closest("[data-rule-go]");
    if (ruleGo) {
      e.preventDefault();
      showView(ruleGo.dataset.ruleGo || "settings");
      return;
    }
    const toastBtn = e.target.closest("[data-toast]");
    if (toastBtn) {
      e.preventDefault();
      const view = toastBtn.dataset.view || toastBtn.dataset.goto;
      if (view) showView(view);
    }
  });



  /* ---------- аудит карточки ---------- */
  function findingSeverityLabel(sev) {
    return sev === "high" ? "критично" : sev === "low" ? "быстро" : "средне";
  }

  function fallbackFindings(a) {
    return (Array.isArray(a.issues) ? a.issues : []).map((item, index) => ({
      id: item.id || `issue-${index}`,
      title: item.label || "Находка",
      fact: item.fact || "",
      action: item.action || "",
      severity: item.severity === "high" ? "high" : "medium",
      effort: "1 день",
      quick: false,
      route: "audit",
      lost: item.lost || 1,
    }));
  }

  function renderCompetitors(a, orgName) {
    const section = $("#auditCompetitors");
    if (!section) return;
    const data = a.competitors;
    if (!data || !Array.isArray(data.competitors) || !data.competitors.length) {
      section.hidden = true;
      return;
    }
    const self = {
      name: orgName || "Вы",
      rating: Number(a.metrics?.rating || a.card?.rating || 0),
      reviews: Number(a.metrics?.reviews || a.card?.reviews || 0),
      url: a.card?.url || "",
      self: true,
    };
    const rows = data.competitors.slice();
    const position = Math.max(1, Math.min(rows.length + 1, Number(data.position) || rows.length + 1));
    rows.splice(position - 1, 0, self);
    const fmt = (value) => Number(value || 0).toLocaleString("ru-RU");
    section.hidden = false;
    if ($("#auditCompetitorsChip")) {
      $("#auditCompetitorsChip").textContent = `${position} из ${data.total || rows.length} по отзывам`;
    }
    if ($("#auditCompetitorInsights")) {
      $("#auditCompetitorInsights").innerHTML = (data.insights || [])
        .map((text) => `<span>${esc(text)}</span>`)
        .join("");
    }
    if ($("#auditCompetitorList")) {
      $("#auditCompetitorList").innerHTML = rows.map((row, index) => {
        const subline = row.self ? "ваша карточка" : row.distance ? `${Number(row.distance).toFixed(1).replace(".", ",")} км` : "";
        const name = `<span class="audit-competitor-name">${esc(row.name)}${subline ? ` <small>${subline}</small>` : ""}</span>`;
        const content = `<span class="audit-competitor-rank">${String(index + 1).padStart(2, "0")}</span>${name}
          <span class="audit-competitor-rating"><b>${row.rating ? row.rating.toFixed(1).replace(".", ",") : "—"}</b></span>
          <span class="audit-competitor-reviews"><b>${fmt(row.reviews)}</b> отзывов</span>`;
        return row.self || !row.url
          ? `<div class="audit-competitor-row is-self">${content}</div>`
          : `<a class="audit-competitor-row" href="${esc(row.url)}" target="_blank" rel="noopener">${content}</a>`;
      }).join("");
    }
  }

  function renderAlice(block) {
    const items = Array.isArray(block?.items) ? block.items : [];
    if ($("#auditAliceNote") && block?.note) $("#auditAliceNote").textContent = block.note;
    if ($("#auditAliceCount")) $("#auditAliceCount").textContent = block ? `${block.ready} из ${block.total}` : "—";
    const list = $("#auditAliceList");
    if (!list) return;
    list.innerHTML = items.length
      ? items.map((item) => `<li class="${item.ready ? "is-ready" : ""}"><b>${esc(item.question)}</b><span>${esc(item.ready ? item.answer : item.gap)}</span></li>`).join("")
      : `<li><span>Факты карточки ещё не собраны.</span></li>`;
  }

  function renderAudit(a) {
    if (!a) return;
    const blocks = Array.isArray(a.blocks) ? a.blocks : [];
    const unknownBlocks = blocks.filter((b) => b.unknown);
    const knownCount = blocks.length - unknownBlocks.length;
    const isPublic = a.source === "public_card";
    const findings = (Array.isArray(a.findings) && a.findings.length ? a.findings : fallbackFindings(a)).slice(0, 8);
    auditFindings = findings;
    const quick = Array.isArray(a.quickWins) ? a.quickWins : findings.filter((f) => f.quick);
    const critical = Number(a.critical ?? findings.filter((f) => f.severity === "high").length);
    const orgName = a.card?.name || currentOrg?.name || "";
    const cardCity = a.card?.city || currentOrg?.city || "";
    const cardAddress = a.card?.address || currentOrg?.address || "";

    const ring = $("#cabScoreRing");
    if (ring) {
      ring.style.setProperty("--score", String(a.score));
      ring.setAttribute("aria-label", `Оценка карточки ${a.score} из 100`);
    }
    if ($("#cabScore")) $("#cabScore").textContent = String(a.score);
    if ($("#auditVerdict")) $("#auditVerdict").textContent = a.verdict || a.label || "Вердикт не собран";
    if ($("#cabNote")) $("#cabNote").textContent = a.note || "Собрали факты из карточки и кабинета.";
    if ($("#auditBand")) {
      $("#auditBand").textContent = a.band === "strong" ? "сильная карточка" : a.band === "growing" ? "есть пробелы" : a.band === "critical" ? "критично" : "нужен план";
    }
    if ($("#auditUpdated")) {
      $("#auditUpdated").textContent = isPublic
        ? `Публичная карточка · ${knownCount} из ${blocks.length} блоков проверено`
        : "Кабинет и публичные факты · обновлено только что";
    }
    if ($("#auditDate")) {
      $("#auditDate").textContent = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    }
    if ($("#auditChips")) {
      const chips = [
        `<span class="chip chip--accent">${findings.length} ${findings.length === 1 ? "находка" : findings.length < 5 ? "находки" : "находок"}</span>`,
        `<span class="chip">${critical} ${critical === 1 ? "критичная" : critical < 5 ? "критичные" : "критичных"}</span>`,
        `<span class="chip">${quick.length} ${quick.length === 1 ? "быстрая правка" : "быстрых правок"}</span>`,
      ];
      $("#auditChips").innerHTML = chips.join("");
    }

    if ($("#auditLossCount")) $("#auditLossCount").textContent = `3 из ${findings.length}`;
    if ($("#auditCloseGaps")) {
      delete $("#auditCloseGaps").dataset.goto;
      $("#auditCloseGaps").innerHTML = `<svg width="13" height="13" aria-hidden="true"><use href="#i-spark"/></svg> Закрыть пробелы`;
    }
    if ($("#auditLossCards")) {
      const top = findings.slice(0, 3);
      $("#auditLossCards").innerHTML = top.length
        ? top.map((f, index) => {
            const sev = f.severity || "medium";
            return `<button class="audit-loss" type="button" data-finding-open="${index}" aria-label="Открыть находку: ${esc(f.title)}">
              <span class="audit-loss-top"><span class="audit-loss-num">${String(index + 1).padStart(2, "0")}</span><span class="audit-dot audit-dot--${esc(sev)}" title="${esc(findingSeverityLabel(sev))}"></span></span>
              <span class="audit-loss-title">${esc(f.title)}</span>
              <span class="audit-loss-fact">${esc(f.fact || "")}</span>
              <span class="audit-loss-action">${esc(f.action || "Открыть находку")}</span>
            </button>`;
          }).join("")
        : `<div class="audit-empty">Явных провалов нет. Поддерживайте цены, фото и ответы актуальными.</div>`;
    }

    if ($("#auditPlan")) {
      const plan = Array.isArray(a.plan) && a.plan.length ? a.plan : findings.slice(0, 3);
      $("#auditPlan").innerHTML = plan.length
        ? plan.map((f) => `<li><div><strong>${esc(f.title)}</strong><span>${esc(f.action || "")}</span> <em>${esc(f.when || f.effort || "неделя")}</em></div></li>`).join("")
        : `<li class="audit-plan-empty">План появится после проверки карточки.</li>`;
    }

    if ($("#cabIssues")) {
      $("#cabIssues").innerHTML = findings.length
        ? findings.map((f, index) => {
            const sev = f.severity || "medium";
            const route = ["audit", "settings", "prices", "images", "reviews", "news", "stories", "semantics"].includes(f.route) ? f.route : "audit";
            return `<details class="audit-finding" id="audit-finding-${index}"${index === 0 ? " open" : ""}>
              <summary>
                <span class="audit-dot audit-dot--${esc(sev)}" aria-hidden="true"></span>
                <span class="audit-finding-title"><strong>${esc(f.title)}</strong><small>${esc(f.fact || "")}</small></span>
                <span class="audit-finding-meta"><span class="audit-sev audit-sev--${esc(sev)}">${esc(findingSeverityLabel(sev))}</span><span>${esc(f.effort || "неделя")}</span></span>
              </summary>
              <div class="audit-finding-body">
                <p><strong>Что делать:</strong> ${esc(f.action || "Уточните данные в карточке.")}</p>
                <div class="audit-finding-fix"><button class="btn btn--ghost btn--small" type="button" data-goto="${route}">Перейти к исправлению</button><em>${f.quick ? "Быстрая правка" : "Потребует времени"}</em></div>
              </div>
            </details>`;
          }).join("")
        : `<div class="audit-empty">Явных провалов нет. Проверьте карточку через месяц.</div>`;
    }

    // Контекст: название, адрес, ссылка/фото. Для кабинета берём данные организации.
    const cardImages = (Array.isArray(a.card?.images) ? a.card.images : [])
      .filter((src) => /^https:\/\/avatars\.mds\.yandex\.net\/get-(?:altay|sprav-products)\//i.test(String(src || "")))
      .slice(0, 6);
    currentCardMeta = a.card || null;
    if (cardImages.length) currentCardImages = cardImages;
    paintCardFace(currentOrg);
    cardImagesLoaded = true;
    const context = $("#auditContext");
    if (context) {
      context.hidden = !(orgName || cardCity || cardAddress);
      if (!context.hidden) {
        if ($("#auditContextEyebrow")) $("#auditContextEyebrow").textContent = isPublic ? "Проверка по ссылке" : "Проверка по данным кабинета";
        if ($("#auditCardName")) $("#auditCardName").textContent = orgName || "Карточка";
        const bits = [a.card?.category || currentOrg?.category, [cardCity, cardAddress].filter(Boolean).join(", ")].filter(Boolean);
        if ($("#auditCardMeta")) $("#auditCardMeta").textContent = bits.join(", ") || "Яндекс.Карты";
        if ($("#auditSourceChip")) $("#auditSourceChip").textContent = isPublic ? "публичные данные" : "данные кабинета";
        if ($("#auditImportNote")) {
          $("#auditImportNote").textContent = a.importError || (isPublic
            ? "Это открытая страница Яндекс.Карт. По ней видно название, адрес, фото и отзывы гостей. Не видно, какие запросы люди набирают, и не видно ответы, которые владелец уже написал в кабинете Яндекса."
            : "");
        }
      }
    }

    const signalBox = $("#auditSignals");
    if (signalBox) {
      const card = a.card || {};
      const m = a.metrics || {};
      const signals = [];
      if (m.photos) signals.push([`${m.photos} фото`, "ok"]);
      if (m.hasStories) signals.push(["Сторис: есть", "ok"]);
      else if (m.storiesKnown !== false) signals.push(["Сторис: нет", "off"]);
      if (card.menuItemCount) signals.push([`Меню: ${card.menuItemCount}${card.menuItemCount >= 40 ? "+" : ""} позиций`, "ok"]);
      else if (isPublic) signals.push(["Меню не найдено", "off"]);
      if (card.hasSite) signals.push(["Сайт: есть", "ok"]);
      else if (isPublic) signals.push(["Сайт не указан", "off"]);
      if (card.verified) signals.push(["Владелец подтверждён", "ok"]);
      signalBox.innerHTML = signals.map(([text, tone]) => `<span class="chip ${tone === "ok" ? "chip--ok" : "chip--off"}">${esc(text)}</span>`).join("");
      signalBox.hidden = !signals.length;
    }

    const gallery = $("#auditGallery");
    if (gallery) {
      gallery.hidden = cardImages.length === 0;
      if (cardImages.length) {
        const count = Number(a.card?.photos || cardImages.length);
        if ($("#auditGalleryCount")) $("#auditGalleryCount").textContent = `${count} фото в карточке · ${cardImages.length} в превью`;
        if ($("#auditGalleryGrid")) {
          $("#auditGalleryGrid").innerHTML = cardImages.map((src, i) => `<a href="${esc(src)}" target="_blank" rel="noopener" aria-label="Открыть фото ${i + 1}"><img src="${esc(cardImageSrc(src))}" alt="Фото ${i + 1} из карточки ${esc(orgName)}" loading="lazy" decoding="async"></a>`).join("");
        }
      }
    }

    if ($("#auditCta")) $("#auditCta").hidden = false;
    const paid = auditIsPaid(a);
    auditBillingKnown = true;
    const planName = a.billing?.plan || a.paywall?.plan || currentOrgPlan || "Стартовый";
    auditPayPlan = paid ? "" : (a.paywall?.plan || planName);
    paintPlanConnection(paid, planName);
    if ($("#auditCtaText")) {
      if (paid) {
        $("#auditCtaText").textContent = "«Исправить» открывает первый пробел.";
      } else if (a.paywall) {
        const price = Number(a.paywall.price);
        const priceBit = price ? ` · ${price.toLocaleString("ru-RU")} ₽` : "";
        $("#auditCtaText").textContent = `Тариф «${a.paywall.plan || planName}»${priceBit}. Кнопка выставляет счёт в кабинете, оплаты картой нет.`;
      }
    }
    if ($("#auditPayBtn")) {
      const showPay = !paid && Boolean(a.paywall) && a.paywall.canInvoice !== false;
      $("#auditPayBtn").hidden = !showPay;
      if (showPay) $("#auditPayBtn").textContent = a.paywall.cta || "Оформить подписку";
    }
    renderCompetitors(a, orgName);
    renderAlice(a.alice);

    if ($("#cabBars")) {
      const bars = blocks.map((b) => {
        const unknown = Boolean(b.unknown);
        const width = unknown ? 0 : Math.max(0, Math.min(100, (Number(b.score) / Number(b.weight || 1)) * 100));
        const value = unknown ? "нет данных" : `${Math.round(Number(b.score))}/${b.weight}`;
        return `<div class="audit-bar${unknown ? " is-unknown" : ""}"${b.note ? ` title="${esc(b.note)}"` : ""}><em>${esc(b.label)}<small class="audit-fact">${esc(b.fact || "")}</small></em><span class="track"><span class="fill" style="width:${width}%"></span></span><b>${esc(value)}</b></div>`;
      }).join("");
      const unknownNote = unknownBlocks.length
        ? `<p class="audit-unknown-note">Не проверили: ${unknownBlocks.map((b) => esc(b.label)).join(", ")}. ${esc(unknownBlocks[0].note || "По публичной ссылке это не видно.")}</p>`
        : "";
      $("#cabBars").innerHTML = bars + unknownNote;
    }
    if ($("#auditMetricsSub")) $("#auditMetricsSub").textContent = `${knownCount} блоков · ${Object.keys(a.metrics || {}).length} показателей`;
    const m = a.metrics || {};
    if ($("#cabMetrics")) {
      $("#cabMetrics").innerHTML = [
        [m.products ?? 0, "позиций"],
        [m.photos ?? 0, "фото"],
        [m.rating ?? "—", "рейтинг"],
        [m.reviews ?? 0, "отзывов"],
        [m.hasStories ? "есть" : m.storiesKnown === false ? "—" : "нет", "сторис"],
        [m.news ?? 0, "новостей"],
        [isPublic ? "—" : (m.replyRate != null ? `${m.replyRate}%` : "—"), "ответов"],
      ].map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
    }
    if ($("#auditDetails")) {
      const summary = $("#auditDetails summary small");
      if (summary) summary.textContent = `${knownCount} из ${blocks.length} блоков · ${unknownBlocks.length ? "часть скрыта" : "все проверено"}`;
    }
  }

  document.addEventListener("click", (event) => {
    const open = event.target.closest("[data-finding-open]");
    if (!open) return;
    const index = Number(open.dataset.findingOpen);
    const detail = document.getElementById(`audit-finding-${index}`);
    if (detail) {
      detail.open = true;
      detail.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  let auditPrintOpenState = [];
  function printAudit() {
    auditPrintOpenState = $$("#auditDetails, .audit-finding").map((el) => [el, el.open]);
    $$("#auditDetails, .audit-finding").forEach((el) => { el.open = true; });
    document.body.classList.add("print-audit");
    const cleanup = () => {
      document.body.classList.remove("print-audit");
      auditPrintOpenState.forEach(([el, open]) => { el.open = open; });
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 1500);
  }
  $("#auditPrint")?.addEventListener("click", printAudit);

  function openTariffs() {
    const modal = $("#tariffModal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("tariff-open");
    modal.querySelector(".tariff-close")?.focus?.();
  }
  function closeTariffs() {
    const modal = $("#tariffModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("tariff-open");
  }
  function openFirstAuditGap() {
    const finding = auditFindings.find((item) => viewIds.includes(item?.route) && item.route !== "audit");
    showView(finding?.route || "cabinet");
  }

  function subscriptionDaysLeft(paidAt) {
    if (!paidAt) return null;
    const start = new Date(paidAt);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return Math.ceil((end.getTime() - Date.now()) / 86400000);
  }

  let knownPaidAt = "";
  let planBillingQuiet = false;

  function daysLeftLabel(days) {
    if (days === 0) return "сегодня";
    return `ещё ${days} ${pluralRu(days, "день", "дня", "дней")}`;
  }

  function paintPlanConnection(paid, planName, paidAt) {
    const plan = planName || currentOrgPlan || "Стартовый";
    if (paid) currentOrgPlan = plan;
    if (arguments.length >= 3) knownPaidAt = paidAt || "";
    const at = arguments.length >= 3 ? paidAt : knownPaidAt;
    const days = paid ? subscriptionDaysLeft(at) : null;
    const soon = Boolean(paid && days != null && days >= 0 && days <= 3);
    planBillingQuiet = Boolean(paid && !soon);
    const plaque = document.querySelector(".plan-mini");
    if (plaque) plaque.hidden = Boolean(paid);
    const badge = $("#planMiniState");
    if (badge) {
      badge.hidden = Boolean(paid);
      if (!paid) badge.textContent = "до оплаты";
    }
    const note = $("#trialNote");
    if (note) {
      note.hidden = Boolean(paid);
      if (!paid) note.textContent = "Отдельного пробного запаса нет. Счёт — на месячную цену.";
    }
    const planMini = document.querySelector(".plan-mini-top strong");
    if (planMini && !paid) planMini.textContent = `Тариф «${plan}»`;
    paintPlanIncludes(currentLimits, plan);
    const chip = $("#trialChip");
    if (chip) {
      if (!paid) {
        chip.hidden = false;
        chip.textContent = "до оплаты";
      } else if (soon) {
        chip.hidden = false;
        chip.textContent = daysLeftLabel(days);
      } else {
        chip.hidden = true;
        chip.textContent = "";
      }
    }
    if ($("#accountPlan")) $("#accountPlan").textContent = `Тариф «${plan}»`;
    if ($("#planCardSub")) {
      if (paid && soon) $("#planCardSub").textContent = daysLeftLabel(days);
      else if (paid) $("#planCardSub").textContent = "";
      else {
        const prices = {
          "Стартовый": "2 500",
          "Самостоятельный": "5 500",
          "Автоматический": "11 900",
          "Старт": "2 500",
          "Рост": "5 500",
          "Сеть": "11 900",
        };
        $("#planCardSub").textContent = `«${plan}» · ${prices[plan] || prices["Стартовый"]} ₽ / мес`;
      }
    }
    const issue = $("#invoiceIssue");
    if (issue) issue.hidden = planBillingQuiet;
    if ($("#invoiceNote")) $("#invoiceNote").hidden = planBillingQuiet;
    $$("[data-plan-choose]").forEach((btn) => {
      const own = btn.dataset.plan === plan;
      if (paid && own) {
        btn.textContent = "Подключён";
        btn.dataset.planState = "paid";
      } else {
        btn.textContent = paid ? "Выставить счёт" : "Выбрать";
        btn.dataset.planState = "invoice";
      }
    });
    if ($("#auditPayBtn") && paid) $("#auditPayBtn").hidden = true;
  }

  async function createInvoice(plan) {
    const note = $("#invoiceNote");
    const chosen = plan || $("#invoicePlan")?.value || "Стартовый";
    if (!serverActive || !activeOrgId) {
      const text = apiMissingText();
      if (note) note.textContent = text;
      toast("Счёт не выставлен", text);
      return;
    }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/invoices`, {
        method: "POST",
        body: { plan: chosen },
      });
      const message = data.message || `Счёт на «${chosen}» выставлен. Оплаты картой нет — статус «ждём оплату».`;
      if (note) note.textContent = message;
      closeTariffs();
      showView("settings");
      await loadInvoices();
      setTimeout(() => $("#invoiceList")?.scrollIntoView({ block: "center" }), 40);
      toast("Счёт выставлен", message);
    } catch (err) {
      const text = liveErrorText(err, "Не удалось выставить счёт.");
      if (note) note.textContent = text;
      toast("Счёт не выставлен", text);
    }
  }

  document.addEventListener("click", async (event) => {
    const choose = event.target.closest("[data-plan-choose]");
    if (choose) {
      event.preventDefault();
      const plan = choose.dataset.plan || "Стартовый";
      if (choose.dataset.planState === "paid") {
        closeTariffs();
        showView("settings");
        setTimeout(() => $("#invoiceList")?.scrollIntoView({ block: "center" }), 40);
        toast("Тариф подключён", `«${plan}» уже оплачен. Счета лежат в настройках.`);
        return;
      }
      if ($("#invoicePlan")) $("#invoicePlan").value = plan;
      await createInvoice(plan);
      return;
    }
    if (event.target.closest("#auditCloseGaps, #auditFixBtn")) {
      event.preventDefault();
      openFirstAuditGap();
      return;
    }
    if (event.target.closest("#auditPayBtn")) {
      event.preventDefault();
      const plan = auditPayPlan || $("#invoicePlan")?.value || currentOrgPlan || "Стартовый";
      if ($("#invoicePlan")) $("#invoicePlan").value = plan;
      await createInvoice(plan);
      return;
    }
    if (event.target.closest("[data-tariff-close]")) closeTariffs();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#tariffModal")?.hidden) closeTariffs();
  });

  async function loadAudit(force = false) {
    if (!serverActive || !activeOrgId) {
      if (sessionChecked && $("#cabNote")) $("#cabNote").textContent = apiMissingText();
      return;
    }
    if ($("#auditUpdated")) $("#auditUpdated").textContent = "читаем карточку…";
    try {
      renderAudit(await apiJson(`/api/orgs/${activeOrgId}/card-audit${force ? "?refresh=1" : ""}`));
    } catch (err) {
      if ($("#cabNote")) $("#cabNote").textContent = liveErrorText(err, "Не удалось посчитать аудит.");
    }
  }


  $("#refreshAudit")?.addEventListener("click", async (e) => {
    toast("Проверка запущена", "Пересчитываем карточку по актуальным данным.");
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "Пересчитываем…";
    try {
      await loadAudit(true);
      toast("Проверка обновлена", "Данные карточки пересчитаны.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  /* ---------- global search + review filters ---------- */
  const search = $("#globalSearch");
  let reviewFilter = "all";
  function applyReviewVisibility() {
    const q = String(search?.value || "").trim().toLowerCase();
    let visibleReviews = 0;
    $$(".review-item").forEach((item) => {
      const state = item.dataset.state;
      const rating = Number(item.dataset.rating);
      const filterMatch =
        reviewFilter === "all" ||
        (reviewFilter === "new" && state === "new") ||
        (reviewFilter === "done" && state === "done") ||
        (reviewFilter === "neg" && rating <= 3);
      const queryMatch = !q || item.textContent.toLowerCase().includes(q);
      item.hidden = !(filterMatch && queryMatch);
      if (!item.hidden) visibleReviews += 1;
    });
    if ($("#reviewSearchEmpty")) $("#reviewSearchEmpty").hidden = visibleReviews > 0;
  }
  const SEARCH_PLACES = [
    ["Карточка", "overview"],
    ["Отзывы", "reviews"],
    ["Прайс", "prices"],
    ["Витрина", "storefront"],
    ["Новости", "news"],
    ["Сторис", "stories"],
    ["Календарь", "calendar"],
    ["Клиенты", "clients"],
    ["Запросы", "semantics"],
    ["Материалы", "brandbook"],
    ["Настройки", "settings"],
  ];
  function paintSearchResults(query) {
    const box = $("#searchResults");
    if (!box) return;
    const q = String(query || "").trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    const hits = SEARCH_PLACES.filter(([label]) => label.toLowerCase().includes(q));
    const prices = (Array.isArray(priceItems) ? priceItems : []).filter((item) => String(item.name || "").toLowerCase().includes(q)).slice(0, 5);
    const newsHits = (Array.isArray(newsDrafts) ? newsDrafts : []).filter((item) => String(item.headline || "").toLowerCase().includes(q)).slice(0, 5);
    box.innerHTML = [
      ...hits.map(([label, view]) => `<button type="button" data-search-view="${view}">${esc(label)}</button>`),
      ...prices.map((item) => `<button type="button" data-search-view="prices">${esc(item.name)}</button>`),
      ...newsHits.map((item) => `<button type="button" data-search-view="news">${esc(item.headline || "Новость")}</button>`),
    ].join("") || `<button type="button" disabled>Ничего не нашлось</button>`;
    box.hidden = false;
  }
  search?.addEventListener("input", () => {
    paintSearchResults(search.value);
    applyReviewVisibility();
  });
  $("#searchResults")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-search-view]");
    if (!btn) return;
    showView(btn.dataset.searchView);
    if ($("#searchResults")) $("#searchResults").hidden = true;
  });

  const themeBtn = $("#themeToggle");
  function paintThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    if (!themeBtn) return;
    themeBtn.textContent = dark ? "Тёмная" : "Светлая";
    themeBtn.setAttribute("aria-pressed", String(dark));
  }
  paintThemeButton();
  themeBtn?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("locus:theme", next); } catch { /* выбор темы живёт до перезагрузки */ }
    paintThemeButton();
  });

  const pass = document.querySelector(".card-passport");
  if (pass && $("#cardHome")) $("#cardHome").appendChild(pass);

  /* ---------- reviews ---------- */
  const reviews = {};
  let activeReview = null;
  let activeTone = "care";
  function toneFromSettings() {
    const value = String($("#voiceTone")?.value || "");
    if (value === "business" || value === "friendly" || value === "care") return value;
    if (/делов/i.test(value)) return "business";
    if (/друж/i.test(value)) return "friendly";
    return "care";
  }
  let reviewsLoaded = false;
  let reviewsLoading = false;
  const replyText = $("#replyText");
  const publishReply = $("#publishReply");
  const replyCount = $("#replyCount");

  function reviewWhen(iso) {
    const t = new Date(iso || 0).getTime();
    if (!t) return "недавно";
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 1) return "только что";
    if (min < 60) return `${min} мин`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} ч`;
    return `${Math.round(h / 24)} дн`;
  }

  function replyGoesToMaps(row) {
    const externalId = String(row?.externalId || row?.external_id || "");
    return autopilotData?.connector?.mode === "partner_api" && Boolean(externalId) && !/^seed-/i.test(externalId);
  }

  function replyQueueLabel(row, done) {
    if (replyGoesToMaps(row) || (row?.live && serverActive)) return done ? "Отправлено в Яндекс" : "Отправить в Яндекс";
    return done ? "В кабинете, не в Картах" : "Оставить в кабинете";
  }

  function mergeLiveReview(row) {
    const current = reviews[row.id] || {};
    const author = String(row.author || "Гость").trim();
    const rating = Number(row.rating) || 0;
    const reply = row.reply?.text || "";
    return {
      ...current,
      fromMaps: Boolean(row.fromMaps),
      externalId: row.external_id || "",
      name: author.split(" ")[0],
      avatar: author.slice(0, 1).toUpperCase(),
      cls: current.cls || "",
      stars: rating,
      when: reviewWhen(row.created_at),
      body: esc(row.text || ""),
      status: row.status === "done" ? "done" : "new",
      reply,
      draft: row.reply?.text || "",
      serverReply: row.reply || null,
      appeal: row.appeal || null,
      rawText: row.text || "",
      createdAt: row.created_at || "",
      live: true,
      replies: {},
    };
  }

  async function loadReviews(refresh = false) {
    if (!serverActive || !activeOrgId || reviewsLoading) return;
    reviewsLoading = true;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/reviews${refresh ? "?refresh=1" : ""}`);
      reviewLinkNeeded = data.publicCard === false || (!data.textsCollected && Boolean(String(data.notice || "").trim()));
      if (reviewLinkNeeded) {
        const onboard = $("#onboarding");
        if (onboard) onboard.hidden = false;
        const input = $("#fillUrl");
        if (input && currentOrg?.yandexUrl && !input.value) input.value = currentOrg.yandexUrl;
      }
      const list = data.reviews || [];
      const box = $("#reviewList");
      if (!box) return;
      // Не показываем отзывы предыдущей организации: список всегда строится из API.
      Object.keys(reviews).forEach((key) => { delete reviews[key]; });
      box.innerHTML = "";
      list.forEach((row) => { reviews[row.id] = mergeLiveReview(row); });
      reviewsLoaded = true;
      if (!list.length) {
        const notice = String(data.notice || "").trim();
        const text = notice || (currentCardUrl
          ? "Публичная страница не отдала тексты отзывов."
          : "Нужна ссылка на карточку в Яндекс.Картах — без неё отзывы не собираются.");
        box.innerHTML = `<div class="empty-state"><strong>Отзывов пока нет</strong><p>${esc(text)}</p></div>`;
        activeReview = null;
        if ($("#rdName")) $("#rdName").textContent = "Нет отзыва";
        if ($("#rdMeta")) $("#rdMeta").textContent = "Выберите отзыв слева";
        if ($("#rdBody")) $("#rdBody").textContent = "";
        if (replyText) { replyText.value = ""; replyText.readOnly = true; }
        if (publishReply) { publishReply.disabled = false; publishReply.classList.add("is-blocked"); publishReply.textContent = "Оставить в кабинете"; }
        refreshReviewCounts();
        return;
      }
      activeReview = Number(list[0].id);
      for (const row of list) {
        let item = $(`.review-item[data-review-id="${row.id}"]`, box);
        if (!item) {
          item = document.createElement("button");
          item.type = "button";
          item.className = "review-item";
          item.dataset.reviewId = String(row.id);
          item.innerHTML = `<span class="rev-top"><span class="avatar" aria-hidden="true"></span><span class="who"><strong></strong><span></span></span><span class="rev-stars" aria-hidden="true"></span></span><span class="rev-snippet"></span><span class="rev-status"><span class="st st--new">без ответа</span><time></time></span>`;
          box.appendChild(item);
        }
        const r = reviews[row.id];
        item.dataset.state = r.status;
        item.dataset.rating = String(r.stars);
        item.querySelector(".avatar").textContent = r.avatar;
        item.querySelector(".avatar").className = `avatar ${r.cls}`.trim();
        item.querySelector(".who strong").textContent = r.name;
        item.dataset.fromMaps = r.fromMaps ? "1" : "0";
        const sourceLabel = r.fromMaps ? "Яндекс.Карты" : "Кабинет";
        item.querySelector(".who span").textContent = `${sourceLabel} · ${r.stars} ${r.stars === 1 ? "звезда" : r.stars < 5 ? "звезды" : "звёзд"}`;
        item.querySelector(".rev-stars").textContent = stars(r.stars);
        item.querySelector(".rev-snippet").textContent = String(row.text || "").slice(0, 95) + (String(row.text || "").length > 95 ? "…" : "");
        const st = item.querySelector(".st");
        st.className = `st ${r.status === "done" ? "st--done" : "st--new"}`;
        st.textContent = r.status === "done" ? "отвечен" : (r.draft ? "черновик" : "без ответа");
        item.querySelector("time").textContent = r.when;
      }
      applyReviewVisibility();
      refreshReviewCounts();
      if (reviews[activeReview]) selectReview(activeReview);
    } catch {
      /* остаёмся на демо-данных, если API недоступен */
    } finally {
      reviewsLoading = false;
    }
  }

  function refreshReviewCounts() {
    const items = Array.from(document.querySelectorAll("#reviewList .review-item"));
    const counts = {
      all: items.length,
      new: items.filter((item) => item.dataset.state === "new" && item.dataset.fromMaps === "1").length,
      cabinetNew: items.filter((item) => item.dataset.state === "new").length,
      neg: items.filter((item) => Number(item.dataset.rating) <= 3).length,
      done: items.filter((item) => item.dataset.state === "done").length,
    };
    $$("[data-filter]").forEach((btn) => {
      const n = btn.querySelector("b");
      if (n && counts[btn.dataset.filter] !== undefined) n.textContent = String(counts[btn.dataset.filter]);
    });
    const mapsRows = items.filter((item) => item.dataset.fromMaps === "1").length;
    if ($("#revSummary")) {
      $("#revSummary").textContent = mapsRows
        ? `${mapsRows} с карточки, ${counts.new} ждут ответа, источник: Яндекс.Карты`
        : "Нужна ссылка на карточку в Яндекс.Картах — без неё отзывы не собираются.";
    }
    if ($("#reviewBadge")) {
      $("#reviewBadge").textContent = String(counts.new);
      $("#reviewBadge").hidden = !counts.new;
    }
  }

  function stars(n) {
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }
  function updateCount() {
    if (!replyText || !replyCount) return;
    const n = replyText.value.length;
    const paragraphs = replyText.value.split(/\n\s*\n/).filter(Boolean).length;
    replyCount.textContent = `${paragraphs} абз. · ${n} / 1000`;
    replyCount.classList.toggle("is-over", n > 1000);
  }

  function appealChanceLabel(chance) {
    return chance === "high" ? "сильное основание" : chance === "medium" ? "нужна проверка" : "основание не выбрано";
  }

  function syncAppealReason() {
    const select = $("#appealReason");
    if (!select) return;
    const option = select.options[select.selectedIndex];
    const hint = option?.dataset.hint || "";
    const chance = option?.dataset.chance || "";
    if ($("#appealReasonHint")) {
      $("#appealReasonHint").textContent = hint || "Сначала выберите нарушение — от него зависит структура текста.";
    }
    if ($("#appealChance")) {
      $("#appealChance").className = `chip ${chance ? `chip--${chance}` : ""}`.trim();
      $("#appealChance").textContent = chance ? appealChanceLabel(chance) : "основание не выбрано";
    }
    if ($("#appealEvidence")) {
      $("#appealEvidence").placeholder = option?.value === "personal_data"
        ? "Не копируйте телефон или адрес — напишите, какие именно данные опубликованы."
        : option?.value === "adult" || option?.value === "threats"
          ? "Опишите характер фрагмента без дословного повторения."
          : "Скопируйте точную фразу из отзыва. Например: «Подруга сказала, что здесь обвешивают».";
    }
    if ($("#appealStatus") && !$("#appealPanel")?.hidden) {
      const current = reviews[activeReview];
      if (!current?.appeal?.text) {
        $("#appealStatus").textContent = option?.value
          ? "Основание выбрано. Добавьте цитату, если она есть, и сгенерируйте жалобу."
          : "Выберите нарушение — Локус проверит формулировку.";
      }
    }
    if ($("#appealGenerate")) $("#appealGenerate").disabled = !option?.value;
  }

  function renderAppeal(r) {
    const offer = $("#appealOffer");
    const panel = $("#appealPanel");
    if (!offer) return;
    const negative = r && r.stars <= 3;
    offer.hidden = !negative;
    if (panel && panel.hidden !== false && !negative) panel.hidden = true;
    if (!negative) return;
    const appeal = r.appeal;
    const status = appeal?.status;
    const button = $("#appealOpen");
    const copy = offer.querySelector(".appeal-offer-copy p");
    if (button) button.textContent = status === "queued" || status === "sent" ? "Открыть жалобу" : "Проверить отзыв";
    if (copy) {
      copy.textContent = status === "queued" || status === "sent"
        ? "Жалоба уже в очереди поддержки. Можно открыть текст и проверить формулировки."
        : "Плохая оценка — не основание для удаления. Жалоба сработает только на нарушение правил, а решение и срок остаются за поддержкой Яндекса.";
    }
    if (panel && !panel.hidden) fillAppealPanel(r);
  }

  function fillAppealPanel(r) {
    const appeal = r?.appeal;
    if ($("#appealReason")) $("#appealReason").value = appeal?.reason || "";
    if ($("#appealEvidence")) $("#appealEvidence").value = appeal?.evidence || "";
    if ($("#appealSigner") && !$("#appealSigner").value) {
      const owner = $("#topUserName")?.textContent?.trim() || "";
      $("#appealSigner").value = owner ? `${owner}, представитель организации` : "";
    }
    if ($("#appealText")) $("#appealText").value = appeal?.text || "";
    syncAppealReason();
    if ($("#appealChance") && appeal?.chance) {
      $("#appealChance").className = `chip chip--${appeal.chance}`;
      $("#appealChance").textContent = appealChanceLabel(appeal.chance);
    }
    if ($("#appealStatus")) {
      $("#appealStatus").textContent = appeal
        ? (appeal.status === "queued" || appeal.status === "sent" ? "Жалоба в очереди поддержки." : appeal.note || "Проверьте цитату и подпись перед отправкой.")
        : "Выберите нарушение — Локус проверит формулировку.";
    }
    if ($("#appealCount")) $("#appealCount").textContent = `${($("#appealText")?.value || "").length} / 1800 · от 300 знаков`;
    if ($("#appealSubmit")) {
      const queued = appeal?.status === "queued" || appeal?.status === "sent";
      $("#appealSubmit").disabled = queued || !($("#appealText")?.value.trim().length >= 300);
      $("#appealSubmit").textContent = queued ? "В очереди поддержки" : "Поставить в очередь";
    }
  }

  function openAppeal() {
    const r = reviews[activeReview];
    if (!r) return;
    const panel = $("#appealPanel");
    if (panel) panel.hidden = false;
    fillAppealPanel(r);
    panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    $("#appealReason")?.focus();
  }

  async function generateCurrentAppeal() {
    const r = reviews[activeReview];
    if (!r) return;
    if (!serverActive) { toast("Нет соединения с API", apiMissingText()); return; }
    const reason = $("#appealReason")?.value || "";
    if (!reason) { toast("Выберите нарушение", "Жалоба без нарушения правил не рассматривается."); $("#appealReason")?.focus(); return; }
    const btn = $("#appealGenerate");
    const label = btn?.innerHTML || "";
    if (btn) { btn.disabled = true; btn.textContent = "Собираем…"; }
    try {
      const data = await apiJson(`/api/reviews/${activeReview}/appeal`, {
        method: "POST",
        body: { reason, evidence: $("#appealEvidence")?.value || "", signer: $("#appealSigner")?.value || "" },
      });
      r.appeal = data.appeal;
      if ($("#appealText")) $("#appealText").value = data.appeal?.text || "";
      if ($("#appealStatus")) $("#appealStatus").textContent = data.note || "Текст готов. Проверьте цитату и подпись.";
      if ($("#appealChance")) {
        const chance = data.chance || data.appeal?.chance || "";
        $("#appealChance").className = `chip ${chance ? `chip--${chance}` : ""}`.trim();
        $("#appealChance").textContent = chance ? appealChanceLabel(chance) : "основание не выбрано";
      }
      if ($("#appealCount")) $("#appealCount").textContent = `${($("#appealText")?.value || "").length} / 1800 · от 300 знаков`;
      if ($("#appealSubmit")) $("#appealSubmit").disabled = false;
      toast("Жалоба готова", "Проверьте цитату и подпись. Скриншоты прикладывать не нужно.");
    } catch (err) {
      toast("Не получилось собрать", err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  }

  async function submitCurrentAppeal() {
    const r = reviews[activeReview];
    if (!r) return;
    if (r.appeal?.status === "queued" || r.appeal?.status === "sent") {
      toast("Уже в очереди", "Это обращение уже стоит в очереди поддержки.");
      return;
    }
    const text = $("#appealText")?.value.trim() || "";
    if (text.length < 300) { toast("Рано отправлять", "Добавьте факты: текст короче 300 знаков."); return; }
    const btn = $("#appealSubmit");
    if (btn) { btn.disabled = true; btn.textContent = "Ставим в очередь…"; }
    try {
      const data = await apiJson(`/api/reviews/${activeReview}/appeal/submit`, { method: "POST", body: { text } });
      r.appeal = data.appeal;
      if ($("#appealStatus")) $("#appealStatus").textContent = "Жалоба в очереди кабинета. В Яндекс её не отправляли.";
      if ($("#appealOpen")) $("#appealOpen").textContent = "Открыть жалобу";
      if ($("#appealSubmit")) { $("#appealSubmit").disabled = true; $("#appealSubmit").textContent = "В очереди поддержки"; }
      toast("Жалоба в очереди", "Поставили в очередь. Удаление не гарантировано — решение за поддержкой.");
      refreshReviewCounts();
    } catch (err) {
      toast("Не удалось отправить", err.message);
    } finally {
      if (btn) {
        const queued = r.appeal?.status === "queued" || r.appeal?.status === "sent";
        btn.disabled = queued;
        btn.innerHTML = queued ? "В очереди поддержки" : '<svg width="13" height="13" aria-hidden="true"><use href="#i-check"/></svg> Поставить в очередь';
      }
    }
  }

  $("#cancelSubscription")?.addEventListener("click", () => {
    try { localStorage.setItem("locus:plan:cancelled", "1"); } catch { /* ignore */ }
    const note = $("#trialNote");
    if (note) note.textContent = "Подписка отмечена отменённой. Доступ до конца оплаченного периода.";
    const btn = $("#cancelSubscription");
    if (btn) { btn.disabled = true; btn.textContent = "Подписка отменена"; }
    showView("settings");
  });

  $("#appealOpen")?.addEventListener("click", openAppeal);
  $("#reviewActions")?.addEventListener("click", () => {
    if (!activeReview || !reviews[activeReview]) {
      toast("Сначала выберите отзыв", "Жалоба открывается по выбранному отзыву.");
      return;
    }
    openAppeal();
  });
  $("#appealClose")?.addEventListener("click", () => { const p = $("#appealPanel"); if (p) p.hidden = true; });
  $("#appealReason")?.addEventListener("change", syncAppealReason);
  $("#appealGoReply")?.addEventListener("click", () => {
    $("#appealPanel") && ($("#appealPanel").hidden = true);
    document.querySelector(".reply-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => $("#replyKeywords")?.focus(), 350);
  });
  $("#appealGenerate")?.addEventListener("click", generateCurrentAppeal);
  $("#appealSubmit")?.addEventListener("click", submitCurrentAppeal);
  $("#appealText")?.addEventListener("input", () => {
    if ($("#appealCount")) $("#appealCount").textContent = `${($("#appealText")?.value || "").length} / 1800 · от 300 знаков`;
    if ($("#appealSubmit")) $("#appealSubmit").disabled = !($("#appealText")?.value.trim().length >= 300);
  });

  function selectReview(id) {
    const r = reviews[id];
    if (!r) return;
    activeReview = id;
    $$(".review-item").forEach((item) => {
      item.classList.toggle("is-active", Number(item.dataset.reviewId) === id);
    });
    $("#rdName").textContent = r.name;
    $("#rdMeta").textContent = `${r.stars} ${r.stars === 1 ? "звезда" : r.stars < 5 ? "звезды" : "звёзд"} · ${r.when}`;
    $("#rdBody").innerHTML = r.body;
    const av = $("#rdAvatar");
    av.textContent = r.avatar;
    av.className = `avatar ${r.cls}`.trim();

    if (r.status === "done") {
      replyText.value = r.reply;
      replyText.readOnly = true;
      publishReply.textContent = replyQueueLabel(r, true);
      publishReply.disabled = false;
      publishReply.classList.add("is-blocked");
      publishReply.dataset.state = "done";
      if ($("#generateReply")) {
        $("#generateReply").disabled = false;
        $("#generateReply").title = "Сгенерировать заново — новый черновик заменит опубликованный ответ.";
      }
    } else {
      replyText.value = r.draft || r.replies[activeTone] || r.replies.care || "";
      replyText.readOnly = false;
      publishReply.disabled = false;
      publishReply.classList.remove("is-blocked");
      publishReply.dataset.state = "new";
      if ($("#generateReply")) {
        $("#generateReply").disabled = false;
        $("#generateReply").removeAttribute("title");
      }
      publishReply.textContent = replyQueueLabel(r, false);
    }
    updateCount();
    renderAppeal(r);
  }

  $$(".review-item").forEach((item) => {
    item.addEventListener("click", () => selectReview(Number(item.dataset.reviewId)));
  });
  $("#reviewList")?.addEventListener("click", (event) => {
    const item = event.target.closest(".review-item");
    if (item) selectReview(Number(item.dataset.reviewId));
  });

  async function generateCurrentReply() {
    const r = reviews[activeReview];
    if (!r) return;
    if (r.status === "done") {
      toast("Собираем новую версию", "Новый черновик заменит опубликованный ответ после публикации.");
    }
    if (!serverActive) {
      toast("Нет соединения с API", apiMissingText());
      return;
    }
    const btn = $("#generateReply");
    const btnLabel = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Собираем…"; }
    if ($("#replyKeywords")) $("#replyKeywords").placeholder = "Собираем ключи из карточки…";
    try {
      const currentText = replyText.value.trim();
      const priorVariant = Number.isFinite(Number(r.genCount))
        ? Number(r.genCount)
        : (currentText ? 2 : 0);
      let data = null;
      let text = "";
      let attempt = 0;
      for (; attempt < 3; attempt += 1) {
        const tone = toneFromSettings();
        activeTone = tone;
        data = await apiJson(`/api/reviews/${activeReview}/reply`, {
          method: "POST",
          body: { tone, keywords: splitTags($("#replyKeywords")?.value || ""), variant: priorVariant + attempt },
        });
        text = data.reply?.text || "";
        if (text && text !== currentText) break;
      }
      r.genCount = priorVariant + attempt;
      r.replies[activeTone] = text;
      r.draft = text;
      r.serverReply = data.reply;
      r.status = "new";
      replyText.value = text;
      replyText.readOnly = false;
      publishReply.disabled = false;
      publishReply.dataset.state = "new";
      if ($("#generateReply")) {
        $("#generateReply").disabled = false;
        $("#generateReply").removeAttribute("title");
      }
      publishReply.textContent = replyQueueLabel(r, false);
      if ($("#replyKeywords") && data.reply?.keywords?.length) $("#replyKeywords").value = data.reply.keywords.join(", ");
      if ($("#replyKeywords")) $("#replyKeywords").placeholder = "Ключевые слова: услуги, ниша, город";
      updateCount();
      const item = $(`.review-item[data-review-id="${activeReview}"]`);
      if (item) {
        item.dataset.state = "new";
        const st = $(".rev-status .st", item);
        if (st) { st.className = "st st--new"; st.textContent = "черновик"; }
      }
      refreshReviewCounts();
      noteGenerated({
        target: "reviews",
        kind: "text",
        title: `Отзывы · «${String(r.author || "гость").trim() || "гость"}»`,
        text: "Черновик ответа собран.",
        key: `reply:${activeReview}:${Date.now()}`,
      });
      toast("Ответ собран", `${data.reply?.paragraphs || 2} абзаца · ключи уже в тексте`);
    } catch (err) {
      toast("Не получилось собрать", err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.innerHTML = btnLabel || '<svg width="13" height="13" aria-hidden="true"><use href="#i-spark"/></svg> Сгенерировать'; }
    }
  }

  replyText?.addEventListener("input", updateCount);
  $("#generateReply")?.addEventListener("click", generateCurrentReply);
  $("#reviewsRefresh")?.addEventListener("click", () => loadReviews(true));

  publishReply?.addEventListener("click", async () => {
    const r = reviews[activeReview];
    if (!r) { toast("Нет отзыва", "Выберите отзыв из списка слева."); return; }
    if (r.status === "done") {
      toast("Ответ уже опубликован", "Соберите новую версию, если хотите дополнить ответ.");
      return;
    }
    const text = replyText.value.trim();
    if (text.length < 20) {
      toast("Слишком коротко", "Ответ короче 20 символов выглядит формально. Добавьте деталей.");
      return;
    }
    if (r.live && serverActive) {
      publishReply.disabled = true;
      try {
        const sent = await apiJson(`/api/reviews/${activeReview}/publish`, { method: "POST", body: { text, tone: activeTone } });
        if (!sent.published) {
          publishReply.disabled = false;
          toast(sent.mode === "approval" ? "Ушло в мессенджер" : "Не ушло в Яндекс", sent.message || "");
          return;
        }
        r.status = "done";
        r.reply = text;
        replyText.readOnly = true;
        if ($("#generateReply")) {
          $("#generateReply").disabled = false;
          $("#generateReply").title = "Сгенерировать заново — новый черновик заменит опубликованный ответ.";
        }
        publishReply.textContent = replyQueueLabel(r, true);
        publishReply.disabled = false;
        publishReply.classList.add("is-blocked");
        const item = $(`.review-item[data-review-id="${activeReview}"]`);
        if (item) {
          item.dataset.state = "done";
          const st = $(".rev-status .st", item);
          if (st) { st.className = "st st--done"; st.textContent = "отвечен"; }
        }
        refreshReviewCounts();
        refreshNotifications();
        toast("Отправлено в Яндекс", sent.message || "Аккаунт представителя сохранил ответ.");
      } catch (err) {
        publishReply.disabled = false;
        toast("Не опубликовано", err.message);
      }
      return;
    }
    r.status = "done";
    r.reply = text;
    const item = $(`.review-item[data-review-id="${activeReview}"]`);
    if (item) {
      item.dataset.state = "done";
      const st = $(".rev-status .st", item);
      if (st) { st.className = "st st--done"; st.textContent = "отвечен"; }
    }
    publishReply.disabled = false;
    publishReply.classList.add("is-blocked");
    publishReply.textContent = replyQueueLabel(r, true);
    replyText.readOnly = true;
    if ($("#generateReply")) $("#generateReply").disabled = true;
    refreshReviewCounts();
    toast("В очереди кабинета", "Статус: в кабинете, не в Картах.");
    const badge = $(".side-badge");
    if (badge) {
      const left = Math.max(0, Number(badge.textContent) - 1);
      badge.textContent = String(left);
      if (left === 0) badge.classList.add("side-badge--muted");
    }
    updateCount();
  });

  /* review filters */
  $$("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      reviewFilter = btn.dataset.filter || "all";
      applyReviewVisibility();
    });
  });

  if (reviews[1]) selectReview(1);

  /* ---------- stories: серия как в карточке ---------- */
  let storyProducts = [];
  let storySlotPhotos = {};
  let storySeriesLoading = false;

  function storyNicheKey() {
    const raw = `${currentOrg?.category || ""} ${currentOrg?.name || ""}`.toLowerCase();
    if (/стомат|зуб|ортодонт/.test(raw)) return "dentistry";
    if (/барбер/.test(raw)) return "barber";
    if (/медиц|клиник/.test(raw)) return "medical";
    if (/фитнес|спортзал|тренаж|йога/.test(raw)) return "fitness";
    if (/авто|машин|сервис|шин/.test(raw)) return "auto";
    if (/одежд|бутик|ателье|гардероб|шоурум|товар/.test(raw)) return "retail";
    if (/салон|красот|стриж|маникюр|бров/.test(raw)) return "beauty";
    if (/строит|ремонт|отделк|фасад|кровл/.test(raw)) return "construction";
    if (/ресторан|бар(?!бер)|пицц/.test(raw)) return "restaurant";
    if (/пекар|выпеч|хлеб/.test(raw)) return "bakery";
    if (/кофе|кафе/.test(raw)) return "coffee";
    return "default";
  }

  function moneyRub(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";
    return `${new Intl.NumberFormat("ru-RU").format(n)} ₽`;
  }

  const STORY_TITLES = {
    coffee: "Кофейня", bakery: "Пекарня", restaurant: "Ресторан", beauty: "Салон красоты",
    barber: "Барбершоп", dentistry: "Стоматология", medical: "Клиника", auto: "Автосервис",
    fitness: "Фитнес", retail: "Магазин", construction: "Ремонт", default: "Карточка",
  };
  const STILLS = {
    cup: { src: "/assets/stories/coffee-cup.jpg", label: "Чашка" },
    matcha: { src: "/assets/stories/coffee-matcha.jpg", label: "Матча" },
    pastry: { src: "/assets/stories/coffee-pastry.jpg", label: "Выпечка" },
    seat: { src: "/assets/stories/coffee-seat.jpg", label: "Зал" },
    bag: { src: "/assets/stories/coffee-bag.jpg", label: "С собой" },
    loaf: { src: "/assets/stories/bakery-loaf.jpg", label: "Хлеб" },
    table: { src: "/assets/stories/restaurant-table.jpg", label: "Стол" },
    salon: { src: "/assets/stories/salon-still.jpg", label: "Уход" },
    tools: { src: "/assets/stories/barber-tools.jpg", label: "Инструменты" },
    clinic: { src: "/assets/stories/clinic-quiet.jpg", label: "Клиника" },
    wheel: { src: "/assets/stories/auto-detail.jpg", label: "Сервис" },
    gym: { src: "/assets/stories/gym-empty.jpg", label: "Зал" },
    shirt: { src: "/assets/stories/clothes-rack.jpg", label: "Вещи" },
    wood: { src: "/assets/stories/wood-samples.jpg", label: "Материалы" },
  };
  const NICHE_STILLS = {
    coffee: ["cup", "matcha", "pastry", "seat", "bag"],
    bakery: ["loaf", "pastry", "bag", "seat"],
    restaurant: ["table", "seat", "pastry", "bag"],
    beauty: ["salon", "tools"],
    barber: ["tools", "salon"],
    dentistry: ["clinic"],
    medical: ["clinic"],
    auto: ["wheel"],
    fitness: ["gym"],
    retail: ["shirt"],
    construction: ["wood"],
    default: ["cup", "seat", "table"],
  };
  let storyMade = {};
  let storyFocus = "route";
  let storyPackKey = "";

  function storyContext() {
    const org = currentOrg || {};
    const placeBits = orgPlace(org);
    const priced = storyProducts.filter((item) => item?.name && Number(item.price) > 0);
    const drinks = priced.filter((item) => /латте|уайт|кофе|матча|капуч|эспрессо|американо|раф|какао|чай/i.test(item.name));
    const gifts = priced.filter((item) => /кружк|стакан|мерч|сертификат/i.test(item.name));
    const foods = priced.filter((item) => !drinks.includes(item) && !gifts.includes(item));
    return {
      place: [placeBits.address, placeBits.city].filter(Boolean).join(", ") || "адрес из карточки",
      brand: org.name || "Карточка",
      priced, drinks, foods, gifts,
    };
  }

  function cardFieldText(value) {
    if (value && typeof value === "object") return String(value.value || "").trim();
    return String(value || "").trim();
  }

  function routeEntranceText(org = {}) {
    const photos = org.card?.photos;
    let raw = "";
    if (Array.isArray(photos)) {
      const slot = photos.find((item) => item && item.id === "entrance");
      raw = cardFieldText(slot?.value ?? slot);
    } else if (photos && typeof photos === "object") {
      raw = cardFieldText(photos.entrance);
    }
    if (!raw) raw = cardFieldText(org.entrance);
    if (!raw || /\.(jpe?g|png|webp|gif|svg|heic|arw)$/i.test(raw) || /^https?:/i.test(raw) || /[\\/]/.test(raw)) return "";
    return raw;
  }

  function orgPlace(org = {}) {
    const cardAddress = org.card?.address;
    const address = String(
      org.address
      || cardAddress?.value
      || (typeof cardAddress === "string" ? cardAddress : "")
      || ""
    ).trim();
    const city = String(org.city || "").trim();
    return { address, city };
  }

  function routeFactLine(org = {}) {
    const { address, city } = orgPlace(org);
    const noAddress = !address || /не указан|уточня|адрес из карточки|адрес в карточке/i.test(address);
    if (noAddress) return { missing: true, line: "В карточке нет адреса. Место не показываем.", approach: "" };
    const where = city && !address.toLowerCase().includes(city.toLowerCase()) ? `${address}, ${city}` : address;
    const comment = cardFieldText(org.card?.addressComment || org.addressComment);
    const commentOk = comment && !/(?:\+7|8)[\s().-]*\d/.test(comment) ? comment : "";
    const features = [
      ...(Array.isArray(org.features) ? org.features : []),
      ...(Array.isArray(org.card?.features) ? org.card.features : []),
    ].map((item) => String(item || "").trim()).filter(Boolean);
    const parking = features.find((item) => /парков/i.test(item)) || "";
    const entrance = routeEntranceText(org);
    const how = [];
    if (entrance) how.push(entrance.replace(/\.+$/, ""));
    if (commentOk && !how.some((part) => part.includes(commentOk))) how.push(commentOk.replace(/\.+$/, ""));
    if (parking && !how.some((part) => part.includes(parking))) how.push(parking.replace(/\.+$/, ""));
    const arrival = how.length ? `${how.join(". ")}.` : "Как пройти в карточке ещё не указано.";
    const approachSource = `${commentOk} ${entrance}`;
    const approach = /двор/i.test(approachSource) ? "yard" : /подъезд|вход|дверь|этаж/i.test(approachSource) ? "door" : "street";
    return { missing: false, line: `${where}. ${arrival}`, approach };
  }

  function routeSlot() {
    const org = currentOrg || {};
    const place = [org.address, org.city].filter(Boolean).join(", ");
    const way = routeFactLine(org);
    return {
      id: "route",
      kind: "scene",
      model: true,
      title: "Как пройти",
      listTitle: place ? `Как пройти, ${place}` : "Как пройти",
      note: "Подъезд и парковка",
      way: way.line,
      approach: way.approach,
      missing: way.missing,
      price: "",
      cta: "Маршрут",
      still: "",
    };
  }
  function productLines(product) {
    const raw = String(product?.comment || product?.description || "").trim();
    if (!raw) return [];
    const parts = raw.split(/[;\n•]/).map((part) => part.trim()).filter((part) => part && !/прайс|добавьте/i.test(part));
    if (parts.length >= 2) return parts.slice(0, 4);
    const commas = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (commas.length >= 3) return commas.slice(0, 4);
    return [raw];
  }
  function productSlot(id, product, title, still, cta, note) {
    const lines = productLines(product);
    const guest = lines.length > 1 ? lines.join(", ") : (lines[0] || "");
    return {
      id, kind: "scene", still,
      title: product?.name || title,
      note: product ? guest : note,
      lines: lines.length > 1 ? lines : [],
      price: product ? `${product.is_from ? "от " : ""}${moneyRub(product.price)}` : "",
      cta,
    };
  }
  function textSlot(id, title, note, still, cta) {
    return { id, kind: "scene", still, title, note, price: "", cta };
  }
  function takeProducts(list) {
    const used = [];
    return () => {
      const item = list.find((entry) => !used.includes(entry));
      if (item) used.push(item);
      return item || null;
    };
  }
  function servicePack(ctx, spec) {
    const next = takeProducts(ctx.priced);
    const slots = [routeSlot(), productSlot("offer", next(), spec.offer, spec.still, spec.cta, "добавьте услугу в прайс")];
    spec.rest.forEach((item) => {
      slots.push(item.fromPrice
        ? productSlot(item.id, next(), item.title, item.still || spec.still, item.cta || spec.cta, item.note)
        : textSlot(item.id, item.title, item.note, item.still || spec.still, item.cta || spec.cta));
    });
    let extra = 0;
    while (slots.length < 10) {
      const product = next();
      if (!product) break;
      slots.push(productSlot(`extra-${extra}`, product, product.name, spec.still, spec.cta, ""));
      extra += 1;
    }
    return slots;
  }

  function storySeries() {
    const ctx = storyContext();
    const niche = storyNicheKey();
    if (niche === "coffee") {
      const nextDrink = takeProducts(ctx.drinks.length ? ctx.drinks : ctx.priced);
      const nextFood = takeProducts(ctx.foods);
      const gift = ctx.gifts[0] || null;
      return [
        routeSlot(),
        productSlot("offer", nextDrink(), "Акция", "cup", "Смотреть меню", "добавьте позицию в прайс"),
        productSlot("sip", nextDrink(), "Что выпить", "matcha", "Заказать", "второй напиток из прайса"),
        productSlot("food", nextFood(), "Завтрак", "pastry", "К завтраку", "блюдо из прайса"),
        productSlot("more", nextFood(), "Ещё из меню", "pastry", "Смотреть меню", "следующая позиция"),
        textSlot("away", "С собой", "Кофе и выпечка на вынос", "bag", "Забрать"),
        textSlot("team", "Кто варит", "Кто стоит за стойкой", "seat", "Познакомиться"),
        gift
          ? productSlot("gift", gift, "Подарок", "bag", "Забрать", "")
          : textSlot("hall", "Где сесть", "Зал и места у окна", "seat", "Заглянуть"),
      ];
    }
    if (niche === "auto") {
      return [
        routeSlot(),
        textSlot("oil", "Замена масла", "в день обращения", "wheel", "Записаться"),
        textSlot("diag", "Диагностика", "точная проверка", "wheel", "Записаться"),
        textSlot("repair", "Ремонт и обслуживание", "список работ", "wheel", "Записаться"),
        textSlot("parts", "Запчасти в наличии", "деталь к заказу", "wheel", "Записаться"),
        textSlot("tires", "Шиномонтаж", "колёса и диски", "wheel", "Записаться"),
        textSlot("wash", "Мойка", "кузов и стёкла", "wheel", "Записаться"),
      ];
    }
    const packs = {
      bakery: { offer: "Свежая выпечка", still: "loaf", cta: "Смотреть витрину", rest: [
        { id: "tea", fromPrice: true, title: "К чаю", note: "ещё одна позиция", still: "pastry" },
        { id: "more", fromPrice: true, title: "Утро", note: "что берут с утра", still: "loaf" },
        { id: "away", title: "С собой", note: "Пакет на вынос", still: "bag", cta: "Забрать" },
        { id: "oven", title: "Из печи", note: "Кто печёт с утра", still: "loaf" },
        { id: "hall", title: "Где забрать", note: ctx.place, still: "seat", cta: "Маршрут" },
      ] },
      restaurant: { offer: "Блюдо", still: "table", cta: "Забронировать", rest: [
        { id: "second", fromPrice: true, title: "Ещё из меню", note: "следующая позиция", still: "table" },
        { id: "third", fromPrice: true, title: "К столу", note: "ещё одна позиция", still: "pastry" },
        { id: "hall", title: "Зал", note: "Где вас посадят", still: "seat" },
        { id: "book", title: "Бронь", note: "Столик лучше держать заранее", still: "table", cta: "Забронировать" },
        { id: "away", title: "С собой", note: "Если кухня отдаёт навынос", still: "bag", cta: "Забрать" },
      ] },
      beauty: { offer: "Акция", still: "salon", cta: "Записаться", rest: [
        { id: "team", title: "Специалисты", note: "Кто принимает", still: "salon" },
        { id: "a", fromPrice: true, title: "Уход", note: "услуга из прайса", still: "salon" },
        { id: "b", fromPrice: true, title: "Образ", note: "ещё одна услуга", still: "salon" },
        { id: "c", fromPrice: true, title: "Детали", note: "Крупный план работы", still: "tools" },
        { id: "visit", title: "Первый визит", note: "Обсудим задачу до начала", still: "salon" },
        { id: "book", title: "Запись", note: "Свободные окна уточняет администратор", still: "salon" },
      ] },
      barber: { offer: "Акция", still: "tools", cta: "Записаться", rest: [
        { id: "cut", fromPrice: true, title: "Стрижка", note: "услуга из прайса", still: "tools" },
        { id: "beard", fromPrice: true, title: "Борода", note: "если есть в прайсе", still: "tools" },
        { id: "master", title: "Мастер", note: "Кто стрижёт", still: "tools" },
        { id: "shape", title: "Форма", note: "Подберём до начала стрижки", still: "tools" },
        { id: "book", title: "Запись", note: "Свободные окна на неделю", still: "tools" },
      ] },
      dentistry: { offer: "Акция", still: "clinic", cta: "Записаться", rest: [
        { id: "team", title: "Специалисты", note: "Кто ведёт приём", still: "clinic" },
        { id: "consult", fromPrice: true, title: "Консультация", note: "приём из прайса", still: "clinic" },
        { id: "hygiene", fromPrice: true, title: "Гигиена", note: "если есть в прайсе", still: "clinic" },
        { id: "plan", title: "План приёма", note: "Что будет на визите", still: "clinic" },
        { id: "prep", title: "Как подготовиться", note: "Список вещей скажет администратор", still: "clinic" },
        { id: "book", title: "Запись", note: "Окно к врачу", still: "clinic" },
      ] },
      medical: { offer: "Акция", still: "clinic", cta: "Записаться", rest: [
        { id: "team", title: "Специалисты", note: "Кто ведёт приём", still: "clinic" },
        { id: "visit", fromPrice: true, title: "Приём", note: "услуга из прайса", still: "clinic" },
        { id: "check", fromPrice: true, title: "Диагностика", note: "если есть в прайсе", still: "clinic" },
        { id: "prep", title: "Как подготовиться", note: "Список вещей скажет администратор", still: "clinic" },
        { id: "room", title: "Кабинет", note: "Где проходит приём", still: "clinic" },
        { id: "book", title: "Запись", note: "Окно на приём", still: "clinic" },
      ] },
      fitness: { offer: "Абонемент", still: "gym", cta: "Записаться", rest: [
        { id: "hall", title: "Зал", note: "Где проходят тренировки", still: "gym" },
        { id: "coach", title: "Тренер", note: "Кто ведёт занятие", still: "gym" },
        { id: "group", fromPrice: true, title: "Группа", note: "занятие из прайса", still: "gym" },
        { id: "first", title: "Первая тренировка", note: "Покажем зал до оплаты", still: "gym" },
        { id: "time", title: "Расписание", note: "Когда проходят группы", still: "gym" },
      ] },
      retail: { offer: "Новинка", still: "shirt", cta: "Смотреть", rest: [
        { id: "look", fromPrice: true, title: "Образ", note: "позиция из прайса", still: "shirt" },
        { id: "size", title: "Размер", note: "Поможем с посадкой в зале", still: "shirt" },
        { id: "fit", title: "Примерка", note: "Посадка в зале", still: "shirt" },
        { id: "line", fromPrice: true, title: "Коллекция", note: "ещё одна позиция", still: "shirt" },
        { id: "gift", title: "В подарок", note: "Если в прайсе есть подарочная позиция", still: "shirt" },
      ] },
      construction: { offer: "Замер", still: "wood", cta: "Оставить заявку", rest: [
        { id: "cost", title: "Смета", note: "Состав работ до старта", still: "wood" },
        { id: "steps", title: "Этапы", note: "От замера до сдачи", still: "wood" },
        { id: "site", title: "Объект", note: "Как выглядят работы", still: "wood" },
        { id: "stuff", title: "Материалы", note: "Чем работаем", still: "wood" },
        { id: "ask", title: "Заявка", note: "Коротко о задаче", still: "wood", cta: "Оставить заявку" },
      ] },
      default: { offer: "Акция", still: "cup", cta: "Подробнее", rest: [
        { id: "service", fromPrice: true, title: "Услуга", note: "позиция из прайса", still: "seat" },
        { id: "more", fromPrice: true, title: "Ещё", note: "следующая позиция", still: "table" },
        { id: "team", title: "Специалисты", note: "Кто принимает", still: "seat" },
        { id: "place", title: "Где мы", note: ctx.place, still: "seat", cta: "Маршрут" },
        { id: "book", title: "Запись", note: "Как к вам попасть", still: "table" },
      ] },
    };
    return servicePack(ctx, packs[niche] || packs.default);
  }

  function lightenHex(hex) {
    const raw = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return "#FFE6A8";
    const mix = (channel) => Math.round(channel + (255 - channel) * 0.42).toString(16).padStart(2, "0");
    return `#${mix(parseInt(raw.slice(0, 2), 16))}${mix(parseInt(raw.slice(2, 4), 16))}${mix(parseInt(raw.slice(4, 6), 16))}`;
  }

  function storyThemes() {
    const { palette } = activeLook();
    const paper = palette.paper || "#F5EFE2";
    const ink = palette.ink || "#1E1B16";
    const accent = palette.accent || "#C56B2E";
    const soft = palette.soft || paper;
    const light = palette.light || paper;
    const dark = palette.dark || ink;
    return [
      { bg: paper, ink, accent, panel: ink, panelInk: paper, map: soft, block: light, park: soft },
      { bg: ink, ink: paper, accent, panel: paper, panelInk: ink, map: soft, block: light, park: soft },
      { bg: dark, ink: light, accent, panel: paper, panelInk: ink, map: soft, block: light, park: soft },
    ];
  }

  function nicheStills(niche) {
    return NICHE_STILLS[niche] || NICHE_STILLS.default;
  }

  const STORY_LAYOUTS = [
    { id: "classic", name: "Классика" },
    { id: "plate", name: "Карточка" },
    { id: "ticket", name: "Прайс" },
    { id: "cover", name: "Обложка" },
  ];
  let storyIdeas = [];
  let storyIdeaSeq = 1;

  function storyBoard() {
    return [...storySeries(), ...storyIdeas];
  }

  function blockModelSvg(accent) {
    const tone = /^#[0-9a-f]{6}$/i.test(String(accent || "")) ? accent : "#C6A36A";
    const box = (x, y, w, h, d) => {
      const top = `${x},${y} ${x + w},${y - d} ${x + w + d},${y} ${x + d},${y + d}`;
      const left = `${x},${y} ${x + d},${y + d} ${x + d},${y + d + h} ${x},${y + h}`;
      const right = `${x + w},${y - d} ${x + w + d},${y} ${x + w + d},${y + h} ${x + w},${y + h - d}`;
      return `<polygon points="${left}" fill="#8a8378"/><polygon points="${right}" fill="#6e675e"/><polygon points="${top}" fill="#f3eee6"/>`;
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 746" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="420" height="746" fill="#c9c0b3"/>
      <rect x="24" y="168" width="372" height="540" rx="18" fill="#ddd4c6"/>
      <polygon points="48,560 372,508 372,572 48,624" fill="#b7aea1"/>
      <polygon points="86,590 168,572 168,612 86,630" fill="#cfc6b8"/>
      <polygon points="186,568 268,550 268,590 186,608" fill="#cfc6b8"/>
      ${box(64, 300, 108, 150, 28)}
      ${box(196, 250, 86, 188, 24)}
      ${box(292, 320, 70, 120, 20)}
      ${box(78, 470, 64, 70, 16)}
      <path d="M40 640 C 130 600, 180 590, 230 540 S 300 470, 250 390" fill="none" stroke="${tone}" stroke-width="7" stroke-linecap="round"/>
    </svg>`;
  }

  function guestNote(note) {
    const text = String(note || "");
    if (/прайс|добавьте/i.test(text)) return "";
    return text;
  }

  function frameHasContact(text) {
    const value = String(text || "");
    if (/(?:\+7|8)[\s().-]*\d(?:[\s().-]*\d){9,}/.test(value)) return true;
    if (/\+\d(?:[\s().-]*\d){9,}/.test(value)) return true;
    if (/(?:ул\.|улиц|просп|пер\.|бульв|наб\.|шоссе|проезд|корп\.|дом\s*\d|д\.\s*\d)/i.test(value)) return true;
    if (/адрес из карточки/i.test(value)) return true;
    return false;
  }

  function shortPlace(place) {
    const clean = String(place || "").replace(/^г\.?\s*/i, "");
    return clean.length > 46 ? `${clean.slice(0, 44)}…` : clean;
  }

  function ensureStoryPack() {
    const key = `${activeOrgId || 0}:${storyNicheKey()}`;
    if (storyPackKey === key) return;
    storyPackKey = key;
    storyMade = { route: { theme: 0, layout: 0, mode: "model", still: "", src: "" } };
    storyIdeas = [];
    storyIdeaSeq = 1;
    storyFocus = "route";
  }

  function ensureMade(id) {
    if (storyMade[id]) return storyMade[id];
    const slot = storyBoard().find((item) => item.id === id);
    const plate = STORY_LAYOUTS.findIndex((item) => item.id === "plate");
    const ticket = STORY_LAYOUTS.findIndex((item) => item.id === "ticket");
    storyMade[id] = {
      theme: 0,
      layout: slot?.price ? ticket : plate,
      mode: slot?.model ? "model" : "still",
      still: slot?.still || "cup",
      src: "",
    };
    return storyMade[id];
  }

  function regenerateStory(id) {
    const slot = storyBoard().find((item) => item.id === id);
    if (!slot) return;
    if (!storyMade[id]) {
      ensureMade(id);
      storyFocus = id;
      renderStories();
      return;
    }
    const state = storyMade[id];
    const themes = storyThemes(storyNicheKey());
    state.theme = (Number(state.theme) + 1) % themes.length;
    storyFocus = id;
    renderStories();
  }

  function storyMaterialAt(index) {
    const card = currentCardImages[index];
    if (card) return { src: card, label: "фото из карточки" };
    return null;
  }

  function storySlotMaterial(slot, index) {
    const chosen = storySlotPhotos[slot.id];
    if (chosen?.src) return { src: chosen.src, label: chosen.label || "приложено вами" };
    if (chosen?.id && activeOrgId) {
      return {
        src: `/api/orgs/${activeOrgId}/images/${chosen.id}`,
        label: chosen.local ? "макет: ключа фото нет" : "сгенерировано под тему",
      };
    }
    return storyMaterialAt(index);
  }

  const palettes = [
    { id: "amber", label: "Янтарь", fallback: "linear-gradient(165deg,#e2a24a,#a4552a 45%,#4a2415)" },
    { id: "sage", label: "Шалфей", fallback: "linear-gradient(165deg,#9db8a8,#1d5b45 55%,#0d2a20)" },
    { id: "terra", label: "Терракота", fallback: "linear-gradient(165deg,#e2795f,#8f2a17 55%,#451208)" },
    { id: "plum", label: "Слива", fallback: "linear-gradient(165deg,#c9c5d8,#4d4a63 55%,#22212e)" }
  ];
  function defaultPaletteIndex() {
    const category = cardCategory();
    if (category === "барбершоп") return 2;
    if (category === "клиника") return 3;
    if (category === "фитнес" || category === "пекарня") return 1;
    return 0;
  }

  function cardCategory() {
    const raw = String(currentCardMeta?.category || currentOrg?.name || "").toLowerCase();
    if (/кофей|кафе/.test(raw)) return "кофейня";
    if (/пекар|выпеч|хлеб/.test(raw)) return "пекарня";
    if (/барбер|салон|красот/.test(raw)) return "барбершоп";
    if (/ресторан|бар|пицц|еда/.test(raw)) return "ресторан";
    if (/фитнес|спорт|йог/.test(raw)) return "фитнес";
    if (/клиник|стом|медиц/.test(raw)) return "клиника";
    return currentCardMeta?.category || "карточка";
  }

  function designUrl({ format = "story", title, subtitle = "", category = "", price = "", cta = "Смотреть меню", variant = 1, photo = "", imageId = "" } = {}) {
    if (!serverActive || !activeOrgId) return "";
    const params = new URLSearchParams({
      format,
      title: String(title || ""),
      subtitle: String(subtitle || ""),
      category: category || cardCategory(),
      theme: palettes[selectedPalette].id,
      variant: String(variant),
      cta,
    });
    if (price) params.set("price", price);
    const look = activeLook().palette;
    if (look?.paper) params.set("paper", look.paper);
    if (look?.ink) params.set("ink", look.ink);
    if (look?.accent) params.set("accent", look.accent);
    if (currentBrandbook) params.set("brand", "1");
    if (photo) params.set("photo", photo);
    if (imageId) params.set("imageId", String(imageId));
    return `/api/orgs/${activeOrgId}/preview.svg?${params.toString()}`;
  }

  function syncPaletteButtons() {
    $$(".palette").forEach((b, i) => b.setAttribute("aria-pressed", String(i === selectedPalette)));
  }

  function applyDefaultPalette() {
    if (paletteTouched) return;
    const next = defaultPaletteIndex();
    if (next !== selectedPalette) {
      selectedPalette = next;
      syncPaletteButtons();
    }
  }

  async function ensureCardImages() {
    applyDefaultPalette();
    if (!serverActive || !activeOrgId || !currentCardUrl || cardImagesLoaded) return;
    try {
      const res = await fetch(`/api/orgs/${activeOrgId}/card-audit`, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const data = await res.json();
      const images = (Array.isArray(data.card?.images) ? data.card.images : [])
        .filter((src) => /^https:\/\/avatars\.mds\.yandex\.net\/get-(?:altay|sprav-products)\//i.test(String(src || "")))
        .slice(0, 6);
      if (images.length) currentCardImages = images;
      currentCardMeta = data.card || currentCardMeta;
      cardImagesLoaded = true;
      applyDefaultPalette();
    } catch {
      /* остаётся редакционный демо-арт */
    }
  }

  function storyNote(reason, tone, offer) {
    const base = offer || "Расскажите о новинке в двух предложениях.";
    if (tone === "short") return base.split(/[.!?]/)[0].trim() + ".";
    if (tone === "bold") return base.replace(/\.$/, "") + ". Без лишних слов.";
    return base;
  }

  function storyPrice(offer) {
    const match = String(offer || "").match(/(\d[\d\s]{0,7})\s*₽/);
    return match ? `${match[1].replace(/\s+/g, "")} ₽` : "";
  }

  let storyHistoryItems = [];
  let storyHistoryOpen = false;

  function storyToneLabel(tone) {
    return tone === "short" ? "коротко" : tone === "bold" ? "смелый" : "тёплый";
  }

  function storyShotSrc(src) {
    const value = String(src || "");
    return value && !value.startsWith("data:image/svg") ? value : "";
  }

  function routeLibraryPhoto() {
    const rows = (Array.isArray(imageAssets) ? imageAssets : []).filter((image) => {
      if (!image?.url || /svg/i.test(String(image.mime || ""))) return false;
      return String(image.scene || "").trim() === "Как пройти";
    });
    const pick = rows.slice().sort((a, b) => Number(b.id) - Number(a.id))[0];
    return pick?.url ? String(pick.url) : "";
  }

  function routeDisplayPhotos(slot, made) {
    if (!(slot?.model || slot?.id === "route")) return null;
    const shots = [0, 1, 2].map((index) => storyShotSrc(made?.shots && made.shots[index])).filter(Boolean);
    if (!shots.length && storyShotSrc(made?.src)) shots.push(storyShotSrc(made.src));
    if (shots.length > 1) return null;
    if (shots.length === 1) return shots;
    const stored = routeLibraryPhoto();
    return stored ? [stored] : [];
  }

  function storyAddressLine(org = {}) {
    const { address, city } = orgPlace(org);
    const noAddress = !address || /не указан|уточня|адрес из карточки|адрес в карточке/i.test(address);
    if (noAddress) return "";
    return city && !address.toLowerCase().includes(city.toLowerCase()) ? `${address}, ${city}` : address;
  }

  function routeApproachFacts(org = {}) {
    const entrance = routeEntranceText(org);
    const features = [
      ...(Array.isArray(org.features) ? org.features : []),
      ...(Array.isArray(org.card?.features) ? org.card.features : []),
    ].map((item) => String(item || "").trim()).filter(Boolean);
    const parking = features.find((item) => /парков/i.test(item)) || "";
    return { entrance, parking };
  }

  function storyFactFromCard(slot) {
    const lines = [];
    if (Array.isArray(slot?.lines)) {
      for (const part of slot.lines) {
        const clean = String(part || "").trim();
        if (!clean || /прайс|добавьте/i.test(clean) || lines.includes(clean)) continue;
        lines.push(clean);
      }
    }
    if (lines.length) return lines.join(". ");
    if (slot?.price) {
      const note = guestNote(slot?.note);
      return note || "";
    }
    return "";
  }

  function storySequence(slot, routeMark) {
    const org = currentOrg || {};
    const title = String(slot?.title || "История").trim() || "История";
    const honest = "Как пройти в карточке ещё не указано.";
    if (slot?.model || slot?.id === "route") {
      const where = storyAddressLine(org);
      const { entrance, parking } = routeApproachFacts(org);
      if (!entrance && !parking) {
        return [
          { role: "Обложка", text: title },
          { role: "Адрес", text: where || "Адреса в карточке нет." },
          { role: "Дальше", text: honest },
        ];
      }
      const fact = [entrance, parking].filter(Boolean).join(". ");
      const guest = String(org.cta || "").trim();
      return [
        { role: "Обложка", text: title },
        { role: routeMark, text: fact },
        { role: "Гостю", text: guest || honest },
      ];
    }
    const fact = storyFactFromCard(slot);
    const guest = String(org.cta || "").trim();
    return [
      { role: "Обложка", text: title },
      { role: "Факт", text: fact || "В карточке нет отдельного факта для этой истории." },
      { role: "Гостю", text: guest || "В карточке нет отдельного действия для гостя." },
    ];
  }

  function storyPublishBody(slot) {
    const about = String(slot?.title || "").trim();
    if (slot?.model || slot?.id === "route") {
      const org = currentOrg || {};
      const address = String(org.address || "").trim();
      const city = String(org.city || "").trim();
      const noAddress = !address || /не указан|уточня|адрес из карточки|адрес в карточке/i.test(address);
      const where = noAddress ? "" : (city && !address.toLowerCase().includes(city.toLowerCase()) ? `${address}, ${city}` : address);
      const way = String(slot?.way || "").trim();
      const missingHow = Boolean(slot?.missing) || /ещё не указано|нет адреса/i.test(way) || !way;
      const honest = "Как пройти в карточке ещё не указано.";
      const place = where ? (/[.!?…]$/.test(where) ? where : `${where}.`) : "";
      const text = missingHow ? [honest, place].filter(Boolean).join(" ") : (way || place || honest);
      return { about: about || "Как пройти", text };
    }
    const bits = [];
    const note = guestNote(slot?.note);
    if (note) bits.push(note.replace(/[.!?…]+$/, ""));
    if (Array.isArray(slot?.lines)) {
      for (const part of slot.lines) {
        const clean = String(part || "").trim().replace(/[.!?…]+$/, "");
        if (!clean || /прайс|добавьте/i.test(clean) || bits.some((item) => item.includes(clean))) continue;
        bits.push(clean);
      }
    }
    const facts = bits.join(". ");
    const text = facts
      ? (about && !facts.toLowerCase().includes(about.toLowerCase()) ? `${about}. ${facts}.` : `${facts}.`)
      : (about ? `${about}. В карточке нет отдельного текста для этой истории.` : "");
    return { about, text };
  }

  function renderStories() {
    const grid = $("#storyGrid");
    if (!grid) return;
    document.querySelector("#view-stories [data-goto='brandbook']")?.remove();
    ensureStoryPack();
    const niche = storyNicheKey();
    const series = storyBoard();
    const focus = series.find((item) => item.id === storyFocus) || series[0];
    storyFocus = focus.id;
    selectedStory = Math.max(0, series.findIndex((item) => item.id === focus.id));
    const themes = storyThemes();
    const state = storyMade[focus.id] || null;
    const theme = themes[(state?.theme || 0) % themes.length];
    if ($("#storySub")) $("#storySub").textContent = `${STORY_TITLES[niche] || "Карточка"}, ${series.length} историй, «${focus.title}»`;

    const menu = series.map((slot, index) => {
      const made = Boolean(storyMade[slot.id]);
      const listTitle = slot.listTitle || slot.title;
      const listNote = slot.way || (slot.model ? slot.note : (slot.price ? `${slot.note} · ${slot.price}` : slot.note));
      return `<li class="story-menu-row">
        <button type="button" class="story-menu-item" data-open-slot="${esc(slot.id)}" aria-pressed="${slot.id === focus.id}">
          <span class="story-menu-kicker">${index + 1}</span>
          <span><b>${esc(listTitle)}</b><small>${esc(listNote)}</small></span>
        </button>
      </li>`;
    }).join("");

    const posterNames = ["Тёплое золото", "Цветной свет", "Живая деталь"];
    const posterClasses = ["is-warm", "is-night", "is-living"];
    const stage = series.map((slot) => {
      const made = storyMade[slot.id] || {};
      const routeMark = "Подъезд и парковка";
      const parts = storySequence(slot, routeMark);
      const partList = `<ol class="story-parts">${parts.map((part) => `<li><span>${esc(part.role)}</span><b>${esc(part.text)}</b></li>`).join("")}</ol>`;
      const selected = Number(made.poster) || 0;
      const routePhotos = routeDisplayPhotos(slot, made);
      const singleRoute = Boolean(routePhotos && routePhotos.length === 1);
      const frames = singleRoute
        ? `<button type="button" class="poster-frame is-panel is-photo${slot.id === focus.id ? " is-selected" : ""}" data-poster="0" data-slot="${esc(slot.id)}" aria-pressed="${slot.id === focus.id}">
          <img src="${esc(routePhotos[0])}" alt="${esc(slot.title)}">
          <span class="poster-type"><strong>${esc(slot.title)}</strong></span>
        </button>`
        : posterNames.map((label, index) => {
          const src = (made.shots && made.shots[index]) || (index === selected ? made.src : "") || "";
          const real = src && !String(src).startsWith("data:image/svg");
          const empty = `<span class="sf-photo sf-photo--empty">${slot.model && slot.missing ? "" : "Кадр пустой"}</span>`;
          return `<button type="button" class="poster-frame is-panel ${posterClasses[index]}${slot.id === focus.id && selected === index ? " is-selected" : ""}" data-poster="${index}" data-slot="${esc(slot.id)}" aria-pressed="${slot.id === focus.id && selected === index}">
          ${real ? `<img src="${esc(src)}" alt="">` : empty}
          <span class="poster-type"><strong>${esc(slot.title)}</strong></span>
          <em class="poster-variant">${label}</em>
        </button>`;
        }).join("");
      return `<section class="story-poster-block">
        <div class="story-poster-row${singleRoute ? " is-single" : ""}">${frames}</div>
        ${partList}
        <div class="story-controls">
          <button type="button" class="btn btn--small" data-attach-slot="${esc(slot.id)}">Своё фото</button>
          <button type="button" class="btn btn--ghost btn--small" data-gen-slot="${esc(slot.id)}" title="Замещающий кадр. Не фото двери, машины, кабинета или стойки.">Замещающий кадр</button>
        </div>
      </section>`;
    }).join("");

    grid.innerHTML = `<div class="story-work">
      <div>
        ${lookBar()}
        <p class="story-list-label">Сгенерировать историю</p>
        <ol class="story-menu">${menu}</ol>
        <form class="story-idea" data-story-idea>
          <label class="story-list-label" for="storyIdeaInput">Своя идея</label>
          <div class="story-idea-row">
            <input id="storyIdeaInput" name="idea" maxlength="80" placeholder="Например, акция в субботу">
            <button class="btn btn--small" type="submit">Добавить</button>
          </div>
        </form>
      </div>
      <div class="story-detail">${stage}</div>
    </div>`;
    if ($("#storyStatus") && (state || focus?.id === "route")) {
      const supplied = ((state?.mode === "upload" || state?.mode === "card" || state?.mode === "grok") && state?.src) || (focus?.id === "route" && Boolean(routeLibraryPhoto()));
      $("#storyStatus").textContent = supplied ? `«${focus.title}»: кадр в рамке.` : `«${focus.title}»: кадр ещё не нарисован.`;
    }
    paintLookHosts();
  }

  async function loadStorySeries() {
    if (storySeriesLoading) return;
    storySeriesLoading = true;
    if (serverActive && activeOrgId) {
      try {
        const me = await apiJson("/api/me");
        const fresh = (me.orgs || []).find((item) => item.id === activeOrgId);
        if (fresh) currentOrg = fresh;
      } catch {
        /* серия остаётся на том, что уже открыто */
      }
      try {
        const [prices, images] = await Promise.all([
          apiJson(`/api/orgs/${activeOrgId}/prices`),
          apiJson(`/api/orgs/${activeOrgId}/images`),
        ]);
        storyProducts = Array.isArray(prices.products) ? prices.products : [];
        if (Array.isArray(images.images)) imageAssets = images.images;
      } catch {
        /* серия остаётся на адресе карточки */
      }
      await ensureCardImages();
    }
    await ensureLook();
    renderStories();
    storySeriesLoading = false;
  }

  $$(".palette").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      selectedPalette = i;
      paletteTouched = true;
      $$(".palette").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      renderStories();
    });
  });

  $$(".story-card").forEach((card) => {
    card.addEventListener("click", () => {
      $$(".story-card").forEach((c) => c.setAttribute("aria-pressed", String(c === card)));
    });
  });

  ["storyReason", "storyTone"].forEach((id) => {
    $(`#${id}`)?.addEventListener("change", () => {
      renderStories();
      if ($("#storyStatus")) $("#storyStatus").textContent = "Параметры обновлены. Нажмите «Собрать 3 варианта», чтобы обновить серию.";
    });
  });
  $("#storyOffer")?.addEventListener("change", () => {
    renderStories();
    if ($("#storyStatus")) $("#storyStatus").textContent = "Текст обновлён — проверьте его в вариантах.";
  });
  $("#storyCta")?.addEventListener("change", () => {
    renderStories();
    if ($("#storyStatus")) $("#storyStatus").textContent = "Кнопка обновлена во всех вариантах.";
  });

  let storyAttachSlot = "";
  $("#storyFile")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const slotId = storyAttachSlot;
    event.target.value = "";
    if (!file || !slotId) return;
    const state = ensureMade(slotId);
    if (state.mode === "upload" && state.src) URL.revokeObjectURL(state.src);
    state.mode = "upload";
    state.shots = state.shots || ["", "", ""];
    state.shots[Number(state.poster) || 0] = URL.createObjectURL(file);
    state.src = state.shots[Number(state.poster) || 0];
    storyFocus = slotId;
    renderStories();
    if ($("#storyStatus")) $("#storyStatus").textContent = "Ваш снимок стоит в этой истории. Фон можно оставить любой из трёх.";
  });

  $("#storyGrid")?.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-story-idea]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const title = String(input?.value || "").trim();
    if (!title) return;
    const id = `idea-${storyIdeaSeq++}`;
    storyIdeas.push({
      id,
      kind: "scene",
      title,
      note: "",
      price: "",
      cta: "Подробнее",
      still: nicheStills(storyNicheKey())[0] || "cup",
      custom: true,
    });
    ensureMade(id);
    storyFocus = id;
    renderStories();
    if ($("#storyStatus")) $("#storyStatus").textContent = `«${title}» добавлена в список. Можно собрать и сменить вид.`;
  });

  $("#storyGrid")?.addEventListener("click", (event) => {
    const attach = event.target.closest("[data-attach-slot]");
    if (attach) {
      event.preventDefault();
      storyAttachSlot = attach.dataset.attachSlot || storyFocus;
      $("#storyFile")?.click();
      return;
    }
    const themeBtn = event.target.closest("button[data-theme][data-slot]");
    if (themeBtn) {
      const id = themeBtn.dataset.slot;
      ensureMade(id);
      storyMade[id].theme = Number(themeBtn.dataset.theme) || 0;
      storyFocus = id;
      renderStories();
      return;
    }
    const photoBtn = event.target.closest("[data-photo-mode]");
    if (photoBtn) {
      const id = photoBtn.dataset.slot;
      const made = ensureMade(id);
      made.mode = photoBtn.dataset.photoMode || "still";
      if (made.mode === "still") made.still = photoBtn.dataset.still || made.still;
      if (made.mode === "card") made.src = photoBtn.dataset.photoSrc || "";
      storyFocus = id;
      renderStories();
      return;
    }
    const posterBtn = event.target.closest("[data-poster]");
    if (posterBtn) {
      const id = posterBtn.dataset.slot || storyFocus;
      ensureMade(id).poster = Number(posterBtn.dataset.poster) || 0;
      storyFocus = id;
      renderStories();
      return;
    }
    const gen = event.target.closest("[data-gen-slot]");
    if (gen) {
      generateStoryStill(gen.dataset.genSlot);
      return;
    }
    const open = event.target.closest("[data-open-slot]");
    if (open) {
      storyFocus = open.dataset.openSlot;
      renderStories();
    }
  });

  ["storyReason", "storyTone", "storyOffer"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => { serverStoryVariants = []; });
    if (el.tagName === "TEXTAREA" || el.type === "text" || el.type === "search") {
      el.addEventListener("input", () => { serverStoryVariants = []; });
    }
  });
  $("#storyCta")?.addEventListener("input", () => { storyCtaTouched = true; });
  $("#storyTone")?.addEventListener("change", () => { storyToneTouched = true; });

  $("#publishStory")?.addEventListener("click", async () => {
    const selected = $('.story-card[aria-pressed="true"]');
    if (!selected) { toast("Выберите кадр", "Сначала выберите сторис в серии."); return; }
    const title = selected.dataset.title || "Сторис";
    const note = selected.dataset.note || "";
    const cta = selected.dataset.cta || $("#storyCta")?.value.trim() || "Смотреть меню";
    const counter = $("#storyCounter");
    const btn = $("#publishStory");
    if (btn) btn.disabled = true;
    if ($("#storyStatus")) $("#storyStatus").textContent = "Ставим в очередь кабинета…";
    if (serverActive && activeOrgId) {
      try {
        const data = await apiJson(`/api/orgs/${activeOrgId}/stories/publish`, {
          method: "POST",
          body: {
            title,
            text: note && note.toLowerCase().startsWith(title.toLowerCase()) ? note : `${title}. ${note}`.trim(),
            occasion: title,
            tone: $("#storyTone")?.value || "warm",
            format: "1080×1920",
            cta,
            link: $("#storyLink")?.value.trim() || "",
          },
        });
        if (counter) counter.textContent = `осталось ${Math.max(0, Number(data.limits?.stories || 0) - Number(data.limits?.usedStories || 0))} публикаций`;
        if (!data.queueId) {
          if ($("#storyStatus")) $("#storyStatus").textContent = "Очередь не создана. Кадр можно скачать PNG.";
          toast("Очередь не создана", "Сторис не отмечена опубликованной.");
          return;
        }
        if ($("#storyStatus")) $("#storyStatus").textContent = data.message || (data.published ? "Отправлено в Яндекс." : "Не ушло в Яндекс.");
        toast(data.mode === "approval" ? "Ушло в мессенджер" : (data.published ? "Отправлено" : "Не ушло"), data.message || title);
        refreshNotifications();
        if (storyHistoryOpen) loadStoryHistory(true);
        return;
      } catch (err) {
        if ($("#storyStatus")) $("#storyStatus").textContent = err.message;
        toast("Не опубликовано", err.message);
        return;
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    if ($("#storyStatus")) $("#storyStatus").textContent = "Сервер недоступен. Кадр можно скачать PNG.";
    toast("Очередь не создана", "Сторис не отмечена опубликованной.");
    if (btn) btn.disabled = false;
  });

  function storyHistoryDate(story) {
    const raw = String(story?.created_at || "");
    const date = raw ? new Date(raw) : null;
    return date && Number.isFinite(date.getTime())
      ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
      : "без даты";
  }

  function renderStoryHistory(stories = []) {
    const box = $("#storyHistoryList");
    if (!box) return;
    storyHistoryItems = stories;
    if (!stories.length) {
      box.innerHTML = `<p class="field-hint story-history-empty">Пока нет публикаций. Соберите три варианта и опубликуйте один — он появится здесь и станет доступен для повторного открытия.</p>`;
      if ($("#storyHistorySub")) $("#storyHistorySub").textContent = "Пока пусто";
      return;
    }
    if ($("#storyHistorySub")) $("#storyHistorySub").textContent = `${stories.length} ${pluralRu(stories.length, "публикация", "публикации", "публикаций")}`;
    box.innerHTML = stories.map((story, i) => {
      const variants = Array.isArray(story.variants) ? story.variants : [];
      const first = variants[0] || {};
      const text = cleanStoryHistoryText(first.text || story.occasion || "Без текста", first.cta);
      const tone = storyToneLabel(story.tone);
      return `<button class="story-history-item" type="button" data-history-index="${i}">
        <span class="story-history-thumb" style="background:linear-gradient(160deg,#d9c4a7,#6d4b35)"></span>
        <span class="story-history-copy">
          <b>${esc(story.occasion || first.title || "Сторис")}</b>
          <small>${esc(storyHistoryDate(story))} · ${esc(tone)} · вертикальный кадр</small>
          <span>${esc(text)}</span>
        </span>
        <span class="story-history-arrow" aria-hidden="true">→</span>
      </button>`;
    }).join("");
  }

  function cleanStoryHistoryText(text, cta) {
    let value = String(text || "").replace(/\s+/g, " ").trim();
    if (cta) value = value.replace(new RegExp(`\\s*${String(cta).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i"), "").trim();
    return value.length > 180 ? `${value.slice(0, 177)}…` : value;
  }

  async function loadStoryHistory(force = false) {
    if (storyHistoryItems.length && !force) { renderStoryHistory(storyHistoryItems); return; }
    const box = $("#storyHistoryList");
    if (box) box.innerHTML = `<p class="field-hint">Загружаем историю…</p>`;
    if (!serverActive || !activeOrgId) {
      renderStoryHistory([]);
      return;
    }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/stories`);
      renderStoryHistory(Array.isArray(data.stories) ? data.stories : []);
    } catch (err) {
      if (box) box.innerHTML = `<p class="field-hint">Не удалось загрузить историю: ${esc(err.message)}</p>`;
    }
  }

  function openStoryHistory() {
    storyHistoryOpen = true;
    if ($("#storyHistory")) $("#storyHistory").hidden = false;
    if ($("#storyHistoryBtn")) $("#storyHistoryBtn").setAttribute("aria-expanded", "true");
    loadStoryHistory(true);
  }

  function closeStoryHistory() {
    storyHistoryOpen = false;
    if ($("#storyHistory")) $("#storyHistory").hidden = true;
    if ($("#storyHistoryBtn")) $("#storyHistoryBtn").setAttribute("aria-expanded", "false");
  }

  function loadStoryFromHistory(index) {
    const story = storyHistoryItems[index];
    if (!story) return;
    const variant = Array.isArray(story.variants) ? story.variants[0] || {} : {};
    const title = story.occasion || variant.title || "Сторис";
    if ($("#storyOffer")) $("#storyOffer").value = variant.text || story.occasion || "";
    if ($("#storyCta")) $("#storyCta").value = variant.cta || "Смотреть меню";
    selectedStory = 0;
    renderStories();
    if ($("#storyStatus")) $("#storyStatus").textContent = `Открыт сохранённый материал «${title}» от ${storyHistoryDate(story)}.`;
    closeStoryHistory();
    toast("История открыта", `«${title}» загружена в редактор.`);
  }

  $("#storyHistoryBtn")?.addEventListener("click", () => {
    if (storyHistoryOpen) closeStoryHistory();
    else openStoryHistory();
  });
  $("#storyHistoryClose")?.addEventListener("click", closeStoryHistory);
  $("#storyHistoryList")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-history-index]");
    if (item) loadStoryFromHistory(Number(item.dataset.historyIndex));
  });

  function paintCoverLine(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    let line = "";
    words.forEach((word, index) => {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else line = test;
      if (index === words.length - 1 && line) ctx.fillText(line, x, y);
    });
    return y;
  }

  async function downloadFrame(selected, frame) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");
    const panelH = Math.round(1920 * 0.34);
    const panel = frame.style.getPropertyValue("--sf-panel").trim() || "#1E1B16";
    const panelInk = frame.style.getPropertyValue("--sf-panel-ink").trim() || "#F5EFE2";
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, 1080, 1920);
    const photo = frame.querySelector(".sf-photo img");
    if (photo?.complete && photo.naturalWidth) ctx.drawImage(photo, 0, panelH, 1080, 1920 - panelH);
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, 1080, panelH);
    ctx.textAlign = "left";
    ctx.fillStyle = panelInk;
    ctx.font = "600 72px Georgia, \"Times New Roman\", serif";
    const titleBottom = paintCoverLine(ctx, selected.dataset.title || "", 48, panelH - 120, 984, 78);
    const note = frame.querySelector(".sf-note")?.textContent || "";
    if (note && !frameHasContact(note)) {
      ctx.font = "500 32px Georgia, \"Times New Roman\", serif";
      paintCoverLine(ctx, note, 48, titleBottom + 16, 984, 40);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("png");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `locus-story-${String(selected.dataset.title || "story").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "")}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadSelectedStory() {
    const selected = $('.story-card[aria-pressed="true"]');
    const frame = selected?.querySelector(".story-frame");
    if (frame) {
      const button = $("#downloadStory");
      if (button) button.disabled = true;
      try {
        await downloadFrame(selected, frame);
        toast("PNG готов", "Вертикальный кадр: выбранный фон и снимок.");
      } catch {
        toast("Не получилось скачать", "Снимок с чужого адреса браузер не отдаёт в файл. Выберите кадр из серии или приложите своё фото.");
      } finally {
        if (button) button.disabled = false;
      }
      return;
    }
    const img = selected?.querySelector(".story-preview img");
    const src = img?.currentSrc || img?.src || selected?.dataset.designSrc;
    if (!src) {
      toast("Нет макета", serverActive ? "Выберите кадр серии — скачивать пока нечего." : apiMissingText());
      return;
    }
    const button = $("#downloadStory");
    if (button) button.disabled = true;
    try {
      const res = await fetch(src, { credentials: "same-origin" });
      if (!res.ok) throw new Error("svg");
      const svg = await res.text();
      /* WKWebView не грузит SVG из blob: в <img>, поэтому используем data URI. */
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = svgUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#F5EFE2";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("png");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `locus-story-${String(selected?.dataset.title || "design").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("PNG готов", generatedStoryImageId ? "Вертикальный кадр и текст." : "Вертикальный макет без фото.");
    } catch {
      toast("Не получилось скачать", serverActive ? "Файл сторис не собрался. Выберите другой кадр." : apiMissingText());
    } finally {
      if (button) button.disabled = false;
    }
  }

  $("#downloadStory")?.addEventListener("click", downloadSelectedStory);

  /* ---------- storefront: единая серия с историями ---------- */
  function ensureProductPhotoPicker(card, title) {
    const actions = card.querySelector(".product-actions");
    if (!actions) return;
    let picker = card.querySelector(".product-photo-pick");
    if (!currentCardImages.length) {
      picker?.remove();
      return;
    }
    if (!picker) {
      picker = document.createElement("div");
      picker.className = "product-photo-pick";
      picker.innerHTML = '<label>Фото позиции <select></select></label>';
      actions.before(picker);
      picker.querySelector("select").addEventListener("change", (e) => {
        productPhotoChoices.set(title, e.target.value);
        renderStorefront(storefrontItems);
      });
    }
    const select = picker.querySelector("select");
    if (select.dataset.count !== String(currentCardImages.length)) {
      select.dataset.count = String(currentCardImages.length);
      select.innerHTML = '<option value="">Без фото</option>' + currentCardImages
        .map((url, index) => `<option value="${esc(url)}">Фото ${index + 1}</option>`)
        .join("");
    }
    select.value = productPhotoChoices.get(title) || "";
  }

  function applyStorefrontDesigns(force = false) {
    const products = $$("#view-storefront .product");
    if (!products.length || !serverActive || !activeOrgId) return;
    products.forEach((card, i) => {
      const art = card.querySelector(".product-art");
      if (!art) return;
      const title = card.querySelector(".product-body strong")?.textContent.trim() || "Позиция витрины";
      const desc = card.querySelector("[data-desc]")?.textContent.trim() || "";
      const meta = card.querySelector(".product-meta span")?.textContent.trim() || "";
      const category = meta.split("·")[0].trim() || cardCategory();
      const price = card.querySelector(".product-meta b")?.textContent.trim() || "";
      ensureProductPhotoPicker(card, title);
      const item = storefrontItems.find((row) => Number(row.id) === Number(card.dataset.storefrontId));
      const savedPhoto = item?.image_id ? `/api/orgs/${activeOrgId}/images/${Number(item.image_id)}` : "";
      const photo = productPhotoChoices.get(title) || savedPhoto || "";
      const src = designUrl({ format: "product", title, subtitle: desc, category, price, variant: i + 1, photo });
      if (!src) return;
      let img = art.querySelector("img[data-design]");
      if (!img) {
        art.replaceChildren();
        img = document.createElement("img");
        img.dataset.design = "1";
        img.loading = "eager";
        img.decoding = "async";
        art.appendChild(img);
        art.classList.add("product-art--design");
        art.setAttribute("role", "presentation");
        art.removeAttribute("aria-label");
        img.addEventListener("error", () => {
          img.remove();
          art.classList.add("is-error");
        });
      }
      if (force || img.getAttribute("src") !== src) img.src = src;
      img.alt = `${title} — дизайн витрины в стиле карточки`;
      art.setAttribute("aria-label", img.alt);
    });
  }

  /* ---------- storefront ---------- */
  const longDescriptions = {
    "Флэт уайт": "Двойной эспрессо и мягкое молоко. Без сахара, если не попросите. Готовим на зерне светлой обжарки — можно взять с собой.",
    "Сырники с малиной": "Творожные сырники из фермерского творога, малиновый соус и сметана 20%. Готовим каждое утро небольшими партиями. Подаём с сезонным джемом — спросите у бариста.",
    "Круассан с миндалём": "Слоёное тесто, миндальный крем и лепестки миндаля. Подогреваем перед подачей, чтобы масло раскрылось. Лучше всего — с фильтром.",
    "Сырники с грушей": "Творожные сырники из фермерского творога, карамелизированная груша, сметана 20%. Готовим каждое утро небольшими партиями. Подаём с сезонным джемом — спросите у бариста.",
    "Круассан миндальный": "Слоёный круассан на французском масле, миндальный крем и лепестки миндаля. Подогреваем перед подачей, чтобы масло раскрылось. Лучше всего — с фильтром.",
    "Матча-латте": "Церемониальная матча, молоко на выбор: обычное, овсяное или кокосовое. Без сиропа и сахара — по желанию. Готовим на воде, не на порошке.",
    "Фильтр Эфиопия": "Светлая обжарка, ноты персика и чёрного чая. Завариваем в V60, подаём 250 мл. Каждую партию пробуем перед тем, как поставить в меню.",
    "Сэндвич с индейкой": "Хлеб на закваске, индейка, печёный перец, соус на йогурте. Собираем после заказа, поэтому он не успевает отсыреть. Можно взять с собой.",
    "Термокружка «Полдень»": "Керамическая кружка 350 мл с логотипом. Ручная работа, можно мыть в посудомоечной машине. Хороший повод завести привычку пить кофе медленнее."
  };

  $$("[data-generate-desc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".product");
      const title = card.querySelector(".product-body strong").textContent.trim();
      const p = card.querySelector("[data-desc]");
      if (!card.dataset.originalDesc) card.dataset.originalDesc = p.textContent.trim();
      const text = longDescriptions[title] || card.dataset.originalDesc || p.textContent;
      p.textContent = text;
      btn.textContent = "Готово ✓";
      btn.disabled = true;
      toast("Описание готово", `«${title}» — можно публиковать в карточку.`);
    });
  });

  $$("[data-publish-product]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const title = btn.closest(".product").querySelector(".product-body strong").textContent.trim();
      toast("Очередь не создана", "Эта кнопка не отправила позицию на сервер.");
    });
  });

  /* ---------- storefront screen ---------- */
  let storefrontItems = [];
  const storefrontPublished = new Set();

  function storefrontPrice(item) {
    const price = Number(item.price) || 0;
    if (!price) return "Цена не указана";
    return `${item.is_from ? "от " : ""}${price.toLocaleString("ru-RU")} ₽`;
  }

  function renderStorefront(items = storefrontItems) {
    const grid = $("#storefrontGrid");
    const empty = $("#storefrontEmpty");
    const summary = $("#storefrontSummary");
    if (!grid) return;
    storefrontItems = (Array.isArray(items) ? items : []).slice().sort((a, b) => (Number(b.popular) || 0) - (Number(a.popular) || 0));
    if (empty) empty.hidden = storefrontItems.length > 0;
    grid.hidden = storefrontItems.length === 0;
    if (!storefrontItems.length) {
      grid.innerHTML = "";
      if (summary) summary.textContent = "В прайсе пока нет позиций";
      return;
    }
    const categories = new Set(storefrontItems.map((item) => String(item.category || "").trim()).filter(Boolean));
    const missing = storefrontItems.filter((item) => !String(item.description || "").trim()).length;
    grid.innerHTML = storefrontItems.map((item) => {
      const title = String(item.name || "Позиция");
      const category = String(item.category || "Без категории");
      const description = String(item.description || item.comment || "");
      const published = storefrontPublished.has(Number(item.id));
      const unavailable = Number(item.available) === 0;
      const shotId = Number(item.showcase_image_id) || 0;
      const fallbackId = Number(item.image_id) || 0;
      const photoId = shotId || fallbackId;
      const photo = photoId && activeOrgId ? `/api/orgs/${activeOrgId}/images/${photoId}` : "";
      const ownShot = Boolean(shotId);
      const shots = Array.isArray(item.showcase_shots) ? item.showcase_shots : [];
      return `
        <article class="product${unavailable ? " is-unavailable" : ""}" data-storefront-id="${Number(item.id)}">
          <div class="product-art${photo ? "" : " product-art--plain"}">
            ${photo ? `<img src="${esc(photo)}" alt="${esc(title)}" data-shot-open="${esc(photo)}" data-shot-title="${esc(title)}">` : `<span class="sf-photo sf-photo--empty">Кадр пустой</span>`}
            <strong class="product-on-photo">${esc(title)}</strong>
            <span class="product-on-line">${esc(storefrontPrice(item))}</span>
          </div>
          <div class="product-body">
            <div class="product-kicker">${esc(category)}${unavailable ? " · скрыта" : ""}${ownShot ? "" : " · кадр прайса, пока нет своего"}</div>
            <p data-desc>${description && !/состав[^.]{0,90}не указан|что входит[^.]{0,70}не указан|добавьте комментарий к позиции/i.test(description) ? esc(description) : (item.copyOffer?.text ? esc(item.copyOffer.text) : "Описание собирается в прайсе.")}</p>
            ${item.copyOffer?.comment ? `<button type="button" class="btn btn--small" data-storefront-offer="${Number(item.id)}">Подставить в комментарий</button>` : ""}
            <div class="product-meta"><span>${esc(category)}${item.unit ? ` · ${esc(item.unit)}` : ""}</span><b>${storefrontPrice(item)}</b></div>
            ${currentOrg?.card?.booking?.url ? `<a href="${esc(currentOrg.card.booking.url)}">${esc(currentOrg.card.booking.url)}</a>` : ""}
            <div class="product-actions">
              <button type="button" data-product-photo="${Number(item.id)}">Кадр витрины</button>
              <button type="button" class="primary${published ? " is-blocked" : ""}" data-publish-product="${Number(item.id)}" data-published="${published ? "true" : "false"}">${published ? "В кабинете, не в Картах" : "Оставить в кабинете"}</button>
            </div>
            <div class="product-photo-panel" data-photo-panel="${Number(item.id)}" hidden>
              <div class="product-photo-head">
                <strong>Фото для витрины</strong>
                <button class="icon-btn" type="button" data-photo-close="${Number(item.id)}" aria-label="Закрыть генерацию фото">×</button>
              </div>
              <div class="product-photo-grid">
                <label>Сцена<select data-photo-scene="${Number(item.id)}"><option value="detail">Предметный кадр</option><option value="hero">Главный кадр</option><option value="interior">Интерьер / место</option><option value="process">Процесс</option></select></label>
                <label>Уточнение<input type="text" maxlength="120" data-photo-extra="${Number(item.id)}" placeholder="Свет, материалы, подача"></label>
              </div>
              <div class="product-photo-actions">
                <button class="btn btn--small" type="button" data-photo-own="${Number(item.id)}">Своё фото</button>
                <button class="btn btn--ghost btn--small" type="button" data-photo-generate="${Number(item.id)}" title="Замещающий кадр. Не фото двери, машины, кабинета или стойки.">Замещающий кадр</button>
                <span class="field-hint" data-photo-status="${Number(item.id)}">Замещающий кадр — не фото двери, машины, кабинета или стойки.</span>
              </div>
              ${shots.length ? `<div class="news-image-choice-row">${shots.map((image) => `<button type="button" class="news-image-choice"><img src="${esc(image.url)}" alt="${esc(title)}" data-shot-open="${esc(image.url)}" data-shot-title="${esc(title)}"></button>`).join("")}</div>` : ""}
            </div>
          </div>
        </article>`;
    }).join("");
    if (summary) {
      const n = storefrontItems.length;
      summary.innerHTML = `<span class="chip chip--solid">${n} ${pluralRu(n, "позиция", "позиции", "позиций")}</span>
        <span class="chip">${categories.size} ${pluralRu(categories.size, "категория", "категории", "категорий")}</span>
        <span class="chip${missing ? " chip--accent" : ""}">${missing ? `${missing} без описания` : "описания заполнены"}</span>`;
    }
    paintLookHosts();
  }

  async function generateProductPhoto(card, id, fromQueue = false) {
    if (!activeOrgId || !serverActive) { toast("Нет соединения с API", apiMissingText()); return; }
    const item = storefrontItems.find((row) => Number(row.id) === Number(id));
    if (!item) return;
    if (!fromQueue) {
      const queued = `Витрина · «${item.name || "позиция"}»`;
      if (!enqueueImageJob(queued, () => generateProductPhoto(card, id, true))) return;
      const status = card.querySelector(`[data-photo-status="${id}"]`);
      if (imageJobRunning && imageJobQueue.length && status) status.textContent = `В очереди: ${queued}.`;
      return;
    }
    const panel = card.querySelector(`[data-photo-panel="${id}"]`);
    const btn = panel?.querySelector(`[data-photo-generate="${id}"]`);
    const status = panel?.querySelector(`[data-photo-status="${id}"]`);
    const label = btn?.innerHTML || "";
    const provider = imageProviders.find((p) => p.configured)?.id || "grok";
    const scene = item.name || panel?.querySelector(`[data-photo-scene="${id}"]`)?.value || "витрина";
    const extra = panel?.querySelector(`[data-photo-extra="${id}"]`)?.value.trim() || "";
    if (btn) btn.textContent = "Собираем…";
    if (status) status.textContent = "Готовим кадр под позицию…";
    try {
      let body;
      try {
        body = await apiJson(`/api/orgs/${activeOrgId}/images`, {
          method: "POST",
          body: {
            provider,
            scene,
            format: "4:5",
            placement: "showcase",
            count: 3,
            ...lookPayload(),
            extra: [`Место, где делают «${item.name}»: комната, стойка или объект, услуга читается в сцене. Не макро фактуры. Верх темнее под название, букв в кадре нет.`, item.category, extra].filter(Boolean).join(". "),
            productId: Number(id),
          },
        });
      } catch (err) {
        const kept = (err?.payload?.images || []).filter((image) => image?.id && image.url && !/svg/.test(image.mime || ""));
        if (!kept.length) throw err;
        body = { images: kept };
      }
      const images = (body.images || []).filter((image) => image?.id && image.url && !/svg/.test(image.mime || ""));
      const image = images[0];
      if (!image) throw new Error("Кадр витрины не получился");
      await apiJson(`/api/products/${Number(id)}/image`, { method: "POST", body: { imageId: Number(image.id), slot: "showcase" } });
      item.showcase_image_id = Number(image.id);
      item.showcase_image_url = image.url;
      item.showcase_shots = images;
      renderStorefront(storefrontItems);
      const next = document.querySelector(`[data-photo-panel="${id}"]`);
      if (next) next.hidden = false;
      const nextStatus = next?.querySelector(`[data-photo-status="${id}"]`);
      const ready = `${images.length} ${pluralRu(images.length, "кадр", "кадра", "кадров")} витрины. Нажмите, чтобы открыть крупно.`;
      if (nextStatus) nextStatus.textContent = ready;
      noteGenerated({
        target: "storefront",
        kind: "image",
        title: `Витрина · «${item.name || "позиция"}»`,
        text: "Кадр витрины собран.",
        key: `showcase:${id}:${image.id}`,
      });
      toast("Кадр витрины готов", `«${item.name}»: ${images.length} ${pluralRu(images.length, "кадр", "кадра", "кадров")}.`);
    } catch (err) {
      const kept = (err?.payload?.images || []).filter((image) => image?.id && image.url && !/svg/.test(image.mime || ""));
      if (kept.length) {
        item.showcase_shots = kept;
        item.showcase_image_id = Number(kept[0].id);
        item.showcase_image_url = kept[0].url;
        renderStorefront(storefrontItems);
        const next = document.querySelector(`[data-photo-panel="${id}"]`);
        if (next) next.hidden = false;
        const nextStatus = next?.querySelector(`[data-photo-status="${id}"]`);
        if (nextStatus) nextStatus.textContent = `${kept.length} ${pluralRu(kept.length, "кадр", "кадра", "кадров")} витрины. Нажмите, чтобы открыть крупно.`;
        toast("Кадр витрины готов", `«${item.name}»: ${kept.length} ${pluralRu(kept.length, "кадр", "кадра", "кадров")}.`);
      } else {
        const message = String(err?.message || "").trim() || "Не удалось сгенерировать изображение";
        if (status) status.textContent = message;
        toast("Не удалось собрать фото", message);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  }

  function syncStorefrontDescribeAll() {
    const btn = $("#storefrontDescribeAll");
    if (!btn) return;
    const missing = storefrontItems.filter((item) => !String(item.description || "").trim() && Number(item.id)).length;
    btn.disabled = false;
    btn.classList.toggle("is-blocked", missing === 0);
    btn.title = missing === 0 ? "У всех позиций уже заполнено описание" : "";
    btn.textContent = missing ? "Описания для всех" : "Описания заполнены";
  }

  async function loadStorefront() {
    if (!activeOrgId) return;
    await ensureLook();
    const summary = $("#storefrontSummary");
    if (summary) summary.textContent = "Загружаем позиции…";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/prices`);
      renderStorefront(data.products || []);
    } catch (err) {
      if (summary) summary.textContent = err.message;
    }
  }

  $("#storefrontRefresh")?.addEventListener("click", async () => {
    await loadStorefront();
    toast("Витрина обновлена", "Позиции и описания подтянуты из прайса.");
  });
  $("#storefrontDescribeAll")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    const missing = storefrontItems.filter((item) => !String(item.description || "").trim() && Number(item.id));
    if (!missing.length) { toast("Описания уже есть", "У всех позиций заполнено описание."); return; }
    btn.disabled = true;
    let done = 0;
    try {
      for (const item of missing) {
        btn.textContent = `Собираем ${done + 1} из ${missing.length}…`;
        const data = await apiJson(`/api/products/${item.id}/description`, { method: "POST" });
        item.description = data.text || item.description;
        done += 1;
      }
      renderStorefront(storefrontItems);
      toast("Описания готовы", `${done} ${pluralRu(done, "позиция", "позиции", "позиций")} — проверьте факты.`);
    } catch (err) {
      toast("Не всё получилось", err.message);
    } finally {
      syncStorefrontDescribeAll();
    }
  });
  let frameUpload = null;

  function askOwnFrame(job) {
    frameUpload = job;
    $("#frameFile")?.click();
  }

  $("#frameFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const job = frameUpload;
    event.target.value = "";
    frameUpload = null;
    if (!file || !job) return;
    if (!serverActive || !activeOrgId) {
      toast("Нет соединения с API", apiMissingText());
      return;
    }
    const mime = imageMime(file);
    if (!mime) {
      toast("Нужен файл", "jpeg, png, webp или gif.");
      return;
    }
    try {
      const dataUrl = await readDataUrl(file);
      const created = await apiJson(`/api/orgs/${activeOrgId}/images/upload`, {
        method: "POST",
        body: { contentBase64: dataUrl.replace(/^data:[^,]*,/, ""), mime, filename: file.name },
      });
      if (!created.id) throw new Error("Сервер не вернул файл.");
      await apiJson(`/api/products/${job.productId}/image`, {
        method: "POST",
        body: { imageId: Number(created.id), slot: job.slot },
      });
      if (job.slot === "showcase") {
        const item = storefrontItems.find((row) => Number(row.id) === Number(job.productId));
        if (item) {
          item.showcase_image_id = Number(created.id);
          item.showcase_image_url = created.url;
        }
        renderStorefront(storefrontItems);
      } else {
        const item = priceItems.find((row) => Number(row.id) === Number(job.productId));
        if (item) item.image_id = Number(created.id);
        priceShotChoices[job.productId] = [{ id: created.id, url: created.url || `/api/orgs/${activeOrgId}/images/${created.id}` }];
        renderPriceRows();
      }
      toast("Своё фото на месте", "Это ваш файл. Замещающий кадр его не подменяет.");
    } catch (err) {
      toast("Не загрузили", liveErrorText(err, "Не удалось загрузить фото."));
    }
  });

  $("#storefrontGrid")?.addEventListener("click", async (event) => {
    const ownShot = event.target.closest("[data-photo-own]");
    if (ownShot) {
      askOwnFrame({ productId: Number(ownShot.dataset.photoOwn), slot: "showcase" });
      return;
    }
    const offerBtn = event.target.closest("[data-storefront-offer]");
    if (offerBtn) {
      const id = Number(offerBtn.dataset.storefrontOffer);
      const item = storefrontItems.find((row) => Number(row.id) === id);
      const offer = item?.copyOffer;
      if (!item || !offer?.comment) return;
      offerBtn.disabled = true;
      try {
        await apiJson(`/api/products/${id}`, {
          method: "PATCH",
          body: {
            name: item.name,
            category: item.category,
            price: Number(item.price) || 0,
            unit: item.unit || "",
            isFrom: Boolean(item.is_from),
            comment: offer.comment,
            description: offer.text,
            available: item.available !== 0,
            popular: Boolean(item.popular),
          },
        });
        item.comment = offer.comment;
        item.description = offer.text;
        item.copyOffer = { text: "", comment: "", source: "" };
        renderStorefront(storefrontItems);
        toast("Комментарий подставлен", `«${item.name}»: черновик по запросам в прайсе. Состав по-прежнему не выдуман.`);
      } catch (err) {
        offerBtn.disabled = false;
        toast("Не подставилось", err.message || "");
      }
      return;
    }
    const photoBtn = event.target.closest("[data-product-photo]");
    if (photoBtn) {
      const id = Number(photoBtn.dataset.productPhoto);
      const panel = photoBtn.closest(".product")?.querySelector(`[data-photo-panel="${id}"]`);
      if (panel) {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) panel.querySelector(`[data-photo-scene="${id}"]`)?.focus();
      }
      return;
    }
    const photoClose = event.target.closest("[data-photo-close]");
    if (photoClose) {
      const panel = photoClose.closest("[data-photo-panel]");
      if (panel) panel.hidden = true;
      return;
    }
    const photoGenerate = event.target.closest("[data-photo-generate]");
    if (photoGenerate) {
      const card = photoGenerate.closest(".product");
      await generateProductPhoto(card, Number(photoGenerate.dataset.photoGenerate));
      return;
    }
    const descBtn = event.target.closest("[data-generate-desc]");
    if (descBtn) {
      const id = Number(descBtn.dataset.generateDesc);
      descBtn.disabled = true;
      const label = descBtn.textContent;
      descBtn.textContent = "Собираем…";
      try {
        const data = await apiJson(`/api/products/${id}/description`, { method: "POST" });
        const item = storefrontItems.find((row) => Number(row.id) === id);
        if (item) item.description = data.text || item.description;
        renderStorefront(storefrontItems);
        toast("Описание готово", "В тексте только состав и цена из прайса.");
      } catch (err) {
        descBtn.disabled = false;
        descBtn.textContent = label;
        toast("Не получилось собрать", err.message);
      }
      return;
    }
    const publishBtn = event.target.closest("[data-publish-product]");
    if (publishBtn) {
      const id = Number(publishBtn.dataset.publishProduct);
      if (storefrontPublished.has(id) || publishBtn.classList.contains("is-blocked")) {
        toast("Уже в очереди", "Позиция уже в очереди кабинета.");
        return;
      }
      const item = storefrontItems.find((row) => Number(row.id) === id);
      if (!activeOrgId || !serverActive) {
        toast("Очередь не создана", "Кнопка не отправила позицию на сервер.");
        return;
      }
      publishBtn.disabled = true;
      try {
        const queued = await apiJson(`/api/orgs/${activeOrgId}/autopilot/queue`, {
          method: "POST",
          body: {
            type: "product_update",
            entityId: id,
            title: `Позиция: ${item?.name || "Прайс"}`,
            payload: { productId: id },
          },
        });
        if (!queued.item?.id) {
          toast("Очередь не создана", "Позиция осталась в прайсе.");
          publishBtn.disabled = false;
          return;
        }
        storefrontPublished.add(id);
        publishBtn.classList.add("is-blocked");
        publishBtn.textContent = queued.published ? "В Яндексе" : (queued.mode === "approval" ? "В мессенджере" : "Не ушло");
        toast(queued.mode === "approval" ? "Ушло в мессенджер" : (queued.published ? "Отправлено" : "Не ушло"), queued.message || item?.name || "");
      } catch (err) {
        publishBtn.disabled = false;
        toast("Очередь не создана", err.message || "");
      }
    }
  });

  /* ---------- semantics ---------- */
  function semanticTone(intent) {
    const value = String(intent || "").toLowerCase();
    if (value.includes("гео")) return ["intent--geo", "гео"];
    if (value.includes("куп") || value.includes("транз")) return ["intent--buy", "купить"];
    if (value.includes("бренд")) return ["intent--brand", "бренд"];
    return ["intent--info", "инфо"];
  }

  let semGeoFilter = { layer: "all", cluster: "all" };

  function semIntentLabel(row) {
    return semanticTone(row.intent)[1];
  }

  function semHash(value) {
    let h = 0;
    for (const ch of String(value || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }

  let semMap = null;
  let semMapKey = "";

  function demandKind(list) {
    if (list.some((row) => row.source === "wordstat" && Number.isFinite(Number(row.frequency)))) return "wordstat";
    if (list.some((row) => Number(row.frequency) > 0 && row.source !== "нет данных")) return "estimate";
    return "none";
  }

  function placePoint(meta = {}) {
    const urban = meta.urban || meta.nearby?.urban || null;
    const loc = meta.location || {};
    const lat = Number(urban?.lat || loc.lat);
    const lon = Number(urban?.lon || loc.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) < 1 || Math.abs(lon) < 1) return null;
    return { lat, lon, urban };
  }

  function mapCaption(meta = {}) {
    const point = placePoint(meta);
    const wordstat = meta.wordstat || {};
    const osm = !point
      ? "Точка появится по адресу с улицей или по координатам карточки."
      : "Точка — адрес организации.";
    if (wordstat.mode === "file") {
      return wordstat.matched
        ? `${osm} Показы из файла Вордстата: ${wordstat.matched} ${pluralRu(wordstat.matched, "фраза", "фразы", "фраз")}.`
        : `${osm} ${wordstat.error || "Файл Вордстата не совпал с ядром."}`;
    }
    if (wordstat.matched) return osm;
    if (wordstat.error) return `${osm} ${wordstat.error}.`;
    return `${osm} Wordstat не подключён: цифры спроса не подставляем.`;
  }

  function renderUrbanMap(meta = {}) {
    const host = $("#semMap");
    const caption = $("#semMapCaption");
    if (!host) return;
    if (caption) caption.textContent = mapCaption(meta);
    const point = placePoint(meta);
    if (!point || !window.leaflet?.map) {
      if (semMap) {
        semMap.remove();
        semMap = null;
        semMapKey = "";
      }
      host.classList.add("sem-map-empty");
      host.textContent = point ? "Карта не загрузилась." : "Адрес ещё без точки. Привяжите карточку или укажите улицу и дом — карта строится по ним.";
      return;
    }
    const key = `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
    if (semMap && semMapKey === key && semMap.getContainer() === host) {
      requestAnimationFrame(() => semMap.invalidateSize());
      return;
    }
    if (semMap) semMap.remove();
    host.classList.remove("sem-map-empty");
    host.textContent = "";
    const Leaflet = window.leaflet;
    semMap = Leaflet.map(host, { scrollWheelZoom: false, attributionControl: true, zoomControl: true }).setView([point.lat, point.lon], 15);
    semMapKey = key;
    Leaflet.tileLayer("/api/map/tile/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 18,
      minZoom: 11,
    }).addTo(semMap);
    const tip = document.createElement("span");
    tip.textContent = [currentOrg?.name, meta.location?.address || currentOrg?.address].filter(Boolean).join(", ");
    Leaflet.circleMarker([point.lat, point.lon], {
      radius: 8,
      color: "#1d5b45",
      weight: 3,
      fillColor: "#f4f1e8",
      fillOpacity: 1,
    }).addTo(semMap).bindTooltip(tip, { direction: "top" });
    requestAnimationFrame(() => semMap.invalidateSize());
  }

  window.addEventListener("resize", () => {
    if (semMap && !$("#view-semantics")?.hidden) semMap.invalidateSize();
  });

  function renderSemGeo(list, meta = {}) {
    const card = $("#semGeoCard");
    if (!card) return;
    const point = placePoint(meta);
    card.hidden = list.length === 0 && !point;
    if (!list.length) {
      renderUrbanMap(meta);
      return;
    }
    const intents = ["гео", "купить", "инфо", "бренд"];
    const countByIntent = Object.fromEntries(intents.map((intent) => [intent, list.filter((row) => semIntentLabel(row) === intent).length]));
    const freqByIntent = Object.fromEntries(intents.map((intent) => [intent, list.filter((row) => semIntentLabel(row) === intent).reduce((sum, row) => sum + Number(row.frequency || 0), 0)]));
    const kind = demandKind(list);
    const hasFreq = kind !== "none";
    const freqTotal = Object.values(freqByIntent).reduce((sum, n) => sum + n, 0) || 1;
    const strongest = intents.slice().sort((a, b) => (hasFreq ? freqByIntent[b] - freqByIntent[a] : countByIntent[b] - countByIntent[a]))[0];
    const city = meta.location?.city || currentOrg?.city || "город";
    if ($("#semGeoSub")) {
      const demand = kind === "wordstat"
        ? "спрос из Wordstat за 30 дней"
        : kind === "estimate"
          ? "цифры ядра — оценка, не Wordstat"
          : (meta.wordstat?.error || "Wordstat не подключён, ноль не показываем");
      $("#semGeoSub").textContent = `Точка на карте · ${city} · ${demand}`;
    }
    if ($("#semGeoSummary")) {
      const lead = kind === "wordstat"
        ? `${Math.round((freqByIntent[strongest] / freqTotal) * 100)}% показов — ${strongest}`
        : kind === "estimate"
          ? `${Math.round((freqByIntent[strongest] / freqTotal) * 100)}% оценки — ${strongest}`
          : `Больше всего фраз — ${strongest}`;
      const note = kind === "wordstat"
        ? `${list.length} фраз. Цифры — показы Wordstat за 30 дней по региону города.`
        : kind === "estimate"
          ? `${list.length} фраз. Это ориентир по категории, не выгрузка Wordstat.`
          : (meta.wordstat?.error
            ? `${meta.wordstat.error}. Ноль здесь не значит, что вас не ищут: это список запросов по категории и адресу.`
            : "Wordstat не подключён. Ноль здесь не значит, что вас не ищут: это список запросов по категории и адресу.");
      $("#semGeoSummary").innerHTML = `<div class="sem-geo-lead"><span class="sem-geo-city">${esc(city)}</span><strong>${esc(lead)}</strong><p>${esc(note)}</p></div>
        <div class="sem-geo-bars">${intents.map((intent) => {
          const width = hasFreq ? Math.max(countByIntent[intent] ? 8 : 0, Math.round((freqByIntent[intent] / freqTotal) * 100)) : Math.max(countByIntent[intent] ? 8 : 0, Math.round((countByIntent[intent] / Math.max(1, list.length)) * 100));
          const mark = hasFreq
            ? `${Math.round((freqByIntent[intent] / freqTotal) * 100)}%`
            : (countByIntent[intent] ? String(countByIntent[intent]) : "—");
          return `<div class="sem-geo-bar"><span>${intent}</span><i><b style="width:${width}%;background:${intent === "гео" ? "var(--green)" : intent === "купить" ? "var(--accent)" : intent === "инфо" ? "var(--amber)" : "var(--muted)"}"></b></i><em>${mark}</em></div>`;
        }).join("")}</div>`;
    }
    const clusters = [...new Map(list.map((row) => [row.cluster || "Без кластера", { name: row.cluster || "Без кластера", count: 0, freq: 0 }])).values()];
    for (const cluster of clusters) {
      const rows = list.filter((row) => (row.cluster || "Без кластера") === cluster.name);
      cluster.count = rows.length;
      cluster.freq = rows.reduce((sum, row) => sum + Number(row.frequency || 0), 0);
    }
    clusters.sort((a, b) => b.freq - a.freq);
    if ($("#semDistricts")) {
      $("#semDistricts").innerHTML = `<span class="sem-side-label">Кластеры</span>` + clusters.map((cluster) => `<button class="sem-district${semGeoFilter.cluster === cluster.name ? " is-active" : ""}" type="button" data-sem-cluster="${esc(cluster.name)}" aria-pressed="${semGeoFilter.cluster === cluster.name}"><span>${esc(cluster.name)}</span><b>${cluster.count}</b></button>`).join("");
    }
    const top = list.slice().sort((a, b) => Number(b.frequency || 0) - Number(a.frequency || 0)).slice(0, 6);
    if ($("#semGeoList")) {
      const demandTitle = kind === "wordstat" ? "показы Wordstat" : kind === "estimate" ? "оценка, не Wordstat" : "Wordstat не подключён";
      $("#semGeoList").innerHTML = `<span class="sem-side-label">${hasFreq ? "Сильнее всего" : "Фразы адреса"}</span>` + top.map((row) => `<button class="sem-geo-row" type="button" data-sem-cluster="${esc(row.cluster || "Без кластера")}"><i class="sem-dot sem-dot--${semIntentLabel(row)}"></i><span>${esc(row.phrase)}</span><b title="${demandTitle}">${freqText(row) === "без оценки" ? "—" : freqText(row)}</b></button>`).join("");
    }
    renderUrbanMap(meta);
  }

  function applySemGeoFilter() {
    $$("#semLayers [data-sem-layer]").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.semLayer === semGeoFilter.layer)));
    $$("#semMap .sem-map-point").forEach((point) => {
      const okLayer = semGeoFilter.layer === "all" || point.dataset.semIntent === semGeoFilter.layer;
      const okCluster = semGeoFilter.cluster === "all" || point.dataset.semCluster === semGeoFilter.cluster;
      point.classList.toggle("is-muted", !(okLayer && okCluster));
    });
    $$("#semDistricts [data-sem-cluster]").forEach((btn) => {
      const active = semGeoFilter.cluster === btn.dataset.semCluster;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    $$("#semBody tr[data-sem-intent]").forEach((row) => {
      const okLayer = semGeoFilter.layer === "all" || row.dataset.semIntent === semGeoFilter.layer;
      const okCluster = semGeoFilter.cluster === "all" || row.dataset.semCluster === semGeoFilter.cluster;
      row.hidden = !(okLayer && okCluster);
    });
    const visibleRows = $$("#semBody tr[data-sem-intent]").filter((row) => !row.hidden);
    if ($("#semFilterEmpty")) $("#semFilterEmpty").hidden = visibleRows.length > 0;
    updateSemanticCount();
  }

  $("#semResetFilter")?.addEventListener("click", () => {
    semGeoFilter.layer = "all";
    semGeoFilter.cluster = "all";
    applySemGeoFilter();
  });

  $$("#semLayers [data-sem-layer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      semGeoFilter.layer = btn.dataset.semLayer;
      if (semGeoFilter.layer === "all") semGeoFilter.cluster = "all";
      applySemGeoFilter();
    });
  });
  $("#semGeoCard")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-sem-cluster]");
    if (!target) return;
    const cluster = target.dataset.semCluster;
    semGeoFilter.cluster = semGeoFilter.cluster === cluster ? "all" : cluster;
    applySemGeoFilter();
  });

  function renderNearby(nearby, location = {}) {
    const box = $("#semNearby");
    if (!box) return;
    const items = Array.isArray(nearby?.competitors) ? nearby.competitors.filter((item) => item.distance !== null) : [];
    if (!items.length) {
      box.hidden = true;
      return;
    }
    const street = String(location.street || "").trim();
    const city = String(location.city || currentOrg?.city || "").trim();
    const place = [street, city].filter(Boolean).join(", ");
    box.hidden = false;
    if ($("#semNearbySub")) {
      $("#semNearbySub").textContent = `${place || "ваш адрес"} · ${items.length} ${pluralRu(items.length, "карточка", "карточки", "карточек")} рядом`;
    }
    if ($("#semNearbyChip")) $("#semNearbyChip").textContent = `до ${Math.max(...items.map((item) => item.distance)).toFixed(1).replace(".", ",")} км`;
    if ($("#semNearbyList")) {
      $("#semNearbyList").innerHTML = items.map((item) => `<a class="sem-nearby-item" href="${esc(item.url)}" target="_blank" rel="noopener">
        <strong>${esc(item.name)}</strong>
        <span class="sem-nearby-meta"><span><b>${Number(item.distance).toFixed(1).replace(".", ",")} км</b></span><span>★ ${item.rating ? Number(item.rating).toFixed(1).replace(".", ",") : "—"}</span><span>${Number(item.reviews || 0).toLocaleString("ru-RU")} отзывов</span></span>
      </a>`).join("");
    }
  }

  function renderSemantics(rows = [], meta = {}) {
    const body = $("#semBody");
    if (!body) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty-state"><strong>Ядро ещё не собрано</strong><p>Соберите базовое ядро по категории, городу и позициям прайса. Это займёт пару секунд.</p></div></td></tr>`;
    } else {
      const savedPicks = readSemanticPicks();
      body.innerHTML = list.map((row, index) => {
        const [tone, label] = semanticTone(row.intent);
        const checked = savedPicks ? savedPicks.has(row.phrase) : index < 4;
        const dest = semDestination(row.action);
        const demand = freqText(row);
        return `<tr data-sem-intent="${label}" data-sem-cluster="${esc(row.cluster || "Без кластера")}" data-sem-phrase="${esc(row.phrase)}"><td><input class="sem-check" type="checkbox" ${checked ? "checked" : ""} aria-label="Взять в работу: ${esc(row.phrase)}"></td><td class="q">${esc(row.phrase)} <span class="sem-picked" ${checked ? "" : "hidden"}>в работе</span></td><td class="num${demand === "без оценки" ? " is-empty" : ""}">${demand}</td><td>${esc(row.cluster || "—")}</td><td><span class="intent ${tone}">${label}</span></td><td><button class="action-pill" type="button" data-sem-go="${dest.view}" title="${esc(dest.hint)}">${esc(row.action || dest.label)}</button></td></tr>`;
      }).join("");
    }
    const total = Number(meta.total ?? list.length);
    const clusters = Number(meta.clusters ?? new Set(list.map((row) => row.cluster)).size);
    if ($("#semSub")) {
      const location = meta.location || {};
      const place = [location.street, location.city].filter(Boolean).join(", ") || currentOrg?.city || "";
      const kind = demandKind(list);
      const demandNote = kind === "wordstat"
        ? (meta.wordstat?.mode === "file" ? " · показы из файла Вордстата" : " · спрос из Wordstat")
        : kind === "estimate"
          ? " · спрос — оценка, не Wordstat"
          : (meta.wordstat?.error ? ` · ${meta.wordstat.error}` : " · спрос без цифр: Wordstat не подключён");
      $("#semSub").textContent = total
        ? `Ядро по карточке и адресу · ${total} фраз · ${clusters} ${pluralRu(clusters, "кластер", "кластера", "кластеров")}${place ? ` · ${place}` : ""}${demandNote}`
        : "Ядро запросов по вашей карточке";
    }
    if ($("#semSummary")) {
      const kind = demandKind(list);
      const demandChip = kind === "wordstat"
        ? `<span class="chip chip--accent">Wordstat · 30 дней</span>`
        : list.some((row) => row.source === "estimate")
          ? `<span class="chip chip--accent" title="Это ориентир по категории и городу, а не выгрузка Wordstat">Оценка · не Wordstat</span>`
          : "";
      $("#semSummary").innerHTML = total
        ? `<span class="chip chip--solid">${total} ${pluralRu(total, "фраза", "фразы", "фраз")}</span><span class="chip">${clusters} ${pluralRu(clusters, "кластер", "кластера", "кластеров")}</span><span class="chip">${list.length} приоритетных</span>${demandChip}`
        : `<span class="chip">Ядро пустое</span><span class="chip chip--accent">Соберите за пару секунд</span>`;
    }
    if ($("#semInsights")) {
      const top = list.slice(0, 3);
      $("#semInsights").innerHTML = top.map((row, index) => {
        const dest = semDestination(row.action);
        const demand = freqText(row);
        const line = row.source === "wordstat"
          ? `${demand} показов за 30 дней, Wordstat. Фраза идёт ${dest.where}.`
          : demand === "без оценки"
            ? `Цифры спроса нет. Фраза идёт ${dest.where}.`
            : `${demand} — оценка, не Wordstat. Фраза идёт ${dest.where}.`;
        return `<div class="insight"><strong><span>${index + 1}</span> ${esc(row.phrase)}</strong><p>${line}</p></div>`;
      }).join("") || `<div class="insight"><strong><span>1</span> Соберите ядро</strong><p>Добавьте категорию и позиции, затем нажмите «Пересобрать ядро».</p></div>`;
    }
    updateSemanticCount();
    renderNearby(meta.nearby, meta.location);
    renderSemGeo(list, meta);
    applySemGeoFilter();
    sortSemanticRows(semSortMode);
  }

  function streetish(address) {
    const value = String(address || "").trim();
    return value.length >= 4 && (/\d/.test(value) || /(улиц|бульвар|проспект|шоссе|переул|набереж|пр-т|бул\.|ул\.)/i.test(value));
  }

  async function loadSemantics() {
    if (!serverActive || !activeOrgId) return;
    try {
      let data = await apiJson(`/api/orgs/${activeOrgId}/semantics`);
      const canFind = Boolean(currentOrg?.yandexUrl) || streetish(currentOrg?.address) || Boolean(placePoint(data));
      if (canFind && (!data.urban?.fetchedAt || data.urban?.error)) {
        if ($("#semMapCaption")) $("#semMapCaption").textContent = "Смотрим адрес…";
        try {
          data = await apiJson(`/api/orgs/${activeOrgId}/place`, { method: "POST", body: {} });
        } catch (err) {
          if ($("#semMapCaption")) $("#semMapCaption").textContent = err.message || "Адрес сейчас не разобрать.";
        }
      }
      renderSemantics(data.semantics || [], data);
    } catch {
      renderSemantics([], {});
    }
  }

  function semDestination(action) {
    const value = String(action || "");
    if (/сторис/i.test(value)) return { view: "stories", label: "В сторис", hint: "Откроет сторис. Фраза для текста истории.", where: "в сторис" };
    if (/витрин/i.test(value)) return { view: "storefront", label: "В витрину", hint: "Откроет витрину. Фраза для короткого описания позиции.", where: "в витрину" };
    if (/сайт/i.test(value)) return { view: "prices", label: "В прайс", hint: "Откроет прайс. Фраза для описания услуги или товара.", where: "в прайс" };
    return { view: "news", label: value || "В новости", hint: "Откроет новости и подставит фразу темой. В карточку Яндекса её переносите вы.", where: "в новости и текст карточки" };
  }

  function semPickKey() {
    return `locus:sem-pick:${activeOrgId || "0"}`;
  }

  function readSemanticPicks() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(semPickKey()) || "null");
      return Array.isArray(raw) ? new Set(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSemanticPicks() {
    const phrases = selectedSemantics().map((row) => row.dataset.semPhrase).filter(Boolean);
    sessionStorage.setItem(semPickKey(), JSON.stringify(phrases));
  }

  function selectedSemantics() {
    return $$(".sem-table2 tbody tr").filter((tr) => tr.querySelector(".sem-check")?.checked);
  }

  let semSortMode = "frequency";

  function updateSemanticCount() {
    const total = $$(".sem-table2 tbody tr").length;
    const visible = $$(".sem-table2 tbody tr").filter((row) => !row.hidden).length;
    const selected = selectedSemantics().length;
    $$(".sem-table2 tbody tr").forEach((row) => {
      const checked = Boolean(row.querySelector(".sem-check")?.checked);
      row.setAttribute("aria-checked", checked ? "true" : "false");
      row.classList.toggle("is-picked", checked);
      const badge = row.querySelector(".sem-picked");
      if (badge) badge.hidden = !checked;
    });
    if ($("#semPickNote")) {
      $("#semPickNote").textContent = selected
        ? `В работе ${selected} ${pluralRu(selected, "фраза", "фразы", "фраз")}: их берём в ответы, новости и описания. Кнопка в столбце «Действие» открывает этот блок и подставляет фразу.`
        : "Ни одна фраза не в работе. Поставьте галочку — и кнопка «Действие» откроет блок, куда её ставить.";
    }
    if ($("#semSelected")) {
      const mode = semSortMode === "intent" ? "по интенту" : "по частоте";
      $("#semSelected").textContent = `${mode} · выбрано ${selected} из ${total} приоритетных${visible < total ? ` · показано ${visible}` : ""}`;
    }
  }

  function semanticFrequency(row) {
    return Number(String(row.querySelector(".num")?.textContent || "").replace(/[^\d]/g, "")) || 0;
  }

  function semanticIntent(row) {
    return String(row.querySelector(".intent")?.textContent || "").trim().toLowerCase();
  }

  function sortSemanticRows(mode = "frequency") {
    const body = $(".sem-table2 tbody");
    if (!body) return;
    semSortMode = mode === "intent" ? "intent" : "frequency";
    const rows = $$(".sem-table2 tbody tr");
    const intentOrder = { "гео": 0, "купить": 1, "инфо": 2, "бренд": 3 };
    rows.sort((a, b) => {
      if (mode === "intent") {
        const ai = intentOrder[semanticIntent(a)] ?? 9;
        const bi = intentOrder[semanticIntent(b)] ?? 9;
        if (ai !== bi) return ai - bi;
      }
      return semanticFrequency(b) - semanticFrequency(a);
    });
    const realRows = rows.filter((row) => row.dataset.semPhrase);
    const noDemand = realRows.length > 0 && realRows.every((row) => semanticFrequency(row) === 0);
    if (noDemand && mode !== "intent") {
      rows.sort((a, b) => String(a.dataset.semCluster || "").localeCompare(String(b.dataset.semCluster || ""), "ru")
        || String(a.dataset.semPhrase || "").localeCompare(String(b.dataset.semPhrase || ""), "ru"));
    }
    rows.forEach((row) => body.appendChild(row));
    const geo = $("#semGeoList");
    if (geo) {
      const order = rows.map((row) => row.dataset.semPhrase);
      $$("#semGeoList .sem-geo-row").sort((a, b) => order.indexOf(a.querySelector("span")?.textContent) - order.indexOf(b.querySelector("span")?.textContent))
        .forEach((button) => geo.appendChild(button));
    }
    $$("[data-sem-sort]").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.semSort === mode)));
    updateSemanticCount();
    if ($("#semSelected") && noDemand && mode !== "intent") {
      const selected = selectedSemantics().length;
      $("#semSelected").textContent = `без цифр спроса · порядок по кластеру · в работе ${selected}`;
    }
  }

  $$("[data-sem-sort]").forEach((btn) => {
    btn.addEventListener("click", () => sortSemanticRows(btn.dataset.semSort));
  });

  function toggleSemanticRow(row) {
    const check = row?.querySelector(".sem-check");
    if (!check) return;
    check.checked = !check.checked;
    check.dispatchEvent(new Event("change", { bubbles: true }));
  }

  $$(".sem-check").forEach((check) => check.addEventListener("change", updateSemanticCount));
  $("#semBody")?.addEventListener("change", (event) => {
    if (event.target.closest(".sem-check")) {
      writeSemanticPicks();
      updateSemanticCount();
    }
  });
  $("#semBody")?.addEventListener("click", (event) => {
    const go = event.target.closest("[data-sem-go]");
    if (!go) return;
    event.stopPropagation();
    const row = go.closest("tr");
    const phrase = row?.dataset.semPhrase || "";
    const check = row?.querySelector(".sem-check");
    if (check && !check.checked) {
      check.checked = true;
      writeSemanticPicks();
      updateSemanticCount();
    }
    const dest = semDestination(go.textContent);
    sessionStorage.setItem("locus:sem-carry", JSON.stringify({ phrase, view: go.dataset.semGo || dest.view, hint: dest.where }));
    showView(go.dataset.semGo || dest.view);
  });
  $$(".sem-table2 tbody tr").forEach((row) => {
    row.tabIndex = 0;
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-label", "Отметить фразу");
    row.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      toggleSemanticRow(row);
    });
  });
  $(".sem-table2 tbody")?.addEventListener("click", (event) => {
    if (event.target.closest("input, button, a, label")) return;
    const row = event.target.closest("tr");
    if (row) toggleSemanticRow(row);
  });
  updateSemanticCount();

  $("#exportCsv")?.addEventListener("click", () => {
    const rows = [["Запрос", "Частота", "Кластер", "Интент", "Действие"]];
    selectedSemantics().forEach((tr) => {
      const cells = $$("td", tr);
      if (cells.length < 6) return;
      rows.push([
        cells[1].textContent.trim(),
        cells[2].textContent.trim().replace(/\s/g, ""),
        cells[3].textContent.trim(),
        cells[4].textContent.trim(),
        cells[5].textContent.trim()
      ]);
    });
    const csv = "\uFEFF" + rows.map((r) => r.join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "locus-semantics.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast("CSV готов", `${rows.length - 1} выбранных фраз выгружены с BOM для Excel.`);
  });

  function downloadPhraseFile(name, lines) {
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  $("#wordstatPhrases")?.addEventListener("click", () => {
    const picked = [...document.querySelectorAll("#semBody tr")].filter((row) => row.querySelector(".sem-check")?.checked);
    const rows = picked.length ? picked : [...document.querySelectorAll("#semBody tr")];
    const phrases = rows.map((row) => row.dataset.semPhrase || "").map((phrase) => phrase.trim()).filter(Boolean);
    if (!phrases.length) {
      toast("Нет фраз", "Сначала соберите ядро.");
      return;
    }
    downloadPhraseFile("фразы-для-вордстата.csv", ["Фраза", ...phrases]);
    toast("Список для Вордстата", `${phrases.length} ${pluralRu(phrases.length, "фраза", "фразы", "фраз")}. В Вордстате выберите город точки и скачайте отчёт.`);
  });

  $("#wordstatUploadBtn")?.addEventListener("click", () => $("#wordstatFile")?.click());
  $("#wordstatFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeOrgId) return;
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 8));
      const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
      if (ole) {
        toast("Старый Excel", "Сохраните отчёт как .xlsx или CSV и загрузите снова.");
        return;
      }
      const zip = head[0] === 0x50 && head[1] === 0x4b;
      const body = { filename: file.name };
      if (zip) {
        let binary = "";
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        body.fileBase64 = btoa(binary);
      } else {
        body.text = new TextDecoder("utf-8").decode(buf);
      }
      const data = await apiJson(`/api/orgs/${activeOrgId}/wordstat`, { method: "POST", body });
      renderSemantics(data.semantics || [], data);
      const matched = Number(data.wordstat?.matched || 0);
      toast(matched ? "Показы записаны" : "Файл разобран", matched
        ? `${matched} ${pluralRu(matched, "фраза совпала", "фразы совпали", "фраз совпали")} с ядром.`
        : (data.wordstat?.error || "Совпадений с ядром нет."));
    } catch (err) {
      toast("Выгрузка не принята", err.message || "Проверьте файл Вордстата");
    }
  });

  $("#rebuildCore")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.textContent = "Собираем ядро…";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/semantics`, { method: "POST" });
      renderSemantics(data.semantics || [], data);
      const ws = data.wordstat || {};
      toast("Ядро собрано", ws.matched
        ? `${data.total || 0} фраз, спрос из Wordstat.`
        : `${data.total || 0} фраз. ${ws.error || "Wordstat не подключён — цифры не подставлены."}`);
    } catch (err) {
      toast("Не удалось собрать ядро", err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  /* ---------- settings ---------- */
  function settingsKey() {
    return activeOrgId ? `locus:settings:v1:${activeOrgId}` : "";
  }

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(settingsKey()) || "{}") || {}; } catch { return {}; }
  }

  function applyOrgVoice(org) {
    if (!org) return;
    if ($("#voiceSign")) {
      const current = String($("#voiceSign").value || "").trim();
      if (!current || /Полдень|бариста|завтраки/.test(current)) {
        const brand = String(org.name || "").match(/«([^»]+)»/)?.[1] || String(org.name || "").replace(/^(Кофейня|Пекарня|Барбершоп|Салон|Стоматология|Автосалон)\s*/i, "").trim();
        $("#voiceSign").value = brand ? `Команда «${brand}»` : "Команда";
      }
    }
    if ($("#voiceFacts")) {
      const features = Array.isArray(org.features) ? org.features.filter(Boolean).slice(0, 4) : [];
      const facts = [org.description, features.length ? `Ключевое: ${features.join(", ")}.` : ""].filter(Boolean).join(" ");
      const current = String($("#voiceFacts").value || "");
      if (!current.trim() || /Полдень|бариста|завтраки/.test(current)) $("#voiceFacts").value = facts;
    }
  }

  function applySettings() {
    const saved = readSettings();
    if (!saved || !Object.keys(saved).length) return;
    $$(".switch-btn").forEach((btn) => {
      if (btn.dataset.locked) {
        btn.setAttribute("aria-checked", "true");
        return;
      }
      const key = btn.getAttribute("aria-label");
      if (key && Object.prototype.hasOwnProperty.call(saved.switches || {}, key)) {
        btn.setAttribute("aria-checked", String(Boolean(saved.switches[key])));
      }
    });
    for (const id of ["voiceTone", "voiceStop", "voiceSign", "voiceFacts"]) {
      const el = $(`#${id}`);
      if (el && saved.fields && Object.prototype.hasOwnProperty.call(saved.fields, id)) el.value = saved.fields[id];
    }
    if ($("#minusWords") && $("#voiceStop")) $("#minusWords").value = $("#voiceStop").value;
  }

  function collectSettings() {
    const switches = {};
    $$(".switch-btn").forEach((btn) => {
      const key = btn.getAttribute("aria-label");
      if (key) switches[key] = btn.getAttribute("aria-checked") === "true";
    });
    const fields = {};
    for (const id of ["voiceTone", "voiceStop", "voiceSign", "voiceFacts"]) {
      const el = $(`#${id}`);
      if (el) fields[id] = el.value;
    }
    return { switches, fields };
  }

  function freqText(row) {
    if (!row || row.source === "нет данных") return "без оценки";
    if (row.source === "wordstat" && Number.isFinite(Number(row.frequency))) return Number(row.frequency).toLocaleString("ru-RU");
    if (!Number(row.frequency)) return "без оценки";
    return Number(row.frequency).toLocaleString("ru-RU");
  }

  async function loadInvoices() {
    if (!activeOrgId || !$("#invoiceList")) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/invoices`);
      const rows = data.invoices || [];
      const paidRow = rows.find((row) => row.status === "paid");
      if (paidRow) paintPlanConnection(true, paidRow.plan || currentOrgPlan, paidRow.paidAt);
      else paintPlanConnection(false, currentOrgPlan);
      const quiet = planBillingQuiet;
      $("#invoiceList").innerHTML = rows.length
        ? rows.map((row) => {
          const money = quiet ? "" : ` · ${Number(row.amount).toLocaleString("ru-RU")} ₽`;
          return `<div class="mini-list-row"><span>${esc(row.plan)}${money}</span><b>${esc(row.statusLabel)}</b>${row.status === "awaiting" ? `<button class="btn btn--ghost btn--small" type="button" data-pay="${row.id}">Оплачен</button><button class="btn btn--ghost btn--small" type="button" data-cancel-invoice="${row.id}">Отменить</button>` : ""}</div>`;
        }).join("")
        : `<div class="mini-list-row"><span>Счетов пока нет</span></div>`;
    } catch (err) {
      $("#invoiceList").innerHTML = `<div class="mini-list-row"><span>${esc(err.message || "Счета недоступны")}</span></div>`;
      if (!planBillingQuiet) paintPlanConnection(false, currentOrgPlan);
    }
  }

  const supportThread = [];

  function renderSupportChat() {
    const box = $("#supportChat");
    if (!box) return;
    box.innerHTML = supportThread.length
      ? supportThread.map((row) => `<p class="support-line support-line--${row.role}"><b>${row.role === "user" ? "Вы" : "Локус"}</b> ${esc(row.text)}</p>`).join("")
      : `<p class="field-hint">Спросите про тариф, что публикуется и чего Локус не делает. Письмо не уйдёт.</p>`;
    box.scrollTop = box.scrollHeight;
  }

  async function loadSupportTickets() {
    renderSupportChat();
  }

  $("#issueInvoice")?.addEventListener("click", () => createInvoice($("#invoicePlan")?.value || "Стартовый"));

  $("#invoiceList")?.addEventListener("click", async (event) => {
    const pay = event.target.closest("[data-pay]");
    const cancel = event.target.closest("[data-cancel-invoice]");
    const id = pay?.dataset.pay || cancel?.dataset.cancelInvoice;
    if (!id || !activeOrgId) return;
    const action = pay ? "pay" : "cancel";
    try {
      await apiJson(`/api/orgs/${activeOrgId}/invoices/${id}/${action}`, { method: "POST", body: {} });
      loadInvoices();
      if (action === "pay") location.reload();
    } catch (err) {
      if ($("#invoiceNote")) $("#invoiceNote").textContent = err.message || "Не удалось обновить счёт.";
    }
  });

  function applyUsage(limits = {}) {
    const pairs = {
      "Тексты и новости": [limits.usedTexts, limits.texts],
      "Изображения": [limits.usedImages, limits.images],
      "Ответы": [limits.usedReplies, limits.replies],
      "Товары и услуги": [limits.usedProducts, limits.products],
      "Фразы в ядре": [limits.usedPhrases, limits.phrases],
    };
    $$(".usage-row").forEach((row) => {
      const label = row.querySelector("span")?.textContent.trim() || "";
      const pair = pairs[label] || (label.startsWith("Ответы") ? [limits.usedReplies, limits.replies] : null);
      if (!pair) return;
      const [used, total] = pair.map((x) => Number(x) || 0);
      const value = row.querySelector("b");
      if (value) value.textContent = `${used} / ${total}`;
      const bar = row.nextElementSibling?.querySelector("i");
      if (bar) bar.style.width = `${total ? Math.min(100, Math.round((used / total) * 100)) : 0}%`;
    });
    const phrasesUsed = Number(limits.usedPhrases) || 0;
    const phrasesTotal = Number(limits.phrases) || 0;
    if ($("#usageNote")) {
      $("#usageNote").textContent = phrasesTotal && phrasesUsed / phrasesTotal >= 0.8
        ? "Ядро почти достигло лимита тарифа. Дополнительный пакет фраз можно подключить без смены тарифа."
        : `Фразы в ядре: ${phrasesUsed} из ${phrasesTotal} в этом месяце. В следующем месяце запас снова полный.`;
    }
  }

  $("#supportSend")?.addEventListener("click", async () => {
    const btn = $("#supportSend");
    const result = $("#supportResult");
    const message = String($("#supportMessage")?.value || "").trim();
    if (!activeOrgId) return;
    if (message.length < 2) {
      if (result) result.textContent = "Напишите вопрос.";
      return;
    }
    const first = !supportThread.some((row) => row.role === "user");
    if (first && !$("#supportConsent")?.checked) {
      if (result) result.textContent = "Нужно согласие на обработку данных.";
      return;
    }
    if (btn) btn.disabled = true;
    if (result) result.textContent = "";
    supportThread.push({ role: "user", text: message });
    renderSupportChat();
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/support/chat`, { method: "POST", body: { message, pdConsent: true } });
      supportThread.push({ role: "locus", text: data.answer || "Ответ собран из фактов кабинета." });
      if ($("#supportMessage")) $("#supportMessage").value = "";
      const consent = $("#supportConsentRow");
      if (consent) consent.hidden = true;
      renderSupportChat();
    } catch (err) {
      supportThread.pop();
      renderSupportChat();
      if (result) result.textContent = err.message || "Чат не ответил.";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#ovHoursForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("#ovHoursMsg");
    const hoursWeekdays = String($("#ovHoursWeekdays")?.value || "").trim();
    const hoursWeekends = String($("#ovHoursWeekends")?.value || "").trim();
    const hoursHolidays = String($("#ovHoursHolidays")?.value || "").trim();
    if (!activeOrgId) return;
    if (![hoursWeekdays, hoursWeekends, hoursHolidays].some((part) => part.length >= 2)) {
      if (msg) msg.textContent = "Часы пустые. Напишите будни, выходные и праздники.";
      return;
    }
    const button = event.currentTarget.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/profile`, { method: "PATCH", body: { card: { hoursWeekdays, hoursWeekends, hoursHolidays } } });
      currentOrg = { ...currentOrg, ...data.org };
      paintCardSurfaces(currentOrg);
      if (msg) msg.textContent = "Часы записаны. Телефон и часы человек видит, когда карточку уже открыл. В поиск карточка попадает текстами.";
      toast("Часы записаны", "Локус возьмёт их в тексты. В Карты это само не уходит.");
      await loadOverview();
    } catch (err) {
      if (msg) msg.textContent = err.message || "Не удалось сохранить часы.";
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#disconnectCard")?.addEventListener("click", () => {
    const message = $("#supportMessage");
    if (message && !message.value.trim()) message.value = "Нужно остановить работу кабинета. Карточку в Яндекс.Картах это само не снимет.";
    toast("Карточка в Яндексе остаётся", "Отключение из Локуса не снимает карточку с Карт. Напишите в чат.");
    document.querySelector(".support-card")?.scrollIntoView({ block: "nearest" });
    setTimeout(() => $("#supportMessage")?.focus(), 60);
  });

  $("#analyticsReport")?.addEventListener("click", (event) => {
    const href = event.currentTarget.getAttribute("href") || "";
    if (!href || href === "#") {
      event.preventDefault();
      toast("Отчёт недоступен", serverActive ? "Недельный отчёт откроется, когда организация загрузится." : apiMissingText());
    }
  });

  function syncStopWords(fromId) {
    const box = $("#minusWords");
    const field = $("#voiceStop");
    if (!box || !field) return;
    if (fromId === "minusWords") field.value = box.value;
    else box.value = field.value;
    const key = settingsKey();
    if (key) localStorage.setItem(key, JSON.stringify(collectSettings()));
  }
  $("#minusWords")?.addEventListener("input", () => syncStopWords("minusWords"));
  $("#voiceStop")?.addEventListener("input", () => syncStopWords("voiceStop"));
  if ($("#minusWords") && $("#voiceStop") && !$("#minusWords").value.trim()) $("#minusWords").value = $("#voiceStop").value;

  $("#saveSettings")?.addEventListener("click", () => {
    const key = settingsKey();
    if (!key) return;
    if ($("#minusWords") && $("#voiceStop")) $("#voiceStop").value = $("#minusWords").value;
    localStorage.setItem(key, JSON.stringify(collectSettings()));
    toast("Сохранено", "Следующий ответ возьмёт выбранный тон.");
  });

  /* ---------- settings ---------- */
  $$(".switch-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
      if (btn.dataset.locked || btn.disabled || btn.getAttribute("aria-disabled") === "true") {
        showView(btn.dataset.ruleGo || "autopilot");
        return;
      }
      const next = btn.getAttribute("aria-checked") !== "true";
      btn.setAttribute("aria-checked", String(next));
    });
  });


  /* ================= СТУДИЯ: ИЗОБРАЖЕНИЯ, НОВОСТИ, ПРАЙС ================= */
  async function apiJson(path, options = {}) {
    const opts = { credentials: "same-origin", headers: { Accept: "application/json" }, ...options };
    if (opts.body && typeof opts.body !== "string") {
      opts.headers = { ...opts.headers, "Content-Type": "application/json" };
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const providerText = typeof data?.error === "string" ? data.error : "";
      const hostDown = !data && (res.status === 530 || res.status === 502 || res.status === 503 || res.status === 504);
      const error = new Error(providerText || (hostDown || res.status >= 500 ? "Сервер кабинета сейчас не отвечает." : `Не получилось: ${res.status}`));
      error.code = data?.code || "HTTP";
      error.status = res.status;
      error.payload = data;
      throw error;
    }
    return data || {};
  }

  function splitTags(value) {
    return String(value || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
  }

  function setQuota(el, used, total, label) {
    if (!el) return;
    el.textContent = `${label}: ${used} / ${total}`;
    el.classList.toggle("quota-chip--low", total > 0 && used / total >= 0.8);
  }

  const FALLBACK_IMAGE_PROVIDERS = [
    { id: "nano-banana", name: "Nano Banana (Google)", configured: false, note: "Ключ GEMINI_API_KEY не задан." },
    { id: "gptunnel", name: "Nano Banana (РФ, GPTunnel)", configured: false, note: "Ключ GPTUNNEL_API_KEY не задан." },
    { id: "yandex-art", name: "YandexART", configured: false, note: "Ключ Yandex Cloud не задан." },
    { id: "openai", name: "OpenAI Images", configured: false, note: "Ключ OPENAI_API_KEY не задан." },
    { id: "bfl", name: "FLUX (BFL)", configured: false, note: "Ключ BFL_API_KEY не задан." },
    { id: "recraft", name: "Recraft", configured: false, note: "Ключ RECRAFT_API_KEY не задан." },
  ];

  let imageProviders = [];
  let imageAssets = [];
  let selectedImageId = null;
  let imageLimits = null;

  function currentImageAsset() {
    return imageAssets.find((x) => Number(x.id) === Number(selectedImageId)) || null;
  }

  function renderImageProviders() {
    const select = $("#imageProvider");
    if (!select) return;
    select.innerHTML = imageProviders.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.configured ? "" : " — не подключён"}</option>`).join("");
    const preferred = imageProviders.find((p) => p.configured) || imageProviders[0];
    if (preferred) select.value = preferred.id;
    const note = $("#imageProviderNote");
    if (note) {
      const p = imageProviders.find((x) => x.id === select.value) || preferred;
      note.textContent = p?.configured
        ? "Ключ найден. Кадры уходят провайдеру; люди, текст и логотипы запрещены промптом."
        : "Ключа нет. Кадр берётся из 12 миров ниши. Это не публикация в Картах.";
    }
    select.onchange = () => {
      const p = imageProviders.find((x) => x.id === select.value);
      if (note) note.textContent = p?.configured
        ? "Ключ найден. Кадры уходят провайдеру; люди, текст и логотипы запрещены промптом."
        : "Ключа нет. Кадр берётся из 12 миров ниши. Это не публикация в Картах.";
    };
  }

  function renderPublicCardPhotos() {
    const box = $("#publicCardPhotos");
    const note = $("#publicCardPhotosNote");
    const images = Array.isArray(currentOrg?.publicImages) ? currentOrg.publicImages.slice(0, 6) : [];
    if (box) {
      box.hidden = images.length === 0;
      box.innerHTML = images.map((src, index) => `<a class="image-tile" href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Кадр ${index + 1} с публичной страницы" loading="lazy"></a>`).join("");
    }
    if (note) note.hidden = images.length === 0;
  }

  function renderImageGallery() {
    const box = $("#imageGallery");
    const count = $("#imageCount");
    if (!box) return;
    if (count) count.textContent = `${imageAssets.length} ${imageAssets.length === 1 ? "изображение" : imageAssets.length < 5 ? "изображения" : "изображений"}`;
    if (!imageAssets.length) {
      box.innerHTML = `<div class="empty-state"><span class="empty-ico">✦</span><strong>Пока пусто</strong><p>Сгенерируйте обложку, интерьер или деталь. Кадры появятся здесь с alt и ключевыми словами.</p></div>`;
      const meta = $("#imageMetaCard");
      if (meta) meta.hidden = true;
      return;
    }
    box.innerHTML = imageAssets.map((img) => {
      const uploaded = img.provider === "upload" && !/svg/i.test(String(img.mime || ""));
      const slotLabel = { logo: "В логотип", entrance: "Вход", inside: "Внутри", work: "Работа", outside: "Снаружи" };
      const assign = uploaded
        ? `<div class="image-assign">${Object.keys(slotLabel).map((slot) => `<button class="mini-btn" type="button" data-assign-slot="${slot}" data-assign-image="${Number(img.id)}">${slotLabel[slot]}</button>`).join("")}</div>`
        : "";
      return `<div class="image-tile-wrap">
      <button class="image-tile ${Number(img.id) === Number(selectedImageId) ? "is-selected" : ""}" type="button" data-image-id="${Number(img.id)}" aria-pressed="${Number(img.id) === Number(selectedImageId)}">
        <img src="${esc(img.url)}" alt="${esc(img.alt || "Изображение")}" loading="lazy">
        <span class="image-tile-meta"><b>${esc((img.keywords || [])[0] || img.title || "Кадр")}</b><small>${esc(img.format || "файл")} · ${esc(img.provider)}</small></span>
      </button>${assign}</div>`;
    }).join("");
  }

  function selectImage(id) {
    selectedImageId = Number(id);
    const asset = currentImageAsset();
    renderImageGallery();
    const card = $("#imageMetaCard");
    if (!asset) {
      if (card) card.hidden = true;
      if ($("#downloadImage")) $("#downloadImage").hidden = true;
      return;
    }
    if (card) card.hidden = false;
    if ($("#imageAlt")) $("#imageAlt").value = asset.alt || "";
    if ($("#imageTitle")) $("#imageTitle").value = asset.title || "";
    if ($("#imageKeywords")) $("#imageKeywords").value = (asset.keywords || []).join(", ");
    if ($("#downloadImage")) {
      $("#downloadImage").hidden = false;
      $("#downloadImage").href = `${asset.url}/download`;
    }
    if ($("#imageMetaStatus")) $("#imageMetaStatus").textContent = "";
  }

  async function loadImages() {
    if (!activeOrgId) {
      imageProviders = FALLBACK_IMAGE_PROVIDERS;
      renderImageProviders();
      if ($("#imageStatus")) $("#imageStatus").textContent = "Сначала подключите карточку — тогда появятся сцены и лимиты.";
      return;
    }
    try {
      const [catalog, list] = await Promise.all([
        apiJson(`/api/orgs/${activeOrgId}/imagegen`),
        apiJson(`/api/orgs/${activeOrgId}/images`),
      ]);
      lookCatalog = catalog.looks || lookCatalog;
      imageProviders = (catalog.providers || []).length ? catalog.providers : FALLBACK_IMAGE_PROVIDERS;
      imageAssets = list.images || [];
      imageLimits = list.limits || catalog.limits || null;
      renderImageProviders();
      renderPublicCardPhotos();
      renderImageGallery();
      if (imageLimits) setQuota($("#imageQuota"), imageLimits.usedImages || 0, imageLimits.images || 0, "Изображения");
      if ($("#imageStatus")) {
        const configured = imageProviders.filter((p) => p.configured).length;
        $("#imageStatus").textContent = configured
          ? `Подключено провайдеров: ${configured}. Генерация занимает до минуты.`
          : "Ключа провайдера нет: три кадра берутся из набора миров этой ниши. В Карты они сами не уходят.";
      }
    } catch (err) {
      imageProviders = FALLBACK_IMAGE_PROVIDERS;
      renderImageProviders();
      if ($("#imageStatus")) $("#imageStatus").textContent = err.message;
    }
  }

  async function generateImages(fromQueue = false) {
    if (!activeOrgId) { toast("Нет карточки", "Подключите карточку в настройках."); return; }
    const sceneLabel = $("#imageScene")?.selectedOptions?.[0]?.textContent?.trim() || $("#imageScene")?.value || "кадр";
    if (!fromQueue) {
      const label = `Изображения · «${sceneLabel}»`;
      if (!enqueueImageJob(label, () => generateImages(true))) return;
      const status = $("#imageStatus");
      if (imageJobRunning && imageJobQueue.length && status) status.textContent = `В очереди: ${label}.`;
      return;
    }
    const btn = $("#generateImages");
    const btn2 = $("#generateImagesBottom");
    const provider = $("#imageProvider")?.value || "openai";
    const status = $("#imageStatus");
    if (status) status.textContent = "Собираем промпт и отправляем провайдеру…";
    try {
      const refs = String($("#imageRefs")?.value || "").split(/[\s,]+/).filter(Boolean).slice(0, 2);
      const data = await apiJson(`/api/orgs/${activeOrgId}/images`, {
        method: "POST",
        body: {
          provider,
          scene: $("#imageScene")?.value || "hero",
          format: $("#imageFormat")?.value || "9:16",
          extra: $("#imageExtra")?.value || "",
          references: refs,
          count: 3,
          ...lookPayload(),
        },
      });
      if (status) status.textContent = "Готово. Проверьте кадры и заполните alt.";
      noteGenerated({
        target: "stories",
        kind: "image",
        title: `Изображения · «${sceneLabel}»`,
        text: "Кадр собран и лежит в галерее.",
        key: `gallery:${data.images?.[0]?.id || Date.now()}`,
      });
      toast("Изображения готовы", "3 кадра в одной стилистике. Проверьте alt и ключевые слова.");
      await loadImages();
      if (data.images?.[0]) selectImage(data.images[0].id);
    } catch (err) {
      const message = err.code === "PROVIDER_NOT_CONFIGURED"
        ? "Провайдер не подключён. Смените провайдера или добавьте ключ в env — без него реальная генерация не запускается."
        : err.message;
      if (status) status.textContent = message;
      toast("Генерация не запущена", message);
      await loadImages();
    } finally {
      [btn, btn2].forEach((b) => { if (b) b.disabled = false; });
    }
  }

  async function saveImageMeta() {
    const asset = currentImageAsset();
    if (!asset || !activeOrgId) return;
    try {
      await apiJson(`/api/orgs/${activeOrgId}/images/${asset.id}`, {
        method: "PATCH",
        body: {
          alt: $("#imageAlt")?.value || "",
          title: $("#imageTitle")?.value || "",
          keywords: splitTags($("#imageKeywords")?.value || ""),
          category: asset.category || "",
        },
      });
      asset.alt = $("#imageAlt")?.value || "";
      asset.title = $("#imageTitle")?.value || "";
      asset.keywords = splitTags($("#imageKeywords")?.value || "");
      if ($("#imageMetaStatus")) $("#imageMetaStatus").textContent = "Сохранено";
      renderImageGallery();
      toast("Теги сохранены", "Alt и ключевые слова обновлены. В фото Карт отдельного alt нет.");
    } catch (err) {
      if ($("#imageMetaStatus")) $("#imageMetaStatus").textContent = err.message;
    }
  }

  /* ---------- новости ---------- */
  let newsDrafts = [];
  let newsTopicCache = [];
  let customNewsTopics = [];
  let selectedNewsTopic = "";
  let newsTemplateCache = [];
  let selectedNewsTemplate = "";
  let newsTemplateSearch = "";

  function customNewsTopicsKey() { return activeOrgId ? `locus:news:custom:${activeOrgId}` : ""; }
  function readCustomNewsTopics() {
    try {
      const list = JSON.parse(localStorage.getItem(customNewsTopicsKey()) || "[]");
      return Array.isArray(list) ? list.filter((t) => t && t.title).slice(0, 10) : [];
    } catch { return []; }
  }
  function saveCustomNewsTopics() {
    try { localStorage.setItem(customNewsTopicsKey(), JSON.stringify(customNewsTopics.slice(0, 10))); } catch { /* ignore */ }
  }
  let currentNewsId = null;

  let newsNicheCache = "";
  let newsOnlyNiche = false;
  let newsCatalogCache = null;

  const newsNicheLabels = { dentistry: "Стоматология", cosmetology: "Косметология", beauty: "Салон красоты", barber: "Барбершоп", coffee: "Кофейня", retail: "Магазин", construction: "Строительство", auto: "Автосалон", medical: "Медицина", default: "Универсальные" };

  function renderTemplatePicker(templates, groups, currentNiche) {
    const list = $("#newsTemplateList");
    const empty = $("#newsTemplateEmpty");
    const label = $("#newsTemplateLabel");
    if (!list) return;
    const groupLabels = Object.fromEntries((groups || []).map((g) => [g.id, g.label]));
    const current = templates.find((t) => t.id === selectedNewsTemplate);
    if (label) {
      label.textContent = current?.preview || current?.titlePattern || "Авто: подобрать по теме";
      const kicker = label.closest(".template-picker-btn")?.querySelector(".template-picker-kicker");
      if (kicker) kicker.textContent = current ? `${groupLabels[current.group] || newsNicheLabels[current.niche] || "Сценарий"} · ${(current.structure || []).length} блоков` : "Выбрать сценарий";
    }
    const query = newsTemplateSearch.trim().toLowerCase();
    const visible = templates.filter((t) => {
      if (!query) return true;
      return [t.preview, t.titlePattern, t.description, groupLabels[t.group], newsNicheLabels[t.niche]].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
    if (empty) empty.hidden = visible.length > 0;
    const grouped = new Map();
    for (const t of visible) {
      const key = t.group || "other";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(t);
    }
    const groupOrder = [...new Set([...(groups || []).map((g) => g.id), ...grouped.keys()])];
    let html = "";
    for (const group of groupOrder) {
      const items = grouped.get(group);
      if (!items?.length) continue;
      html += `<div class="template-group"><span class="template-group-title">${esc(groupLabels[group] || "Другие сценарии")}</span>`;
      html += items.map((t) => {
        const selected = t.id === selectedNewsTemplate;
        return `<button class="template-option${selected ? " is-selected" : ""}" type="button" role="option" aria-selected="${selected}" data-template-id="${esc(t.id)}">
          <span class="template-option-head"><span class="template-badge">${esc(newsNicheLabels[t.niche] || "Универсальный")}</span><span class="template-option-meta">${(t.structure || []).length} блоков</span></span>
          <strong>${esc(t.preview || t.titlePattern || t.id)}</strong>
          <span class="template-option-desc">${esc(t.description || "Сценарий для карточки")}</span>
        </button>`;
      }).join("");
      html += `</div>`;
    }
    list.innerHTML = html;
  }

  function setNewsTemplate(id) {
    selectedNewsTemplate = id || "";
    if ($("#newsTemplate")) $("#newsTemplate").value = selectedNewsTemplate;
    const current = newsTemplateCache.find((t) => t.id === selectedNewsTemplate);
    if ($("#newsTemplateHint")) {
      $("#newsTemplateHint").textContent = current
        ? `${current.description || "Сценарий для карточки"} Блоков: ${(current.structure || []).length}.`
        : "Шаблон задаёт структуру и SEO-абзац; факты подставляются из карточки.";
    }
    renderTemplatePicker(newsTemplateCache, newsCatalogCache?.groups || [], newsNicheCache);
  }

  function closeTemplatePicker() {
    const panel = $("#newsTemplatePanel");
    const btn = $("#newsTemplateBtn");
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function renderNewsTemplates(catalog) {
    const select = $("#newsTemplate");
    if (!select) return;
    newsCatalogCache = catalog || null;
    const allTemplates = Array.isArray(catalog?.templates) ? catalog.templates : [];
    const currentNiche = catalog?.niche || "";
    newsNicheCache = currentNiche;
    const medicalNiche = new Set(["dentistry", "cosmetology", "medical"]);
    const templates = allTemplates.filter((t) => {
      if ((t.niche === "medical" || /^medical-/.test(String(t.id || ""))) && !medicalNiche.has(currentNiche)) return false;
      if (newsOnlyNiche && currentNiche !== "default") return t.niche === currentNiche || t.niche === "default";
      return true;
    });
    newsTemplateCache = templates;
    const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
    const nicheLabels = { dentistry: "Стоматология", cosmetology: "Косметология", beauty: "Салон красоты", barber: "Барбершоп", coffee: "Кофейня", retail: "Магазин", construction: "Строительство", auto: "Автосалон", medical: "Медицина", default: "Универсальные" };
    const groupLabels = Object.fromEntries(groups.map((g) => [g.id, g.label]));
    const nicheOrder = [currentNiche, ...Object.keys(nicheLabels).filter((n) => n !== currentNiche)];
    const grouped = new Map();
    for (const t of templates) {
      if (!grouped.has(t.niche)) grouped.set(t.niche, []);
      grouped.get(t.niche).push(t);
    }
    let html = `<option value="">Авто: подобрать по теме</option>`;
    for (const niche of nicheOrder) {
      const list = grouped.get(niche);
      if (!list?.length) continue;
      html += `<optgroup label="${esc(nicheLabels[niche] || niche)}${niche === currentNiche ? " · ваша ниша" : ""}">`;
      html += list.map((t) => `<option value="${esc(t.id)}">${esc(groupLabels[t.group] ? `${groupLabels[t.group]} · ` : "")}${esc(t.preview || t.titlePattern || t.id)}</option>`).join("");
      html += `</optgroup>`;
    }
    select.innerHTML = html;
    if (selectedNewsTemplate && templates.some((t) => t.id === selectedNewsTemplate)) select.value = selectedNewsTemplate;
    renderTemplatePicker(templates, groups, currentNiche);
    if ($("#newsTemplateMeta")) {
      const nicheCount = templates.filter((t) => t.niche === currentNiche).length;
      $("#newsTemplateMeta").textContent = newsOnlyNiche
        ? `${nicheCount} сценариев для вашей ниши + ${templates.length - nicheCount} универсальных · снимите галочку, чтобы увидеть все 100`
        : `${templates.length} шаблонов · ${allTemplates.filter((t) => t.niche === currentNiche).length} для вашей ниши`;
    }
    if ($("#newsTemplateHint")) {
      const current = templates.find((t) => t.id === selectedNewsTemplate);
      $("#newsTemplateHint").textContent = current
        ? `${current.description} Блоков: ${(current.structure || []).length}.`
        : "Шаблон задаёт структуру и SEO-абзац; факты подставляются из карточки.";
    }
  }

  $("#newsTemplate")?.addEventListener("change", (event) => {
    setNewsTemplate(event.target.value || "");
  });

  $("#newsTemplateBtn")?.addEventListener("click", () => {
    const panel = $("#newsTemplatePanel");
    const btn = $("#newsTemplateBtn");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (btn) btn.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      newsTemplateSearch = "";
      if ($("#newsTemplateSearch")) $("#newsTemplateSearch").value = "";
      renderTemplatePicker(newsTemplateCache, newsCatalogCache?.groups || [], newsNicheCache);
      setTimeout(() => $("#newsTemplateSearch")?.focus(), 30);
    }
  });
  $("#newsTemplateSearch")?.addEventListener("input", (event) => {
    newsTemplateSearch = event.target.value || "";
    renderTemplatePicker(newsTemplateCache, newsCatalogCache?.groups || [], newsNicheCache);
  });
  $("#newsTemplateList")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-template-id]");
    if (!option) return;
    setNewsTemplate(option.dataset.templateId);
    closeTemplatePicker();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#newsTemplatePicker")) closeTemplatePicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTemplatePicker();
  });
  $("#newsOnlyNiche")?.addEventListener("change", (event) => {
    newsOnlyNiche = Boolean(event.target.checked);
    if (newsOnlyNiche && selectedNewsTemplate && !newsTemplateCache.some((t) => t.id === selectedNewsTemplate)) {
      selectedNewsTemplate = "";
      if ($("#newsTemplate")) $("#newsTemplate").value = "";
    }
    if (newsCatalogCache) renderNewsTemplates(newsCatalogCache);
    if (selectedNewsTemplate && $("#newsTemplate")) $("#newsTemplate").value = selectedNewsTemplate;
  });

  function renderNewsTopics() {
    const box = $("#newsTopicList");
    if (!box) return;
    if (!newsTopicCache.length) { box.innerHTML = `<p class="field-hint">Нет тем. Проверьте карточку и нишу.</p>`; return; }
    if (!selectedNewsTopic || !newsTopicCache.some((t) => t.id === selectedNewsTopic)) selectedNewsTopic = newsTopicCache[0].id;
    box.innerHTML = newsTopicCache.map((topic) => {
      const isWordstat = topic.source === "wordstat";
      const meta = topic.custom
        ? "своя тема"
        : isWordstat
          ? (Number(topic.popular) > 0 ? `ядро · ${Number(topic.popular).toLocaleString("ru-RU")}` : "фраза из ядра")
          : `${topic.activeSeason ? "сезон · " : ""}тема ниши`;
      return `
      <button type="button" class="topic-item ${topic.id === selectedNewsTopic ? "is-selected" : ""}" data-topic-id="${esc(topic.id)}" aria-pressed="${topic.id === selectedNewsTopic}">
        <span><strong>${esc(topic.title)}</strong><small>${meta}</small></span>
        <b>${isWordstat ? "спрос" : topic.activeSeason ? "сейчас" : "в плане"}</b>
      </button>`;
    }).join("");
  }

  function renderNewsList() {
    const box = $("#newsList");
    if (!box) return;
    if (!newsDrafts.length) {
      box.innerHTML = `<p class="field-hint">Пока нет новостей. Соберите первую — это займёт минуту.</p>`;
      return;
    }
    const seenHeadlines = new Set();
    const visibleDrafts = newsDrafts.filter((n) => {
      const key = String(n.headline || "").trim().toLowerCase();
      if (key && seenHeadlines.has(key)) return false;
      if (key) seenHeadlines.add(key);
      return true;
    });
    box.innerHTML = visibleDrafts.map((n) => `
      <button type="button" class="news-row" data-news-id="${Number(n.id)}">
        <span class="news-row-date">${esc(String(n.created_at || "").slice(0, 10))}</span>
        <span class="news-row-copy"><strong>${esc(n.headline || "Без заголовка")}</strong><small>Карты · ${esc((n.keywords || []).join(", "))}</small></span>
        <span class="st st--new">${esc(n.status === "draft" ? "черновик" : n.status === "queued" || n.status === "published" ? "В кабинете, не в Картах" : n.status)}</span>
      </button>`).join("");
  }

  function setNewsImagePreview(imageId) {
    const box = $("#newsImagePreview");
    const img = $("#newsImagePreviewImg");
    if (!box || !img) return;
    const asset = imageAssets.find((x) => Number(x.id) === Number(imageId));
    if (!asset) { box.hidden = true; img.removeAttribute("src"); return; }
    img.src = asset.url || `/api/orgs/${activeOrgId}/images/${asset.id}`;
    img.alt = asset.alt || "Обложка новости";
    const cap = $("#newsPosterType");
    if (cap) cap.innerHTML = `<strong>${esc($("#newsHeadline")?.value.trim() || "Новость")}</strong>`;
    box.hidden = false;
  }

  function fillNewsEditor(n) {
    currentNewsId = Number(n.id);
    if ($("#newsHeadline")) $("#newsHeadline").value = n.headline || "";
    if ($("#newsBody")) $("#newsBody").value = n.body || "";
    if ($("#newsKeywords")) $("#newsKeywords").value = (n.keywords || []).join(", ");
    if ($("#newsImage")) $("#newsImage").value = n.image_id ? String(n.image_id) : "";
    setNewsImagePreview(n.image_id);
    const ownerNote = n.ownerNote || n.owner_note || "";
    if ($("#newsOwnerNote")) $("#newsOwnerNote").hidden = !ownerNote;
    if ($("#newsOwnerNoteText") && ownerNote) $("#newsOwnerNoteText").textContent = ownerNote;
    if ($("#newsStatus")) $("#newsStatus").textContent = `Для Яндекс.Карт · ${String(n.created_at || "").slice(0, 10)}`;
    updateNewsCount();
    syncNewsPublish();
  }

  function updateNewsCount() {
    const body = $("#newsBody")?.value || "";
    if ($("#newsBodyCount")) $("#newsBodyCount").textContent = `${body.length} / 3000`;
    syncNewsPublish();
  }

  function syncNewsPublish() {
    const btn = $("#newsPublish");
    if (!btn) return;
    const body = $("#newsBody")?.value.trim() || "";
    const draft = newsDrafts.find((n) => Number(n.id) === Number(currentNewsId));
    const queued = draft?.status === "queued";
    btn.disabled = false;
    btn.classList.toggle("is-blocked", body.length < 120 || queued);
    btn.title = queued ? "Новость уже в очереди" : body.length < 120 ? "Для публикации нужно минимум 120 знаков" : "";
    btn.textContent = queued ? "В кабинете, не в Картах" : "Оставить в кабинете";
    if ($("#newsSaveStatus") && body.length > 0 && body.length < 120) {
      $("#newsSaveStatus").textContent = "Для публикации нужно минимум 120 знаков.";
    }
  }

  async function loadNews() {
    if (!activeOrgId) return;
    if (!imageAssets.length) {
      try {
        const list = await apiJson(`/api/orgs/${activeOrgId}/images`);
        imageAssets = list.images || [];
      } catch { /* новости не блокируем */ }
    }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/news`);
      newsDrafts = data.news || [];
      renderNewsTemplates(data.templates);
      const freshTopics = data.topics || [];
      if (!customNewsTopics.length) customNewsTopics = readCustomNewsTopics();
      const custom = customNewsTopics.filter((t) => !freshTopics.some((x) => x.title.toLowerCase() === t.title.toLowerCase()));
      newsTopicCache = [...custom, ...freshTopics];
      renderNewsTopics();
      renderNewsList();
      renderNewsReminder();
      syncNewsPublish();
      if (data.limits) setQuota($("#newsQuota"), data.limits.usedTexts || 0, data.limits.texts || 0, "Тексты");
      const select = $("#newsImage");
      if (select) {
        const current = select.value;
        const seenImages = new Set();
        const imageOptions = imageAssets.filter((img) => {
          const key = String(img.alt || img.url || img.id).trim().toLowerCase();
          if (seenImages.has(key)) return false;
          seenImages.add(key);
          return true;
        });
        select.innerHTML = `<option value="">Без изображения</option>` + imageOptions.map((img) => `<option value="${Number(img.id)}">${esc(img.alt || `Кадр ${img.id}`)}</option>`).join("");
        if (current) select.value = current;
      }
      if (!currentNewsId && newsDrafts[0]) fillNewsEditor(newsDrafts[0]);
    } catch (err) {
      if ($("#newsStatus")) $("#newsStatus").textContent = err.message;
    }
  }

  function nextNewsDate() {
    const dates = (newsDrafts || [])
      .map((n) => new Date(n.created_at || 0).getTime())
      .filter((t) => Number.isFinite(t) && t > 0)
      .sort((a, b) => b - a);
    const base = dates[0] || (Date.now() - 7 * 24 * 60 * 60 * 1000);
    return new Date(base + 7 * 24 * 60 * 60 * 1000);
  }

  function renderNewsReminder() {
    const next = nextNewsDate();
    const label = next.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    if ($("#newsNextDate")) $("#newsNextDate").textContent = label;
    const due = next.getTime() <= Date.now();
    if ($("#newsReminderStatus")) {
      $("#newsReminderStatus").textContent = due
        ? "Пора опубликовать новость недели."
        : `Следующая по плану: ${label}.`;
    }
  }

  async function checkWeeklyNewsReminder() {
    if (!serverActive || !activeOrgId) return;
    try {
      if (!newsDrafts.length) {
        const data = await apiJson(`/api/orgs/${activeOrgId}/news`);
        newsDrafts = data.news || [];
      }
      renderNewsReminder();
      const next = nextNewsDate();
      if (next.getTime() > Date.now()) return;
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 1);
      const week = Math.ceil((((now - start) / 86400000) + start.getDay() + 1) / 7);
      const key = `locus:news:reminded:${activeOrgId}:${now.getFullYear()}-W${week}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
      toast("Новость недели", "Пора опубликовать одну новость — это поддерживает карточку живой. Рекомендуем раз в неделю.");
    } catch { /* напоминание не блокирует кабинет */ }
  }

  async function enableNewsReminder() {
    const orgKey = activeOrgId || "demo";
    localStorage.setItem(`locus:news:weekly:${orgKey}`, "1");
    let permission = "unsupported";
    if ("Notification" in window) {
      try { permission = await Notification.requestPermission(); } catch { permission = "denied"; }
      if (permission === "granted") {
        try {
          new Notification("Локус: новость недели", {
            body: "Пора опубликовать одну новость. Рекомендуемый ритм — раз в неделю.",
            tag: `locus-news-${orgKey}`,
          });
        } catch { /* браузер может запретить уведомление без service worker */ }
      }
    }
    if ($("#newsReminderStatus")) {
      $("#newsReminderStatus").textContent = permission === "granted"
        ? "Браузерное напоминание включено; в кабинете проверяем раз в неделю."
        : "Напоминание включено в кабинете: покажем при следующем входе.";
    }
    toast(
      "Напоминание включено",
      permission === "granted" ? "Разрешение браузера получено. Показываем раз в неделю." : "В кабинете покажем напоминание при следующем входе."
    );
  }

  function addCustomNewsTopic() {
    const input = $("#newsCustomTopic");
    const title = String(input?.value || "").trim().slice(0, 80);
    if (!title) { toast("Введите тему", "Например: «кофейня с собакой» или фразу из Wordstat."); return; }
    const existing = newsTopicCache.find((t) => t.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      selectedNewsTopic = existing.id;
    } else {
      const topic = { id: `custom-${Date.now()}`, title, source: "wordstat", popular: 0, custom: true, activeSeason: true };
      customNewsTopics.push(topic);
      saveCustomNewsTopics();
      newsTopicCache.unshift(topic);
      selectedNewsTopic = topic.id;
    }
    renderNewsTopics();
    if (input) input.value = "";
    toast("Тема добавлена", `«${title}» появилась в списке тем.`);
  }
  $("#newsAddTopic")?.addEventListener("click", addCustomNewsTopic);
  $("#newsCustomTopic")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addCustomNewsTopic(); }
  });

  function renderNewsImageChoices(images) {
    const box = $("#newsImageChoices");
    if (!box) return;
    if (!images.length) { box.hidden = true; box.innerHTML = ""; return; }
    const headline = esc($("#newsHeadline")?.value.trim() || "Новость");
    box.innerHTML = `<span class="news-image-choices-label">${images.length} ${pluralRu(images.length, "вариант", "варианта", "вариантов")} — смотрите крупно</span><div class="news-image-choice-row">${images.map((image) => `<button type="button" class="news-image-choice poster-frame" data-news-image-choice="${Number(image.id)}" aria-pressed="false"><img src="${esc(image.url)}" alt="${esc(image.alt || "Обложка новости")}" loading="lazy" data-shot-open="${esc(image.url)}" data-shot-title="${headline}"><span class="poster-type"><strong>${headline}</strong></span></button>`).join("")}</div>`;
    box.hidden = false;
  }

  function newsCoverLine(images, errorText) {
    const frames = (Array.isArray(images) ? images : []).filter((image) => image?.url && !/svg/i.test(String(image.mime || "")));
    const shotError = String(errorText || "").trim();
    if (frames.length >= 3 && !shotError) return "Три обложки готовы. Выберите кадр.";
    return `Собрали ${frames.length} из 3.${shotError ? ` ${shotError}` : ""}`;
  }

  function showNewsCoverStatus(images, errorText) {
    const line = newsCoverLine(images, errorText);
    const node = $("#newsImageStatus");
    if (node) node.textContent = line;
    return line;
  }

  async function generateNewsImage(fromQueue = false) {
    if (!activeOrgId) { toast("Нет карточки", "Подключите карточку."); return; }
    const topicLabel = ($("#newsHeadline")?.value.trim() || newsTopicCache.find((t) => t.id === selectedNewsTopic)?.title || "новость").slice(0, 80);
    if (!fromQueue) {
      const label = `Новости · «${topicLabel}»`;
      if (!enqueueImageJob(label, () => generateNewsImage(true))) return;
      const status = $("#newsImageStatus");
      if (imageJobRunning && imageJobQueue.length && status) status.textContent = `В очереди: ${label}.`;
      return;
    }
    const btn = $("#newsGenerateImage");
    const status = $("#newsImageStatus");
    if (status) status.textContent = "Собираем обложку под тему новости…";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    let coverShown = false;
    try {
      const topic = newsTopicCache.find((t) => t.id === selectedNewsTopic)?.title || "";
      const fact = ($("#newsHeadline")?.value.trim() || topic).replace(/(?:\+7|8)[\s().-]*\d(?:[\s().-]*\d){9,}|\+\d(?:[\s().-]*\d){9,}/g, "").trim();
      const price = storyPrice($("#newsBody")?.value || "");
      const provider = imageProviders.find((p) => p.configured)?.id || "grok";
      const data = await apiJson(`/api/orgs/${activeOrgId}/images`, {
        method: "POST",
        signal: controller.signal,
        body: {
          provider,
          scene: fact || "новость",
          format: "16:9",
          placement: "news",
          title: fact,
          price,
          extra: "Реальное место услуги, не крупный кроп материала. Верх темнее под короткий заголовок. Букв, цифр и телефона в кадре нет.",
          count: 3,
          ...lookPayload(),
        },
      });
      const images = (data.images || []).filter((image) => image?.url && !/svg/i.test(String(image.mime || "")));
      const shotError = typeof data.error === "string" ? data.error : (data.error?.message || "");
      const coverLine = showNewsCoverStatus(images, shotError);
      coverShown = true;
      if (!images.length) {
        const box = $("#newsImageChoices");
        const headline = esc($("#newsHeadline")?.value.trim() || "Новость");
        if (box) {
          box.hidden = false;
          box.innerHTML = `<span class="news-image-choices-label">${esc(coverLine)}</span><div class="news-image-choice-row">${[0, 1, 2].map(() => `<div class="news-image-choice poster-frame"><span class="sf-photo sf-photo--empty">Кадр пустой</span><span class="poster-type"><strong>${headline}</strong></span></div>`).join("")}</div>`;
        }
        toast("Обложка не собралась", coverLine);
        return;
      }
      const image = images[0];
      imageAssets = [...images, ...imageAssets.filter((x) => !images.some((y) => Number(y.id) === Number(x.id)))];
      const select = $("#newsImage");
      if (select) {
        const keep = select.querySelector('option[value=""]');
        select.innerHTML = "";
        if (keep) select.appendChild(keep);
        for (const item of images) {
          const option = document.createElement("option");
          option.value = String(item.id);
          option.textContent = item.alt || `Обложка ${item.id}`;
          select.appendChild(option);
        }
        select.value = String(image.id);
      }
      renderNewsImageChoices(images);
      setNewsImagePreview(image.id);
      if (currentNewsId && ($("#newsBody")?.value.trim().length || 0) >= 120) {
        try {
          await apiJson(`/api/orgs/${activeOrgId}/news/${currentNewsId}`, {
            method: "PATCH",
            body: {
              headline: $("#newsHeadline")?.value || "",
              body: $("#newsBody")?.value || "",
              keywords: splitTags($("#newsKeywords")?.value || ""),
              imageId: Number(image.id),
            },
          });
        } catch { /* черновик не затирает уже показанный счётчик кадров */ }
      }
      if (data.limits) setQuota($("#imageQuota"), data.limits.usedImages || 0, data.limits.images || 0, "Изображения");
      const complete = images.length >= 3 && !String(shotError || "").trim();
      showNewsCoverStatus(images, shotError);
      noteGenerated({
        target: "news",
        kind: "image",
        title: `Новости · «${topicLabel}»`,
        text: "Обложка новости собрана.",
        key: `news-image:${image.id || Date.now()}`,
      });
      toast(complete ? "Обложки готовы" : "Обложка собралась не целиком", complete ? "Три варианта — выберите кадр." : coverLine);
    } catch (err) {
      const timedOut = err?.name === "AbortError";
      const kept = (err?.payload?.images || []).filter((image) => image?.url && !/svg/i.test(String(image.mime || "")));
      const shotError = err?.code === "IMAGE_QUOTA"
        ? "Закончилась квота изображений. Смените тариф или докупите пакет."
        : timedOut
          ? "Время ожидания вышло."
          : String(err?.payload?.error || err.message || "").trim();
      const message = showNewsCoverStatus(kept, shotError);
      coverShown = true;
      if (kept.length) renderNewsImageChoices(kept);
      toast(kept.length ? "Обложка собралась не целиком" : "Не получилось собрать обложку", message);
    } finally {
      clearTimeout(timer);
      if (!coverShown) showNewsCoverStatus([], "Кадр не собрался.");
      if (btn) btn.disabled = false;
    }
  }

  async function generateNewsDraft() {
    if (!activeOrgId) { toast("Нет карточки", "Подключите карточку."); return; }
    const btn = $("#newsGenerate");
    if (btn) btn.disabled = true;
    if ($("#newsStatus")) $("#newsStatus").textContent = "Собираем текст по теме новости…";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/news`, {
        method: "POST",
        body: {
          topic: selectedNewsTopic,
          topicTitle: newsTopicCache.find((t) => t.id === selectedNewsTopic)?.title || "",
          keywords: splitTags($("#newsKeywordInput")?.value || ""),
          template: selectedNewsTemplate,
        },
      });
      currentNewsId = Number(data.id);
      if (data.template) {
        selectedNewsTemplate = data.template;
        if ($("#newsTemplate")) $("#newsTemplate").value = data.template;
      }
      fillNewsEditor({ ...data, created_at: new Date().toISOString() });
      if ($("#newsStatus")) $("#newsStatus").textContent = `Текст для Карт готов · ${data.body?.length || 0} знаков. Проверьте факты.`;
      if (window.matchMedia("(max-width: 900px)").matches) {
        $("#newsBody")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      await loadNews();
      renderNewsTopics();
      noteGenerated({
        target: "news",
        kind: "text",
        title: `Новости · «${String(data.headline || newsTopicCache.find((t) => t.id === selectedNewsTopic)?.title || "текст").slice(0, 80)}»`,
        text: "Текст новости собран.",
        key: `news-text:${data.id || Date.now()}`,
      });
      toast("Новость собрана", "Проверьте цену, адрес и отсутствие обещаний.");
    } catch (err) {
      if ($("#newsStatus")) $("#newsStatus").textContent = err.message;
      toast("Не получилось собрать", err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  $("#newsBody")?.addEventListener("input", updateNewsCount);

  async function publishNewsDraft() {
    if (!activeOrgId || !currentNewsId) { toast("Нет черновика", "Сначала соберите новость."); return; }
    const body = $("#newsBody")?.value.trim() || "";
    const draft = newsDrafts.find((n) => Number(n.id) === Number(currentNewsId));
    if (draft?.status === "queued") { toast("Уже в очереди", "Новость в кабинете, в Карты не отправлена."); return; }
    if (body.length < 120) { toast("Текст короткий", "Для публикации нужно минимум 120 знаков."); return; }
    const btn = $("#newsPublish");
    if (btn) btn.disabled = true;
    try {
      await apiJson(`/api/orgs/${activeOrgId}/news/${currentNewsId}`, {
        method: "PATCH",
        body: {
          headline: $("#newsHeadline")?.value || "",
          body,
          keywords: splitTags($("#newsKeywords")?.value || ""),
          imageId: Number($("#newsImage")?.value) || null,
        },
      });
      const data = await apiJson(`/api/orgs/${activeOrgId}/news/${currentNewsId}/publish`, { method: "POST" });
      if (!data.queueId) {
        if (btn) btn.disabled = false;
        if ($("#newsStatus")) $("#newsStatus").textContent = "Очередь не создана. Текст остался черновиком.";
        toast("Очередь не создана", "Новость не отмечена опубликованной.");
        return;
      }
      if ($("#newsStatus")) $("#newsStatus").textContent = "В кабинете, не в Картах.";
      if ($("#newsSaveStatus")) $("#newsSaveStatus").textContent = "Новость в очереди кабинета.";
      await loadNews();
      if (btn) btn.textContent = "В кабинете, не в Картах";
      refreshNotifications();
      toast("В очереди кабинета", "В Яндекс.Карты новость не отправлена.");
      if (data.limits) setQuota($("#newsQuota"), data.limits.usedTexts || 0, data.limits.texts || 0, "Тексты");
    } catch (err) {
      if ($("#newsSaveStatus")) $("#newsSaveStatus").textContent = err.message;
      toast("Не опубликовано", err.message);
      syncNewsPublish();
    }
  }

  $("#newsPublish")?.addEventListener("click", publishNewsDraft);

  async function saveNewsDraft() {
    if (!activeOrgId || !currentNewsId) { toast("Нет черновика", "Сначала соберите новость."); return; }
    try {
      await apiJson(`/api/orgs/${activeOrgId}/news/${currentNewsId}`, {
        method: "PATCH",
        body: {
          headline: $("#newsHeadline")?.value || "",
          body: $("#newsBody")?.value || "",
          keywords: splitTags($("#newsKeywords")?.value || ""),
          imageId: Number($("#newsImage")?.value) || null,
        },
      });
      if ($("#newsSaveStatus")) $("#newsSaveStatus").textContent = "Сохранено";
      await loadNews();
      toast("Черновик сохранён", "Текст и ключевые слова обновлены.");
    } catch (err) {
      if ($("#newsSaveStatus")) $("#newsSaveStatus").textContent = err.message;
    }
  }

  /* ---------- прайс ---------- */
  function priceMenuNiche() {
    const raw = `${currentOrg?.category || ""} ${currentOrg?.name || ""}`.toLowerCase();
    return /(кофейн|кафе|пекар|ресторан|выпеч|кондитер|пицц|суши|кулинар|столов|бургер|шаурм|общепит|еда|кухн|бар(?!бер))/.test(raw);
  }

  function priceRetailNiche() {
    const raw = `${currentOrg?.category || ""} ${currentOrg?.name || ""}`.toLowerCase();
    return /(магазин|одежд|бутик|ателье|гардероб|шоурум|товар|компьютер|электрон|ноутбук)/.test(raw);
  }

  function pluralRu(n, one, few, many) {
    const abs = Math.abs(Number(n) || 0) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function applyPriceCopy() {
    const menu = priceMenuNiche();
    const retail = !menu && priceRetailNiche();
    if ($("#pricesTitle")) $("#pricesTitle").textContent = menu ? "Меню и товары" : retail ? "Товары и цены" : "Прайс услуг";
    if ($("#pricesLead")) {
      $("#pricesLead").textContent = menu
        ? "Цена, единица и одна короткая строка — то, что снимает вопрос до звонка. Сохранённые позиции попадают в витрину."
        : retail
          ? "Цена, размер и понятное описание — то, что помогает выбрать до примерки. Сохранённые позиции попадают в витрину."
          : "Стоимость услуг и понятные условия — без меню и блюд. Сохранённые позиции попадают в витрину.";
    }
    if ($("#pricePreviewTitle")) $("#pricePreviewTitle").textContent = menu ? "Превью меню" : retail ? "Превью товаров" : "Превью прайса";
    if ($("#priceEmptyTitle")) $("#priceEmptyTitle").textContent = menu ? "Меню соберётся здесь" : retail ? "Витрина соберётся здесь" : "Прайс соберётся здесь";
    if ($("#priceEmptyText")) {
      $("#priceEmptyText").textContent = menu
        ? "Добавьте 3–5 позиций — получится меню для сторис, сайта и печати."
        : retail
          ? "Добавьте 3–5 товаров — получится витрина для карточки, сторис и сайта."
          : "Добавьте 3–5 услуг — получится прайс для сайта, сторис и печати.";
    }
  }

  let priceItems = [];
  let priceGoodsNote = "";
  const priceShotChoices = {};
  let showCollapsedPrices = false;

  function priceVal(item, field) {
    if (field === "isFrom") return item.is_from ? "checked" : "";
    return item[field] ?? "";
  }

  function priceMissing(item) {
    return item.price_source === "absent" || (item.source === "import" && !Number(item.price) && item.price_source !== "manual");
  }

  function priceCell(item) {
    if (priceMissing(item)) {
      return `<span class="field-hint">цены на публичной странице нет</span><input data-field="price" type="number" min="0" step="1" value="" placeholder="—" aria-label="Цена" class="price-input">`;
    }
    return `<input data-field="price" type="number" min="0" step="1" value="${Number(item.price) || 0}" aria-label="Цена" class="price-input">`;
  }

  function renderPriceRows() {
    const body = $("#priceRows");
    if (!body) return;
    const pricedRows = priceItems.filter((item) => Number(item.price) > 0);
    const hiddenPrices = showCollapsedPrices || pricedRows.length <= 12 ? [] : pricedRows.slice(12).map((item) => Number(item.id));
    const hiddenSet = new Set(hiddenPrices);
    const visibleItems = priceItems.filter((item) => !hiddenSet.has(Number(item.id)));
    if (!priceItems.length) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty-state empty-state--table"><strong>Прайс пуст</strong><p>${esc(priceGoodsNote || "Добавьте позиции вручную. Если публичная карточка их не отдала, список не выдумываем.")}</p></div></td></tr>`;
    } else {
      body.innerHTML = visibleItems.map((item) => {
        const id = Number(item.id);
        const desc = String(item.description || "");
        const choices = priceShotChoices[id] || (item.image_id && activeOrgId ? [{ id: item.image_id, url: `/api/orgs/${activeOrgId}/images/${Number(item.image_id)}` }] : []);
        const thumb = choices.length ? `<div class="price-shot-row">${choices.map((image) => {
          const src = image.url || (activeOrgId ? `/api/orgs/${activeOrgId}/images/${Number(image.id)}` : "");
          return `<button type="button" class="price-shot-wrap poster-frame" data-price-shot="${id}" data-image-id="${Number(image.id) || ""}"><img class="price-shot" alt="${esc(item.name || "Позиция")}" src="${esc(src)}" data-shot-open="${esc(src)}" data-shot-title="${esc(item.name || "")}"><span class="poster-type"><strong>${esc(item.name || "")}</strong><span>${item.price ? esc(moneyRub(item.price)) : ""}</span></span></button>`;
        }).join("")}</div>` : `<p class="field-hint" data-price-shot-note="${id}"></p>`;
        const offer = item.copyOffer?.text
          ? `<p class="field-hint">Что написать по запросам: ${esc(item.copyOffer.text)}</p>${item.copyOffer.comment ? `<button class="btn btn--ghost btn--small" type="button" data-price-offer="${id}">Подставить в комментарий</button>` : ""}`
          : "";
        const descRow = `<tr class="price-desc-row" data-price-desc="${id}"><td colspan="7"><label class="price-desc-field">Описание<input data-field="description" value="${esc(desc)}" maxlength="3000" aria-label="Описание позиции ${esc(item.name)}"></label>${offer}<div class="price-desc-actions">${thumb}<button class="btn btn--small" type="button" data-price-own="${id}">Своё фото</button><button class="btn btn--ghost btn--small" type="button" data-price-photo="${id}" title="Замещающий кадр. Не фото двери, машины, кабинета или стойки.">Замещающий кадр</button><button class="btn btn--ghost btn--small" type="button" data-price-optimize="${id}">Оптимизировать</button><button class="btn btn--ghost btn--small" type="button" data-build-desc="${id}">Собрать описание</button><button class="btn btn--ghost btn--small" type="button" data-queue-price="${id}">Оставить в кабинете</button><span data-price-queue-status="${id}"></span></div></td></tr>`;
        return `
        <tr data-price-id="${id}">
          <td><input data-field="name" value="${esc(item.name)}" maxlength="250" size="${Math.max(16, String(item.name || "").length)}" aria-label="Название"></td>
          <td><input data-field="category" value="${esc(item.category)}" maxlength="250" aria-label="Категория"></td>
          <td>${priceCell(item)}</td>
          <td><input data-field="unit" value="${esc(item.unit || "")}" maxlength="40" aria-label="Единица" class="unit-input"></td>
          <td><input data-field="isFrom" type="checkbox" ${item.is_from ? "checked" : ""} aria-label="Цена от"></td>
          <td><input data-field="comment" value="${esc(item.comment || "")}" maxlength="120" aria-label="Микрокомментарий"></td>
          <td class="price-row-actions"><button class="icon-btn icon-btn--sm" type="button" data-price-own="${id}" aria-label="Своё фото" title="Своё фото">+</button><button class="icon-btn icon-btn--sm" type="button" data-price-photo="${id}" aria-label="Замещающий кадр, не фото двери, машины, кабинета или стойки" title="Замещающий кадр. Не фото двери, машины, кабинета или стойки."><svg width="12" height="12" aria-hidden="true"><use href="#i-image"/></svg></button><button class="icon-btn icon-btn--sm" type="button" data-delete-price="${id}" aria-label="Удалить позицию">×</button></td>
        </tr>${descRow}`;
      }).join("") + (hiddenPrices.length ? `<tr><td colspan="7"><button class="btn btn--ghost btn--small" type="button" id="showCollapsedPrices">Показать ещё ${hiddenPrices.length}</button></td></tr>` : "");
      $("#showCollapsedPrices")?.addEventListener("click", () => {
        showCollapsedPrices = true;
        renderPriceRows();
      });
    }
    const categories = new Set(priceItems.map((x) => x.category).filter(Boolean));
    const missingPrice = priceItems.filter((x) => Number(x.price) <= 0).length;
    const missingDesc = priceItems.filter((x) => !String(x.description || x.comment || "").trim()).length;
    const noun = priceMenuNiche()
      ? pluralRu(priceItems.length, "позиция", "позиции", "позиций")
      : priceRetailNiche()
        ? pluralRu(priceItems.length, "товар", "товара", "товаров")
        : pluralRu(priceItems.length, "услуга", "услуги", "услуг");
    const cat = pluralRu(categories.size, "категория", "категории", "категорий");
    const gaps = [];
    if (missingPrice) gaps.push(priceItems.some(priceMissing) ? "цены на публичной странице нет" : `${missingPrice} без цены`);
    if (missingDesc) gaps.push(`${missingDesc} без описания`);
    if ($("#priceStats")) $("#priceStats").textContent = `${priceItems.length} ${noun} · ${categories.size} ${cat}${gaps.length ? ` · ${gaps.join(", ")}` : ""}`;
    const menuSheet = priceMenuNiche();
    document.querySelector("#view-prices .price-preview-card")?.toggleAttribute("hidden", !menuSheet);
    if ($("#priceDownload")) $("#priceDownload").hidden = !menuSheet;
    const img = $("#pricePreview");
    const empty = $("#pricePreviewEmpty");
    if (menuSheet && activeOrgId && priceItems.length) {
      if (img) { img.hidden = false; refreshPricePreview(); }
      if (empty) empty.hidden = true;
    } else {
      if (img) img.hidden = true;
      if (empty) empty.hidden = false;
    }
  }

  async function loadPrices() {
    if (!activeOrgId) return;
    await ensureLook();
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/prices`);
      priceItems = data.products || [];
      priceGoodsNote = priceItems.length ? "" : String(data.goodsNote || "");
      applyPriceCopy();
      if (!priceItems.length && priceGoodsNote && $("#priceEmptyText")) $("#priceEmptyText").textContent = priceGoodsNote;
      renderPriceRows();
      if (storefrontItems.length || !$("#view-storefront")?.hidden) renderStorefront(priceItems);
      paintLookHosts();
      if (!$("#pricePreview")?.hidden) refreshPricePreview();
    } catch (err) {
      if ($("#priceStatus")) $("#priceStatus").textContent = err.message;
    }
  }

  function collectPriceRow(tr) {
    const get = (field) => tr.querySelector(`[data-field="${field}"]`);
    const id = Number(tr?.dataset.priceId);
    const item = priceItems.find((x) => Number(x.id) === id) || {};
    return {
      name: get("name")?.value || "",
      category: get("category")?.value || "",
      price: Number(get("price")?.value) || 0,
      unit: get("unit")?.value || "",
      isFrom: Boolean(get("isFrom")?.checked),
      comment: get("comment")?.value || "",
      description: tr.parentElement?.querySelector(`[data-price-desc="${id}"] [data-field="description"]`)?.value ?? item.description ?? "",
      seoTitle: item.seo_title || "",
      seoKeywords: (() => { try { return JSON.parse(item.seo_keywords || "[]"); } catch { return []; } })(),
      available: item.available !== 0,
      popular: Boolean(item.popular),
    };
  }

  async function generatePricePhoto(id, button, fromQueue = false) {
    const item = priceItems.find((row) => Number(row.id) === Number(id));
    if (!item || !activeOrgId) return;
    if (!fromQueue) {
      const queued = `Прайс · «${item.name || "позиция"}»`;
      if (!enqueueImageJob(queued, () => generatePricePhoto(id, button, true))) return;
      const note = document.querySelector(`[data-price-shot-note="${id}"]`);
      if (imageJobRunning && imageJobQueue.length && note) note.textContent = `В очереди: ${queued}.`;
      return;
    }
    const label = button?.textContent || "";
    if (button) button.textContent = "Рисуем…";
    try {
      const provider = imageProviders.find((p) => p.configured)?.id || "grok";
      const facts = [item.comment, item.description].filter(Boolean).join(". ");
      const body = await apiJson(`/api/orgs/${activeOrgId}/images`, {
        method: "POST",
        body: {
          provider,
          scene: item.name || "позиция",
          format: "1:1",
          placement: "photo",
          count: 3,
          productId: Number(id),
          extra: [`Место услуги «${item.name}»: комната или объект, не макро поверхности. Верх темнее под название. Букв в кадре нет.`, facts].filter(Boolean).join(" "),
          ...lookPayload(),
        },
      });
      const images = (body.images || []).filter((image) => image?.id && !/svg/.test(image.mime || ""));
      if (!images.length) throw Object.assign(new Error("Кадр пустой."), { code: "PROVIDER_NOT_CONFIGURED" });
      priceShotChoices[id] = images;
      await apiJson(`/api/products/${Number(id)}/image`, { method: "POST", body: { imageId: Number(images[0].id), slot: "price" } });
      item.image_id = Number(images[0].id);
      renderPriceRows();
      noteGenerated({
        target: "prices",
        kind: "image",
        title: `Прайс · «${item.name || "позиция"}»`,
        text: "Изображение позиции собрано.",
        key: `price-image:${id}:${images[0].id}`,
      });
      toast("Фото прайса готово", `«${item.name}»: три кадра. Нажмите, чтобы открыть крупно.`);
    } catch (err) {
      const note = document.querySelector(`[data-price-shot-note="${id}"]`);
      if (note) note.textContent = err.message || "Кадр пустой.";
      toast("Фото прайса не собралось", err.message || "Кадр пустой.");
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }

  async function savePriceRow(tr) {
    const id = Number(tr?.dataset.priceId);
    if (!id) return;
    try {
      const payload = collectPriceRow(tr);
      await apiJson(`/api/products/${id}`, { method: "PATCH", body: payload });
      const item = priceItems.find((x) => Number(x.id) === id);
      if (item) Object.assign(item, payload, { is_from: payload.isFrom ? 1 : 0 });
      if ($("#priceStatus")) $("#priceStatus").textContent = payload.isFrom
        ? "Сохранено. Для Карт нужна точная цена — «от» останется на сайте и в презентации."
        : "Сохранено";
      if (payload.isFrom) toast("Для Карт нужна точная цена", "«От» сохранён для сайта; при публикации Локус попросит точную сумму.");
      renderPriceRows();
    } catch (err) {
      if ($("#priceStatus")) $("#priceStatus").textContent = err.message;
      toast("Не сохранилось", err.message);
    }
  }

  async function addPriceRow() {
    if (!activeOrgId) return;
    try {
      await apiJson(`/api/orgs/${activeOrgId}/prices`, {
        method: "POST",
        body: { name: "Новая позиция", category: "Услуги", price: 0, unit: "шт.", comment: "Уточните состав и условия." },
      });
      await loadPrices();
      toast("Позиция добавлена", "Заполните название, цену и комментарий.");
    } catch (err) {
      toast("Не получилось добавить", err.message);
    }
  }

  async function downloadSvgAsPng(url, filename, width, height) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error("SVG недоступен");
    const svg = await res.text();
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = svgUrl; });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG не собрался");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  /* ---------- bindings ---------- */
  $("#previewImagePrompt")?.addEventListener("click", async () => {
    if (!activeOrgId) { toast("Нет карточки", "Подключите карточку."); return; }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/imagegen/preview`, {
        method: "POST",
        body: {
          scene: $("#imageScene")?.value || "hero",
          format: $("#imageFormat")?.value || "9:16",
          extra: $("#imageExtra")?.value || "",
          references: String($("#imageRefs")?.value || "").split(/[\s,]+/).filter(Boolean).slice(0, 2),
        },
      });
      const pre = $("#imagePromptPreview");
      if (pre) {
        pre.hidden = false;
        pre.textContent = `${data.prompt}\n\nNEGATIVE: ${data.negative}\n\nALT: ${data.alt}\nTAGS: ${(data.keywords || []).join(", ")}`;
      }
      const copy = $("#copyImagePrompt");
      if (copy) copy.hidden = false;
      if ($("#imageStatus")) $("#imageStatus").textContent = "Промпт собран. Его можно вставить в YandexART или другой выбранный сервис.";
    } catch (err) { toast("Не удалось собрать промпт", err.message); }
  });
  $("#copyImagePrompt")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#imagePromptPreview")?.textContent || "");
      toast("Промпт скопирован", "Вставьте его в интерфейс провайдера.");
    } catch { toast("Не удалось скопировать", "Выделите текст вручную."); }
  });
  $("#generateImages")?.addEventListener("click", generateImages);
  $("#generateImagesBottom")?.addEventListener("click", generateImages);
  $("#imageGallery")?.addEventListener("click", async (e) => {
    const assign = e.target.closest("[data-assign-slot]");
    if (assign) {
      const slot = assign.dataset.assignSlot;
      const imageId = Number(assign.dataset.assignImage);
      const asset = imageAssets.find((img) => Number(img.id) === imageId);
      if (!asset || asset.provider !== "upload" || /svg/i.test(String(asset.mime || "")) || !activeOrgId) return;
      try {
        const data = await apiJson(`/api/orgs/${activeOrgId}/profile`, { method: "PATCH", body: { card: { photos: { [slot]: asset.url } } } });
        currentOrg = { ...currentOrg, ...data.org };
        fillCardForm(data.org?.card);
        toast("Фото в слоте", slot === "entrance" ? "В слот входа записан загруженный файл, не рисунок." : "Загруженный файл записан в кабинет. В Карты сам не уходит.");
      } catch (err) {
        toast("Не записали", err.message || "");
      }
      return;
    }
    const tile = e.target.closest("[data-image-id]");
    if (tile) selectImage(tile.dataset.imageId);
  });
  $("#uploadImage")?.addEventListener("click", () => $("#imageUpload")?.click());
  $("#imageUpload")?.addEventListener("change", async () => {
    const input = $("#imageUpload");
    const file = input?.files?.[0];
    if (!file) return;
    if (!serverActive || !activeOrgId) {
      toast("Нет соединения с API", apiMissingText());
      input.value = "";
      return;
    }
    const mime = imageMime(file);
    if (!mime) {
      toast("Нужен файл", "jpeg, png, webp или gif. Рисунок сюда не ставим.");
      input.value = "";
      return;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Файл не читается"));
        reader.readAsDataURL(file);
      });
      const created = await apiJson(`/api/orgs/${activeOrgId}/images/upload`, {
        method: "POST",
        body: { contentBase64: dataUrl.replace(/^data:[^,]*,/, ""), mime, filename: file.name },
      });
      await loadImages();
      if (created.id) selectImage(created.id);
      toast("Файл загружен", "Его можно поставить в логотип, вход, внутри, работу или снаружи.");
    } catch (err) {
      toast("Не загрузили", liveErrorText(err, "Не удалось загрузить фото."));
    } finally {
      if (input) input.value = "";
    }
  });
  $("#downloadImage")?.addEventListener("click", (event) => {
    const href = event.currentTarget.getAttribute("href") || "";
    if (!href || href === "#") {
      event.preventDefault();
      toast("Нет изображения", "Сначала выберите кадр в галерее.");
      return;
    }
    toast("Скачиваем оригинал", "Файл откроется в новой загрузке браузера.");
  });
  $("#saveImageMeta")?.addEventListener("click", saveImageMeta);
  $("#copyImageMeta")?.addEventListener("click", async () => {
    const asset = currentImageAsset();
    if (!asset) { toast("Выберите кадр", "Сначала откройте изображение в галерее."); return; }
    const text = `TITLE: ${$("#imageTitle")?.value || ""}\nALT: ${$("#imageAlt")?.value || ""}\nKEYWORDS: ${$("#imageKeywords")?.value || ""}\nFILE: locus-${asset.id}.png`;
    try { await navigator.clipboard.writeText(text); toast("Теги скопированы", "Alt и ключевые слова — для сайта и выгрузки."); }
    catch { toast("Не удалось скопировать", "Выделите текст вручную."); }
  });
  $("#useImageStory")?.addEventListener("click", () => {
    const asset = currentImageAsset();
    if (!asset) { toast("Выберите кадр", "Сначала откройте изображение в галерее."); return; }
    generatedStoryImageId = Number(asset.id);
    showView("stories");
    renderStories();
    toast("Кадр выбран для сторис", "Три варианта используют сгенерированное изображение. Проверьте текст и скачайте PNG.");
  });
  $("#newsGenerate")?.addEventListener("click", generateNewsDraft);
  $("#newsGenerateImage")?.addEventListener("click", generateNewsImage);
  $("#newsImageChoices")?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-news-image-choice]");
    if (!choice) return;
    const id = Number(choice.dataset.newsImageChoice);
    if ($("#newsImage")) $("#newsImage").value = String(id);
    setNewsImagePreview(id);
    $$("[data-news-image-choice]", $("#newsImageChoices")).forEach((btn) => {
      const active = Number(btn.dataset.newsImageChoice) === id;
      btn.classList.toggle("is-selected", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    toast("Обложка выбрана", "Кадр прикрепится к новости при сохранении.");
  });
  $("#newsReminderBtn")?.addEventListener("click", enableNewsReminder);
  setInterval(checkWeeklyNewsReminder, 60 * 60 * 1000);
  $("#newsSave")?.addEventListener("click", saveNewsDraft);
  $("#newsBody")?.addEventListener("input", updateNewsCount);
  $("#newsImage")?.addEventListener("change", () => setNewsImagePreview($("#newsImage")?.value));
  $("#newsTopicList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-topic-id]");
    if (!btn) return;
    selectedNewsTopic = btn.dataset.topicId;
    renderNewsTopics();
  });
  $("#newsList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-news-id]");
    if (!btn) return;
    const draft = newsDrafts.find((x) => Number(x.id) === Number(btn.dataset.newsId));
    if (draft) fillNewsEditor(draft);
  });
  $("#newsCopy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#newsBody")?.value || "");
      toast("Скопировано", "Текст можно вставить в публикацию Карт.");
    } catch { toast("Не удалось скопировать", "Выделите текст вручную."); }
  });
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  $("#priceImport")?.addEventListener("click", () => $("#priceImportFile")?.click());
  $("#priceImportFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file || !activeOrgId) return;
    if (file.size > 5_000_000) {
      toast("Файл слишком большой", "Максимум 5 МБ. Разделите прайс на части.");
      event.target.value = "";
      return;
    }
    const status = $("#priceImportStatus");
    if (status) status.textContent = `Читаем «${file.name}»…`;
    try {
      const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const data = await apiJson(`/api/orgs/${activeOrgId}/prices/import`, {
        method: "POST",
        body: { filename: file.name, contentBase64 },
      });
      await loadPrices();
      const skipped = data.skipped?.length || 0;
      if (status) status.textContent = `Импортировано ${data.imported} из ${file.name}${skipped ? ` · пропущено ${skipped}` : ""}.`;
      toast("Прайс загружен", `${data.imported} позиций из «${file.name}»${skipped ? `, пропущено ${skipped}` : ""}.`);
    } catch (err) {
      if (status) status.textContent = err.message;
      toast("Не удалось импортировать", err.message);
    } finally {
      event.target.value = "";
    }
  });
  function downloadPriceFile(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  $("#priceTemplate")?.addEventListener("click", () => {
    if (!activeOrgId) return;
    downloadPriceFile(`/api/orgs/${activeOrgId}/prices/template`, "locus-price-template.csv");
    toast("Шаблон скачан", "CSV с колонками для импорта в Excel.");
  });
  $("#priceExport")?.addEventListener("click", () => {
    if (!activeOrgId) return;
    downloadPriceFile(`/api/orgs/${activeOrgId}/prices/export.xlsx`, "locus-price.xlsx");
    toast("Excel скачан", "Прайс выгружен в .xlsx.");
  });

  $("#priceAdd")?.addEventListener("click", addPriceRow);
  $("#priceRows")?.addEventListener("change", (e) => {
    if (e.target.matches("[data-field='description']")) {
      const id = e.target.closest("[data-price-desc]")?.dataset.priceDesc;
      const tr = $("#priceRows")?.querySelector(`[data-price-id="${id}"]`);
      if (tr) savePriceRow(tr);
      return;
    }
    const tr = e.target.closest("[data-price-id]");
    if (tr) savePriceRow(tr);
  });
  $("#priceRows")?.addEventListener("click", async (e) => {
    const offerBtn = e.target.closest("[data-price-offer]");
    if (offerBtn) {
      const id = Number(offerBtn.dataset.priceOffer);
      const item = priceItems.find((row) => Number(row.id) === id);
      const offer = item?.copyOffer;
      const tr = $("#priceRows")?.querySelector(`[data-price-id="${id}"]`);
      const comment = tr?.querySelector("[data-field='comment']");
      const desc = $("#priceRows")?.querySelector(`[data-price-desc="${id}"] [data-field="description"]`);
      if (comment && offer?.comment) comment.value = offer.comment;
      if (desc && offer?.text) desc.value = offer.text;
      if (item) item.copyOffer = { text: "", comment: "", source: "" };
      if (tr) savePriceRow(tr);
      return;
    }
    const buildBtn = e.target.closest("[data-build-desc]");
    if (buildBtn) {
      const id = Number(buildBtn.dataset.buildDesc);
      buildBtn.disabled = true;
      try {
        const data = await apiJson(`/api/products/${id}/description`, { method: "POST" });
        const item = priceItems.find((row) => Number(row.id) === id);
        if (item) item.description = data.text || "";
        renderPriceRows();
        toast("Описание собрано", "Текст из названия, цены и фактов карточки.");
      } catch (err) {
        buildBtn.disabled = false;
        toast("Не собрали", err.message || "");
      }
      return;
    }
    const queueBtn = e.target.closest("[data-queue-price]");
    if (queueBtn) {
      const id = Number(queueBtn.dataset.queuePrice);
      const item = priceItems.find((row) => Number(row.id) === id);
      if (!activeOrgId) return;
      queueBtn.disabled = true;
      try {
        const queued = await apiJson(`/api/orgs/${activeOrgId}/autopilot/queue`, {
          method: "POST",
          body: { type: "product_update", entityId: id, title: `Позиция: ${item?.name || "Прайс"}`, payload: { productId: id } },
        });
        const slot = document.querySelector(`[data-price-queue-status="${id}"]`);
        if (!queued.item?.id) {
          if (slot) slot.textContent = "";
          queueBtn.disabled = false;
          toast("Очередь не создана", "Позиция осталась в прайсе.");
          return;
        }
        if (slot) slot.textContent = "В кабинете, не в Картах";
        toast("В очереди кабинета", `«${item?.name || "Позиция"}» в очереди. В Карты не отправлено.`);
      } catch (err) {
        queueBtn.disabled = false;
        toast("Очередь не создана", err.message || "");
      }
      return;
    }
    const optimizeBtn = e.target.closest("[data-price-optimize]");
    if (optimizeBtn && activeOrgId) {
      const id = Number(optimizeBtn.dataset.priceOptimize);
      optimizeBtn.disabled = true;
      try {
        const data = await apiJson(`/api/products/${id}/optimize`, { method: "POST", body: {} });
        const item = priceItems.find((row) => Number(row.id) === id);
        if (item) {
          item.name = data.name || item.name;
          item.comment = data.comment || "";
          item.description = data.description || "";
        }
        renderPriceRows();
        toast(data.missingComposition ? "Состава нет" : "Позиция собрана", data.note || (data.renamed ? "Имя сверено с фразой Вордстата. Цену не меняли." : "Комментарий и описание из известных фактов. Цену не меняли."));
        const photo = document.querySelector(`[data-price-photo="${id}"]`);
        if (photo) await generatePricePhoto(id, photo);
      } catch (err) {
        optimizeBtn.disabled = false;
        toast("Не оптимизировали", err.message || "");
      }
      return;
    }
    const ownPrice = e.target.closest("[data-price-own]");
    if (ownPrice) {
      askOwnFrame({ productId: Number(ownPrice.dataset.priceOwn), slot: "price" });
      return;
    }
    const photoBtn = e.target.closest("[data-price-photo]");
    if (photoBtn && activeOrgId) {
      await generatePricePhoto(Number(photoBtn.dataset.pricePhoto), photoBtn);
      return;
    }
    const btn = e.target.closest("[data-delete-price]");
    if (!btn || !activeOrgId) return;
    if (!confirm("Удалить позицию из прайса? Это действие можно отменить только вручную.")) return;
    try {
      await apiJson(`/api/products/${Number(btn.dataset.deletePrice)}`, { method: "DELETE" });
      await loadPrices();
      toast("Позиция удалена", "Прайс обновлён.");
    } catch (err) { toast("Не удалось удалить", err.message); }
  });
  $("#priceDownload")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    try {
      await downloadSvgAsPng(`/api/orgs/${activeOrgId}/price.svg`, "locus-price.png", 1200, 1600);
      toast("Прайс готов", "PNG 1200×1600 — для печати и сторис.");
    } catch (err) { toast("Не получилось скачать", liveErrorText(err, "Файл прайса не собрался.")); }
  });

  /* ---------- clients: визиты, ОС и отзывы ---------- */
  const channelLabels = { whatsapp: "WhatsApp", telegram: "Telegram", sms: "SMS", email: "E-mail", phone: "Телефон", other: "Другой канал" };

  function clientById(id) {
    return clients.find((client) => Number(client.id) === Number(id)) || null;
  }

  function formatClientDate(value) {
    if (!value) return "дата не указана";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "дата не указана";
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  function clientMessengerHref(channel, contact, text) {
    const value = String(contact || "").trim();
    const digits = value.replace(/\D/g, "");
    const encoded = encodeURIComponent(String(text || ""));
    if (channel === "whatsapp" && digits) return `https://wa.me/${digits.replace(/^8/, "7")}?text=${encoded}`;
    if (channel === "telegram" && value) {
      const username = value.replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").replace(/\?.*$/, "");
      return username ? `https://t.me/${encodeURIComponent(username)}` : "";
    }
    if (channel === "sms" && digits) return `sms:${digits}?body=${encoded}`;
    if (channel === "email" && /@/.test(value)) return `mailto:${value}?subject=${encodeURIComponent("Впечатление о визите")}&body=${encoded}`;
    if (channel === "phone" && digits) return `tel:${digits}`;
    return "";
  }

  async function copyClientText(text, label) {
    const value = String(text || "").trim();
    if (!value) { toast("Пока нечего копировать", "Сначала соберите текст."); return; }
    try {
      await navigator.clipboard.writeText(value);
      toast(label || "Скопировано", "Текст в буфере обмена.");
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); toast(label || "Скопировано", "Текст в буфере обмена."); }
      catch { toast("Не удалось скопировать", "Выделите текст вручную."); }
      area.remove();
    }
  }

  function clientStatusClass(status) {
    if (status === "review_ready" || status === "sent") return "client-row-status--ready";
    if (status === "requested" || status === "feedback") return "client-row-status--wait";
    return "";
  }

  function renderClientStats(summary = clientSummary) {
    if ($("#clientStatTotal")) $("#clientStatTotal").textContent = String(summary.total || 0);
    if ($("#clientStatWaiting")) $("#clientStatWaiting").textContent = String(summary.requested || 0);
    if ($("#clientStatReady")) $("#clientStatReady").textContent = String(summary.ready || 0);
    if ($("#clientStatRating")) $("#clientStatRating").textContent = summary.rating ? String(summary.rating).replace(".", ",") : "—";
    const badge = $("#clientBadge");
    if (badge) {
      badge.textContent = String(summary.total || 0);
      badge.hidden = !summary.total;
    }
  }

  function filteredClients() {
    const query = String($("#clientSearch")?.value || "").trim().toLowerCase();
    const status = String($("#clientStatusFilter")?.value || "");
    return clients.filter((client) => {
      if (status && client.status !== status) return false;
      if (!query) return true;
      return [client.name, client.contact, client.service, channelLabels[client.channel]].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }

  function renderClientList() {
    const list = $("#clientList");
    const empty = $("#clientEmpty");
    if (!list) return;
    const rows = filteredClients();
    if ($("#clientListCount")) {
      $("#clientListCount").textContent = `${rows.length} ${pluralRu(rows.length, "клиент", "клиента", "клиентов")}${clients.length !== rows.length ? ` из ${clients.length}` : ""}`;
    }
    if (!clients.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = rows.length ? rows.map((client) => {
      const meta = [formatClientDate(client.visitAt), channelLabels[client.channel], client.service].filter(Boolean).join(", ");
      return `<button class="client-row" type="button" data-client-id="${client.id}" aria-pressed="${Number(client.id) === Number(selectedClientId)}">
        <span class="client-row-name">${esc(client.name)}</span>
        <span class="client-row-status ${clientStatusClass(client.status)}">${esc(client.statusLabel || client.status)}</span>
        <span class="client-row-meta">${esc(meta || "визит без деталей")}${client.feedbackRating ? ` · ОС ${client.feedbackRating}/5` : ""}</span>
      </button>`;
    }).join("") : `<div class="client-list-empty"><strong>Ничего не найдено</strong><p>Измените запрос или фильтр статуса.</p></div>`;
  }

  function renderClientDetail() {
    const client = clientById(selectedClientId);
    const empty = $("#clientDetailEmpty");
    const detail = $("#clientDetail");
    if (!detail) return;
    if (!client) {
      if (empty) empty.hidden = false;
      detail.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    detail.hidden = false;
    if ($("#clientDetailStatus")) $("#clientDetailStatus").textContent = client.statusLabel || client.status;
    if ($("#clientDetailName")) $("#clientDetailName").textContent = client.name;
    if ($("#clientDetailMeta")) $("#clientDetailMeta").textContent = `${formatClientDate(client.visitAt)} · ${client.service || "визит"}`;
    if ($("#clientDetailChannel")) $("#clientDetailChannel").textContent = channelLabels[client.channel] || client.channel || "—";
    if ($("#clientDetailContact")) $("#clientDetailContact").textContent = client.contact || "не указан";
    if ($("#clientDetailConsent")) $("#clientDetailConsent").textContent = client.consent ? "есть" : "нет";
    if ($("#clientDetailConsent")) $("#clientDetailConsent").style.color = client.consent ? "#2d5540" : "#a3321c";
    if ($("#clientRequestText")) $("#clientRequestText").value = client.requestText || "";
    if ($("#clientRequestState")) $("#clientRequestState").textContent = !client.consent ? "нужно согласие" : client.requestText ? "сообщение собрано" : "черновик";
    if ($("#clientFeedback")) $("#clientFeedback").value = client.feedback || "";
    if ($("#clientRating")) $("#clientRating").value = String(client.feedbackRating || 0);
    if ($("#clientReviewText")) $("#clientReviewText").value = client.reviewText || "";
    if ($("#clientReviewState")) $("#clientReviewState").textContent = client.reviewText ? "отзыв собран" : "ещё не собран";
    if ($("#clientReviewNote")) {
      $("#clientReviewNote").textContent = client.reviewText
        ? "Собрано из слов клиента. Проверьте факты, имя и формулировки — публикует сам клиент."
        : "SEO-текст соберётся из обратной связи. Его нужно проверить и отправить клиенту — сам он не публикуется.";
    }
    if ($("#clientPublishText")) $("#clientPublishText").value = client.publishText || "";
    if ($("#clientRequestGen")) $("#clientRequestGen").disabled = !client.consent;
    if ($("#clientFeedbackSave")) $("#clientFeedbackSave").disabled = !client.consent;
    if ($("#clientMarkSent")) $("#clientMarkSent").disabled = !client.reviewText;
    if ($("#clientFeedbackHint")) {
      $("#clientFeedbackHint").textContent = client.consent ? "Только факты из слов клиента. Ничего не выдумываем." : "Нет согласия — запись ОС заблокирована. Отметьте согласие в карточке.";
    }
    const requestHref = clientMessengerHref(client.channel, client.contact, client.requestText || "");
    const requestOpen = $("#clientRequestOpen");
    if (requestOpen) {
      requestOpen.hidden = !requestHref;
      requestOpen.href = requestHref || "#";
    }
    const publishHref = clientMessengerHref(client.channel, client.contact, client.publishText || "");
    const publishOpen = $("#clientPublishOpen");
    if (publishOpen) {
      publishOpen.hidden = !publishHref;
      publishOpen.href = publishHref || "#";
    }
    const maps = $("#clientReviewMaps");
    if (maps) {
      maps.href = client.orgCardUrl || client.reviewLink || "#";
      maps.style.opacity = (client.orgCardUrl || client.reviewLink) ? "1" : ".45";
    }
  }

  function renderClients() {
    renderClientStats();
    renderClientList();
    renderClientDetail();
  }

  function updateClientInList(client) {
    if (!client) return;
    const index = clients.findIndex((item) => Number(item.id) === Number(client.id));
    if (index >= 0) clients[index] = client;
    else clients.unshift(client);
    selectedClientId = client.id;
    renderClients();
  }

  async function loadClients() {
    if (!serverActive || !activeOrgId) {
      renderClients();
      return;
    }
    if ($("#clientTemplateLink")) $("#clientTemplateLink").href = `/api/orgs/${activeOrgId}/clients/template`;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/clients`);
      clients = Array.isArray(data.clients) ? data.clients : [];
      clientSummary = data.summary || {};
      if (!clientById(selectedClientId)) selectedClientId = (clients.find((client) => client.consent && client.status !== "sent") || clients[0])?.id || null;
      renderClients();
    } catch (err) {
      toast("Не удалось загрузить клиентов", err.message);
    }
  }

  async function loadClientBadge() {
    if (!serverActive || !activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/clients`);
      clients = Array.isArray(data.clients) ? data.clients : [];
      clientSummary = data.summary || {};
      renderClientStats();
    } catch { /* тихо: бейдж не критичен */ }
  }

  function openClientForm(client = null) {
    editingClientId = client?.id || null;
    const card = $("#clientFormCard");
    if (!card) return;
    card.hidden = false;
    if ($("#clientFormTitle")) $("#clientFormTitle").textContent = client ? "Карточка клиента" : "Новый клиент";
    if ($("#clientName")) $("#clientName").value = client?.name || "";
    if ($("#clientContact")) $("#clientContact").value = client?.contact || "";
    if ($("#clientChannel")) $("#clientChannel").value = client?.channel || "whatsapp";
    if ($("#clientVisitAt")) $("#clientVisitAt").value = client?.visitAt ? String(client.visitAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
    if ($("#clientService")) $("#clientService").value = client?.service || "";
    if ($("#clientConsent")) $("#clientConsent").checked = Boolean(client?.consent);
    if ($("#clientFormStatus")) $("#clientFormStatus").textContent = "";
    card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
    setTimeout(() => $("#clientName")?.focus(), 80);
  }

  function closeClientForm() {
    const card = $("#clientFormCard");
    if (card) card.hidden = true;
    editingClientId = null;
  }

  async function saveClientForm(event) {
    event.preventDefault();
    if (!serverActive || !activeOrgId) { toast("Нет соединения с API", apiMissingText()); return; }
    const name = String($("#clientName")?.value || "").trim();
    if (!name) { toast("Укажите имя", "Без имени клиента не сохранить."); return; }
    const payload = {
      name,
      contact: String($("#clientContact")?.value || "").trim(),
      channel: $("#clientChannel")?.value || "other",
      visitAt: $("#clientVisitAt")?.value || "",
      service: String($("#clientService")?.value || "").trim(),
      consent: Boolean($("#clientConsent")?.checked),
    };
    const save = $("#clientFormSave");
    if (save) save.disabled = true;
    try {
      const data = editingClientId
        ? await apiJson(`/api/clients/${editingClientId}`, { method: "PATCH", body: payload })
        : await apiJson(`/api/orgs/${activeOrgId}/clients`, { method: "POST", body: payload });
      updateClientInList(data.client);
      clientSummary = data.summary || clientSummary;
      closeClientForm();
      toast(editingClientId ? "Клиент обновлён" : "Клиент добавлен", data.client?.name || "Карточка сохранена.");
    } catch (err) {
      if ($("#clientFormStatus")) $("#clientFormStatus").textContent = err.message;
      toast("Не удалось сохранить", err.message);
    } finally {
      if (save) save.disabled = false;
    }
  }

  async function importClientFile(file) {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast("Файл слишком большой", "Максимум 6 МБ."); return; }
    if (!serverActive || !activeOrgId) { toast("Нет соединения с API", apiMissingText()); return; }
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
      reader.readAsDataURL(file);
    }).catch((err) => { toast("Не удалось прочитать файл", err.message); return ""; });
    if (!base64) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/clients/import`, {
        method: "POST",
        body: { filename: file.name, contentBase64: base64 },
      });
      clients = Array.isArray(data.clients) ? data.clients : clients;
      clientSummary = data.summary || clientSummary;
      if (!clientById(selectedClientId)) selectedClientId = clients[0]?.id || null;
      renderClients();
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      toast("Импорт готов", `Добавлено: ${data.imported || 0}${skipped ? `, пропущено: ${skipped}` : ""}.`);
      const fileInput = $("#clientFile");
      if (fileInput) fileInput.value = "";
    } catch (err) {
      toast("Не удалось импортировать", err.message);
    }
  }

  async function generateClientRequest() {
    const client = clientById(selectedClientId);
    if (!client) return;
    if (!client.consent) { toast("Нет согласия", "Сначала отметьте согласие клиента в карточке."); return; }
    try {
      const data = await apiJson(`/api/clients/${client.id}/request`, { method: "POST" });
      updateClientInList(data.client);
      toast("Сообщение готово", "Проверьте текст и откройте мессенджер.");
    } catch (err) { toast("Не удалось собрать сообщение", err.message); }
  }

  async function saveClientFeedback() {
    const client = clientById(selectedClientId);
    if (!client) return;
    if (!client.consent) { toast("Нет согласия", "Запись ОС доступна только с согласием клиента."); return; }
    const feedback = String($("#clientFeedback")?.value || "").trim();
    if (feedback.length < 20) { toast("Слишком коротко", "Опишите впечатление хотя бы в 20 знаках."); return; }
    const rating = Number($("#clientRating")?.value || 0);
    const button = $("#clientFeedbackSave");
    if (button) button.disabled = true;
    try {
      const data = await apiJson(`/api/clients/${client.id}/feedback`, { method: "POST", body: { rating, feedback } });
      updateClientInList(data.client);
      const verdict = data.review?.validation?.verdict;
      toast("Обратная связь сохранена", verdict === "reject" ? "Проверьте отзыв: валидатор нашёл риск." : "Отзыв собран из слов клиента — проверьте перед отправкой.");
    } catch (err) {
      toast("Не удалось сохранить ОС", err.message);
    } finally {
      if (button) button.disabled = !clientById(selectedClientId)?.consent;
    }
  }

  async function regenerateClientReview() {
    const client = clientById(selectedClientId);
    if (!client) return;
    try {
      const data = await apiJson(`/api/clients/${client.id}/review`, { method: "POST" });
      updateClientInList(data.client);
      toast("Отзыв пересобран", "Ещё раз проверьте факты и формулировки.");
    } catch (err) { toast("Не удалось пересобрать", err.message); }
  }

  async function markClientSent() {
    const client = clientById(selectedClientId);
    if (!client) return;
    try {
      const data = await apiJson(`/api/clients/${client.id}/sent`, {
        method: "POST",
        body: { reviewLink: client.orgCardUrl || client.reviewLink || "" },
      });
      updateClientInList(data.client);
      clientSummary = data.summary || clientSummary;
      toast("Отмечено отправленным", "Статус клиента обновлён.");
    } catch (err) { toast("Не удалось обновить статус", err.message); }
  }

  async function deleteClient() {
    const client = clientById(selectedClientId);
    if (!client) return;
    if (!window.confirm(`Удалить клиента «${client.name}» из базы?`)) return;
    try {
      const data = await apiJson(`/api/clients/${client.id}`, { method: "DELETE" });
      clients = clients.filter((item) => Number(item.id) !== Number(client.id));
      selectedClientId = clients[0]?.id || null;
      clientSummary = data.summary || clientSummary;
      renderClients();
      toast("Клиент удалён", "Данные убраны из базы.");
    } catch (err) { toast("Не удалось удалить", err.message); }
  }

  /* ---------- brandbook ---------- */
  const brandSourceLabels = { generated: "сгенерирован", upload: "загружен", manual: "заполнен вручную", demo: "демо" };

  function brandbookPalette(book) {
    return book?.palette || { paper: "#F5EFE2", ink: "#1E1B16", accent: "#C56B2E", soft: "#E6D2B5", dark: "#3A2114", light: "#FFF9ED" };
  }

  let lookCatalog = null;
  let lookPageIndex = 0;
  let lookWorldId = "";

  function lookSlice() {
    const worlds = Array.isArray(lookCatalog?.worlds) ? lookCatalog.worlds : [];
    const size = Number(lookCatalog?.pageSize) || 3;
    const pages = Math.max(1, Math.ceil(worlds.length / size) || 1);
    const page = ((lookPageIndex % pages) + pages) % pages;
    return { page, pages, size, total: worlds.length, worlds: worlds.slice(page * size, page * size + size) };
  }

  function selectedLookId() {
    if (lookWorldId && lookCatalog?.worlds?.some((item) => item.id === lookWorldId)) return lookWorldId;
    return lookSlice().worlds[0]?.id || "";
  }

  function lookPayload() {
    return { lookId: selectedLookId(), lookPage: lookSlice().page };
  }

  const BRAND_PALETTES = {
    paper: { accent: "#C56B2E", paper: "#F5EFE2", ink: "#1E1B16" },
    pine: { accent: "#1D5B45", paper: "#F4F7F4", ink: "#1C2820" },
    ink: { accent: "#8F2A17", paper: "#F7F4EE", ink: "#1A1A1A" },
    shop: { accent: "#3E568F", paper: "#F6F4EF", ink: "#1E2430" },
  };

  function paletteOfBook(book) {
    const p = book?.palette;
    if (p && /^#[0-9a-f]{6}$/i.test(p.paper) && /^#[0-9a-f]{6}$/i.test(p.ink) && /^#[0-9a-f]{6}$/i.test(p.accent)) return p;
    return null;
  }

  function defaultLookId() {
    const raw = `${currentOrg?.category || ""} ${currentOrg?.name || ""}`.toLowerCase();
    if (/компьютер|электрон|магазин|одежд/.test(raw)) return "shop";
    if (/салон|клиник|стомат|медиц/.test(raw)) return "ink";
    if (/барбер|фитнес|сад|эко/.test(raw)) return "pine";
    return "paper";
  }

  function lookFromFiles(book = currentBrandbook) {
    return book?.lookFrom === "files" || book?.source === "upload" || book?.source === "generated";
  }

  function activeLook() {
    const saved = paletteOfBook(currentBrandbook);
    if (saved) return { palette: saved, fromMaterials: lookFromFiles() };
    const id = BRAND_PALETTES[selectedLook] ? selectedLook : defaultLookId();
    const preset = BRAND_PALETTES[id];
    return { palette: { accent: preset.accent, paper: preset.paper, ink: preset.ink, dark: preset.ink, light: preset.paper, soft: preset.paper }, fromMaterials: false };
  }

  function variantList() {
    const variants = Array.isArray(currentBrandbook?.lookVariants) ? currentBrandbook.lookVariants : [];
    return variants.length >= 3 ? variants.slice(0, 3) : [];
  }

  function variantButtons() {
    const variants = variantList();
    const pick = currentBrandbook?.lookPick || variants[0]?.id || "";
    return variants.map((variant) => `<button type="button" data-look-variant="${esc(variant.id)}" style="--swatch-a:${esc(variant.paper)};--swatch-b:${esc(variant.accent)}" aria-pressed="${pick === variant.id}">${esc(variant.name)}</button>`).join("");
  }

  function presetButtons() {
    const names = { paper: "Бумага", pine: "Хвоя", ink: "Чернила", shop: "Витрина" };
    const current = paletteOfBook(currentBrandbook);
    return Object.entries(BRAND_PALETTES).map(([id, preset]) => {
      const on = current
        ? current.accent.toUpperCase() === preset.accent.toUpperCase() && current.paper.toUpperCase() === preset.paper.toUpperCase() && current.ink.toUpperCase() === preset.ink.toUpperCase()
        : (BRAND_PALETTES[selectedLook] ? selectedLook : defaultLookId()) === id;
      return `<button type="button" data-look="${id}" data-brand-palette="${id}" aria-pressed="${on}">${names[id]}</button>`;
    }).join("");
  }

  function lookBar() {
    const slice = lookSlice();
    const pick = selectedLookId();
    const from = slice.page * slice.size + 1;
    const to = from + slice.worlds.length - 1;
    const worlds = slice.worlds.length
      ? `<div class="brand-palettes" role="group" aria-label="Три мира из двенадцати">${slice.worlds.map((item) => `<button type="button" data-look-world="${esc(item.id)}" aria-pressed="${item.id === pick}">${esc(item.name)}</button>`).join("")}<button type="button" data-look-more>Другие три</button></div>`
      : "";
    const note = slice.total
      ? `Миры ${from}–${to} из ${slice.total}. На экране три. «Другие три» показывает следующие и не повторяет их, пока набор не кончится. Выбранный мир встаёт в сторис, витрину, прайс и новости.`
      : "Набор миров появится вместе с карточкой. Пока можно выбрать сочетание цветов.";
    return `<div class="look-bar"><p class="story-controls-label">${note}</p>${worlds}</div>`;
  }

  function paintLookHosts() {
    const html = lookBar();
    if ($("#storefrontLook")) $("#storefrontLook").innerHTML = html;
    if ($("#priceLook")) $("#priceLook").innerHTML = html;
    const choices = $("#brandPalettes");
    if (choices) choices.innerHTML = variantList().length ? variantButtons() : presetButtons();
    const hint = $("#brandColorHint");
    if (hint) {
      const variants = variantList();
      hint.textContent = variants.length
        ? (currentBrandbook?.lookSource === "link"
          ? "Три варианта сняты с фото по ссылке. Загруженный снимок с ними не смешивается."
          : "Три варианта сняты с загруженного фото. Ссылка на облако с ними не смешивается.")
        : "Образец открывает палитру, рядом можно вписать HEX. Готовый набор ставит акцент, фон и текст сразу.";
    }
  }

  function refreshPricePreview() {
    const img = $("#pricePreview");
    if (!img || !activeOrgId) return;
    const p = activeLook().palette;
    img.src = `/api/orgs/${activeOrgId}/price.svg?paper=${encodeURIComponent(p.paper)}&ink=${encodeURIComponent(p.ink)}&accent=${encodeURIComponent(p.accent)}&t=${Date.now()}`;
  }

  async function ensureLook() {
    if (!lookCatalog && serverActive && activeOrgId) {
      try {
        const catalog = await apiJson(`/api/orgs/${activeOrgId}/imagegen`);
        lookCatalog = catalog.looks || null;
        if (Array.isArray(catalog.providers) && catalog.providers.length) imageProviders = catalog.providers;
      } catch {
        /* набор миров останется пустым */
      }
    }
    if (currentBrandbook || !serverActive || !activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/brandbook`);
      currentBrandbook = data?.brandbook || null;
      brandbookMeta = data || {};
    } catch {
      /* без сохранённых материалов остаётся готовое сочетание */
    }
  }

  function closeLookModal() {
    const modal = $("#lookModal");
    if (modal) modal.hidden = true;
  }

  function openLookModal() {
    const variants = variantList();
    const modal = $("#lookModal");
    const grid = $("#lookModalGrid");
    if (!modal || !grid || variants.length < 3) return;
    const brand = esc(currentOrg?.name || "Карточка");
    const product = [...storyProducts, ...priceItems].find((item) => item?.name);
    const title = esc(product?.name || "Как пройти");
    const note = esc(product?.price ? `${Number(product.price).toLocaleString("ru-RU")} ₽` : (currentOrg?.city || ""));
    const pick = currentBrandbook?.lookPick || variants[0].id;
    grid.innerHTML = variants.map((variant) => `<button type="button" class="look-choice" data-look-variant="${esc(variant.id)}" aria-pressed="${pick === variant.id}">
      <span class="look-story" style="background:${esc(variant.paper)};color:${esc(variant.ink)}">
        <span class="sf-brand">${brand}</span>
        <span class="sf-title">${title}</span>
        ${note ? `<span class="sf-note">${note}</span>` : ""}
        <span class="look-story-photo" style="background:${esc(variant.accent)}"></span>
        <span class="look-story-cta" style="background:${esc(variant.accent)};color:${esc(variant.paper)}">Смотреть</span>
      </span>
      <strong>${esc(variant.name)}</strong>
    </button>`).join("");
    modal.hidden = false;
    modal.querySelector("[data-look-close]")?.focus?.();
  }

  async function applyVariant(id) {
    const variant = variantList().find((item) => item.id === id);
    if (!variant || !activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/brandbook`, {
        method: "POST",
        body: {
          keepSource: true,
          brandbook: {
            ...(currentBrandbook || {}),
            lookFrom: "files",
            lookPick: variant.id,
            palette: { paper: variant.paper, ink: variant.ink, accent: variant.accent },
          },
        },
      });
      renderBrandbook(data);
      closeLookModal();
      if ($("#brandSaveStatus")) $("#brandSaveStatus").textContent = `Включён вариант «${variant.name}». Сторис, витрина и прайс уже в этих цветах.`;
      toast("Вариант включён", `«${variant.name}» стоит в сторис, витрине и прайсе.`);
    } catch (err) {
      toast("Не удалось включить вариант", err.message);
    }
  }

  async function applyLook(id) {
    const preset = BRAND_PALETTES[id];
    if (!preset || !activeOrgId) return;
    selectedLook = id;
    paintLookHosts();
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/brandbook`, {
        method: "POST",
        body: {
          keepSource: true,
          brandbook: {
            ...(currentBrandbook || { name: currentOrg?.name || "Бренд" }),
            lookFrom: "",
            lookSource: "",
            lookPick: "",
            lookVariants: [],
            palette: { accent: preset.accent, paper: preset.paper, ink: preset.ink },
          },
        },
      });
      renderBrandbook(data);
      toast("Сочетание применено", "Сторис, витрина и прайс берут эти цвета.");
    } catch (err) {
      toast("Не удалось сохранить цвет", err.message);
    }
  }

  function imageProviderReady() {
    return imageProviders.some((item) => item.configured);
  }

  async function generateStoryStill(id, fromQueue = false) {
    const status = $("#storyStatus");
    const slot = storyBoard().find((item) => item.id === id);
    if (!slot || !activeOrgId) {
      if (status) status.textContent = !activeOrgId ? "Сначала выберите организацию." : "Эта история не в списке.";
      return;
    }
    if ((slot.model || slot.id === "route") && slot.missing) {
      const text = slot.way || "В карточке нет адреса. Место не показываем.";
      if (status) status.textContent = text;
      toast("Место не показываем", text);
      return;
    }
    if (!fromQueue) {
      const label = `Сторис · «${slot.title}»`;
      if (!enqueueImageJob(label, () => generateStoryStill(id, true))) return;
      if (imageJobRunning && imageJobQueue.length) {
        if (status) status.textContent = `В очереди: ${label}.`;
      }
      return;
    }
    await ensureLook();
    const provider = imageProviders.find((item) => item.configured)?.id || "";
    if (!provider) {
      const text = "Ключ рисования на сервере не задан. Кадр провайдеру не отправляем.";
      if (status) status.textContent = text;
      toast("Кадр не собран", text);
      return;
    }
    const button = document.querySelector(`[data-gen-slot="${id}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = "Собираем…";
    }
    if (status) status.textContent = "Собираем кадры…";
    toast("Собираем кадры", `«${slot.title}»`);
    const route = slot.model || slot.id === "route";
    const lights = route
      ? [
        "Один пеший маршрут. Свет и материалы из палитры карточки.",
        "Тот же один маршрут, другой угол. Не витрина и не сумерки.",
        "Тот же один путь, без второго маршрута.",
      ]
      : [
        "Тёплый практический свет, золотые блики, глубокие тени, мелкая фактура.",
        "Ночной интерьер, один цветной луч поперёк предмета, высокая детализация.",
        "Та же сцена и живая деталь в кадре: растение, пар или капли в свете.",
      ];
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/images`, {
        method: "POST",
        body: {
          provider,
          scene: slot.title,
          format: "9:16",
          placement: "story",
          count: 3,
          ...lookPayload(),
          extra: `${lights.join(" ")} Верх кадра темнее под короткий заголовок. Букв в кадре нет. ${route ? "Без названий улиц, без номера дома, без экрана навигатора, без водяного знака." : [slot.note].filter((text) => text && !/прайс|добавьте/i.test(text)).join(". ")}`,
        },
      });
      const images = (data.images || []).filter((image) => image?.url && !/svg/.test(image.mime || ""));
      if (images.length) {
        const made = ensureMade(id);
        made.mode = "grok";
        made.shots = ["", "", ""];
        images.slice(0, 3).forEach((image, index) => { made.shots[index] = image.url; });
        made.poster = 0;
        made.src = made.shots[0];
        storyFocus = id;
        renderStories();
      }
      const shotError = String(data.error || "").trim();
      const complete = images.length >= 3 && !shotError;
      const doneText = !images.length
        ? (shotError || "Кадр не собрался.")
        : complete
          ? `Три кадра «${slot.title}» нарисованы.`
          : `Собрали ${images.length} из 3.${shotError ? ` ${shotError}` : ""}`;
      if (status) status.textContent = doneText;
      if (complete) toast("Кадры готовы", `«${slot.title}»`);
      else toast(images.length ? "Кадр собрался не целиком" : "Кадр не собрался", shotError || doneText);
      if (images.length) {
        noteGenerated({
          target: "stories",
          kind: "image",
          title: `Сторис · «${slot.title}»`,
          text: "Кадр истории собран.",
          key: `story-image:${id}:${images[0].id || Date.now()}`,
        });
      }
    } catch (err) {
      const text = err.message || "Кадр не собрался.";
      if (status) status.textContent = text;
      toast("Кадр не собрался", text);
    } finally {
      const again = document.querySelector(`[data-gen-slot="${id}"]`);
      if (again && again.textContent === "Собираем…") {
        again.disabled = false;
        again.textContent = "Замещающий кадр";
      }
    }
  }

  function brandColorValue(id, fallback) {
    const color = String($(`#${id}`)?.value || "");
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function setBrandColor(id, value) {
    const next = /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "";
    if (!next) return;
    if ($(`#${id}`)) $(`#${id}`).value = next;
    if ($(`#${id}Hex`)) $(`#${id}Hex`).value = next.toUpperCase();
  }

  function syncBrandColorInput(target) {
    if (!target?.id) return;
    if (target.type === "color") {
      const hex = $(`#${target.id}Hex`);
      if (hex) hex.value = target.value.toUpperCase();
    }
    if (target.id.endsWith("Hex")) {
      const value = String(target.value || "").trim();
      const color = document.getElementById(target.id.replace(/Hex$/, ""));
      if (color && /^#[0-9a-f]{6}$/i.test(value)) color.value = value;
    }
    paintBrandPalettePressed();
  }

  function paintBrandPalettePressed() {
    const accent = brandColorValue("brandAccent", "").toUpperCase();
    const paper = brandColorValue("brandPaper", "").toUpperCase();
    const ink = brandColorValue("brandInk", "").toUpperCase();
    $$("#brandPalettes button").forEach((btn) => {
      const preset = BRAND_PALETTES[btn.dataset.brandPalette];
      const on = preset && preset.accent.toUpperCase() === accent && preset.paper.toUpperCase() === paper && preset.ink.toUpperCase() === ink;
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  function renderBrandPreview(book) {
    const palette = brandbookPalette(book);
    const hero = $("#brandPreviewHero");
    if (hero) {
      hero.style.background = palette.paper || "#F5EFE2";
      hero.style.color = palette.ink || "#1E1B16";
    }
    if ($("#brandPreviewName")) $("#brandPreviewName").textContent = book?.name || "Название бренда";
    if ($("#brandPreviewTagline")) $("#brandPreviewTagline").textContent = book?.tagline || "Слоган появится здесь";
    if ($("#brandPreviewSign")) $("#brandPreviewSign").textContent = book?.signature || "Подпись";
    if ($("#brandPreviewTone")) $("#brandPreviewTone").textContent = book?.tone?.label || book?.tone?.description || "—";
    if ($("#brandPreviewAudience")) $("#brandPreviewAudience").textContent = book?.audience || "—";
    const swatches = $("#brandPaletteView");
    if (swatches) {
      swatches.innerHTML = ["paper", "soft", "accent", "dark", "ink", "light"].map((key) => `<i style="background:${esc(palette[key])}" title="${key}"></i>`).join("");
    }
  }

  function fillBrandForm(book) {
    if ($("#brandName")) $("#brandName").value = book?.name || "";
    if ($("#brandTagline")) $("#brandTagline").value = book?.tagline || "";
    if ($("#brandMission")) $("#brandMission").value = book?.mission || "";
    if ($("#brandAudience")) $("#brandAudience").value = book?.audience || "";
    if ($("#brandTone")) $("#brandTone").value = book?.tone?.description || book?.tone?.label || "";
    if ($("#brandSignature")) $("#brandSignature").value = book?.signature || "";
    if ($("#brandImagery")) $("#brandImagery").value = book?.imagery?.style || "";
    if ($("#brandMaterialsUrl")) $("#brandMaterialsUrl").value = book?.materialsUrl || "";
    setBrandColor("brandAccent", /^#[0-9a-f]{6}$/i.test(String(book?.palette?.accent || "")) ? book.palette.accent : "#C56B2E");
    setBrandColor("brandPaper", /^#[0-9a-f]{6}$/i.test(String(book?.palette?.paper || "")) ? book.palette.paper : "#F5EFE2");
    setBrandColor("brandInk", /^#[0-9a-f]{6}$/i.test(String(book?.palette?.ink || "")) ? book.palette.ink : "#1E1B16");
    paintBrandPalettePressed();
    if ($("#brandDo")) $("#brandDo").textContent = (book?.do || []).join(", ") || "—";
    if ($("#brandDont")) $("#brandDont").textContent = (book?.dont || []).join(", ") || "—";
  }

  function applyBrandbookToStories(book) {
    if (!book) return;
    if ($("#storyCta") && !storyCtaTouched) $("#storyCta").value = book.cta || $("#storyCta").value;
    if ($("#storyTone") && !storyToneTouched) {
      const tone = String(book.tone?.label || book.tone?.key || "").toLowerCase();
      $("#storyTone").value = /корот|дел/.test(tone) ? "short" : /смел|уверен|замет/.test(tone) ? "bold" : "warm";
    }
  }

  function renderBrandbook(data) {
    brandbookMeta = data || {};
    currentBrandbook = data?.brandbook || null;
    const book = currentBrandbook;
    if ($("#brandStatusDot")) $("#brandStatusDot").classList.toggle("is-on", Boolean(book));
    if ($("#brandStatusTitle")) $("#brandStatusTitle").textContent = book ? "Материалы заданы" : "Материалы не заданы";
    if ($("#brandStatusText")) {
      $("#brandStatusText").textContent = book
        ? `«${book.name}» · ${book.tone?.label || "тон не задан"} · применяется к новым материалам.`
        : "Загрузите PDF/DOCX/TXT/JSON или соберите черновик с помощником — он станет единым стилем.";
    }
    const sourceLabel = book?.lookFrom === "files" ? "по файлам" : (brandSourceLabels[book?.source] || "—");
    if ($("#brandSource")) $("#brandSource").textContent = `источник: ${book ? sourceLabel : "—"}`;
    if ($("#brandFormState")) $("#brandFormState").textContent = book ? sourceLabel : "черновик";
    if ($("#brandUploadMeta")) {
      $("#brandUploadMeta").hidden = !data?.filename;
      if (data?.filename) $("#brandUploadMeta").textContent = `${data.filename}${data.updatedAt ? ` · обновлён ${new Date(data.updatedAt).toLocaleDateString("ru-RU")}` : ""}`;
    }
    const reference = $("#brandReference");
    if (reference) {
      if (book?.referenceFile && activeOrgId) {
        reference.hidden = false;
        reference.src = `/api/orgs/${activeOrgId}/brandbook/reference?t=${Date.now()}`;
      } else {
        reference.hidden = true;
        reference.removeAttribute("src");
      }
    }
    if ($("#brandRawWrap")) $("#brandRawWrap").hidden = !data?.rawText;
    if ($("#brandRaw") && data?.rawText) $("#brandRaw").textContent = data.rawText;
    if ($("#brandSaveStatus")) $("#brandSaveStatus").textContent = book ? "Изменения применятся к новым генерациям." : "Заполните поля или загрузите файл.";
    renderBrandPreview(book);
    fillBrandForm(book);
    applyBrandbookToStories(book);
    serverStoryVariants = [];
    if ($("#storyGrid")) renderStories();
    if (location.hash === "#storefront") renderStorefront(storefrontItems);
    refreshPricePreview();
    paintLookHosts();
  }

  async function loadBrandbook() {
    if (!serverActive || !activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/brandbook`);
      renderBrandbook(data);
      if (location.hash === "#stories" && $("#storyGrid")) renderStories();
    } catch (err) {
      if ($("#brandStatusText")) $("#brandStatusText").textContent = liveErrorText(err, "Не удалось загрузить материалы.");
      toast("Брендбук недоступен", err.message);
    }
  }

  function cloudUrlFromText(value) {
    const raw = String(value || "").replace(/\u00a0/g, " ").trim();
    if (!raw) return "";
    const scheme = raw.match(/https?:\/\/[^\s<>"']+/i);
    let candidate = scheme ? scheme[0] : "";
    if (!candidate) {
      const host = raw.match(/(?:disk\.yandex\.(?:ru|com|by|kz)|yadi\.sk|drive\.google\.com|docs\.google\.com)\/[^\s<>"']+/i);
      if (host) candidate = `https://${host[0]}`;
    }
    candidate = candidate.replace(/[),.;]+$/, "");
    if (!candidate) return "";
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      url.protocol = "https:";
      url.hash = "";
      return url.toString().slice(0, 500);
    } catch {
      return "";
    }
  }

  function collectBrandbook() {
    const current = currentBrandbook || {};
    const materialsRaw = String($("#brandMaterialsUrl")?.value || "").trim();
    return {
      ...current,
      name: String($("#brandName")?.value || "").trim(),
      tagline: String($("#brandTagline")?.value || "").trim(),
      mission: String($("#brandMission")?.value || "").trim(),
      audience: String($("#brandAudience")?.value || "").trim(),
      tone: { ...(current.tone || {}), description: String($("#brandTone")?.value || "").trim() },
      signature: String($("#brandSignature")?.value || "").trim(),
      materialsUrl: cloudUrlFromText(materialsRaw) || materialsRaw,
      imagery: { ...(current.imagery || {}), style: String($("#brandImagery")?.value || "").trim() },
      palette: {
        ...(current.palette || {}),
        accent: brandColorValue("brandAccent", current.palette?.accent || "#C56B2E"),
        paper: brandColorValue("brandPaper", current.palette?.paper || "#F5EFE2"),
        ink: brandColorValue("brandInk", current.palette?.ink || "#1E1B16"),
      },
      source: current.source || "manual",
    };
  }

  async function saveBrandbook() {
    if (!serverActive || !activeOrgId) { toast("Нет соединения с API", apiMissingText()); return; }
    const button = $("#brandSaveBtn");
    if (button) button.disabled = true;
    if ($("#brandSaveStatus")) {
      $("#brandSaveStatus").textContent = String($("#brandMaterialsUrl")?.value || "").trim()
        ? "Собираем три варианта по ссылке…"
        : "Сохраняем…";
    }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/brandbook`, { method: "POST", body: { brandbook: collectBrandbook() } });
      renderBrandbook(data);
      const materialsUrl = String($("#brandMaterialsUrl")?.value || "").trim();
      const materialsNote = data?.cloud?.message || (materialsUrl
        ? "Ссылка сохранена."
        : "Сторис, новости и ответы будут опираться на них.");
      if ($("#brandSaveStatus")) $("#brandSaveStatus").textContent = materialsNote;
      if (data?.cloud?.variants?.length >= 3) openLookModal();
      else toast("Материалы сохранены", materialsNote);
    } catch (err) {
      if ($("#brandSaveStatus")) $("#brandSaveStatus").textContent = err.message;
      toast("Не удалось сохранить брендбук", err.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function generateBrandbookDraft() {
    if (!serverActive || !activeOrgId) { toast("Нет соединения с API", apiMissingText()); return; }
    const button = $("#brandGenerateBtn");
    if (button) button.disabled = true;
    if ($("#brandStatusText")) $("#brandStatusText").textContent = "Собираем черновик по данным карточки…";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/brandbook/generate`, {
        method: "POST",
        body: { notes: String($("#brandNotes")?.value || "").trim() },
      });
      renderBrandbook(data);
      toast("Черновик брендбука готов", "Проверьте поля и сохраните, если всё верно.");
    } catch (err) {
      if ($("#brandStatusText")) $("#brandStatusText").textContent = err.message;
      toast("Не удалось собрать брендбук", err.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function uploadBrandbookFile(file) {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast("Файл слишком большой", "Максимум 6 МБ."); return; }
    if (!serverActive || !activeOrgId) { toast("Нет соединения с API", apiMissingText()); return; }
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
      reader.readAsDataURL(file);
    }).catch((err) => { toast("Не удалось прочитать файл", err.message); return ""; });
    if (!base64) return;
    const image = /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
    if ($("#brandStatusText")) $("#brandStatusText").textContent = image ? "Собираем три варианта по фото…" : "Читаем файл…";
    if (image && $("#brandSaveStatus")) $("#brandSaveStatus").textContent = "Собираем три варианта по фото…";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/brandbook/upload`, {
        method: "POST",
        body: { filename: file.name, contentBase64: base64 },
      });
      renderBrandbook(data);
      const note = data?.cloud?.message || (image
        ? "Оформление собрано по фото."
        : "Проверьте распознанные поля и сохраните правки.");
      if ($("#brandSaveStatus")) $("#brandSaveStatus").textContent = note;
      if (data?.cloud?.variants?.length >= 3) openLookModal();
      else toast(image ? "Фото принято" : "Брендбук загружен", note);
    } catch (err) {
      if ($("#brandStatusText")) $("#brandStatusText").textContent = err.message;
      toast("Не удалось загрузить брендбук", err.message);
    }
  }

  /* ---------- clients / brandbook events ---------- */
  $("#clientTemplateLink")?.addEventListener("click", (event) => {
    if (!activeOrgId) event.preventDefault();
  });
  $("#clientImportBtn")?.addEventListener("click", () => $("#clientFile")?.click());
  $("#clientEmptyImport")?.addEventListener("click", () => $("#clientFile")?.click());
  $("#clientImportHintBtn")?.addEventListener("click", () => {
    toast("Импорт клиентов", "Excel/CSV: колонки «Имя», «Телефон», «Мессенджер», «Дата визита», «Услуга», «Согласие». JSON: массив clients. Шаблон можно скачать рядом.");
  });
  $("#clientFile")?.addEventListener("change", (event) => importClientFile(event.target.files?.[0]));
  $("#clientRefreshBtn")?.addEventListener("click", loadClients);
  $("#clientSearch")?.addEventListener("input", renderClientList);
  $("#clientStatusFilter")?.addEventListener("change", renderClientList);
  $("#clientAddBtn")?.addEventListener("click", () => openClientForm());
  $("#clientEmptyImport")?.addEventListener("click", () => $("#clientFile")?.click());
  $("#clientFormClose")?.addEventListener("click", closeClientForm);
  $("#clientFormCancel")?.addEventListener("click", closeClientForm);
  $("#clientForm")?.addEventListener("submit", saveClientForm);
  $("#clientEditBtn")?.addEventListener("click", () => {
    const client = clientById(selectedClientId);
    if (client) openClientForm(client);
  });
  $("#clientDeleteBtn")?.addEventListener("click", deleteClient);
  $("#clientList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-client-id]");
    if (!row) return;
    selectedClientId = Number(row.dataset.clientId);
    renderClients();
  });
  $("#clientRequestGen")?.addEventListener("click", generateClientRequest);
  $("#clientRequestCopy")?.addEventListener("click", () => copyClientText($("#clientRequestText")?.value, "Сообщение скопировано"));
  $("#clientFeedbackSave")?.addEventListener("click", saveClientFeedback);
  $("#clientReviewGen")?.addEventListener("click", regenerateClientReview);
  $("#clientReviewCopy")?.addEventListener("click", () => copyClientText($("#clientReviewText")?.value, "Отзыв скопирован"));
  $("#clientPublishCopy")?.addEventListener("click", () => copyClientText($("#clientPublishText")?.value, "Сообщение со ссылкой скопировано"));
  $("#clientMarkSent")?.addEventListener("click", markClientSent);
  $("#clientRequestOpen")?.addEventListener("click", (event) => {
    if (!event.currentTarget.getAttribute("href") || event.currentTarget.getAttribute("href") === "#") {
      event.preventDefault();
      toast("Нужен контакт", "Укажите телефон, @Telegram или e-mail клиента.");
    }
  });
  $("#clientPublishOpen")?.addEventListener("click", (event) => {
    if (!event.currentTarget.getAttribute("href") || event.currentTarget.getAttribute("href") === "#") {
      event.preventDefault();
      toast("Нужен контакт", "Укажите контакт клиента в карточке.");
    }
  });
  $("#clientReviewMaps")?.addEventListener("click", () => {
    const client = clientById(selectedClientId);
    const url = client?.orgCardUrl || client?.reviewLink || currentCardUrl || "";
    if (!url || url === "#") {
      toast("Ссылка на карточку не задана", "Добавьте ссылку на Яндекс.Карты — без неё отзыв некуда вести.");
      showView("overview");
      return;
    }
    window.open(url, "_blank", "noopener");
  });

  $("#lookModal")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-look-close]")) closeLookModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#lookModal") && !$("#lookModal").hidden) closeLookModal();
  });
  $("#brandUploadBtn")?.addEventListener("click", () => $("#brandFile")?.click());
  $("#brandDrop")?.addEventListener("click", () => $("#brandFile")?.click());
  $("#brandDrop")?.addEventListener("dragover", (event) => {
    event.preventDefault();
    $("#brandDrop")?.classList.add("is-over");
  });
  $("#brandDrop")?.addEventListener("dragleave", () => $("#brandDrop")?.classList.remove("is-over"));
  $("#brandDrop")?.addEventListener("drop", (event) => {
    event.preventDefault();
    $("#brandDrop")?.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadBrandbookFile(file);
  });
  $("#view-brandbook")?.addEventListener("paste", (event) => {
    const image = [...(event.clipboardData?.files || [])].find((file) => /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name));
    if (image) {
      event.preventDefault();
      uploadBrandbookFile(image);
      return;
    }
    const target = event.target;
    if (target && target !== $("#brandMaterialsUrl") && (target.matches?.("input, textarea") || target.isContentEditable)) return;
    const url = cloudUrlFromText(event.clipboardData?.getData("text/plain") || "");
    const input = $("#brandMaterialsUrl");
    if (!url || !input) return;
    event.preventDefault();
    input.value = url;
    if ($("#brandSaveStatus")) $("#brandSaveStatus").textContent = "Ссылка вставлена. Нажмите «Сохранить», чтобы собрать оформление по фото.";
  });
  $("#brandMaterialsUrl")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveBrandbook();
  });
  $("#brandFile")?.addEventListener("change", (event) => uploadBrandbookFile(event.target.files?.[0]));
  $("#brandGenerateBtn")?.addEventListener("click", generateBrandbookDraft);
  $("#brandSaveBtn")?.addEventListener("click", saveBrandbook);
  $("#brandbookForm")?.addEventListener("submit", (event) => { event.preventDefault(); saveBrandbook(); });
  $("#brandbookForm")?.addEventListener("input", (event) => {
    syncBrandColorInput(event.target);
    renderBrandPreview(collectBrandbook());
  });
  $("#brandPalettes")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-brand-palette]");
    const preset = BRAND_PALETTES[btn?.dataset.brandPalette];
    if (!preset) return;
    setBrandColor("brandAccent", preset.accent);
    setBrandColor("brandPaper", preset.paper);
    setBrandColor("brandInk", preset.ink);
    paintBrandPalettePressed();
    renderBrandPreview(collectBrandbook());
  });
  $("#brandRawToggle")?.addEventListener("click", () => {
    const raw = $("#brandRaw");
    if (!raw) return;
    raw.hidden = !raw.hidden;
    $("#brandRawToggle")?.setAttribute("aria-expanded", String(!raw.hidden));
  });


  /* ================= КАЛЕНДАРЬ ================= */
  const CAL_MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const CAL_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  function calMonthTitle(month) {
    const [year, m] = String(month).split("-").map(Number);
    return `${CAL_MONTHS[m - 1] || "месяц"} ${year}`;
  }

  function calDayLabel(dateKey) {
    const date = new Date(`${dateKey}T12:00:00`);
    return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(date);
  }

  function calTaskChip(task) {
    return `<button class="cal-task cal-task--${esc(task.kind)}" type="button" data-cal-task="${esc(task.id)}" title="${esc(task.title)} · ${esc(task.statusLabel)}"><span>${esc(task.time || "—")}</span>${esc(task.title)}</button>`;
  }

  function renderCalendar(data) {
    if (!data) return;
    calendarData = data;
    const [year, month] = String(data.month).split("-").map(Number);
    if ($("#calMonthTitle")) $("#calMonthTitle").textContent = calMonthTitle(data.month);
    const total = (data.tasks || []).length;
    if ($("#calSub")) $("#calSub").textContent = total ? `${total} ${total === 1 ? "задача" : total < 5 ? "задачи" : "задач"} в этом месяце — план, публикации и отчёты` : "План действий, публикаций и отчётов — по дням";
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const todayKey = new Date().toISOString().slice(0, 10);
    if (!calendarSelected || !calendarSelected.startsWith(`${data.month}-`)) calendarSelected = todayKey.startsWith(`${data.month}-`) ? todayKey : `${data.month}-01`;
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const dayNumber = i - offset + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        cells.push('<div class="cal-day is-muted" aria-hidden="true"></div>');
        continue;
      }
      const dateKey = `${data.month}-${String(dayNumber).padStart(2, "0")}`;
      const tasks = data.byDay?.[dateKey] || [];
      const classes = ["cal-day"];
      if (dateKey === todayKey) classes.push("is-today");
      if (dateKey === calendarSelected) classes.push("is-selected");
      if (tasks.length) classes.push("has-tasks");
      cells.push(`<div class="${classes.join(" ")}" data-cal-date="${dateKey}" role="gridcell" tabindex="0" aria-label="${esc(calDayLabel(dateKey))}, задач: ${tasks.length}"><span class="cal-day-num">${dayNumber}</span><span class="cal-day-tasks">${tasks.slice(0, 3).map(calTaskChip).join("")}${tasks.length > 3 ? `<span class="cal-more">+${tasks.length - 3}</span>` : ""}</span></div>`);
    }
    if ($("#calendarGrid")) $("#calendarGrid").innerHTML = cells.join("");
    const selectedTasks = data.byDay?.[calendarSelected] || [];
    if ($("#calAgendaTitle")) $("#calAgendaTitle").textContent = calendarSelected ? calDayLabel(calendarSelected) : "Выберите день";
    if ($("#calAgendaSub")) $("#calAgendaSub").textContent = selectedTasks.length ? `${selectedTasks.length} ${selectedTasks.length === 1 ? "задача" : "задач"} · нажмите, чтобы открыть раздел` : "На этот день пока ничего не запланировано";
    if ($("#calDayCount")) $("#calDayCount").textContent = String(selectedTasks.length);
    if ($("#calAgenda")) {
      $("#calAgenda").innerHTML = selectedTasks.length
        ? selectedTasks.map((task) => `<button type="button" class="cal-agenda-row" data-cal-task="${esc(task.id)}"><span class="cal-dot cal-dot--${esc(task.kind)}"></span><span><strong>${esc(task.title)}</strong><small>${esc(task.statusLabel)}${task.time ? ` · ${esc(task.time)}` : ""}</small></span><b>→</b></button>`).join("")
        : `<div class="empty-state empty-state--compact"><strong>Свободный день</strong><p>Запланируйте ответ на отзыв или публикацию — задача появится в очереди автопилота.</p></div>`;
    }
  }

  async function loadCalendar(month = calendarMonth) {
    if (!serverActive || !activeOrgId) {
      if ($("#calAgenda")) $("#calAgenda").innerHTML = '<div class="empty-state empty-state--compact"><strong>Нужен вход</strong><p>Календарь строится по данным вашей организации.</p></div>';
      return;
    }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/calendar?month=${encodeURIComponent(month)}`);
      calendarMonth = data.month;
      renderCalendar(data);
    } catch (err) {
      toast("Календарь", err.message || "Не удалось загрузить");
    }
  }

  function selectCalendarDay(dateKey) {
    calendarSelected = dateKey;
    if (calendarData) renderCalendar(calendarData);
  }

  async function addCalendarTask() {
    if (!activeOrgId) return;
    const title = window.prompt("Что запланировать? Например: «Ответить на отзыв» или «Новость про завтраки»", "") || "";
    if (!title.trim()) return;
    try {
      await apiJson(`/api/orgs/${activeOrgId}/autopilot/queue`, {
        method: "POST",
        body: { type: "card_update", title, payload: { source: "calendar" }, scheduledAt: `${calendarSelected}T09:00:00.000Z` },
      });
      toast("Запланировано", `${calDayLabel(calendarSelected)} — задача в очереди автопилота.`);
      await loadCalendar(calendarMonth);
    } catch (err) {
      toast("Не запланировано", err.message || "");
    }
  }

  $("#calPrev")?.addEventListener("click", () => {
    const [year, month] = calendarMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 2, 1));
    loadCalendar(date.toISOString().slice(0, 7));
  });
  $("#calNext")?.addEventListener("click", () => {
    const [year, month] = calendarMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month, 1));
    loadCalendar(date.toISOString().slice(0, 7));
  });
  $("#calTodayTop")?.addEventListener("click", () => loadCalendar(new Date().toISOString().slice(0, 7)));
  $("#calRefresh")?.addEventListener("click", () => loadCalendar(calendarMonth));
  $("#calAddTask")?.addEventListener("click", addCalendarTask);
  $("#calSpread")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    const button = $("#calSpread");
    if (button) button.disabled = true;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/calendar/spread`, { method: "POST", body: {} });
      toast("Месяц разложен", data.note || "Карточка поднимается в выдаче. Первое место не обещаем.");
      if ($("#calSub")) $("#calSub").textContent = data.note || $("#calSub").textContent;
      if (data.calendar) renderCalendar(data.calendar);
      else await loadCalendar(calendarMonth);
    } catch (err) {
      toast("Не разложено", err.message || "");
    } finally {
      if (button) button.disabled = false;
    }
  });
  $("#calendarGrid")?.addEventListener("click", (event) => {
    const task = event.target.closest("[data-cal-task]");
    if (task && calendarData) {
      const found = (calendarData.tasks || []).find((item) => item.id === task.dataset.calTask);
      if (found?.view) { showView(found.view); return; }
    }
    const day = event.target.closest("[data-cal-date]");
    if (day) selectCalendarDay(day.dataset.calDate);
  });
  $("#calendarGrid")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const day = event.target.closest("[data-cal-date]");
    if (!day) return;
    event.preventDefault();
    selectCalendarDay(day.dataset.calDate);
  });
  $("#calAgenda")?.addEventListener("click", (event) => {
    const task = event.target.closest("[data-cal-task]");
    if (!task || !calendarData) return;
    const found = (calendarData.tasks || []).find((item) => item.id === task.dataset.calTask);
    if (found?.view) showView(found.view);
  });

  /* ================= КАБИНЕТ ЯНДЕКСА ================= */
  const cabinetStatus = { ready: "заполнено", partial: "частично", empty: "пусто", tariff: "ждёт тариф", absent: "в Локусе нет блока" };
  const cabinetOfferChip = { generate: "собрать", improve: "улучшить", ask: "нужен факт" };
  let cabinetOfferState = [];

  function paintCardSurfaces(org) {
    const booking = org?.card?.booking || {};
    const url = booking.url || "";
    const ask = booking.ask || "Куда ведёт кнопка записи: сайт или форма клиента? Ссылку не придумываем, поле пустое.";
    if ($("#storyLink")) $("#storyLink").value = url;
    if ($("#storyBooking")) $("#storyBooking").textContent = url ? `Кнопка сторис: ${url}` : ask;
    if ($("#storefrontBooking")) $("#storefrontBooking").textContent = url ? `Кнопка витрины: ${url}` : ask;
    if ($("#priceBooking")) $("#priceBooking").textContent = url ? `Ссылка прайса: ${url}` : `Ссылка прайса: ${ask}`;
  }

  function switchFormValue(value) {
    if (value === true) return "show";
    if (value === false) return "hide";
    return "";
  }

  function setCardInput(id, value) {
    const el = $(`#${id}`);
    if (!el || document.activeElement === el) return;
    el.value = value ?? "";
  }

  function fillCardForm(card) {
    if (!card) return;
    setCardInput("cardName", card.name?.value);
    setCardInput("cardShortName", card.shortName?.value);
    setCardInput("cardRubricMain", card.rubricMain?.value);
    setCardInput("cardRubricsSecondary", (card.rubricsSecondary || []).join(", "));
    setCardInput("cardPhone", card.phone?.value);
    setCardInput("cardSite", card.site?.value);
    const contact = (id) => (card.contacts || []).find((item) => item.id === id)?.value || "";
    setCardInput("cardSocial", contact("social"));
    setCardInput("cardEmail", contact("email"));
    setCardInput("cardMessenger", contact("messenger"));
    setCardInput("cardAddress", card.address?.value);
    setCardInput("cardAddressComment", card.addressComment?.value);
    setCardInput("cardStatus", card.workStatus || "");
    setCardInput("cardBooking", card.booking?.url);
    setCardInput("cardHoursWeekdays", card.hours?.weekdays);
    setCardInput("cardHoursWeekends", card.hours?.weekends);
    setCardInput("cardHoursHolidays", card.hours?.holidays);
    if ($("#cardHoursAsk")) {
      $("#cardHoursAsk").textContent = card.hours?.ask
        || (card.hours?.closed ? "" : "Если часы пустые, нужны будни, выходные и праздники.");
    }
    setCardInput("cardFeatures", (card.features || []).join("\n"));
    const photo = (id) => (card.photos || []).find((item) => item.id === id)?.value || "";
    setCardInput("cardPhotoLogo", photo("logo"));
    setCardInput("cardPhotoEntrance", photo("entrance"));
    setCardInput("cardPhotoInside", photo("inside"));
    setCardInput("cardPhotoWork", photo("work"));
    setCardInput("cardPhotoOutside", photo("outside"));
    setCardInput("cardPromoAnnouncement", card.promo?.announcement);
    setCardInput("cardPromoDescription", card.promo?.description);
    setCardInput("cardPromoEnds", card.promo?.ends);
    if ($("#cardPromoPrompt")) $("#cardPromoPrompt").textContent = card.promo?.prompt || "";
    setCardInput("cardEventTopic", card.event?.topic);
    setCardInput("cardEventStart", card.event?.start);
    setCardInput("cardEventEnd", card.event?.end);
    setCardInput("cardEventVideo", card.event?.video);
    const sw = (id) => (card.switches || []).find((item) => item.id === id);
    setCardInput("cardShowAbout", switchFormValue(sw("showAboutPlace")?.value));
    setCardInput("cardShowCaptions", switchFormValue(sw("showCaptions")?.value));
    setCardInput("cardShowPin", switchFormValue(sw("showPinPhoto")?.value));
    setCardInput("cardAboutShort", card.aboutShort?.value);
    setCardInput("cardAboutExtended", card.aboutExtended?.value);
    const list = card.ownerChecklist;
    const box = $("#ownerChecklist");
    if (box && list) {
      box.hidden = false;
      if ($("#ownerChecklistNote")) $("#ownerChecklistNote").textContent = list.note || "";
      if ($("#ownerChecklistCount")) $("#ownerChecklistCount").textContent = `${list.ready} из ${list.total}`;
      if ($("#ownerChecklistItems")) {
        $("#ownerChecklistItems").innerHTML = (list.items || []).map((item) => `<li><span>${esc(item.label)}</span><strong>${item.ready ? "собрано здесь" : esc(item.ask || "пусто")}</strong></li>`).join("");
      }
    }
  }

  function cardProfilePayload(extra = {}) {
    const lines = (id) => String($(`#${id}`)?.value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
    const rubrics = String($("#cardRubricsSecondary")?.value || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
    const sw = (id) => {
      const value = String($(`#${id}`)?.value || "");
      if (value === "show") return true;
      if (value === "hide") return false;
      return null;
    };
    return {
      name: String($("#cardName")?.value || "").trim(),
      shortName: String($("#cardShortName")?.value || "").trim(),
      rubricMain: String($("#cardRubricMain")?.value || "").trim(),
      rubricsSecondary: rubrics,
      features: lines("cardFeatures"),
      phone: String($("#cardPhone")?.value || "").trim(),
      site: String($("#cardSite")?.value || "").trim(),
      contacts: {
        social: String($("#cardSocial")?.value || "").trim(),
        email: String($("#cardEmail")?.value || "").trim(),
        messenger: String($("#cardMessenger")?.value || "").trim(),
      },
      address: String($("#cardAddress")?.value || "").trim(),
      addressComment: String($("#cardAddressComment")?.value || "").trim(),
      workStatus: String($("#cardStatus")?.value || ""),
      bookingUrl: String($("#cardBooking")?.value || "").trim(),
      hoursWeekdays: String($("#cardHoursWeekdays")?.value || "").trim(),
      hoursWeekends: String($("#cardHoursWeekends")?.value || "").trim(),
      hoursHolidays: String($("#cardHoursHolidays")?.value || "").trim(),
      photos: {
        logo: String($("#cardPhotoLogo")?.value || "").trim(),
        entrance: String($("#cardPhotoEntrance")?.value || "").trim(),
        inside: String($("#cardPhotoInside")?.value || "").trim(),
        work: String($("#cardPhotoWork")?.value || "").trim(),
        outside: String($("#cardPhotoOutside")?.value || "").trim(),
      },
      promoAnnouncement: String($("#cardPromoAnnouncement")?.value || "").trim(),
      promoDescription: String($("#cardPromoDescription")?.value || "").trim(),
      promoEnds: String($("#cardPromoEnds")?.value || "").trim(),
      eventTopic: String($("#cardEventTopic")?.value || "").trim(),
      eventStart: String($("#cardEventStart")?.value || "").trim(),
      eventEnd: String($("#cardEventEnd")?.value || "").trim(),
      eventVideo: String($("#cardEventVideo")?.value || "").trim(),
      showAboutPlace: sw("cardShowAbout"),
      showCaptions: sw("cardShowCaptions"),
      showPinPhoto: sw("cardShowPin"),
      aboutShort: String($("#cardAboutShort")?.value || "").trim(),
      aboutExtended: String($("#cardAboutExtended")?.value || "").trim(),
      ...extra,
    };
  }

  function renderCabinetOffers(offers) {
    cabinetOfferState = Array.isArray(offers) ? offers : [];
    const root = $("#cabinetOffers");
    if (!root) return;
    root.innerHTML = cabinetOfferState.map((offer) => {
      const pending = offer.pending
        ? `<p class="cabinet-draft-text">${esc(offer.pending)}</p>${offer.accept ? `<button class="mini-btn" type="button" data-cab-accept="${esc(offer.id)}">Принять в кабинет</button>` : ""}`
        : "";
      return `<article class="cabinet-group cabinet-offer">
        <header><h3>${esc(offer.label)}</h3><span class="chip">${esc(cabinetOfferChip[offer.mode] || offer.mode)}</span></header>
        ${offer.current ? `<p class="gate">Сейчас: ${esc(offer.current)}</p>` : ""}
        ${offer.detail ? `<p class="gate">${esc(offer.detail)}</p>` : ""}
        ${offer.ask ? `<p class="gate">${esc(offer.ask)}</p>` : ""}
        <button class="mini-btn" type="button" data-cab-run="${esc(offer.id)}">${esc(offer.action)}</button>
        <div class="cabinet-offer-result">${pending}</div>
      </article>`;
    }).join("");
  }

  function paintCabinetOfferResult(box, offer, data) {
    if (!box) return;
    if (offer.id === "reviewReply" && data.reply?.text) {
      box.innerHTML = `<p class="cabinet-draft-text">${esc(data.reply.text)}</p><p class="gate">Черновик ответа в кабинете. В Яндекс.Карты он не отправлен.</p>`;
      return;
    }
    if (offer.id === "news" && (data.body || data.headline)) {
      const text = [data.headline, data.body].filter(Boolean).join("\n\n").slice(0, 900);
      box.innerHTML = `<p class="cabinet-draft-text">${esc(text)}</p><p class="gate">Черновик целиком лежит в публикациях. В Яндекс.Карты он не отправлен.</p>`;
      return;
    }
    if (!data.draft) {
      box.innerHTML = `<p class="gate">${esc(data.ask || offer.ask || "Нужен факт. Поле остаётся пустым.")}</p>`;
      return;
    }
    const ask = data.ask ? `<p class="gate">${esc(data.ask)}</p>` : "";
    const accept = data.accept === false
      ? ""
      : `<button class="mini-btn" type="button" data-cab-accept="${esc(offer.id)}">Принять в кабинет</button>`;
    box.innerHTML = `${ask}<p class="cabinet-draft-text">${esc(data.draft)}</p>${accept}<p class="gate">Это черновик. Поле изменится после «Принять в кабинет». В Карты само не уйдёт.</p>`;
  }

  let cabinetGroupsCache = [];
  let cabinetOpen = "";

  function cabinetPhotoField(id, label) {
    const value = String($(`#${id}`)?.value || "");
    return `<label class="field">${label}<input data-sync="${id}" value="${esc(value)}" placeholder="Адрес появится после загрузки"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" data-card-photo="${id}" aria-label="Загрузить: ${esc(label)}"></label>`;
  }

  function imageMime(file) {
    const mime = String(file?.type || "").toLowerCase().split(";")[0].trim();
    if (mime === "image/jpg") return "image/jpeg";
    if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) return mime;
    const name = String(file?.name || "");
    if (/\.jpe?g$/i.test(name)) return "image/jpeg";
    if (/\.png$/i.test(name)) return "image/png";
    if (/\.webp$/i.test(name)) return "image/webp";
    if (/\.gif$/i.test(name)) return "image/gif";
    return "";
  }

  async function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Файл не читается"));
      reader.readAsDataURL(file);
    });
  }

  async function uploadCardPhoto(slotId, file, input) {
    if (!serverActive || !activeOrgId) {
      toast("Нет соединения с API", apiMissingText());
      if (input) input.value = "";
      return;
    }
    if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) {
      toast("Нужен файл", "jpeg, png, webp или gif. Рисунок сюда не ставим.");
      if (input) input.value = "";
      return;
    }
    const mime = imageMime(file);
    if (!mime) {
      toast("Нужен файл", "jpeg, png, webp или gif.");
      if (input) input.value = "";
      return;
    }
    try {
      const dataUrl = await readDataUrl(file);
      const created = await apiJson(`/api/orgs/${activeOrgId}/images/upload`, {
        method: "POST",
        body: { contentBase64: dataUrl.replace(/^data:[^,]*,/, ""), mime, filename: file.name },
      });
      const url = String(created.url || "").trim();
      if (!url) throw new Error("Сервер не вернул адрес файла.");
      const target = document.getElementById(slotId);
      if (target) target.value = url;
      $$(`[data-sync="${slotId}"]`).forEach((el) => { el.value = url; });
      await saveCardProfile({ okTitle: "Фото в слоте", okText: "Файл записан в кабинет. В Карты сам не уходит." });
    } catch (err) {
      toast("Не загрузили", liveErrorText(err, "Не удалось загрузить фото."));
    } finally {
      if (input) input.value = "";
    }
  }

  function cabinetField(id, label, area = false) {
    const value = String($(`#${id}`)?.value || "");
    return area
      ? `<label class="field">${label}<textarea data-sync="${id}" rows="3">${esc(value)}</textarea></label>`
      : `<label class="field">${label}<input data-sync="${id}" value="${esc(value)}"></label>`;
  }

  function cabinetOfferBox(id) {
    const offer = cabinetOfferState.find((item) => item.id === id);
    if (!offer) return "";
    const pending = offer.pending
      ? `<p class="cabinet-draft-text">${esc(offer.pending)}</p>${offer.accept ? `<button class="mini-btn" type="button" data-cab-accept="${esc(offer.id)}">Принять</button>` : ""}`
      : "";
    return `<div class="cabinet-editor-offer">
      ${offer.detail ? `<p class="gate">${esc(offer.detail)}</p>` : ""}
      ${offer.ask ? `<p class="gate">${esc(offer.ask)}</p>` : ""}
      <button class="mini-btn" type="button" data-cab-run="${esc(offer.id)}">${esc(offer.action)}</button>
      <div class="cabinet-offer-result">${pending}</div>
    </div>`;
  }

  function cabinetEditor(group) {
    const save = `<button class="mini-btn" type="button" data-cab-save>Сохранить текст</button>`;
    if (group.id === "goods") {
      return `<div class="cabinet-editor"><p class="gate">Фото и описание позиции пишутся в прайсе. Свой кадр гостя рисуется на витрине и фото прайса не затирает.</p><button class="mini-btn" type="button" data-view="prices">Открыть прайс</button><button class="mini-btn" type="button" data-view="storefront">Открыть витрину</button></div>`;
    }
    if (group.id === "stories") {
      return `<div class="cabinet-editor"><p class="gate">Серия и кадр собираются в сторис. Из кабинета картинку не рисуем.</p><button class="mini-btn" type="button" data-view="stories">Открыть сторис</button></div>`;
    }
    if (group.id === "reviews") {
      return `<div class="cabinet-editor"><p class="gate">Ответ пишется в отзывах.</p><button class="mini-btn" type="button" data-view="reviews">Открыть отзывы</button></div>`;
    }
    if (group.id === "posts") {
      return `<div class="cabinet-editor">${cabinetOfferBox("news")}<button class="mini-btn" type="button" data-view="news">Открыть новости</button></div>`;
    }
    if (group.id === "photos") {
      return `<div class="cabinet-editor"><p class="gate">Свои фото профиля. Сторис и прайс здесь не рисуем. Вход — фотография двери, не рисунок.</p>${cabinetPhotoField("cardPhotoLogo", "Логотип")}${cabinetPhotoField("cardPhotoEntrance", "Вход")}${cabinetPhotoField("cardPhotoInside", "Внутри")}${cabinetPhotoField("cardPhotoWork", "Работа")}${cabinetPhotoField("cardPhotoOutside", "Снаружи")}${save}</div>`;
    }
    if (group.id === "events") {
      return `<div class="cabinet-editor">${cabinetField("cardEventTopic", "Тема")}${cabinetField("cardEventStart", "Начало")}${cabinetField("cardEventEnd", "Конец")}${save}</div>`;
    }
    if (group.id === "promos") {
      return `<div class="cabinet-editor"><div class="promo-offer"><p class="gate">Зелёная акция на карточке. Читаем акции конкурентов и ставим самую конкретную из прайса.</p><button class="mini-btn" type="button" data-promo-offer>Собрать УТП</button><div class="promo-offer-result"></div></div>${cabinetField("cardPromoAnnouncement", "Анонс")}${cabinetField("cardPromoDescription", "Описание", true)}${cabinetField("cardPromoEnds", "Окончание")}${save}</div>`;
    }
    if (group.id === "data") {
      return `<div class="cabinet-editor">${cabinetField("cardName", "Полное название")}${cabinetField("cardRubricMain", "Основная рубрика")}${cabinetField("cardPhone", "Телефон")}${cabinetField("cardSite", "Сайт")}${cabinetField("cardAddress", "Адрес")}${cabinetField("cardHoursWeekdays", "Будни")}${cabinetField("cardHoursWeekends", "Выходные")}${cabinetField("cardHoursHolidays", "Праздники")}${cabinetField("cardBooking", "Ссылка записи")}${cabinetField("cardAboutShort", "О компании, коротко", true)}${cabinetOfferBox("hours")}${cabinetOfferBox("bookingText")}${cabinetOfferBox("aboutShort")}${cabinetOfferBox("aboutExtended")}${cabinetOfferBox("features")}${save}</div>`;
    }
    return `<div class="cabinet-editor"><p class="gate">Этого блока в Локусе нет. В кабинете Яндекса раздел на месте.</p></div>`;
  }

  function offerForCabinetField(id) {
    const key = id === "booking" ? "bookingText" : id;
    return cabinetOfferState.find((item) => item.id === key) || null;
  }

  function cabinetFieldRow(item) {
    const offer = offerForCabinetField(item.id);
    const hint = !item.ready && item.ask ? item.ask : (offer?.detail || "");
    const action = offer
      ? `<button class="mini-btn" type="button" data-cab-run="${esc(offer.id)}">${esc(offer.action)}</button><div class="cabinet-offer-result"></div>`
      : "";
    return `<li class="${offer ? "cabinet-editor-offer" : ""}"><span>${esc(item.label)}</span><strong>${esc(item.value || "—")}</strong>${hint ? `<em>${esc(hint)}</em>` : ""}${action}</li>`;
  }

  function paintFieldOffers() {
    document.querySelectorAll("#cardProfileForm .field-offer").forEach((node) => node.remove());
    const pairs = [
      ["cardAboutShort", "aboutShort"],
      ["cardAboutExtended", "aboutExtended"],
      ["cardFeatures", "features"],
      ["cardHoursAsk", "hours"],
      ["cardBooking", "bookingText"],
    ];
    for (const [fieldId, offerId] of pairs) {
      const field = document.getElementById(fieldId);
      const offer = cabinetOfferState.find((item) => item.id === offerId);
      if (!field || !offer) continue;
      const hint = offer.ask || offer.detail || "";
      const bar = document.createElement("div");
      bar.className = "field-offer cabinet-editor-offer";
      bar.innerHTML = `${hint ? `<p>${esc(hint)}</p>` : ""}<button class="mini-btn" type="button" data-cab-run="${esc(offer.id)}">${esc(offer.action)}</button><div class="cabinet-offer-result"></div>`;
      const host = field.closest("label") || field;
      host.insertAdjacentElement("afterend", bar);
    }
  }

  function renderCabinetGroups() {
    const root = $("#cabinetGroups");
    if (!root) return;
    root.innerHTML = cabinetGroupsCache.map((group) => {
      const open = cabinetOpen === group.id;
      const fields = (group.fields || []).map((item) => cabinetFieldRow(item)).join("");
      return `<article class="cabinet-group${open ? " is-open" : ""}">
        <button type="button" class="cabinet-group-toggle" data-cab-toggle="${esc(group.id)}" aria-expanded="${open ? "true" : "false"}">
          <h3>${esc(group.title)}</h3><span class="chip">${esc(cabinetStatus[group.status] || group.status)}</span>
        </button>
        <p class="screen">${esc(group.screen)}</p>
        ${fields ? `<ul>${fields}</ul>` : ""}
        ${group.tariff ? `<p class="gate">${esc(group.tariff)}</p>` : ""}
        ${open ? cabinetEditor(group) : `<p class="gate">Нажмите блок, чтобы написать, сгенерировать или открыть.</p>`}
      </article>`;
    }).join("");
  }

  async function loadCabinet() {
    if (!activeOrgId) return;
    const root = $("#cabinetGroups");
    if (!root) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/cabinet`);
      if ($("#cabinetNote")) $("#cabinetNote").textContent = data.note || "";
      if (data.card) currentOrg = { ...currentOrg, card: data.card };
      fillCardForm(data.card);
      paintCardSurfaces(currentOrg);
      cabinetOfferState = Array.isArray(data.offers) ? data.offers : [];
      if ($("#cabinetOffers")) { $("#cabinetOffers").hidden = true; $("#cabinetOffers").innerHTML = ""; }
      cabinetGroupsCache = data.groups || [];
      renderCabinetGroups();
      paintFieldOffers();
    } catch (err) {
      root.innerHTML = `<p class="gate">${esc(err.message || "Кабинет не загрузился")}</p>`;
    }
  }

  $("#cabinetPublish")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    const button = $("#cabinetPublish");
    if (button) button.disabled = true;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/cabinet/publish`, { method: "POST", body: {} });
      if ($("#cabinetNote")) $("#cabinetNote").textContent = data.note || "";
      toast(data.saved ? "В Картах" : "Сверено", data.note || "");
    } catch (err) {
      if ($("#cabinetNote")) $("#cabinetNote").textContent = err.message || "";
      toast("Не выложено", err.message || "");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#cabinetFill")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/cabinet`, { method: "POST" });
      await loadCabinet();
      if ($("#cabinetNote") && data.note) $("#cabinetNote").textContent = data.note;
      toast("Очередь", data.note || "Пробелы поставлены в очередь.");
    } catch (err) {
      toast("Не поставлено", err.message || "");
    }
  });

  $("#cabinetGroups")?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-cab-toggle]");
    if (toggle) {
      const id = toggle.dataset.cabToggle || "";
      cabinetOpen = cabinetOpen === id ? "" : id;
      renderCabinetGroups();
      return;
    }
    if (event.target.closest("[data-cab-save]")) $("#cardProfileForm")?.requestSubmit();
    const promo = event.target.closest("[data-promo-offer]");
    if (promo) collectPromoOffer(promo, promo.closest(".promo-offer")?.querySelector(".promo-offer-result"));
  });
  $("#cabinetGroups")?.addEventListener("input", (event) => {
    const sync = event.target.closest("[data-sync]");
    if (!sync) return;
    const target = document.getElementById(sync.dataset.sync);
    if (target) target.value = sync.value;
  });

  $("#view-cabinet")?.addEventListener("click", async (event) => {
    const run = event.target.closest("[data-cab-run]");
    const accept = event.target.closest("[data-cab-accept]");
    if (!run && !accept) return;
    if (!activeOrgId) return;
    const id = (run || accept).dataset.cabRun || (run || accept).dataset.cabAccept;
    const offer = cabinetOfferState.find((item) => item.id === id);
    const box = (run || accept).closest(".cabinet-editor-offer")?.querySelector(".cabinet-offer-result");
    if (accept) {
      accept.disabled = true;
      try {
        await apiJson(`/api/orgs/${activeOrgId}/cabinet/accept`, { method: "POST", body: { block: id } });
        toast("Черновик принят", "В Яндекс.Карты текст не отправляли.");
        await loadCabinet();
      } catch (err) {
        if (box) box.insertAdjacentHTML("beforeend", `<p class="gate">${esc(err.message || "Не приняли")}</p>`);
        toast("Не приняли", err.message || "");
        accept.disabled = false;
      }
      return;
    }
    if (!offer) return;
    if (offer.mode === "ask") {
      if (box) box.innerHTML = `<p class="gate">${esc(offer.ask || "Нужен факт. Поле остаётся пустым.")}</p>`;
      toast("Нужен факт", offer.ask || "");
      return;
    }
    run.disabled = true;
    try {
      const data = await apiJson(offer.endpoint, { method: "POST", body: offer.body || { block: offer.id } });
      paintCabinetOfferResult(box, offer, data);
      if (data.reply?.text || data.body || data.draft) toast("Черновик", "В Яндекс.Карты текст не отправляли.");
      else toast("Нужен факт", data.ask || offer.ask || "");
    } catch (err) {
      if (box) box.innerHTML = `<p class="gate">${esc(err.message || "Не собралось")}</p>`;
      toast("Не собралось", err.message || "");
    } finally {
      run.disabled = false;
    }
  });

  async function saveCardProfile({ okTitle = "Поля записаны", okText = "Пустые факты остались пустыми." } = {}) {
    if (!activeOrgId) return false;
    if (!serverActive) {
      toast("Нет соединения с API", apiMissingText());
      return false;
    }
    const status = $("#cardProfileStatus");
    const button = $("#cardProfileSave");
    if (button) button.disabled = true;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/profile`, { method: "PATCH", body: { card: cardProfilePayload() } });
      currentOrg = { ...currentOrg, ...data.org };
      fillCardForm(data.org?.card);
      paintCardSurfaces(currentOrg);
      if (status) status.textContent = "Сохранили в кабинете. В Яндекс это само не уходит.";
      toast(okTitle, okText);
      await loadCabinet();
      return true;
    } catch (err) {
      const text = liveErrorText(err, "Не удалось сохранить.");
      if (status) status.textContent = text;
      toast("Не сохранили", text);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  $("#cardProfileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveCardProfile();
  });

  $("#view-cabinet")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-card-photo]");
    const file = input?.files?.[0];
    if (!input || !file) return;
    uploadCardPhoto(input.dataset.cardPhoto, file, input);
  });

  function paintPromoOffer(data, box) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const self = data?.self?.text
      ? `<p>Сейчас на вашей карточке: «${esc(data.self.text)}».</p>`
      : data?.self?.present
        ? `<p>На вашей карточке зелёная плашка есть, текст на странице не написан.</p>`
        : `<p>На вашей карточке зелёной акции нет.</p>`;
    const list = rows.map((row) => `<li><b>${esc(row.name || "Карточка")}</b> — ${esc(row.note || "")}</li>`).join("");
    const html = `${self}${list ? `<ul>${list}</ul>` : ""}<p class="promo-offer-strong">${esc(data?.verdict || "")}</p><p class="promo-offer-strong">${esc(data?.ours || "")}</p><p class="field-hint">В Яндекс не отправляли. Текст лежит в полях акции.</p>`;
    const main = $("#promoOfferResult");
    if (main) main.innerHTML = html;
    if (box && box !== main) box.innerHTML = html;
    if (!data?.announcement) return;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
      $$(`[data-sync="${id}"]`).forEach((node) => { node.value = value; });
    };
    set("cardPromoAnnouncement", data.announcement);
    set("cardPromoDescription", data.description || "");
  }

  async function collectPromoOffer(button, box) {
    if (!activeOrgId) return;
    if (button) button.disabled = true;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/promo-offer`, { method: "POST", body: {} });
      paintPromoOffer(data, box);
    } catch (err) {
      const message = err.message || "Не собрали УТП.";
      if (box) box.innerHTML = `<p class="gate">${esc(message)}</p>`;
      toast("Не собрали", message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  $("#promoOfferRun")?.addEventListener("click", () => {
    collectPromoOffer($("#promoOfferRun"), $("#promoOfferResult"));
  });

  $("#cardPromoKeep")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/profile`, { method: "PATCH", body: { card: { promoKeep: true } } });
      currentOrg = { ...currentOrg, ...data.org };
      fillCardForm(data.org?.card);
      if ($("#cardProfileStatus")) $("#cardProfileStatus").textContent = "Акцию оставили. Текст не меняли.";
    } catch (err) {
      toast("Не оставили", err.message || "");
    }
  });

  /* ================= АВТОПИЛОТ ================= */
  function autoQueueActionsFor(item) {
    if (item.status === "pending" && autopilotData?.settings?.approvalRequired) return [];
    if (item.status === "pending") return [["approve", "Одобрить"]];
    if (item.status === "approved") {
      return [
        ["send", "В Карты"],
        ["run", item.manualProof ? "К подтверждению" : "Закрыть в кабинете"],
        ["cancel", "Отменить"],
      ];
    }
    if (item.status === "needs_proof") return [["proof", "Приложить подтверждение"]];
    if (item.status === "failed") return [["retry", "Повторить"], ["cancel", "Отменить"]];
    return [];
  }

  function autoRuCount(n, one, few, many) {
    const value = Math.abs(Number(n) || 0) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function autoFmtDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function autoQueueItemHtml(item) {
    const actions = autoQueueActionsFor(item);
    const detail = [item.typeLabel, item.statusLabel, item.scheduledAt ? `на ${autoFmtDate(item.scheduledAt)}` : "", item.proof ? "есть подтверждение" : ""]
      .filter(Boolean).join(", ");
    const screen = item.payload?.screen ? `<span class="qscreen">Экран: ${esc(item.payload.screen)}</span>` : "";
    const steps = Array.isArray(item.payload?.steps) && item.payload.steps.length
      ? `<ol class="qsteps">${item.payload.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`
      : "";
    const tariff = item.payload?.tariff ? `<span class="qnote">${esc(item.payload.tariff)}</span>` : "";
    const note = item.result?.note ? `<span class="qnote">${esc(item.result.note)}</span>` : "";
    return `
      <div class="queue-item" data-auto-queue="${item.id}">
        <span class="ico ico--accent"><svg aria-hidden="true"><use href="#i-${item.type === "news_publish" ? "spark" : item.type === "photo_upload" || item.type === "cover_upload" ? "image" : "check"}"/></svg></span>
        <div class="qtext"><strong>${esc(item.title)}</strong><span class="qmeta">${esc(detail)}</span>${screen}${steps}${tariff}${note}${item.error ? `<span class="qerror">${esc(item.error)}</span>` : ""}</div>
        <div class="auto-actions">${actions.map(([action, label]) => `<button class="mini-btn" type="button" data-auto-action="${action}" data-queue-id="${item.id}">${label}</button>`).join("")}</div>
      </div>`;
  }

  function renderAutopilot(data) {
    if (!data) return;
    autopilotData = data;
    updateSideStatus(currentOrg, data);
    const settings = data.settings || {};
    const counts = data.counts || {};
    const pending = Number(counts.pending || 0);
    const approved = Number(counts.approved || 0) + Number(counts.running || 0) + Number(counts.needs_proof || 0);
    if ($("#autoKpiPending")) $("#autoKpiPending").textContent = String(pending);
    if ($("#autoKpiActive")) $("#autoKpiActive").textContent = String(approved);
    if ($("#autoKpiDone")) $("#autoKpiDone").textContent = String(Number(counts.done || 0));
    if ($("#autoKpiReports")) $("#autoKpiReports").textContent = String((data.reports || []).length);
    const badge = $("#autoBadge");
    if (badge) badge.hidden = true;
    const connected = settings.status === "connected";
    const mode = settings.mode || "assisted";
    const autopilotPlan = /автоматическ/i.test(String(currentOrg?.plan || ""));
    const connectorOn = Boolean(data.connector?.available);
    const ledger = $("#autoLedger");
    const state = autopilotBusy ? "running" : connected && mode === "auto" ? "cycle" : connected ? "queue" : "off";
    if (ledger) {
      ledger.dataset.state = state;
      ledger.setAttribute("aria-busy", autopilotBusy ? "true" : "false");
    }
    if ($("#autoStatusChip")) {
      $("#autoStatusChip").textContent = autopilotBusy
        ? "Цикл идёт"
        : !connected
          ? (settings.status === "needs_review" ? "Нужна проверка" : "Выключен")
          : mode === "auto"
            ? "Цикл в кабинете"
            : mode === "sms"
              ? "SMS включён"
              : "Очередь включена";
    }
    if ($("#autoWill")) {
      $("#autoWill").textContent = connected && mode === "auto"
        ? "Готовит ответы и новости. В Яндекс их отправляет аккаунт представителя."
        : "Соберёт ответы, новости, сторис и ключевые слова и отправит их аккаунтом представителя.";
    }
    if ($("#autoWont")) {
      $("#autoWont").textContent = "Пароль Яндекса не просим. Очередь одобрения в кабинете не шаг клиента.";
    }
    if ($("#autoNeeds")) {
      $("#autoNeeds").textContent = !autopilotPlan
        ? "По умолчанию тексты отправляет аккаунт представителя. Кнопка «Нужно согласование» — добровольный режим. Цикл без человека входит в пакет «Автоматический»."
        : connected && mode === "auto"
          ? "Фото и обложку человек прикладывает отдельно. Тексты отправляет аккаунт представителя."
          : "Очередь одобрения не шаг клиента. Текст отправляет аккаунт представителя.";
    }
    if ($("#autoStatusText")) {
      $("#autoStatusText").textContent = autopilotBusy
        ? "Локус отправляет тексты аккаунтом представителя."
        : !connected
          ? "По умолчанию сервис сам генерирует текст, читает его и отправляет в Яндекс аккаунтом представителя."
          : mode === "auto"
            ? "Цикл готовит тексты. В Яндекс их отправляет аккаунт представителя. Кнопка «Нужно согласование» — добровольный режим."
            : "Текст читает и отправляет аккаунт представителя. Кнопка «Нужно согласование» — добровольный режим.";
    }
    if ($("#autoModeChip")) {
      $("#autoModeChip").textContent = !connected
        ? "очередь выключена"
        : mode === "auto"
          ? "цикл в кабинете"
          : mode === "sms"
            ? "SMS, тексты шлёт аккаунт представителя"
            : "аккаунт представителя";
    }
    if ($("#autoSyncChip")) {
      $("#autoSyncChip").textContent = settings.lastSyncAt
        ? `карточку читали ${autoFmtDate(settings.lastSyncAt)}`
        : "карточку ещё не читали";
    }
    const connectBtn = $("#autoConnectBtn");
    if (connectBtn) {
      const backToQueue = connected && mode === "auto";
      connectBtn.hidden = connected && mode !== "auto";
      connectBtn.textContent = backToQueue ? "Вернуться к очереди" : "Включить очередь";
      connectBtn.classList.toggle("btn--ghost", backToQueue);
      connectBtn.disabled = autopilotBusy;
    }
    const stopBtn = $("#autoDisconnectBtn");
    if (stopBtn) {
      stopBtn.hidden = !connected;
      stopBtn.disabled = autopilotBusy;
    }
    const autoBtn = $("#autoAutoBtn");
    if (autoBtn) {
      autoBtn.hidden = !autopilotPlan || (connected && mode === "auto");
      autoBtn.textContent = "Включить цикл";
      autoBtn.disabled = autopilotBusy;
    }
    const runBtn = $("#autoRunBtn");
    if (runBtn) {
      runBtn.hidden = !autopilotPlan || mode !== "auto" || !connected;
      runBtn.disabled = autopilotBusy || mode !== "auto" || !connected;
      runBtn.textContent = autopilotBusy ? "Цикл идёт" : "Запустить цикл";
      if (autopilotBusy) runBtn.setAttribute("aria-busy", "true");
      else runBtn.removeAttribute("aria-busy");
    }
    const cycleBox = $("#autoCycleBox");
    if (cycleBox) cycleBox.hidden = !autopilotPlan;
    if ($("#autoNextRun")) {
      $("#autoNextRun").textContent = !autopilotPlan
        ? "Цикл без человека входит в пакет «Автоматический». Тексты по умолчанию отправляет аккаунт представителя. Кнопка «Нужно согласование» — добровольный режим."
        : connected && mode === "auto"
          ? `Следующий цикл: ${settings.autoNextRunAt ? autoFmtDate(settings.autoNextRunAt) : "при первом запуске"}, каждые ${settings.autoIntervalMinutes || 60} мин. Тексты отправляет аккаунт представителя.`
          : "Цикл выключен. Тексты по умолчанию отправляет аккаунт представителя. Кнопка «Нужно согласование» — добровольный режим.";
    }
    if ($("#autoInterval")) $("#autoInterval").value = String(settings.autoIntervalMinutes || 60);
    if ($("#autoReviews")) $("#autoReviews").checked = settings.autoReviews !== false;
    if ($("#autoNews")) $("#autoNews").checked = settings.autoNews !== false;
    if ($("#autoConnectNote")) $("#autoConnectNote").textContent = "";
    const ownerAt = settings.ownerAccessAt || "";
    const operatorId = data.operatorYandexId || "";
    if ($("#ownerAccessStatus")) $("#ownerAccessStatus").textContent = ownerAt ? "Отмечено у себя" : "Ждём владельца";
    const idField = $("#operatorYandexId");
    if (idField && document.activeElement !== idField) idField.value = operatorId;
    if ($("#ownerAccessBtn")) {
      $("#ownerAccessBtn").textContent = ownerAt ? "Отмечено у себя" : "Отметить у себя";
      $("#ownerAccessBtn").disabled = Boolean(ownerAt);
    }
    if ($("#ownerAccessClear")) $("#ownerAccessClear").hidden = !ownerAt;
    if ($("#ownerPackageBtn")) $("#ownerPackageBtn").disabled = !ownerAt;
    if ($("#ownerAccessNote")) {
      $("#ownerAccessNote").textContent = ownerAt
        ? `Доступ есть с ${autoFmtDate(ownerAt)}. Этот аккаунт ведёт тексты карточки. Пароль Яндекса не просим.`
        : operatorId
          ? `Ждём владельца. Клиент добавляет корпоративную почту Локуса ${operatorId} представителем. Этот аккаунт ведёт тексты карточки. Пароль Яндекса не просим.`
          : "Ждём владельца. Сначала сохраните корпоративную почту Локуса — её и добавят представителем.";
    }
    if ($("#autoSmsBtn")) $("#autoSmsBtn").hidden = !data.smsAvailable;
    if ($("#autoReportTime")) $("#autoReportTime").value = settings.reportTime || "09:00";
    if ($("#autoReportDays")) $("#autoReportDays").value = String(settings.reportDays || 1);
    if ($("#autoReportEnabled")) $("#autoReportEnabled").checked = settings.reportEnabled !== false;
    if ($("#autoTelegramEnabled")) $("#autoTelegramEnabled").checked = settings.telegramEnabled !== false;
    if ($("#autoMaxEnabled")) $("#autoMaxEnabled").checked = settings.maxEnabled !== false;
    if ($("#approvalToggle")) {
      const on = Boolean(settings.approvalRequired);
      $("#approvalToggle").setAttribute("aria-pressed", on ? "true" : "false");
      $("#approvalToggle").classList.toggle("is-on", on);
      $("#approvalToggle").textContent = on ? "Включено" : "Выключено";
    }
    if ($("#approvalHint")) {
      $("#approvalHint").textContent = settings.approvalRequired
        ? "Включено. Новость, прайс и сторис сначала приходят в Telegram или MAX."
        : "Выключено. Новость, прайс и сторис уходят в Яндекс сразу.";
    }
    if ($("#autoTelegramChat")) $("#autoTelegramChat").value = settings.telegramChatId || "";
    if ($("#autoMaxChat")) $("#autoMaxChat").value = settings.maxChatId || "";
    const integrations = data.integrations || {};
    const tg = integrations.telegram || {};
    const mx = integrations.max || {};
    if ($("#autoIntegrationChip")) {
      const ready = [tg.ready ? "Telegram" : "", mx.ready ? "MAX" : ""].filter(Boolean);
      $("#autoIntegrationChip").textContent = ready.length ? ready.join(" + ") : "не настроено";
    }
    if ($("#autoConfigNote")) {
      const parts = [];
      parts.push(tg.configured ? "Бот Telegram на сервере есть. Клиент открывает бота и нажимает «Старт», отчёт уходит в личные сообщения." : "Клиент открывает бота и нажимает «Старт». Пока на сервере не задан токен бота, отчёт и черновик никуда не уходят.");
      parts.push(mx.configured ? "Бот MAX на сервере есть." : "Бот MAX на сервере не настроен.");
      if (tg.dryRun || mx.dryRun) parts.push("Отправка наружу выключена, проверяется только настройка.");
      $("#autoConfigNote").textContent = parts.join(" ");
    }
    const queue = data.queue || [];
    const queueWrap = $("#autoQueue");
    if (queueWrap) {
      queueWrap.innerHTML = queue.map(autoQueueItemHtml).join("");
      queueWrap.hidden = queue.length === 0;
    }
    if ($("#autoQueueEmpty")) $("#autoQueueEmpty").hidden = queue.length > 0;
    if ($("#autoQueueCount")) {
      $("#autoQueueCount").textContent = `${queue.length} ${autoRuCount(queue.length, "действие", "действия", "действий")}`;
    }
    const reports = data.reports || [];
    const runs = data.runs || [];
    const reportStatusRu = { draft: "черновик", sent: "отправлен", dry_run: "проверен здесь" };
    const runTriggerRu = { manual: "вручную", schedule: "по расписанию", package: "из пакета" };
    const runStatusRu = { done: "завершён", failed: "ошибка", running: "идёт" };
    const channelRu = { telegram: "Telegram", max: "MAX" };
    const kindRu = { report: "отчёт", test: "проверка", scheduled_report: "отчёт по времени" };
    const logStatusRu = { sent: "ушло", skipped: "не отправлено", failed: "ошибка", dry_run: "проверено здесь" };
    if ($("#autoRuns")) {
      $("#autoRuns").innerHTML = runs.length
        ? runs.map((r) => {
          const done = Number(r.summary?.done || 0);
          const drafted = Number(r.summary?.drafted || 0);
          return `<div class="mini-list-row"><span class="q">Цикл ${esc(runTriggerRu[r.trigger] || r.trigger)}, ${esc(runStatusRu[r.status] || r.status)}. Черновиков ${drafted}, закрыто в кабинете ${done}</span><b>${autoFmtDate(r.createdAt)}</b></div>`;
        }).join("")
        : `<div class="field-hint">Циклов ещё не было. На пакете «Автоматический» цикл включается отдельно и закрывает шаги только в кабинете.</div>`;
    }
    if ($("#autoReports")) {
      $("#autoReports").innerHTML = reports.length
        ? reports.map((r) => `<div class="mini-list-row"><span class="q">${esc(r.title)} · ${esc(reportStatusRu[r.status] || r.status)}</span><b>${autoFmtDate(r.createdAt)}</b></div>`).join("")
        : `<div class="field-hint">Отчётов пока нет. Сформируйте первый — он останется здесь.</div>`;
    }
    if ($("#autoLog")) {
      const logs = data.notifications || [];
      $("#autoLog").innerHTML = logs.length
        ? logs.map((l) => `<div class="mini-list-row"><span class="q">${esc(channelRu[l.channel] || l.channel)} · ${esc(kindRu[l.kind] || l.kind)}</span><b>${esc(logStatusRu[l.status] || l.status)}</b></div>`).join("")
        : `<div class="field-hint">Отправок ещё не было. Без бота отчёт остаётся в кабинете.</div>`;
    }
    if (reports.length && !autopilotReport) {
      const latest = reports[0];
      if (latest.text && $("#autoReportText")) $("#autoReportText").textContent = latest.text;
      if ($("#autoReportStatus")) $("#autoReportStatus").textContent = reportStatusRu[latest.status] || latest.status || "черновик";
    }
  }

  function renderAutoResponse(data) {
    if (data && data.autopilot) renderAutopilot(data.autopilot);
    else if (data && data.settings) renderAutopilot(data);
  }

  async function loadAutopilot() {
    if (!serverActive || !activeOrgId) {
      const ledger = $("#autoLedger");
      if (ledger) ledger.dataset.state = "off";
      if ($("#autoStatusChip")) $("#autoStatusChip").textContent = "Нет сессии";
      if ($("#autoStatusText")) $("#autoStatusText").textContent = "Войдите в кабинет, чтобы включить очередь.";
      if ($("#autoWill")) $("#autoWill").textContent = "Пока ничего не готовит.";
      if ($("#autoWont")) $("#autoWont").textContent = "На этом компьютере, где открыт Яндекс Бизнес, пароль не хранится: человек подтверждает, и только потом текст уходит в это окно.";
      if ($("#autoNeeds")) $("#autoNeeds").textContent = "Сначала войдите в кабинет.";
      return;
    }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot`);
      renderAutopilot(data);
      if (!autopilotReport) {
        try {
          const preview = await apiJson(`/api/orgs/${activeOrgId}/autopilot/report?days=1`);
          autopilotReport = preview.preview;
          if ($("#autoReportText")) $("#autoReportText").textContent = preview.preview.text;
        } catch { /* отчёт можно сформировать вручную */ }
      }
    } catch (err) {
      toast("Автопилот", err.message || "Не удалось загрузить");
    }
  }

  async function saveAutopilotSettings() {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot`, {
        method: "PATCH",
        body: {
          reportTime: $("#autoReportTime")?.value || "09:00",
          reportDays: Number($("#autoReportDays")?.value || 1),
          reportEnabled: Boolean($("#autoReportEnabled")?.checked),
          telegramEnabled: Boolean($("#autoTelegramEnabled")?.checked),
          maxEnabled: Boolean($("#autoMaxEnabled")?.checked),
          telegramChatId: $("#autoTelegramChat")?.value || "",
          maxChatId: $("#autoMaxChat")?.value || "",
          autoReviews: Boolean($("#autoReviews")?.checked),
          autoNews: Boolean($("#autoNews")?.checked),
          autoIntervalMinutes: Number($("#autoInterval")?.value || 60),
        },
      });
      renderAutopilot(data);
      toast("Настройки сохранены", "Время и каналы отчёта обновлены.");
    } catch (err) {
      toast("Не сохранено", err.message || "Проверьте поля");
    }
  }

  async function autopilotConnect() {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/connect`, { method: "POST", body: { mode: "assisted" } });
      renderAutopilot(data);
      toast("Очередь включена", "Текст отправляет аккаунт представителя.");
    } catch (err) {
      toast("Не удалось подключить", err.message || "Попробуйте ещё раз");
    }
  }

  async function autopilotAutoConnect() {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/connect`, { method: "POST", body: { mode: "auto" } });
      renderAutopilot(data);
      toast("Цикл включён", "Локус готовит черновики и закрывает их в кабинете. В Яндекс.Картах от этого ничего не появляется.");
    } catch (err) {
      toast("Цикл не включён", err.message || "Попробуйте ещё раз");
    }
  }

  async function runAutopilotCycle() {
    if (!activeOrgId || autopilotBusy) return;
    autopilotBusy = true;
    if (autopilotData) renderAutopilot(autopilotData);
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/run`, { method: "POST" });
      autopilotBusy = false;
      renderAutoResponse(data);
      const s = data.summary || {};
      toast("Цикл в кабинете завершён", `Черновиков: ${s.drafted || 0}. Закрыто в кабинете: ${s.done || 0}. Пропущено: ${s.skipped || 0}. В Яндекс.Карты это не ушло.`);
      if (typeof loadCalendar === "function" && viewIds.includes("calendar")) loadCalendar(calendarMonth);
    } catch (err) {
      autopilotBusy = false;
      if (autopilotData) renderAutopilot(autopilotData);
      toast("Цикл не выполнен", err.message || "Проверьте, что цикл включён");
    }
  }

  async function autopilotSync() {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/sync`, { method: "POST" });
      renderAutopilot(data);
      toast("Карточка прочитана", data.imported?.fetchedAt ? `Публичные данные на ${autoFmtDate(data.imported.fetchedAt)}. В Карты это ничего не отправило.` : "Публичные данные обновлены. В Карты это ничего не отправило.");
    } catch (err) {
      toast("Синхронизация", err.message || "Не удалось прочитать карточку");
    }
  }

  async function autopilotDisconnect() {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/disconnect`, { method: "POST" });
      renderAutopilot(data);
      toast("Автопилот остановлен", "Очередь и история на месте. В Яндекс ничего не отправлялось.");
    } catch (err) {
      toast("Не удалось отключить", err.message || "");
    }
  }

  async function autopilotSmsConnect() {
    if (!activeOrgId) return;
    const phone = window.prompt("Телефон для SMS-подключения (+7…). Код не хранится на сервере.", "") || "";
    if (!phone.trim()) return;
    try {
      const first = await apiJson(`/api/orgs/${activeOrgId}/autopilot/connect`, { method: "POST", body: { mode: "sms", phone } });
      if (first.code !== "SMS_CODE_SENT") {
        toast("SMS", first.message || "Код не отправлен");
        return;
      }
      const code = window.prompt(`Введите код из SMS. ${first.message || ""}`, "") || "";
      if (!code.trim()) return;
      const second = await apiJson(`/api/orgs/${activeOrgId}/autopilot/connect`, {
        method: "POST",
        body: { mode: "sms", challengeId: first.challengeId, code },
      });
      if (second.autopilot) renderAutopilot(second.autopilot);
      toast("SMS включён", "Тексты по умолчанию отправляет аккаунт представителя. Кнопка «Нужно согласование» — добровольный режим.");
    } catch (err) {
      toast("SMS не подключён", err.message || "Проверьте шлюз и номер");
    }
  }

  async function testAutopilotChannel(channel) {
    if (!activeOrgId) { toast("Нет организации", "Сначала выберите организацию в меню."); return; }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/test`, { method: "POST", body: { channel } });
      const result = data.result || {};
      toast(result.dryRun ? "Не отправлено" : (result.ok ? "Отправлено" : "Не отправлено"), result.dryRun ? "Сообщение наружу не ушло." : (result.ok ? "Сообщение ушло в выбранный чат." : "Канал не принял сообщение."));
      await loadAutopilot();
    } catch (err) {
      toast("Тест не прошёл", err.message || "Проверьте токен и chat id");
    }
  }

  async function generateAutopilotReport(send = false) {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/report`, {
        method: "POST",
        body: { days: Number($("#autoReportDays")?.value || 1), send, channels: ["telegram", "max"] },
      });
      autopilotReport = data.preview;
      if ($("#autoReportText")) $("#autoReportText").textContent = data.preview?.text || "";
      if ($("#autoReportStatus")) $("#autoReportStatus").textContent = data.delivery?.sent ? "отправлен" : data.delivery?.dryRun ? "не отправлено" : "черновик";
      if (data.autopilot) renderAutopilot(data.autopilot);
      if (send && data.delivery) {
        const sent = (data.delivery.results || []).filter((r) => r.ok && !r.dryRun).map((r) => r.channel).join(", ");
        if ($("#autoDeliveryNote")) $("#autoDeliveryNote").textContent = sent ? `Отправлено: ${sent}` : data.delivery.dryRun ? "Настройка проверена. Наружу отчёт не ушёл." : "Отчёт остался в кабинете: каналы не настроены или выключены.";
        toast(sent ? "Отчёт отправлен" : "Отчёт готов", sent ? `Каналы: ${sent}` : "Он остался в кабинете. Для отправки нужен бот и чат.");
      } else {
        toast("Отчёт сформирован", "Проверьте текст и отправьте в каналы.");
      }
      return data;
    } catch (err) {
      toast("Отчёт не сформирован", err.message || "");
      return null;
    }
  }

  async function sendAutopilotReport() {
    if (!activeOrgId) return;
    let reportId = autopilotData?.reports?.[0]?.id || null;
    if (!reportId) {
      const generated = await generateAutopilotReport(false);
      reportId = generated?.id || null;
    }
    if (!reportId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/report-send`, {
        method: "POST",
        body: { reportId, channels: ["telegram", "max"] },
      });
      renderAutoResponse(data);
      const sent = (data.results || []).filter((r) => r.ok && !r.dryRun).map((r) => r.channel).join(", ");
      if ($("#autoDeliveryNote")) $("#autoDeliveryNote").textContent = sent ? `Отправлено: ${sent}` : data.dryRun ? "Настройка проверена. Наружу отчёт не ушёл." : "Ни один канал не отправлен. Проверьте бота и чат.";
      if ($("#autoReportStatus")) $("#autoReportStatus").textContent = sent ? "отправлен" : data.dryRun ? "проверен здесь" : "черновик";
      toast(sent ? "Отчёт отправлен" : "Не отправлено", sent ? `Каналы: ${sent}` : "Отчёт остался в кабинете.");
    } catch (err) {
      toast("Не отправлено", err.message || "");
    }
  }

  async function runAutopilotQueueAction(queueId, action) {
    if (!activeOrgId) return;
    try {
      let proof = "";
      if (action === "proof") {
        proof = window.prompt("Подтверждение: ссылка, номер обращения или короткое описание", "") || "";
        if (proof.trim().length < 3) return;
      }
      const data = await apiJson(`/api/orgs/${activeOrgId}/queue/${queueId}/${action}`, {
        method: "POST",
        body: action === "proof" ? { proof } : {},
      });
      renderAutoResponse(data);
      const item = data.item || {};
      const messages = {
        approve: ["Одобрено", "Очередь одобрения не шаг клиента. Если согласование выключено, текст отправляет аккаунт представителя."],
        run: item.status === "needs_proof" ? ["Ждёт отметки", "Шаг ждёт отметки в кабинете. Новости и ответы по умолчанию отправляет аккаунт представителя."] : ["Закрыто", item.result?.note || "Шаг закрыт. Тексты отправляет аккаунт представителя."],
        cancel: ["Отменено", "Шаг убран из очереди."],
        retry: ["Снова в работе", "Шаг снова в работе у аккаунта представителя."],
        proof: ["Отмечено", "Отметка сохранена в кабинете. Это не ответ коннектора Яндекса."],
        send: ["Отправлено аккаунтом представителя", "Сервис прочитал текст и отправил его в Яндекс. Пароль Яндекса не просим. Если включена кнопка «Нужно согласование», новости и ответы сначала приходят в бот."],
      };
      const message = messages[action] || ["Готово", ""];
      toast(message[0], message[1]);
    } catch (err) {
      if (action === "send" && err.payload) renderAutoResponse(err.payload);
      toast("Действие не выполнено", err.message || "");
    }
  }

  $("#autoSettingsSave")?.addEventListener("click", saveAutopilotSettings);
  $("#autoConnectBtn")?.addEventListener("click", autopilotConnect);
  $("#autoAutoBtn")?.addEventListener("click", autopilotAutoConnect);
  $("#autoRunBtn")?.addEventListener("click", runAutopilotCycle);
  $("#autoDisconnectBtn")?.addEventListener("click", autopilotDisconnect);
  $("#autoSmsBtn")?.addEventListener("click", autopilotSmsConnect);
  $("#ownerAccessBtn")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/access`, { method: "POST", body: {} });
      renderAutopilot(data);
      toast("Отметили у себя", "Это отметка в Локусе. Список организаций Яндекса отсюда не проверяется.");
    } catch (err) {
      toast("Доступ не отмечен", err.message || "");
    }
  });
  $("#ownerAccessClear")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/access`, { method: "POST", body: { present: false } });
      renderAutopilot(data);
      toast("Ждём владельца", "Отметка снята. Пакет снова не собирается.");
    } catch (err) {
      toast("Отметка не снята", err.message || "");
    }
  });
  $("#operatorYandexSave")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    const yandexId = $("#operatorYandexId")?.value || "";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/operator`, { method: "POST", body: { yandexId } });
      renderAutopilot(data);
      toast(data.operatorYandexId ? "Яндекс ID сохранён" : "Яндекс ID очищен", data.operatorYandexId || "Поле пустое. Владельцу пока нечего добавлять.");
    } catch (err) {
      toast("ID не сохранён", err.message || "");
    }
  });
  $("#ownerPackageBtn")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    const btn = $("#ownerPackageBtn");
    if (btn) btn.disabled = true;
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/package`, { method: "POST", body: {} });
      if (data.autopilot) renderAutopilot(data.autopilot);
      const news = Number(data.summary?.news || 0);
      toast("Пакет собран", data.note || `Новостей: ${news}`);
    } catch (err) {
      toast("Пакет не собран", err.message || "");
      if (btn) btn.disabled = false;
    }
  });
  $("#autoSyncBtn")?.addEventListener("click", autopilotSync);
  $("#autoTestTelegram")?.addEventListener("click", () => testAutopilotChannel("telegram"));
  $("#autoTestMax")?.addEventListener("click", () => testAutopilotChannel("max"));
  $("#autoReportGenerate")?.addEventListener("click", () => generateAutopilotReport(false));
  $("#autoReportSend")?.addEventListener("click", sendAutopilotReport);
  $("#autoAddAction")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    const type = $("#autoNewType")?.value || "card_update";
    const title = ($("#autoNewTitle")?.value || "").trim();
    if (!title) {
      toast("Нужно название", "Коротко опишите, что сделать.");
      return;
    }
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot/queue`, {
        method: "POST",
        body: { type, title, payload: { source: "manual" }, scheduledAt: $("#autoNewDate")?.value ? `${$("#autoNewDate").value}T09:00:00.000Z` : "" },
      });
      if ($("#autoNewTitle")) $("#autoNewTitle").value = "";
      renderAutoResponse(data);
      toast("Добавлено", "Шаг записан в кабинете.");
    } catch (err) {
      toast("Не добавлено", err.message || "");
    }
  });
  $("#approvalToggle")?.addEventListener("click", async () => {
    if (!activeOrgId) return;
    const on = $("#approvalToggle").getAttribute("aria-pressed") !== "true";
    try {
      const data = await apiJson(`/api/orgs/${activeOrgId}/autopilot`, {
        method: "PATCH",
        body: { approvalRequired: on },
      });
      renderAutopilot(data);
      toast(on ? "Согласование включено" : "Согласование выключено", on
        ? "Новость, прайс и сторис придут в Telegram или MAX. В Яндекс они уйдут после кнопки в боте."
        : "Дальше новость, прайс и сторис уходят в Яндекс сразу.");
    } catch (err) {
      toast("Не сохранилось", err.message || "");
    }
  });
  $("#autoQueue")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-auto-action]");
    if (!button) return;
    runAutopilotQueueAction(Number(button.dataset.queueId), button.dataset.autoAction);
  });

  /* ---------- misc: disabled look ---------- */
  document.addEventListener("click", (e) => {
    const disabled = e.target.closest("button:disabled");
    if (disabled) {
      e.preventDefault();
    }
  });

  /* Initial route — после объявления всех функций и данных, иначе hash #stories
     обращается к storyReasons до инициализации. */
  document.addEventListener("click", (event) => {
    const open = event.target.closest("[data-shot-open]");
    const close = event.target.closest("[data-shot-close]");
    const box = $("#shotLightbox");
    if (open && box) {
      $("#shotLightboxImg").src = open.dataset.shotOpen || "";
      $("#shotLightboxImg").alt = open.dataset.shotTitle || "";
      $("#shotLightboxCap").textContent = open.dataset.shotTitle || "";
      box.hidden = false;
    }
    if (close && box) box.hidden = true;
  });
  $("#cardFaceFile")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const photo = $("#cardFacePhoto");
    if (!file || !photo) return;
    photo.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
  });

  const initial = location.hash.replace("#", "");
  showView(viewIds.includes(initial) || legacyViews[initial] ? initial : "overview", false);
  window.addEventListener("hashchange", () => {
    const id = location.hash.replace("#", "");
    if (viewIds.includes(id) || legacyViews[id]) showView(id, false);
  });
})();
