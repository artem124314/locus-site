/* Локус — очистка service worker и кэшей браузера, затем свежая версия сайта. */
(async () => {
  const status = document.getElementById("resetStatus");
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch { /* уже очищено или браузер запретил */ }
  if (status) status.textContent = "Кэш очищен. Открываю свежую версию…";
  setTimeout(() => location.replace("index.html?fresh=" + Date.now()), 700);
})();
