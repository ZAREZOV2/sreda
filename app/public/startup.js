(() => {
  try {
    const base = localStorage.getItem("sreda.theme-base");
    if (base === "light" || base === "dark") document.documentElement.dataset.theme = base;
  } catch {}
  const report = message => {
    const status = document.querySelector("#startup-status p");
    if (status) status.textContent = "Не удалось открыть интерфейс Среды.\nОтдельный сервер запускать не требуется.\n" + message;
  };
  window.addEventListener("error", event => report(event.message || "Не загрузился один из встроенных ресурсов."), true);
  window.addEventListener("unhandledrejection", event => report(String(event.reason?.message || event.reason || "Ошибка запуска.")));
  setTimeout(() => report("Запуск занял больше 15 секунд. Используйте проверенный выпуск из папки releases."), 15000);
})();
