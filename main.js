/* High Street Jiu Jitsu: interactions.
   Progressive enhancement: the page is fully readable and navigable with JS off.
   JS adds the cinematic motion, the program switcher, the coach reader, and the
   interactive free-class booking flow (which degrades to a visible phone number
   and schedule link). */
(function () {
  "use strict";
  var doc = document.documentElement;
  doc.classList.remove("no-js");
  doc.classList.add("js");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- header solidify on scroll (always on screen) ---------- */
  var head = $("#head"), hero = $(".hero"), progress = $("#progress");
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (head) {
      if (!hero) head.classList.add("solid");          // inner pages: always solid
      else head.classList.toggle("solid", y > 40);
    }
    if (progress) {
      var h = doc.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    }
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- mobile sheet ---------- */
  var burger = $("#burger"), sheet = $("#sheet"), sheetClose = $("#sheetClose");
  function setSheet(open) {
    if (!sheet) return;
    sheet.classList.toggle("open", open);
    sheet.setAttribute("aria-hidden", String(!open));
    if (burger) burger.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  }
  if (burger) burger.addEventListener("click", function () { setSheet(true); });
  if (sheetClose) sheetClose.addEventListener("click", function () { setSheet(false); });
  if (sheet) sheet.addEventListener("click", function (e) { if (e.target.closest("a")) setSheet(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setSheet(false); });

  /* ---------- reveal on scroll (.rv) + line reveal (.ml) ---------- */
  var revealables = $$(".rv, .ml");
  if ("IntersectionObserver" in window && !reduce) {
    var ro = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (!e.isIntersecting) return;
        var sibs = $$(".ml", e.target.parentNode);
        if (e.target.classList.contains("ml") && sibs.length > 1) {
          sibs.forEach(function (s, i) { setTimeout(function () { s.classList.add("in"); }, i * 120); });
        } else {
          e.target.classList.add("in");
        }
        ro.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -7% 0px" });
    revealables.forEach(function (el) { ro.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("in"); });
  }
  /* safety: never leave content hidden */
  setTimeout(function () { revealables.forEach(function (el) { el.classList.add("in"); }); }, 4500);

  /* ---------- hero parallax ---------- */
  var heroMedia = $("#heroMedia");
  if (heroMedia && !reduce) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY || 0;
        if (y < window.innerHeight * 1.2) heroMedia.style.transform = "translateY(" + (y * 0.18) + "px)";
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------- hero slideshow ---------- */
  var heroSlides = heroMedia ? heroMedia.querySelectorAll("img") : [];
  if (heroSlides.length > 1 && !reduce) {
    var hSlide = 0;
    setInterval(function () {
      heroSlides[hSlide].classList.remove("is-active");
      hSlide = (hSlide + 1) % heroSlides.length;
      heroSlides[hSlide].classList.add("is-active");
    }, 6000);
  }

  /* ---------- count-up ---------- */
  function countUp(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    if (reduce) { el.textContent = String(target); return; }
    var dur = 1400, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * e));
      if (p < 1) requestAnimationFrame(step); else el.textContent = String(target);
    }
    requestAnimationFrame(step);
  }
  var counts = $$("[data-count]");
  if (counts.length && "IntersectionObserver" in window) {
    var cObs = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); cObs.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counts.forEach(function (el) { cObs.observe(el); });
  } else { counts.forEach(function (el) { el.textContent = el.getAttribute("data-count"); }); }

  /* ---------- footer year ---------- */
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ===================================================================
     PROGRAM SWITCHER (tablist)
     =================================================================== */
  var tabs = $$("#switchTabs .switch__tab");
  var imgs = $$(".switch__img");
  var panes = $$(".switch__pane");
  function showProg(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-prog") === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    imgs.forEach(function (im) { im.classList.toggle("is-shown", im.getAttribute("data-prog") === name); });
    panes.forEach(function (p) { p.classList.toggle("is-shown", p.getAttribute("data-prog") === name); });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { showProg(t.getAttribute("data-prog")); });
    t.addEventListener("keydown", function (e) {
      var n = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") n = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = tabs[(i - 1 + tabs.length) % tabs.length];
      if (n) { e.preventDefault(); n.focus(); showProg(n.getAttribute("data-prog")); }
    });
  });

  /* The bespoke booking wizard was retired on 2026-08-06: Kicksite owns
     lead capture end to end, so the free-trial page hosts their form
     directly rather than collecting a day and a time their form has no
     field for. The #scheduleData block on that page stays as the
     canonical class-times record that LIVE_SCHED below mirrors. */

  /* ===================================================================
     TOP-OF-PAGE CHROME: the hero (or the page's opening content) already
     carries the primary CTA, so the nav button, trial bar, and mobile
     sticky CTA reveal only once the visitor scrolls past it.
     =================================================================== */
  var mcta = $("#mcta");
  function setPastTop(on) {
    document.body.classList.toggle("past-top", on);
    if (mcta) {
      mcta.classList.toggle("show", on);
      document.body.classList.toggle("mcta-open", on);
    }
  }
  if (hero && "IntersectionObserver" in window) {
    var mObs = new IntersectionObserver(function (en) {
      setPastTop(!en[0].isIntersecting);
    }, { threshold: 0 });
    mObs.observe(hero);
  } else {
    window.addEventListener("scroll", function () {
      setPastTop((window.scrollY || 0) > 260);
    }, { passive: true });
    setPastTop((window.scrollY || 0) > 260);
  }
  if ("requestAnimationFrame" in window) {
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { document.body.classList.add("anim"); });
    });
  }



  /* ===================================================================
     SCHEDULE: read the printed week table and bring it to life. The
     table stays the source of truth so the page is complete with JS
     off; this adds the live status dial, the up-next queue, today's
     column, a now marker, dimmed past classes, and a program filter.
     Gym-local time (America/Phoenix) so the page is right wherever
     the visitor is.
     =================================================================== */
  var schedTable = $(".sched");
  if (schedTable && window.Intl && Intl.DateTimeFormat) {
    var CLASS_MINS = 60;
    var parseClock = function (s) {
      var m = /^(\d+):(\d+)\s*([ap])/i.exec((s || "").trim());
      if (!m) return -1;
      var h = (+m[1]) % 12;
      if (m[3].toLowerCase() === "p") h += 12;
      return h * 60 + (+m[2]);
    };
    var phx = function () {
      var parts = {};
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", weekday: "short", hour: "numeric", minute: "numeric", hour12: false })
        .formatToParts(new Date()).forEach(function (x) { parts[x.type] = x.value; });
      return { day: { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[parts.weekday],
               mins: ((+parts.hour) % 24) * 60 + (+parts.minute) };
    };
    /* build a model from the printed table: columns are Mon..Sat */
    var slots = [];
    $$("tbody tr", schedTable).forEach(function (tr) {
      var start = parseClock($("th", tr) ? $("th", tr).textContent : "");
      $$("td", tr).forEach(function (td, col) {
        var cell = $(".scell", td);
        if (!cell || start < 0) return;
        var prog = (cell.className.match(/is-[a-z]+/) || ["is-adults"])[0];
        slots.push({ day: col + 1, start: start, el: td, cell: cell,
                     name: ($("b", cell) || {}).textContent || "",
                     who: ($("span", cell) || {}).textContent || "", prog: prog });
      });
    });

    var DAY_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    var DAY_ABBR_CAL = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    var calPaint = null, calFilter = null;

    /* today's calendar date in Phoenix terms, shared by the week grid
       (which prints the date on each day tab) and the .ics export */
    var phxDate = function () {
      var parts = {};
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
        .formatToParts(new Date()).forEach(function (x) { parts[x.type] = x.value; });
      return { y: +parts.year, m: +parts.month, d: +parts.day,
               wd: { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[parts.weekday] };
    };
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var addDays = function (d, n) {
      var js = new Date(Date.UTC(d.y, d.m - 1, d.d));
      js.setUTCDate(js.getUTCDate() + n);
      return { y: js.getUTCFullYear(), m: js.getUTCMonth() + 1, d: js.getUTCDate() };
    };
    var fmtClock = function (m) {
      var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "pm" : "am";
      h = h % 12; if (h === 0) h = 12;
      return h + ":" + (mm < 10 ? "0" : "") + mm + ap;
    };
    var fmtGap = function (m) {
      if (m < 60) return m + " min";
      var h = Math.floor(m / 60), r = m % 60;
      return h + "h" + (r ? " " + r + "m" : "");
    };

    var panel = $("#nowpanel"), arc = $("#nowArc");
    var ARC_LEN = arc ? 2 * Math.PI * 52 : 0;
    if (arc) { arc.style.strokeDasharray = ARC_LEN; }

    var paint = function () {
      var now = phx();
      if (now.day === undefined || isNaN(now.mins)) return;

      /* today's column, past classes, and the live class */
      var headCells = $$("thead th", schedTable);
      headCells.forEach(function (th, i) { th.classList.toggle("is-today", i === now.day); });
      var live = null, upcoming = [];
      slots.forEach(function (s) {
        var isToday = s.day === now.day;
        var isLive = isToday && now.mins >= s.start && now.mins < s.start + CLASS_MINS;
        var isPast = isToday && now.mins >= s.start + CLASS_MINS;
        s.el.classList.toggle("is-today", isToday);
        s.el.classList.toggle("is-live", isLive);
        s.el.classList.toggle("is-past", isPast);
        if (isLive) live = s;
        if (isToday && s.start > now.mins) upcoming.push(s);
      });
      /* nothing left today: look ahead to the next open day */
      if (!upcoming.length) {
        for (var i = 1; i <= 7 && !upcoming.length; i++) {
          var d = (now.day + i) % 7;
          upcoming = slots.filter(function (s) { return s.day === d; })
                          .sort(function (a, b) { return a.start - b.start; })
                          .map(function (s) { return Object.assign({}, s, { inDays: i }); });
        }
      }
      upcoming.sort(function (a, b) { return a.start - b.start; });

      if (calPaint) calPaint(now);

      if (!panel) return;
      panel.hidden = false;

      /* the backdrop follows what is actually on the mats; when the room
         is quiet it falls back to the empty facility in neon */
      var bgLayer = $("#nowsecLive");
      if (bgLayer) {
        var BG = { "no-gi":"nogi", "fundamentals":"fundamentals", "all-levels":"alllevels",
                   "kids":"kids", "wrestling":"wrestling", "muay thai":"muaythai",
                   "open mat":"openmat", "competition":"competition" };
        var key = live ? BG[live.name.replace(/\u2011|\u2010/g, "-").toLowerCase().trim()] : null;
        var want = key ? "/HSJ-website/assets/img/bg/" + key + ".jpg" : "";
        if (bgLayer.getAttribute("data-want") !== want) {
          bgLayer.setAttribute("data-want", want);
          if (!want) {
            bgLayer.classList.remove("is-on");
          } else {
            var pre = new Image();
            pre.onload = function () {
              if (bgLayer.getAttribute("data-want") !== want) return;
              bgLayer.src = want;
              bgLayer.classList.add("is-on");
            };
            pre.src = want;
          }
        }
      }
      var setTxt = function (sel, v) { var e = $(sel); if (e) e.textContent = v; };
      if (live) {
        var done = now.mins - live.start;
        var pct = Math.max(0, Math.min(1, done / CLASS_MINS));
        if (arc) arc.style.strokeDashoffset = String(ARC_LEN * (1 - pct));
        setTxt("#nowPct", Math.round(pct * 100) + "%");
        setTxt("#nowStateTxt", "On the mats now");
        setTxt("#nowTitle", live.name);
        setTxt("#nowMeta", live.who + " \u00b7 started " + fmtClock(live.start) + " \u00b7 " + fmtGap(CLASS_MINS - done) + " left");
        $("#nowcard").classList.add("is-live");
      } else {
        if (arc) arc.style.strokeDashoffset = String(ARC_LEN);
        setTxt("#nowPct", "");
        $("#nowcard").classList.remove("is-live");
        var nxt = upcoming[0];
        if (nxt) {
          var when = nxt.inDays
            ? (nxt.inDays === 1 ? "tomorrow" : DAY_LONG[nxt.day]) + " at " + fmtClock(nxt.start)
            : "in " + fmtGap(nxt.start - now.mins);
          setTxt("#nowStateTxt", "Mats are quiet");
          setTxt("#nowTitle", "Next: " + nxt.name);
          setTxt("#nowMeta", nxt.who + " \u00b7 " + when);
        } else {
          setTxt("#nowStateTxt", "Mats are quiet");
          setTxt("#nowTitle", "See the week below");
          setTxt("#nowMeta", "");
        }
      }
      var list = $("#upnext");
      if (list) {
        list.innerHTML = "";
        upcoming.slice(live ? 0 : 1, live ? 3 : 4).forEach(function (s) {
          var li = document.createElement("li");
          var b = document.createElement("b"); b.textContent = s.name;
          var sp = document.createElement("span");
          sp.textContent = fmtClock(s.start) + (s.inDays ? " \u00b7 " + (s.inDays === 1 ? "tomorrow" : DAY_LONG[s.day]) : "") + " \u00b7 " + s.who;
          li.appendChild(b); li.appendChild(sp);
          list.appendChild(li);
        });
      }
    };
    /* the week at a glance: what day it is, how many classes each day
       carries, whether tomorrow is open, and a jump into that column */
    var DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    var dayweek = $("#dayweek"), dayRow = $("#dayweekRow"), dayLine = $("#dayweekLine");
    var countFor = function (d) {
      return slots.filter(function (s) { return s.day === d; }).length;
    };
    /* opening hours come from the page's own hours block, not from class
       times: the last class ends before the doors do, and the stated
       hours are the canonical figure */
    var HOURS = {};
    (function () {
      /* the footer hours string is the canonical figure and appears on
         every page, so it survives any section being removed here */
      var src = ($(".foot__hours") || {}).textContent || "";
      var expand = function (r) {
        var m = /^(\d+)(?::(\d+))?\s*([ap])?\s*-\s*(\d+)(?::(\d+))?\s*([ap])/i.exec(r.trim());
        if (!m) return null;
        var end = m[6].toLowerCase(), begin = (m[3] || end).toLowerCase();
        var say = function (h, mins, ap) {
          return h + ":" + (mins || "00") + (ap === "a" ? "am" : "pm");
        };
        return say(m[1], m[2], begin) + " to " + say(m[4], m[5], end);
      };
      src.split("\u00b7").forEach(function (part) {
        var seg = part.trim();
        var days = /mon\s*-\s*fri/i.test(seg) ? [1,2,3,4,5]
                 : /^sat/i.test(seg) ? [6]
                 : /^sun/i.test(seg) ? [0] : null;
        if (!days) return;
        var open = /closed/i.test(seg) ? null : expand(seg.replace(/^[a-z-]+\s*/i, ""));
        days.forEach(function (d) { HOURS[d] = open; });
      });
    })();
    var spanFor = function (d) {
      if (Object.prototype.hasOwnProperty.call(HOURS, d)) return HOURS[d];
      var list = slots.filter(function (s) { return s.day === d; });
      if (!list.length) return null;
      var first = Math.min.apply(null, list.map(function (s) { return s.start; }));
      var last = Math.max.apply(null, list.map(function (s) { return s.start + CLASS_MINS; }));
      return fmtClock(first) + " to " + fmtClock(last);
    };
    var focusDay = function (d) {
      slots.forEach(function (s) { s.el.classList.toggle("is-focusday", d !== null && s.day === d); });
      $$(".dayweek__day", dayRow).forEach(function (btn) {
        var on = String(d) === btn.getAttribute("data-day");
        btn.classList.toggle("is-sel", on);
        btn.setAttribute("aria-pressed", String(on));
      });
    };
    var buildWeek = function (todayIdx) {
      if (!dayRow) return;
      dayRow.innerHTML = "";
      [1,2,3,4,5,6,0].forEach(function (d) {
        var n = countFor(d);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dayweek__day" + (d === todayIdx ? " is-today" : "") + (n ? "" : " is-closed");
        btn.setAttribute("data-day", String(d));
        btn.setAttribute("aria-pressed", "false");
        if (!n) btn.disabled = true;
        var lab = document.createElement("b"); lab.textContent = DAY_ABBR[d];
        var sub = document.createElement("span");
        sub.textContent = n ? n + (n === 1 ? " class" : " classes") : "Closed";
        btn.appendChild(lab); btn.appendChild(sub);
        if (n) btn.addEventListener("click", function () {
          var already = btn.classList.contains("is-sel");
          focusDay(already ? null : d);
          if (!already && !reduce) schedTable.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        dayRow.appendChild(btn);
      });
    };
    var sayDays = function (todayIdx) {
      var now = phx();
      var tmr = (todayIdx + 1) % 7;
      var todaySpan = spanFor(todayIdx), tmrSpan = spanFor(tmr);
      var set = function (sel, v) { var e = $(sel); if (e) e.textContent = v; };
      set("#todayDay", DAY_LONG[todayIdx]);
      set("#todayHours", todaySpan ? "Open " + todaySpan : "Closed today");
      var total = countFor(todayIdx);
      var left = slots.filter(function (s) { return s.day === todayIdx && s.start > now.mins; }).length;
      set("#todayLeft", !total ? "No classes scheduled"
        : left ? left + " of " + total + (total === 1 ? " class" : " classes") + " still to come"
               : total + (total === 1 ? " class" : " classes") + ", all finished");
      if (dayLine) {
        dayLine.textContent = tmrSpan
          ? "Tomorrow, " + DAY_LONG[tmr] + ", the doors open " + tmrSpan + " with " + countFor(tmr) + " classes."
          : "Tomorrow, " + DAY_LONG[tmr] + ", the mats are closed.";
      }
    };

    paint();
    (function () {
      var n = phx();
      if (n.day === undefined) return;
      if (dayweek) dayweek.hidden = false;
      buildWeek(n.day);
      sayDays(n.day);
    })();
    window.setInterval(paint, 60000);

    /* ---------------------------------------------------------------
       Build the week from the printed table.

       This was a pixel-proportional day grid, which was honest about
       time but spent more than half its height on hours the academy
       runs nothing: the day spans 6am to 9pm and only seven of those
       fifteen hours hold a class. Same information, banded by time of
       day instead, one row per start time, so the shape of the week
       reads in a single look. On a phone it collapses to one day at a
       time rather than a six-column scroller with truncated titles.

       The grid carries real controls (the day picker), so unlike the
       first version it is exposed to assistive tech rather than hidden
       behind aria-hidden with focusable children inside it. Each class
       names its own day for screen readers, and the printed table,
       which is the JS-off view, steps out of both the page and the
       accessibility tree once the grid is up.
       --------------------------------------------------------------- */
    var calHost = $("#calendar");
    if (calHost && slots.length) {
      var DAY_COLS = [1,2,3,4,5,6];
      /* time-of-day bands, named for who is actually on the mats then */
      var BANDS = [
        { label: "Morning",      until: 11 * 60 },
        { label: "Midday",       until: 16 * 60 },
        { label: "After school", until: 17 * 60 + 15 },
        { label: "Evening",      until: 24 * 60 }
      ];
      /* the four programmes the site actually teaches, matching the four
         pages under /programs/ rather than lumping the striking classes
         into one bucket */
      var DISCIPLINE = { "is-adults": "Jiu Jitsu", "is-kids": "Jiu Jitsu",
                         "is-muaythai": "Muay Thai", "is-wrestling": "Wrestling" };
      var bandFor = function (m) {
        for (var i = 0; i < BANDS.length; i++) if (m < BANDS[i].until) return BANDS[i];
        return BANDS[BANDS.length - 1];
      };
      var times = [];
      slots.forEach(function (s) { if (times.indexOf(s.start) === -1) times.push(s.start); });
      times.sort(function (a, b) { return a - b; });

      var cal = document.createElement("div");
      cal.className = "cal";
      cal.setAttribute("role", "group");
      cal.setAttribute("aria-label", "Weekly class schedule");

      /* the day header picks the day on a phone and marks the column
         being read on a wide screen */
      var chead = document.createElement("div");
      chead.className = "cal__head";
      var corner = document.createElement("span");
      corner.className = "cal__corner";
      chead.appendChild(corner);
      var daysEl = document.createElement("div");
      daysEl.className = "cal__days";
      daysEl.setAttribute("role", "group");
      daysEl.setAttribute("aria-label", "Pick a day");
      var dayBtns = {}, weekStart = phxDate();
      DAY_COLS.forEach(function (d) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "cal__day";
        b.setAttribute("data-d", String(d));
        b.setAttribute("aria-label", DAY_LONG[d]);
        var nm = document.createElement("b"); nm.textContent = DAY_ABBR_CAL[d];
        b.appendChild(nm);
        /* the date is a nicety; drop it rather than print NaN if the
           locale data ever comes back without a calendar date */
        var dnum = addDays(weekStart, d - weekStart.wd).d;
        if (isFinite(dnum)) {
          var dt = document.createElement("i"); dt.textContent = dnum;
          b.appendChild(dt);
        }
        b.addEventListener("click", function () { setDay(d); });
        daysEl.appendChild(b);
        dayBtns[d] = b;
      });
      chead.appendChild(daysEl);
      cal.appendChild(chead);

      var rows = [], groups = [];
      BANDS.forEach(function (band) {
        var inBand = times.filter(function (t) { return bandFor(t) === band; });
        if (!inBand.length) return;
        var bl = document.createElement("h3");
        bl.className = "cal__band";
        bl.textContent = band.label;
        cal.appendChild(bl);
        var group = { el: bl, rows: [] };
        groups.push(group);
        inBand.forEach(function (t) {
          var row = document.createElement("div");
          row.className = "cal__row";
          var lab = document.createElement("span");
          lab.className = "cal__time";
          lab.setAttribute("aria-hidden", "true");   /* every class states its own time */
          lab.textContent = fmtClock(t).replace(":00", "");
          row.appendChild(lab);
          var cellsEl = document.createElement("div");
          cellsEl.className = "cal__cells";
          var cells = {};
          DAY_COLS.forEach(function (d) {
            var c = document.createElement("div");
            c.className = "cal__cell";
            c.setAttribute("data-d", String(d));
            cellsEl.appendChild(c);
            cells[d] = c;
          });
          row.appendChild(cellsEl);
          cal.appendChild(row);
          var rec = { start: t, el: row, cells: cells, group: group };
          rows.push(rec);
          group.rows.push(rec);
        });
      });

      var byTime = {};
      rows.forEach(function (r) { byTime[r.start] = r; });
      slots.forEach(function (s) {
        var row = byTime[s.start], cell = row && row.cells[s.day];
        if (!cell) return;
        var blk = document.createElement("div");
        blk.className = "cal__class " + s.prog;
        var day = document.createElement("span");
        day.className = "sr-only";
        day.textContent = DAY_LONG[s.day] + ", ";
        var nm = document.createElement("b"); nm.textContent = s.name;
        /* what the class is and who it is for are the two things people
           scan for, so both read as badges rather than as the tail of a
           grey meta line. Muay Thai and wrestling name their discipline
           in the title already, so the badge is dropped wherever it
           would repeat the class name. */
        var mt = document.createElement("span"); mt.className = "cal__meta";
        var at = document.createElement("span"); at.className = "cal__at"; at.textContent = fmtClock(s.start);
        mt.appendChild(at);
        var disc = DISCIPLINE[s.prog];
        if (disc && disc.toLowerCase() !== s.name.replace(/‑|‐/g, "-").toLowerCase()) {
          var what = document.createElement("span"); what.className = "cal__what"; what.textContent = disc;
          mt.appendChild(what);
        }
        var who = document.createElement("span"); who.className = "cal__who"; who.textContent = s.who;
        mt.appendChild(who);
        blk.appendChild(day); blk.appendChild(nm); blk.appendChild(mt);
        cell.appendChild(blk);
        s.block = blk;
        s.cellEl = cell;
      });

      /* the one-day view needs somewhere to say "nothing here" */
      var blank = document.createElement("p");
      blank.className = "cal__none";
      cal.appendChild(blank);
      calHost.appendChild(cal);

      var activeDay = 1, progKey = "all";
      var applyVis = function () {
        groups.forEach(function (g) { g.week = false; g.day = false; });
        var anyDay = false;
        rows.forEach(function (r) {
          var inWeek = false, inDay = false;
          DAY_COLS.forEach(function (d) {
            var blk = r.cells[d].firstChild;
            if (!blk) return;
            var on = progKey === "all" || blk.classList.contains(progKey);
            blk.classList.toggle("is-off", !on);
            if (!on) return;
            inWeek = true;
            if (d === activeDay) inDay = true;
          });
          r.el.classList.toggle("is-empty", !inWeek);
          r.el.classList.toggle("is-dayempty", !inDay);
          if (inWeek) r.group.week = true;
          if (inDay) { r.group.day = true; anyDay = true; }
        });
        groups.forEach(function (g) {
          g.el.classList.toggle("is-empty", !g.week);
          g.el.classList.toggle("is-dayempty", !g.day);
        });
        cal.classList.toggle("is-dayblank", !anyDay);
        blank.textContent = "No classes on " + DAY_LONG[activeDay] + ".";
      };
      var setDay = function (d) {
        activeDay = d;
        DAY_COLS.forEach(function (x) {
          dayBtns[x].classList.toggle("is-sel", x === d);
          dayBtns[x].setAttribute("aria-pressed", String(x === d));
        });
        cal.setAttribute("data-day", String(d));
        applyVis();
      };
      calFilter = function (key) { progKey = key; applyVis(); };

      calPaint = function (now) {
        cal.setAttribute("data-today", String(now.day));
        DAY_COLS.forEach(function (d) { dayBtns[d].classList.toggle("is-today", d === now.day); });
        slots.forEach(function (s) {
          if (!s.block) return;
          var isToday = s.day === now.day;
          s.block.classList.toggle("is-live", isToday && now.mins >= s.start && now.mins < s.start + CLASS_MINS);
          s.block.classList.toggle("is-past", isToday && now.mins >= s.start + CLASS_MINS);
        });
      };
      schedTable.closest(".sched-wrap").classList.add("is-replaced");
      (function () {
        var n0 = phx();
        /* open on today, or on Monday when the academy is closed */
        setDay(n0.day >= 1 && n0.day <= 6 ? n0.day : 1);
        if (n0.day !== undefined) calPaint(n0);
      })();
    }

    /* ---------------------------------------------------------------
       Calendar export: build a subscribable .ics from whichever classes
       the visitor picks. Everything happens in the browser, no server.
       Phoenix does not observe daylight saving, so a fixed -0700 offset
       is correct all year and the times never drift.
       --------------------------------------------------------------- */
    var icsBox = $("#icsbox"), icsPicks = $("#icsPicks"), icsGo = $("#icsGo"), icsNote = $("#icsNote");
    if (icsBox && icsPicks && icsGo && window.Blob) {
      var BYDAY = ["SU","MO","TU","WE","TH","FR","SA"];
      /* one choice, not eight toggles: nearly everyone wants the whole
         schedule or the single programme they train, so this is a
         single select mirroring the filter used on the calendar below */
      var SETS = [
        { key: "all",       label: "Every class",           match: function () { return true; } },
        { key: "is-adults", label: "Adults",                match: function (s) { return s.prog === "is-adults"; } },
        { key: "is-kids",      label: "Kids",       match: function (s) { return s.prog === "is-kids"; } },
        { key: "is-muaythai",  label: "Muay Thai",  match: function (s) { return s.prog === "is-muaythai"; } },
        { key: "is-wrestling", label: "Wrestling",  match: function (s) { return s.prog === "is-wrestling"; } }
      ];
      var picked = SETS[0];
      var setCount = function (set) { return slots.filter(set.match).length; };
      var refresh = function () {
        var n = setCount(picked);
        icsGo.disabled = !n;
        if (icsNote) icsNote.textContent = n + (n === 1 ? " class" : " classes") + " · iPhone, Google Calendar, Outlook";
      };
      SETS.forEach(function (set) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = set === picked ? "is-on" : "";
        btn.setAttribute("aria-pressed", String(set === picked));
        btn.textContent = set.label;
        btn.addEventListener("click", function () {
          picked = set;
          $$("button", icsPicks).forEach(function (o) {
            o.classList.remove("is-on"); o.setAttribute("aria-pressed", "false");
          });
          btn.classList.add("is-on"); btn.setAttribute("aria-pressed", "true");
          refresh();
        });
        icsPicks.appendChild(btn);
      });
      refresh();

      var stamp = function (d, mins) {
        return d.y + pad(d.m) + pad(d.d) + "T" + pad(Math.floor(mins / 60)) + pad(mins % 60) + "00";
      };
      var fold = function (line) {
        if (line.length <= 74) return line;
        var out = line.slice(0, 74), rest = line.slice(74);
        while (rest.length) { out += "\r\n " + rest.slice(0, 73); rest = rest.slice(73); }
        return out;
      };
      var esc = function (s) {
        return String(s).replace(/[,;\\]/g, function (ch) { return "\\" + ch; });
      };

      icsGo.addEventListener("click", function () {
        var today = phxDate();
        var nowStamp = stamp(today, 0).slice(0, 8) + "T000000Z";
        var L = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//High Street Jiu Jitsu//Class schedule//EN",
                 "CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:High Street Jiu Jitsu",
                 "X-WR-TIMEZONE:America/Phoenix",
                 "BEGIN:VTIMEZONE","TZID:America/Phoenix","BEGIN:STANDARD","DTSTART:19700101T000000",
                 "TZOFFSETFROM:-0700","TZOFFSETTO:-0700","TZNAME:MST","END:STANDARD","END:VTIMEZONE"];
        var added = 0;
        slots.forEach(function (s, i) {
          if (!picked.match(s)) return;
          var name = s.name.replace(/\u2011|\u2010/g, "-");
          var delta = (s.day - today.wd + 7) % 7;
          var first = addDays(today, delta);
          L.push("BEGIN:VEVENT");
          L.push("UID:hsjj-" + s.day + "-" + s.start + "-" + i + "@highstreetjiujitsu.com");
          L.push("DTSTAMP:" + nowStamp);
          L.push("DTSTART;TZID=America/Phoenix:" + stamp(first, s.start));
          L.push("DTEND;TZID=America/Phoenix:" + stamp(first, s.start + CLASS_MINS));
          L.push("RRULE:FREQ=WEEKLY;BYDAY=" + BYDAY[s.day]);
          L.push(fold("SUMMARY:" + esc(name + " \u00b7 " + s.who)));
          L.push(fold("LOCATION:" + esc("High Street Jiu Jitsu, 5310 E High St Ste 102, Phoenix, AZ 85054")));
          L.push(fold("DESCRIPTION:" + esc("Times can shift. The front desk can confirm any class: (805) 895-4454")));
          L.push("END:VEVENT");
          added++;
        });
        L.push("END:VCALENDAR");
        if (!added) return;
        var blob = new Blob([L.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "high-street-jiu-jitsu.ics";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        if (icsNote) icsNote.textContent = "Downloaded " + added + (added === 1 ? " class" : " classes") + ". Open the file to add them.";
      });
      icsBox.hidden = false;
    }

    /* program filter over the printed table */
    var sfilter = $("#sfilter");
    if (sfilter) {
      sfilter.hidden = false;
      var sChips = $$(".sfilter__chip", sfilter);
      sChips.forEach(function (chip) {
        chip.addEventListener("click", function () {
          var key = chip.getAttribute("data-prog");
          sChips.forEach(function (c) {
            var on = c === chip;
            c.classList.toggle("is-on", on);
            c.setAttribute("aria-pressed", String(on));
          });
          slots.forEach(function (s) {
            s.el.classList.toggle("is-muted", key !== "all" && s.prog !== key);
          });
          if (calFilter) calFilter(key);
        });
      });
    }
  }

  /* ===================================================================
     KICKSITE FRAMES: the academy's lead-capture and programme landing
     pages, embedded from the tenant the old site already uses.

     The tokenised URL redirects to a /public/ endpoint that answers
     X-Frame-Options: ALLOWALL with Content-Security-Policy
     frame-ancestors https:, so the embed works over https and is
     refused over http. Rather than let a visitor stare at a blank box
     on an insecure origin, the iframe is only mounted on https and the
     fallback, which carries the phone number and the email address,
     stays visible everywhere else. A load timeout covers the case where
     Kicksite is reachable but slow or down.

     The member sign-in page is deliberately NOT embedded anywhere: it
     answers X-Frame-Options: SAMEORIGIN and can only ever be a link.
     =================================================================== */
  var ksFrames = $$(".ksframe");
  if (ksFrames.length) {
    var KS_TIMEOUT = 9000;
    ksFrames.forEach(function (box) {
      var src = box.getAttribute("data-ks-src");
      var mount = $(".ksframe__mount", box);
      var fallback = $(".ksframe__fallback", box);
      if (!src || !mount) return;
      if (window.location.protocol !== "https:") return;   /* frame-ancestors https: */

      var frame = document.createElement("iframe");
      frame.src = src;
      frame.title = box.getAttribute("data-ks-title") || "High Street Jiu Jitsu booking form";
      frame.loading = "lazy";
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

      var settled = false, armed = false;
      var give = function () {
        if (settled) return;
        settled = true;
        box.classList.remove("is-loading");
        mount.hidden = true;
        if (fallback) fallback.hidden = false;
      };
      /* the frame is lazy, so a frame below the fold does not begin loading
         until it is scrolled near. Arming the timeout on mount would expire
         it before the browser had started, and replace a working form with
         the fallback, so the clock starts when the box comes into view. */
      var arm = function () {
        if (armed) return;
        armed = true;
        window.setTimeout(give, KS_TIMEOUT);
      };
      var took = function () {
        if (settled) return;
        settled = true;
        box.classList.remove("is-loading");
        box.classList.add("is-live");
        if (fallback) fallback.hidden = true;
      };
      frame.addEventListener("load", took);
      frame.addEventListener("error", give);

      box.classList.add("is-loading");
      mount.hidden = false;
      mount.appendChild(frame);

      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            io.disconnect();
            arm();
          });
        }, { rootMargin: "400px 0px" });
        io.observe(box);
      } else {
        arm();
      }
    });
  }

  /* ===================================================================
     KNOWLEDGE BASE: search and category filter over the aggregated FAQ.
     Enhancement only: with JS off every question and answer is on the
     page, grouped by topic, and the controls simply do nothing.
     =================================================================== */
  var kbList = $("#kb-list");
  if (kbList) {
    var kbItems = $$(".faqitem", kbList);
    var kbGroups = $$(".kbgroup", kbList);
    var kbChips = $$(".achip", $("#kbcats"));
    var kbNone = $("#kbnone");
    var kbInput = $("#kbq");
    var kbCat = "all";
    /* the answer text is read once so filtering never re-reads the DOM */
    kbItems.forEach(function (it) {
      it.setAttribute("data-text", (it.textContent || "").toLowerCase().replace(/\s+/g, " "));
    });
    var kbApply = function () {
      var q = (kbInput ? kbInput.value : "").trim().toLowerCase();
      var shown = 0;
      kbItems.forEach(function (it) {
        var okCat = kbCat === "all" || it.getAttribute("data-cat") === kbCat;
        var okQ = !q || it.getAttribute("data-text").indexOf(q) !== -1;
        var on = okCat && okQ;
        it.hidden = !on;
        /* a search that matches inside an answer opens it, so the reader
           can see why it matched instead of hunting for the words */
        if (q && on) it.open = true; else if (!q) it.open = false;
        if (on) shown++;
      });
      kbGroups.forEach(function (g) {
        g.hidden = !$$(".faqitem", g).some(function (i) { return !i.hidden; });
      });
      kbChips.forEach(function (c) {
        var on = c.getAttribute("data-cat") === kbCat;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", String(on));
      });
      if (kbNone) kbNone.hidden = shown > 0;
    };
    kbChips.forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.classList.contains("is-on")));
      chip.addEventListener("click", function () { kbCat = chip.getAttribute("data-cat"); kbApply(); });
    });
    if (kbInput) kbInput.addEventListener("input", kbApply);
    var kbAll = $(".anone__all", kbNone || document);
    if (kbAll) kbAll.addEventListener("click", function () {
      kbCat = "all"; if (kbInput) kbInput.value = ""; kbApply();
    });
  }

  /* ===================================================================
     ARTICLE LIBRARY FILTER: narrow the library to one topic. The chips
     carry the #topic-* ids the article kickers link to, so arriving from
     an article with that hash pre-selects its topic instead of dumping
     the reader at the top of a list. Enhancement only: with JS off every
     card is visible and the chips do nothing but sit there.
     =================================================================== */
  var afilter = $("#afilter");
  if (afilter) {
    var aCards = $$(".acard, .afeat");
    var aChips = $$(".achip", afilter);
    var aNone = $("#anone");
    var applyTopic = function (key) {
      var shown = 0;
      aCards.forEach(function (c) {
        var on = key === "all" || c.getAttribute("data-topic") === key;
        c.hidden = !on;
        if (on) shown++;
      });
      aChips.forEach(function (c) {
        var on = c.getAttribute("data-topic") === key;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", String(on));
      });
      if (aNone) aNone.hidden = shown > 0;
    };
    aChips.forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.classList.contains("is-on")));
      chip.addEventListener("click", function () { applyTopic(chip.getAttribute("data-topic")); });
    });
    var noneAll = $(".anone__all", aNone || document);
    if (noneAll) noneAll.addEventListener("click", function () { applyTopic("all"); });
    var fromHash = function () {
      var m = /^#topic-([a-z-]+)$/.exec(window.location.hash || "");
      if (m && aChips.some(function (c) { return c.getAttribute("data-topic") === m[1]; })) applyTopic(m[1]);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
  }

  /* ===================================================================
     COACH WALL FILTER: narrow the roster by what each coach teaches.
     Enhancement only; the control row stays hidden without JS so every
     coach is visible. Reflow runs through a view transition where the
     browser supports it, which animates the tiles into their new
     positions instead of snapping.
     =================================================================== */
  var cfilter = $("#cfilter");
  if (cfilter) {
    var chips = $$(".cfilter__chip", cfilter);
    var tiles = $$("#wall .ctile");
    var countEl = $(".cfilter__count", cfilter);
    cfilter.hidden = false;
    var applyFilter = function (key, chip) {
      var shown = 0;
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", String(on));
      });
      tiles.forEach(function (tile) {
        var teach = tile.getAttribute("data-teach") || "";
        var show = key === "all" || teach.split(" ").indexOf(key) !== -1;
        tile.hidden = !show;
        if (show) shown++;
      });
      if (countEl) {
        countEl.textContent = key === "all"
          ? tiles.length + " coaches"
          : shown + (shown === 1 ? " coach" : " coaches") + " teach" + (shown === 1 ? "es" : "") + " it";
      }
    };
    var vtBusy = false;
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var key = chip.getAttribute("data-filter");
        /* a click landing mid-transition must still filter: run it plainly
           rather than letting the in-flight transition swallow it */
        if (document.startViewTransition && !reduce && !vtBusy) {
          vtBusy = true;
          var vt = document.startViewTransition(function () { applyFilter(key, chip); });
          vt.finished.then(function () { vtBusy = false; }, function () { vtBusy = false; });
        } else {
          applyFilter(key, chip);
        }
      });
    });
    applyFilter("all", chips[0]);
  }

  /* ===================================================================
     LIVE NOW: ambient schedule line (2027 prototype). Gym-local time
     via America/Phoenix; LIVE_SCHED mirrors the free-trial
     #scheduleData block and must stay in sync with it. A class reads
     as on the mats for 60 minutes from its start.
     =================================================================== */
  var liveMounts = $$("[data-live-now]");
  if (liveMounts.length && window.Intl && Intl.DateTimeFormat) {
    var LIVE_SCHED = {
      0: [],
      1: [{t:"6:00am",label:"No-Gi",prog:"Adults"},{t:"12:00pm",label:"All-Levels",prog:"Adults"},{t:"4:30pm",label:"Kids",prog:"Ages 4-15"},{t:"5:30pm",label:"Wrestling",prog:"All levels"},{t:"6:30pm",label:"Fundamentals",prog:"Adults"},{t:"7:30pm",label:"All-Levels",prog:"Adults"}],
      2: [{t:"6:00am",label:"Fundamentals",prog:"Adults"},{t:"12:00pm",label:"All-Levels",prog:"Adults"},{t:"4:30pm",label:"Kids",prog:"Ages 4-15"},{t:"5:30pm",label:"Muay Thai",prog:"All levels"},{t:"6:30pm",label:"Fundamentals",prog:"Adults"},{t:"7:30pm",label:"Competition",prog:"Advanced"}],
      3: [{t:"6:00am",label:"No-Gi",prog:"Adults"},{t:"12:00pm",label:"All-Levels",prog:"Adults"},{t:"4:30pm",label:"Kids",prog:"Ages 4-15"},{t:"5:30pm",label:"Wrestling",prog:"All levels"},{t:"6:30pm",label:"Fundamentals",prog:"Adults"},{t:"7:30pm",label:"All-Levels",prog:"Adults"}],
      4: [{t:"6:00am",label:"Fundamentals",prog:"Adults"},{t:"12:00pm",label:"All-Levels",prog:"Adults"},{t:"4:30pm",label:"Kids",prog:"Ages 4-15"},{t:"5:30pm",label:"Muay Thai",prog:"All levels"},{t:"6:30pm",label:"Fundamentals",prog:"Adults"},{t:"7:30pm",label:"Competition",prog:"Advanced"}],
      5: [{t:"6:00am",label:"No-Gi",prog:"Adults"},{t:"12:00pm",label:"All-Levels",prog:"Adults"},{t:"4:30pm",label:"Kids",prog:"Ages 4-15"},{t:"5:30pm",label:"Open Mat",prog:"All welcome"},{t:"6:30pm",label:"Fundamentals",prog:"Adults"},{t:"7:30pm",label:"All-Levels",prog:"Adults"}],
      6: [{t:"4:00pm",label:"Kids",prog:"Ages 4-15"},{t:"5:30pm",label:"All-Levels",prog:"Adults"},{t:"6:30pm",label:"Open Mat",prog:"All welcome"}]
    };
    var LIVE_DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    var liveMins = function (t) {
      var m = /^(\d+):(\d+)(am|pm)$/.exec(t);
      if (!m) return -1;
      var h = (+m[1]) % 12;
      if (m[3] === "pm") h += 12;
      return h * 60 + (+m[2]);
    };
    var phxNow = function () {
      var parts = {};
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", weekday: "short", hour: "numeric", minute: "numeric", hour12: false })
        .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
      return {
        day: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday],
        mins: ((+parts.hour) % 24) * 60 + (+parts.minute)
      };
    };
    var liveMsg = function () {
      var now = phxNow();
      if (now.day === undefined || isNaN(now.mins)) return null;
      var today = LIVE_SCHED[now.day] || [], i, c, m;
      for (i = 0; i < today.length; i++) {
        m = liveMins(today[i].t);
        if (m >= 0 && now.mins >= m && now.mins < m + 60) {
          return ["On the mats right now: ", today[i].label, " · " + today[i].prog];
        }
      }
      for (i = 0; i < today.length; i++) {
        if (liveMins(today[i].t) > now.mins) {
          c = today[i];
          return ["Next class today: ", c.label, " at " + c.t];
        }
      }
      for (i = 1; i <= 7; i++) {
        var d = (now.day + i) % 7, list = LIVE_SCHED[d] || [];
        if (list.length) {
          c = list[0];
          return ["Next class: ", c.label, ", " + (i === 1 ? "tomorrow" : LIVE_DAYS[d]) + " at " + c.t];
        }
      }
      return null;
    };
    var renderLive = function () {
      var msg = null;
      try { msg = liveMsg(); } catch (err) {}
      liveMounts.forEach(function (el) {
        if (!msg) { el.hidden = true; return; }
        var txt = $(".livebar__txt", el);
        if (txt) {
          txt.textContent = "";
          txt.appendChild(document.createTextNode(msg[0]));
          var b = document.createElement("b");
          b.textContent = msg[1];
          txt.appendChild(b);
          txt.appendChild(document.createTextNode(msg[2]));
        }
        el.hidden = false;
      });
    };
    renderLive();
    window.setInterval(renderLive, 60000);
  }

  /* ===================================================================
     TRIAL BAR: bottom strip on every page except the booking page.
     Yields to the mobile sticky CTA; dismiss lasts the browser session.
     =================================================================== */
  var tbar = $("#tbar");
  if (tbar) {
    var TBAR_KEY = "hsjj-tbar-dismissed";
    var tbarDismissed = false;
    try { tbarDismissed = !!window.sessionStorage.getItem(TBAR_KEY); } catch (err) {}
    if (tbarDismissed) tbar.classList.add("is-hidden");
    var tbarClose = $(".tbar__close", tbar);
    if (tbarClose) {
      tbarClose.addEventListener("click", function () {
        tbar.classList.add("is-hidden");
        try { window.sessionStorage.setItem(TBAR_KEY, "1"); } catch (err) {}
      });
    }
  }

  /* ===================================================================
     STICKY YIELD: the footer carries its own CTA band, so the trial bar
     and mobile sticky CTA stand down while any part of it is on screen.
     =================================================================== */
  var foot = $(".foot");
  if (foot && "IntersectionObserver" in window) {
    var fObs = new IntersectionObserver(function (en) {
      document.body.classList.toggle("foot-vis", en[0].isIntersecting);
    }, { threshold: 0 });
    fObs.observe(foot);
  }

  /* ===================================================================
     START HERE PATHS: upgrade the anchor picker to a tablist.
     With JS off the page stays three stacked sections reached by plain
     in-page anchor links; this module adds roles, roving tabindex, and
     one-visible-panel behavior, honoring a path id in the URL hash.
     =================================================================== */
  var pathList = $("#pathTabs");
  if (pathList) {
    var pathTabs = $$(".switch__tab", pathList);
    var pathPanels = [];
    pathTabs.forEach(function (t) {
      var p = document.getElementById((t.getAttribute("href") || "").replace("#", ""));
      if (p) pathPanels.push(p);
    });
    if (pathTabs.length > 0 && pathTabs.length === pathPanels.length) {
      pathList.setAttribute("role", "tablist");
      pathList.setAttribute("aria-label", "Choose your path");
      pathTabs.forEach(function (t, i) {
        t.setAttribute("role", "tab");
        t.setAttribute("aria-controls", pathPanels[i].id);
        pathPanels[i].setAttribute("role", "tabpanel");
        pathPanels[i].setAttribute("aria-labelledby", t.id);
      });
      var showPath = function (id, setHash) {
        pathTabs.forEach(function (t, i) {
          var on = pathPanels[i].id === id;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", String(on));
          t.tabIndex = on ? 0 : -1;
          pathPanels[i].hidden = !on;
        });
        if (setHash && window.history && window.history.replaceState) {
          try { window.history.replaceState(null, "", "#" + id); } catch (err) {}
        }
      };
      pathTabs.forEach(function (t, i) {
        t.addEventListener("click", function (e) {
          e.preventDefault();
          showPath(pathPanels[i].id, true);
        });
        t.addEventListener("keydown", function (e) {
          var n = null;
          if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (i + 1) % pathTabs.length;
          else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (i - 1 + pathTabs.length) % pathTabs.length;
          if (n !== null) { e.preventDefault(); pathTabs[n].focus(); showPath(pathPanels[n].id, true); }
        });
      });
      var startPath = (window.location.hash || "").replace("#", "");
      var knownPath = false;
      pathPanels.forEach(function (p) { if (p.id === startPath) knownPath = true; });
      showPath(knownPath ? startPath : pathPanels[0].id, false);
    }
  }

  /* ===================================================================
     ARTICLE SHARE BAR: progressive reveal of Copy link and Share.
     Static anchors (mailto, sms) and the selectable URL are the baseline;
     the buttons appear only when their API exists. HTTP stage never
     reveals them (secure-context APIs), which is the designed fallback.
     =================================================================== */
  var sharebar = $(".sharebar");
  if (sharebar) {
    var canonEl = document.querySelector('link[rel="canonical"]');
    var shareUrl = (canonEl && canonEl.getAttribute("href")) || window.location.href;
    var shareTitle = document.title;
    var shareUrlText = $(".sharebar__url", sharebar);
    var copyBtn = $(".sharebar__copy", sharebar);
    var shareBtn = $(".sharebar__share", sharebar);
    if (copyBtn && navigator.clipboard && navigator.clipboard.writeText) {
      copyBtn.hidden = false;
      if (shareUrlText) shareUrlText.hidden = true;
      copyBtn.addEventListener("click", function () {
        navigator.clipboard.writeText(shareUrl).then(function () {
          copyBtn.textContent = "Copied";
          setTimeout(function () { copyBtn.textContent = "Copy link"; }, 1600);
        }).catch(function () {
          if (shareUrlText) shareUrlText.hidden = false;
        });
      });
    }
    if (shareBtn && navigator.share) {
      shareBtn.hidden = false;
      shareBtn.addEventListener("click", function () {
        try {
          navigator.share({ title: shareTitle, url: shareUrl }).catch(function () {});
        } catch (err) {}
      });
    }
  }

  /* ===================================================================
     CONTACT FORM (mailto handoff, no backend)
     =================================================================== */
  var cform = $("#contactForm");
  if (cform) {
    cform.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#cName").value.trim();
      var email = $("#cEmail").value.trim();
      var msg = $("#cMsg").value.trim();
      var err = $("#cErr");
      if (!name) { err.textContent = "Add your name so we know who's writing."; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "That email looks off. Mind checking it?"; return; }
      err.textContent = "";
      var phone = ($("#cPhone") && $("#cPhone").value.trim()) || "";
      var body = "Hi High Street Jiu Jitsu,\n\n" + (msg || "I'd like to learn more about training.") +
        "\n\nName: " + name + "\nEmail: " + email + "\nPhone: " + (phone || "not given") + "\n";
      var href = "mailto:info@highstreetjiujitsu.com?subject=" +
        encodeURIComponent("Website message from " + name) + "&body=" + encodeURIComponent(body);
      var done = $("#cDone");
      if (done) { cform.hidden = true; done.hidden = false; }
      try { window.location.href = href; } catch (er) {}
    });
  }
})();
