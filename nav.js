/* nav.js — the one nav's two behaviours.
 *
 * 1. The Research dropdown closes on a click outside it or on Escape, as
 *    a menu should. A native <details> only closes on its own summary, so
 *    an open panel would otherwise sit over the board until the reader
 *    found the summary again.
 * 2. The season dot on the board switch (2026-10-21, after xep.ai's
 *    "live now" tabs): a small green dot after a board's name while its
 *    league is in season, with the words in the link's title. By the
 *    calendar, not by the data file: a data file is one day's slate, and
 *    an off day is not an off season. The nav is otherwise static markup,
 *    the current page marked in it. */

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseNav = api;
  if (typeof document !== "undefined") api.mount(document);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* True while the league is in season, false out of it, null for a page
     that is not a board. The NFL's first game is the Thursday after Labor
     Day, so September 4 at the earliest, through the Super Bowl in mid
     February; MLB from late March through a World Series that can run
     into the second week of November. A window that wraps the new year
     is the one that starts after it ends. By the calendar because the
     nav is on every page and the data files are not: a slate is one
     day, and an off day is not an off season. */
  var WINDOWS = { "nfl.html": [[9, 4], [2, 15]], "baseball.html": [[3, 20], [11, 10]] };
  function inSeason(page, now) {
    var w = WINDOWS[page];
    if (!w) return null;
    var d = now || new Date(), k = (d.getMonth() + 1) * 100 + d.getDate();
    var a = w[0][0] * 100 + w[0][1], b = w[1][0] * 100 + w[1][1];
    return a <= b ? (k >= a && k <= b) : (k >= a || k <= b);
  }

  function mount(document) {
    var menus = document.querySelectorAll(".mnav details.research");
    if (menus.length) {
      var closeAll = function (except) { menus.forEach(function (d) { if (d !== except && d.open) d.open = false; }); };
      document.addEventListener("click", function (e) {
        var inside = e.target && e.target.closest ? e.target.closest(".mnav details.research") : null;
        closeAll(inside);
      });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(null); });
    }
    document.querySelectorAll(".mnav .prim a").forEach(function (a) {
      var dot = a.querySelector(".dot");
      if (!dot) return;
      var on = inSeason(a.getAttribute("href"));
      if (on == null) return;
      var name = a.firstChild && a.firstChild.nodeValue ? a.firstChild.nodeValue.trim() : a.getAttribute("href");
      dot.hidden = !on;
      a.title = name + " · " + (on ? "in season" : "off season");
      if (on) { dot.setAttribute("role", "img"); dot.setAttribute("aria-label", "in season"); }
    });
  }

  return { inSeason: inSeason, WINDOWS: WINDOWS, mount: mount };
});
