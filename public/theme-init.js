// Applies the saved theme before first paint to avoid a light/dark flash.
(function () {
  try {
    var t = localStorage.getItem("dim-theme");
    if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
