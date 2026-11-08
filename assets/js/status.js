(() => {
  const dot = document.getElementById("statusDot");
  const title = document.getElementById("statusTitle");
  const text = document.getElementById("statusText");
  const version = document.getElementById("metricVersion");
  const uptime = document.getElementById("metricUptime");
  const db = document.getElementById("metricDb");
  const scheduler = document.getElementById("metricScheduler");
  const demo = document.getElementById("metricDemo");
  const checked = document.getElementById("metricChecked");
  const updated = document.getElementById("statusUpdated");
  const refresh = document.getElementById("refreshStatus");

  function formatUptime(seconds) {
    const total = Number(seconds) || 0;
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days) return `${days} д ${hours} ч`;
    if (hours) return `${hours} ч ${minutes} мин`;
    return `${Math.max(1, minutes)} мин`;
  }

  function setState(kind, heading, message) {
    dot.className = `dot ${kind}`;
    title.textContent = heading;
    text.textContent = message;
  }

  async function check() {
    refresh.disabled = true;
    refresh.textContent = "Проверяем…";
    try {
      const res = await fetch("/api/health", { cache: "no-store", headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setState("ok", "Сервис работает", "API отвечает, база доступна, планировщик в штатном режиме.");
      } else if (res.status === 503 || data.db === "fail") {
        setState("bad", "Сервис недоступен", "API отвечает, но база данных не прошла проверку. Мы уже разбираемся.");
      } else {
        setState("warn", "Частичная деградация", "Сервис отвечает не полностью. Проверьте статус через минуту.");
      }
      version.textContent = data.version || "—";
      uptime.textContent = formatUptime(data.uptime_sec);
      db.textContent = data.db === "ok" ? "доступна" : "ошибка";
      scheduler.textContent = data.scheduler === "enabled" ? "включён" : "выключен";
      demo.textContent = data.demo === "disabled" ? "выключен" : "включён";
      const at = new Date();
      checked.textContent = at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      updated.textContent = `Обновлено ${at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    } catch {
      setState("bad", "Сервис недоступен", "Не удалось связаться с API. Проверьте соединение или напишите в поддержку.");
      version.textContent = "—";
      uptime.textContent = "—";
      db.textContent = "нет связи";
      scheduler.textContent = "—";
      demo.textContent = "—";
      checked.textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      updated.textContent = "Нет связи";
    } finally {
      refresh.disabled = false;
      refresh.textContent = "Проверить сейчас";
    }
  }

  refresh.addEventListener("click", check);
  check();
  setInterval(check, 15000);
})();
