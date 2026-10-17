/* nav.js — the one nav's one behaviour: the Research dropdown closes on a
 * click outside it or on Escape, as a menu should. A native <details>
 * only closes on its own summary, so an open panel would otherwise sit
 * over the board until the reader found the summary again. Nothing else
 * here: the nav is static markup, the current page is marked in it. */
(function () {
  "use strict";
  var menus = document.querySelectorAll(".mnav details.research");
  if (!menus.length) return;
  var closeAll = function (except) { menus.forEach(function (d) { if (d !== except && d.open) d.open = false; }); };
  document.addEventListener("click", function (e) {
    var inside = e.target && e.target.closest ? e.target.closest(".mnav details.research") : null;
    closeAll(inside);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(null); });
})();
