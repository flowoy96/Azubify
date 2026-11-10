// Früh geladen, damit beim Start kein Aufblitzen entsteht.
(function () {
  try { var t = localStorage.getItem('azubify:theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* egal */ }
})();
