// Applies the saved theme and background before first paint to avoid a flash.
(function () {
  try {
    var t = localStorage.getItem("dim-theme");
    if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    }
    var bg = localStorage.getItem("dim-bg");
    document.documentElement.setAttribute("data-bg", ["dots", "topo", "waves", "rain"].indexOf(bg) >= 0 ? bg : "rain");
  } catch (e) {}
})();
