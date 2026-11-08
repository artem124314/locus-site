/* Локус — лендинг: взаимодействия без зависимостей */
(() => {
  "use strict";

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
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- toast ---------- */
  const stack = $("#toastStack");
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
  window.locusToast = toast;

  /* ---------- сессия и связка с кабинетом ---------- */
  const auth = window.LocusSession;
  const query = new URLSearchParams(window.location.search);
  if (auth && query.get("logout") === "1") {
    auth.clear();
    toast("Вы вышли", "Можно войти снова.");
    query.delete("logout");
    const clean = window.location.pathname + (query.toString() ? "?" + query.toString() : "") + window.location.hash;
    window.history.replaceState({}, "", clean);
  }
  const currentSession = auth ? auth.get() : null;
  const headerLogin = $(".header-login");
  const mobileCabinet = $("#mobileCabinet");
  function markCabinet() {
    if (headerLogin) {
      headerLogin.textContent = "Кабинет";
      headerLogin.href = "app.html";
    }
    if (mobileCabinet) mobileCabinet.textContent = "Кабинет";
  }
  if (currentSession) markCabinet();
  fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.user) markCabinet();
    })
    .catch(() => {});

  /* ---------- header ---------- */
  const header = $("#siteHeader");
  const onScroll = () => header && header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- mobile nav ---------- */
  const burger = $("#burger");
  const mobileNav = $("#mobileNav");
  function closeNav() {
    if (!mobileNav || !burger) return;
    mobileNav.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "Открыть меню");
  }
  if (burger && mobileNav) {
    burger.addEventListener("click", () => {
      const open = mobileNav.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    });
    $$("a", mobileNav).forEach((a) => a.addEventListener("click", closeNav));
    document.addEventListener("keydown", (e) => e.key === "Escape" && closeNav());
    window.addEventListener("resize", () => window.innerWidth > 980 && closeNav());
  }

  /* ---------- reveal ---------- */
  const revealEls = $$(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("is-in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const siblings = Array.from(entry.target.parentElement.children).filter((n) => n.classList.contains("reveal"));
          entry.target.style.transitionDelay = `${Math.min(siblings.indexOf(entry.target), 4) * 70}ms`;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- typing helper ---------- */
  let activeTimer = null;
  function typeText(el, text, speed = 14) {
    if (!el) return;
    if (activeTimer) window.clearInterval(activeTimer);
    if (reduceMotion) {
      el.textContent = text;
      el.classList.remove("caret");
      return;
    }
    el.textContent = "";
    el.classList.add("caret");
    let i = 0;
    activeTimer = window.setInterval(() => {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        window.clearInterval(activeTimer);
        activeTimer = null;
        setTimeout(() => el.classList.remove("caret"), 900);
      }
    }, speed);
  }

  /* ---------- hero reply ---------- */
  const heroReply = $("#heroReply");
  if (heroReply) {
    const full = heroReply.textContent.trim();
    heroReply.textContent = "";
    const start = () => setTimeout(() => typeText(heroReply, full, 12), 900);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
  }

  /* ---------- demo lab ---------- */
  const reviews = {
    neg: {
      name: "Марина", avatar: "М", cls: "avatar--b", when: "2 минуты назад", stars: 3, tag: "3 звезды",
      text: "Пришли в субботу около 11, ждали кофе 25 минут. Бариста извинился, но осадок остался. Круассан вкусный, поэтому три звезды.",
      replies: {
        care: `Благодарим за обратную связь. Нам жаль, что визит не оправдал ожиданий: скорость обслуживания. Это важно — мы разбираем ситуацию с командой и хотим исправить причину, а не только извиниться.

В кофейне «Полдень» завтраки, кофе с собой и свежая выпечка — это позиции, которые можно обсудить на месте. Мы усилили смену на выходных: с 10:00 в зале два бариста. Напитки и блюда готовят на заказ, состав можно уточнить у бариста.

С уважением,
Кофейня «Полдень»`
      }
    },
    neu: {
      name: "Илья", avatar: "И", cls: "", when: "15 минут назад", stars: 4, tag: "4 звезды",
      text: "Вкусный кофе и приятный интерьер, но музыка громковата — не получилось поработать. В целом хорошее место.",
      replies: {
        care: `Благодарим вас за такой тёплый и подробный отзыв! Нам очень приятно, что вы отметили кофе и интерьер. Для нас важно, чтобы каждый визит проходил в комфортном темпе и с вниманием к вашим пожеланиям.

Особую благодарность выражаем за доверие к нашей команде. В кофейне «Полдень» завтраки, кофе с собой и места для работы — это услуги и позиции, которые можно обсудить на месте. Днём делаем музыку тише, чтобы можно было работать; у окна спокойнее.

С уважением,
Кофейня «Полдень»`
      }
    },
    pos: {
      name: "Софья", avatar: "С", cls: "avatar--c", when: "32 минуты назад", stars: 5, tag: "5 звёзд",
      text: "Сырники с грушей — лучшие в городе. Быстро, вежливо, очень уютно. Теперь наше место по выходным.",
      replies: {
        care: `Благодарим вас за такой тёплый и подробный отзыв! Нам очень приятно, что вы отметили сырники с грушей, скорость и уютную атмосферу. Для нас важно, чтобы каждый визит проходил в комфортном темпе и с вниманием к вашим пожеланиям.

Особую благодарность выражаем за доверие к нашей команде. В кофейне «Полдень» завтраки, кофе с собой и свежая выпечка — это позиции, которые можно обсудить на месте. Сырники с грушей остаются в меню до конца октября, а в ноябре попробуйте новый вкус.

С уважением,
Кофейня «Полдень»`
      }
    }
  };

  let currentReview = "neg";
  const currentTone = "care";
  const labReply = $("#labReply");
  const labGenerate = $("#labGenerate");
  const labCounter = $("#labCounter");

  function paintReview(key) {
    const r = reviews[key];
    if (!r) return;
    currentReview = key;
    $("#labName").textContent = r.name;
    $("#labWhen").textContent = r.when;
    $("#labStars").textContent = "★★★★★".slice(0, r.stars) + "☆☆☆☆☆".slice(0, 5 - r.stars);
    $("#labStars").setAttribute("aria-label", `Оценка ${r.stars} из 5`);
    $("#labTag").textContent = r.tag;
    $("#labReviewText").textContent = r.text;
    const avatar = $("#labAvatar");
    avatar.textContent = r.avatar;
    avatar.className = `avatar ${r.cls}`.trim();
    if (labReply) {
      labReply.textContent = r.replies[currentTone];
      labReply.classList.remove("caret");
    }
  }

  if ($("#labReviews")) paintReview(currentReview);

  $$("#labReviews button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("#labReviews button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      paintReview(btn.dataset.review);
    });
  });

  if (labGenerate) {
    labGenerate.addEventListener("click", () => {
      const text = reviews[currentReview].replies[currentTone];
      labGenerate.disabled = true;
      if (labCounter) labCounter.textContent = "генерируем…";
      window.setTimeout(() => {
        typeText(labReply, text, 10);
        labGenerate.disabled = false;
        if (labCounter) {
          labCounter.textContent = "готово · это пример на сайте";
          setTimeout(() => (labCounter.textContent = "пример на сайте, лимит не тратится"), 4200);
        }
      }, 520);
    });
  }

  $$("[data-demo-publish]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.assign("login.html#signup");
    });
  });

  /* ---------- pricing toggle ---------- */
  const fmt = new Intl.NumberFormat("ru-RU");
  function setBilling(period) {
    $$("[data-billing]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.billing === period)));
    $$("[data-price-month]").forEach((el) => {
      const value = Number(period === "year" ? el.dataset.priceYear : el.dataset.priceMonth);
      el.textContent = fmt.format(value);
    });
    $$("[data-year-note]").forEach((el) => {
      el.textContent = period === "year" ? "при оплате за год" : "";
    });
  }
  $$("[data-billing]").forEach((btn) => btn.addEventListener("click", () => setBilling(btn.dataset.billing)));
  setBilling("month");

  /* ---------- calculator ---------- */
  const range = $("#genRange");
  if (range) {
    const out = $("#genOut");
    const planEl = $("#calcPlan");
    const timeEl = $("#calcTime");
    const priceEl = $("#calcPrice");
    const update = () => {
      const n = Number(range.value);
      const pct = ((n - range.min) / (range.max - range.min)) * 100;
      range.style.setProperty("--p", `${pct}%`);
      out.textContent = fmt.format(n);

      const hours = Math.round(n * 0.1);
      let plan = "Стартовый";
      let price = 2500;
      let includes = "200 звёзд · 60 текстов · 24 изображения";
      if (n > 90) { plan = "Самостоятельный"; price = 5500; includes = "800 звёзд · 300 текстов · 60 изображений"; }
      if (n > 400) { plan = "Автоматический"; price = 11900; includes = "2 000 звёзд · 1 000 текстов · 120 изображений"; }

      planEl.textContent = plan;
      const includesEl = $("#calcIncludes");
      if (includesEl) includesEl.textContent = includes;
      timeEl.textContent = `≈ ${fmt.format(hours)} ч`;
      priceEl.textContent = `${fmt.format(price)} ₽ / мес`;
    };
    range.addEventListener("input", update);
    update();
  }

  /* ---------- signup ---------- */
  const form = $("#signupForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("#email");
      const msg = $("#signupMsg");
      const value = input.value.trim();
      const consent = $("#signupConsent");
      const offer = $("#signupOffer");
      const valid = /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Я]{2,}$/.test(value);
      if (offer && !offer.checked) {
        msg.textContent = "Примите условия сервиса — без этого не можем принять заявку.";
        offer.focus();
        return;
      }
      if (consent && !consent.checked) {
        msg.textContent = "Нужно отдельное согласие на обработку персональных данных.";
        consent.focus();
        return;
      }
      if (!valid) {
        msg.textContent = "Похоже, в адресе опечатка. Проверьте почту — и попробуем снова.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      const card = $("#leadCard")?.value.trim() || "";
      if (card && !isYandexCardUrl(card)) {
        msg.textContent = "Ссылка должна вести на карточку в Яндекс.Картах.";
        $("#leadCard").setAttribute("aria-invalid", "true");
        $("#leadCard").focus();
        return;
      }
      $("#leadCard")?.removeAttribute("aria-invalid");
      try {
        if (card) sessionStorage.setItem("locus:prefill-card", card);
      } catch (err) { /* noop */ }
      try {
        await fetch("/api/leads", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            email: value,
            cardUrl: card,
            offerAccepted: Boolean(offer?.checked),
            pdConsent: Boolean(consent?.checked),
            marketing: Boolean($("#signupMarketing")?.checked),
            source: "landing",
          }),
        });
      } catch (err) { /* заявка не должна теряться из-за сети — уводим в регистрацию */ }
      if (currentSession) {
        window.location.assign("app.html");
        return;
      }
      msg.textContent = "Почта принята. Открываем регистрацию — осталось придумать пароль.";
      toast("Почта принята", "Переходим к созданию аккаунта.");
      setTimeout(() => {
        try {
          sessionStorage.setItem("locus:prefill-email", value);
        } catch (err) {
          /* noop */
        }
        window.location.assign("login.html#signup");
      }, 450);
    });
  }


  /* ---------- аудит карточки (демо) ---------- */
  const auditState = {
    niche: "coffee",
    values: { basics: true, products: true, photos: true, reputation: false, activity: false, trust: true, semantics: false },
  };
  const auditPresets = {
    coffee: { basics: true, products: true, photos: true, reputation: false, activity: false, trust: true, semantics: false },
    dental: { basics: true, products: true, photos: false, reputation: true, activity: false, trust: true, semantics: true },
    barber: { basics: true, products: false, photos: true, reputation: true, activity: true, trust: true, semantics: false },
    auto: { basics: true, products: true, photos: false, reputation: false, activity: false, trust: true, semantics: true },
  };
  const auditActions = {
    basics: "Телефон, часы и адрес человек видит, когда карточку уже открыл. В поиск она попадает текстами. Разовая настройка оставляет её адресом.",
    trust: "Подтвердите владельца и добавьте ссылку на карточку: от этого зависит доступ к управлению.",
    products: "Добавьте услуги с ценой и коротким описанием: по ним ищут в Картах.",
    photos: "Добавьте фото: фасад, зал, продукт, команда, детали.",
    reputation: "Отвечайте на новые отзывы; негатив — с фактом и контактом.",
    activity: "Каждый месяц обновляйте ответы, новости и сторис. Карточка поднимается в выдаче. Первое место не обещаем.",
    semantics: "Выпишите фразы, которыми люди ищут такую услугу, и используйте их в ценах и публикациях.",
  };
  const auditWeights = { basics: 20, products: 20, photos: 15, reputation: 20, activity: 10, trust: 5, semantics: 10 };
  const auditBars = [
    { id: "basics", label: "База профиля", weight: 20 },
    { id: "products", label: "Прайс и услуги", weight: 20 },
    { id: "photos", label: "Фото и прайс", weight: 15 },
    { id: "reputation", label: "Отзывы", weight: 20 },
    { id: "activity", label: "Активность", weight: 10 },
    { id: "trust", label: "Доверие", weight: 5 },
    { id: "semantics", label: "Релевантность", weight: 10 },
  ];

  const auditScoreEl = $("#auditScore");
  const auditRing = $("#auditRing");
  const auditLabel = $("#auditLabel");
  const auditNote = $("#auditNote");
  const auditNext = $("#auditNext");
  const auditBarsEl = $("#auditBars");

  function auditTotal() {
    return Object.entries(auditWeights).reduce((sum, [key, weight]) => sum + (auditState.values[key] ? weight : 0), 0);
  }

  function animateScore(to) {
    if (!auditScoreEl) return;
    // Число меняем сразу: кольцо анимируется CSS, текст не зависит от rAF.
    auditScoreEl.textContent = String(to);
  }

  function paintAudit() {
    const total = auditTotal();
    if (auditRing) auditRing.setAttribute("aria-label", "Макет заполненности, не оценка вашей точки");

    const verdict =
      total >= 85
        ? ["Точка собрана", "Цены, фото и ответы на месте. Дальше обновляйте то, что устаревает."]
        : total >= 70
        ? ["Текстов ещё мало", "Телефон и часы человек видит, когда карточку уже открыл. В поиск она попадает текстами."]
        : total >= 45
        ? ["Карточка открыта, тексты не те", "Ответы, новости, сторис и ключевые слова ещё не про запросы, которые набирают."]
        : ["На точке почти пусто", "В поиск карточка попадает текстами. Разовая настройка адреса, телефона и часов оставляет её адресом."];
    if (auditLabel) auditLabel.textContent = verdict[0];
    if (auditNote) auditNote.textContent = verdict[1];

    if (auditBarsEl) {
      auditBarsEl.innerHTML = auditBars
        .map((b) => {
          const on = Boolean(auditState.values[b.id]);
          return `<div class="audit-bar"><em>${b.label}</em><span class="track"><span class="fill" style="width:${on ? "100%" : "0%"}"></span></span></div>`;
        })
        .join("");
    }

    if (auditNext) {
      const missing = Object.keys(auditActions).filter((k) => !auditState.values[k]);
      const items = missing.length ? missing.slice(0, 3).map((k) => auditActions[k]) : [
        "Каждый месяц пишите ответы, новости, сторис и ключевые слова. Разовая настройка оставляет карточку адресом.",
        "Обновляйте фото раз в сезон и следите за порядком: первое фото — витрина.",
        "Проверяйте, что на новые отзывы есть ответ.",
      ];
      auditNext.innerHTML = items.map((x) => `<li>${x}</li>`).join("");
    }
  }

      /* ---------- аудит по ссылке → регистрация → кабинет ---------- */
  const auditStart = $("#auditStart");
  if (auditStart) {
    auditStart.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#auditUrl");
      const msg = $("#auditUrlMsg");
      const value = normalizeCardInput(input?.value || "");
      const valid = isYandexCardUrl(value);
      if (!valid) {
        if (msg) msg.textContent = "Вставьте ссылку на точку в Яндекс.Картах.";
        input?.setAttribute("aria-invalid", "true");
        input?.focus();
        return;
      }
      input?.removeAttribute("aria-invalid");
      if (input) input.value = value;
      if (msg) msg.textContent = "Ссылка принята. Открываем регистрацию: разбор будет по этой точке.";
      try {
        sessionStorage.setItem("locus:audit-url", value);
        sessionStorage.setItem("locus:prefill-card", value);
      } catch (err) { /* noop */ }
      window.location.assign(`login.html?mode=signup&audit=1&card=${encodeURIComponent(value)}`);
    });
  }

  $$("[data-audit-niche]").forEach((btn) => {
    btn.addEventListener("click", () => {
      auditState.niche = btn.dataset.auditNiche;
      auditState.values = { ...auditPresets[auditState.niche] };
      $$("[data-audit-niche]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  $$("[data-audit]").forEach((input) => {
        input.checked = Boolean(auditState.values[input.dataset.audit]);
      });
      paintAudit();
    });
  });

  $$("[data-audit]").forEach((input) => {
    input.addEventListener("change", () => {
      auditState.values[input.dataset.audit] = input.checked;
      paintAudit();
    });
  });
  if (auditBarsEl) paintAudit();

  /* ---------- изображения: без сметы и видео ---------- */

  /* ---------- scroll progress ---------- */
  const progress = $("#scrollProgress");
  function paintProgress() {
    if (!progress) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    progress.style.transform = `scaleX(${p})`;
  }
  paintProgress();
  window.addEventListener("scroll", paintProgress, { passive: true });
  window.addEventListener("resize", paintProgress);

  /* ---------- tilt ---------- */
  if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
    $$("[data-tilt]").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(900px) rotateX(${(-y * 3.2).toFixed(2)}deg) rotateY(${(x * 3.2).toFixed(2)}deg)`;
      });
      card.addEventListener("pointerleave", () => {
        card.style.transform = "";
      });
    });
  }

  /* ---------- counters ---------- */
  const counters = $$("[data-count]");
  if (counters.length && !reduceMotion && "IntersectionObserver" in window) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const to = Number(el.dataset.count);
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - start) / 700);
          el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        cio.unobserve(el);
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => cio.observe(el));
  }

  /* ---------- reveal для новых блоков ---------- */
  if (!reduceMotion && "IntersectionObserver" in window) {
    const late = $$(".section-head, .audit-card, .audit-controls, .media-copy, .media-panel, .plan").filter(
      (el) => !el.classList.contains("reveal")
    );
    late.forEach((el) => el.classList.add("reveal"));
    const lio = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        lio.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.1 });
    late.forEach((el) => lio.observe(el));
  }

  /* ---------- year calculator for plan totals ---------- */
  $$("[data-year-note]").forEach((el) => {
    const plan = el.closest(".plan");
    const month = Number(plan.querySelector("[data-price-month]").dataset.priceMonth);
    el.dataset.total = String(month * 12);
  });
})();
