/* Локус — сессия демо-пользователя (без бэкенда) */
(() => {
  "use strict";

  const KEY = "locus:session:v1";

  const DEMO = Object.freeze({
    name: "Артём",
    fullName: "Артём Винокуров",
    email: "demo@locus.ru",
    company: "Кофейня «Полдень»",
    role: "Владелец",
    plan: "Самостоятельный",
    demo: true,
  });

  function readRaw() {
    try {
      return localStorage.getItem(KEY);
    } catch (err) {
      return null;
    }
  }

  function get() {
    const raw = readRaw();
    if (!raw) return window.__locusSession || null;
    try {
      const data = JSON.parse(raw);
      return data && typeof data === "object" && data.email ? data : null;
    } catch (err) {
      return null;
    }
  }

  function set(data) {
    const session = {
      name: String(data.name || "").trim().slice(0, 40),
      fullName: String(data.fullName || data.name || "Артём Винокуров").trim().slice(0, 80),
      email: String(data.email || DEMO.email).trim().slice(0, 120),
      company: String(data.company || DEMO.company).trim().slice(0, 120),
      role: String(data.role || DEMO.role).slice(0, 40),
      plan: String(data.plan || DEMO.plan).slice(0, 40),
      demo: true,
      createdAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch (err) {
      /* приватный режим или file:// без storage — сессия живёт до перехода */
      window.__locusSession = session;
    }
    return session;
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {
      /* noop */
    }
    window.__locusSession = null;
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "Л";
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "Вы";
  }

  function nameFromEmail(email) {
    const local = String(email || "").split("@")[0] || "";
    const clean = local.replace(/[._-]+/g, " ").trim();
    if (!clean) return "Вы";
    return clean
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  window.LocusSession = { KEY, DEMO, get, set, clear, initials, firstName, nameFromEmail };
})();
