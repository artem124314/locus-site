/* Локус — регистрируем service worker: повторные открытия из кэша браузера.
   Когда выходит новая версия, страница один раз перезагружается сама. */
(() => {
  if (!("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        /* офлайн-режим недоступен — сайт работает как обычно */
      });
  });
})();
