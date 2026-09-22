#!/usr/bin/env python3
"""Sync the published class schedule from the gym's Google Calendar feed.

Runs inside the website repository (see .github/workflows/schedule-sync.yml).
Reads the calendar's secret iCal feed, expands this week's events, and rewrites
the schedule wherever it is published:

  1. the table between <!-- schedule-sync:begin --> and
     <!-- schedule-sync:end --> in schedule/index.html (the schedule page's
     interactive calendar derives from that table at runtime),
  2. calendar/schedule.json, the single runtime record every other schedule
     surface reads (the free-trial booking wizard's day and time chips, and
     the "on the mats right now" band in the site header), and
  3. the five subscription feeds under calendar/.

REQ-087, the contract that matters: the calendar is the source of truth and
the gym owns it. Any event title works. A title nobody has seen before is
classified from its own words and published, never refused, so the gym can
add a class in Google Calendar and see it on the site within 20 minutes with
nothing to configure here. scripts/calendar-map.json is an OPTIONAL override
file for titles whose classification we want to state by hand; an empty
override file is a perfectly good configuration.

Event duration comes from the calendar (DTEND or DURATION), so a 45 minute
class and a two hour open mat are both published truthfully. Two classes in
the same day and time slot stack in the cell rather than stopping the run.

The one guard left is the shrink guard: a week that lost half its classes or
more is held, because that is what a mid-edit or wrong-calendar state looks
like, and re-running with --allow-shrink accepts it.

Exit codes: 0 ok (changed or not), 3 shrink hold (rerun with --allow-shrink
to accept), 4 fetch or parse failure. A markdown report goes to --report.

No secrets live in this file; the feed URL arrives via the SCHEDULE_ICS_URL
environment variable (or --ics for a local file in tests).
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Phoenix")
# Monday .. Sunday. Sunday is index 6, last, because that is where it sits in the
# printed week (REQ-074): the gym runs an occasional Sunday wrestling class and
# had no column to put it in. The seventh column is emitted only in a week that
# actually has a Sunday class, so an ordinary week still renders six.
DAYS = 7
BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
DAY_TH = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
# Only a fallback now: a calendar event that carries no end time at all.
DEFAULT_MINS = 60
MARK_BEGIN = "<!-- schedule-sync:begin -->"
MARK_END = "<!-- schedule-sync:end -->"
DATA_BEGIN = "<!-- schedule-data:begin -->"
DATA_END = "<!-- schedule-data:end -->"
# feeds anchor on a fixed reference week (a past Monday) so regenerated
# output is byte-stable day to day; RRULE:FREQ=WEEKLY keeps apps current
ANCHOR_MONDAY = date(2026, 1, 5)
FEEDS = [
    ("all", None, "High Street Jiu Jitsu"),
    ("adults", "adults", "High Street Jiu Jitsu Adults"),
    ("kids", "kids", "High Street Jiu Jitsu Kids"),
    ("muay-thai", "muaythai", "High Street Jiu Jitsu Striking"),
    ("wrestling", "wrestling", "High Street Jiu Jitsu Wrestling"),
]

# Classification. Discipline is read out of the title's own words; category,
# audience and level follow from it. Every branch has a default, so classify()
# always returns a class and the sync can never be stopped by a name.
#
# Short needles are anchored on word boundaries on purpose: an unanchored "gi"
# matches "beginner", which would file the beginners class under Jiu Jitsu for
# the wrong reason and, worse, would look like it worked.
DISCIPLINE_PATTERNS = (
    (r"wrestl|takedown", "Wrestling"),
    (r"muay\s*thai|kick\s*box|\bstriking\b|\bboxing\b|\bmma\b|\bstand[\s-]*up\b", "Striking"),
    (r"jiu[\s-]*jitsu|\bbjj\b|\bgi\b|open\s*mat|fundamental|drill|grappl|\brolling\b|\bsubmission\b",
     "Jiu Jitsu"),
)
KIDS_PATTERN = r"\bkid|\byouth\b|\bjunior|\blittle\b|\brattler|\btiny\b|\btot\b|\bpee\s*wee\b|\bages?\s*\d"
# An explicit age range in the title is the gym's own words and beats any guess.
AGE_PATTERN = r"\bages?\s*(\d{1,2})\s*(?:to|through|[-‐-―])\s*(\d{1,2})\b"
ADVANCED_PATTERN = r"\badvanced\b|\bcompetition\b|\bcomp\b|\bpro\b|\belite\b"
BEGINNER_PATTERN = r"\bfundamental|\bbeginner|\bintro|\bbasics\b|\bwhite\s*belt\b|\bnew\b"
DEFAULTS = {"audience": "Adults", "level": "All levels"}


def norm(s):
    s = s.replace("‑", "-").replace("‐", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def fmt_time(mins):
    h, m = divmod(mins, 60)
    ampm = "a" if h < 12 else "p"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d}{ampm}"


def fmt_clock(mins):
    """The 6:00am form the runtime surfaces read, as distinct from the 6:00a
    form the printed table's row header uses."""
    h, m = divmod(mins, 60)
    ampm = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d}{ampm}"


def load_overrides(root):
    """Optional hand-written classifications, keyed by normalized title.

    Missing or empty is a valid state: inference covers every title on its
    own. An override may set any of display, category, discipline, audience
    or level, and only the keys it sets are applied.
    """
    p = root / "scripts" / "calendar-map.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text())
    out = {}
    for c in data.get("classes", []):
        match = c.get("match") or c.get("display") or ""
        if match:
            out[norm(match)] = {k: v for k, v in c.items() if k != "match"}
    return out


def classify(title):
    """Read a calendar event title and say what class it is.

    Never fails and never returns None: an unrecognized title still becomes a
    publishable class, because refusing to publish is what left the site a
    month stale. The worst case is a class filed under Adults with no badges,
    which reads correctly on the page even when the guess was uninformative.
    """
    t = norm(title)
    discipline = None
    for pattern, name in DISCIPLINE_PATTERNS:
        if re.search(pattern, t):
            discipline = name
            break

    is_kids = bool(re.search(KIDS_PATTERN, t))
    age = re.search(AGE_PATTERN, t)
    if age:
        audience = f"Ages {age.group(1)}-{age.group(2)}"
        is_kids = True
    elif is_kids:
        audience = "Kids"
    elif "open mat" in t:
        audience = "All welcome"
    else:
        audience = "Adults"

    if re.search(ADVANCED_PATTERN, t):
        level = "Advanced"
    elif re.search(BEGINNER_PATTERN, t):
        level = "Beginner"
    else:
        level = "All levels"

    # Category is the one axis that is not free-form: it picks the cell colour,
    # the program filter and the per-program feed, all of which are built
    # surfaces. Anything unrecognized lands in adults, the generic one, so a
    # brand new discipline still renders and still exports.
    if is_kids:
        category = "kids"
    elif discipline == "Wrestling":
        category = "wrestling"
    elif discipline == "Striking":
        category = "muaythai"
    else:
        category = "adults"

    return {"display": " ".join(str(title).split()) or "Class",
            "category": category, "discipline": discipline,
            "audience": audience, "level": level}


def badges(cls, defaults):
    """The badge rule, stated once (REQ-073).

    Discipline, audience and level are three separate stored axes. A badge is
    printed only when it adds something the class name does not already say,
    and a default audience or level is never printed. At most two survive, so
    a Striking or Wrestling cell carries no badge at all: its name is already
    the discipline, and its audience and level are the defaults.
    """
    name = norm(cls["display"])
    out = []
    for axis in ("discipline", "audience", "level"):
        v = cls.get(axis)
        if not v or defaults.get(axis) == v or norm(v) in name:
            continue
        out.append(v)
    return out[:2]


def fetch_events(args, report):
    """Return (weekday, start_minutes, title, duration_minutes, weekly, date)."""
    try:
        if args.ics:
            raw = Path(args.ics).read_bytes()
        else:
            url = os.environ.get("SCHEDULE_ICS_URL")
            if not url:
                report.append("SCHEDULE_ICS_URL is not set and no --ics file was given.")
                sys.exit(4)
            with urllib.request.urlopen(url, timeout=30) as r:
                raw = r.read()
        import icalendar
        import recurring_ical_events
        cal = icalendar.Calendar.from_ical(raw)
        today = datetime.now(TZ).date()
        monday = today - timedelta(days=today.weekday())
        start = datetime.combine(monday, time(0, 0), tzinfo=TZ)
        end = start + timedelta(days=DAYS)
        out = []
        for ev in recurring_ical_events.of(cal).between(start, end):
            dt = ev["DTSTART"].dt
            if isinstance(dt, datetime):
                local = dt.astimezone(TZ)
            else:  # all-day events carry no class time; skip them
                continue
            wd = local.weekday()
            if wd >= DAYS:
                continue
            # Duration comes from the gym's own event, so a 45 minute class and
            # a two hour open mat both publish truthfully instead of every
            # class being asserted as an hour long.
            mins = DEFAULT_MINS
            endv = ev.get("DTEND")
            if endv is not None and isinstance(endv.dt, datetime):
                delta = int((endv.dt.astimezone(TZ) - local).total_seconds() // 60)
                if delta > 0:
                    mins = delta
            elif ev.get("DURATION") is not None:
                delta = int(ev["DURATION"].dt.total_seconds() // 60)
                if delta > 0:
                    mins = delta
            # A class the gym runs every week ships with an RRULE so subscribers
            # keep seeing it. A one-off ships as a single dated event, or a
            # calendar app shows next month's Sundays a class that never happens.
            # Weekly is the default and only Sunday can opt out of it: the gym
            # may well build its Monday-to-Saturday week as individually created
            # events with no recurrence rule at all, and reading that literally
            # would turn the entire standing schedule into a pile of one-offs
            # that vanish from every subscriber's calendar after this week.
            # Sunday is the only day the client described as occasional.
            weekly = bool(ev.get("RRULE")) or wd != 6
            out.append((wd, local.hour * 60 + local.minute,
                        str(ev.get("SUMMARY", "")), mins, weekly, local.date()))
        return out
    except SystemExit:
        raise
    except Exception as e:  # network, parse, or library failure
        report.append(f"Could not fetch or parse the calendar feed: {e}")
        sys.exit(4)


def build_slots(events, overrides, report):
    """Classify every event into slots keyed by (weekday, start minutes).

    A slot holds a list, because two classes really can start at the same time
    on the same day: the gym runs kids on one mat and adults on the other. The
    old code treated that as a fault and stopped the whole publish.
    """
    slots, seen = {}, {}
    for wd, mins, title, dur, weekly, on_date in events:
        cls = dict(classify(title))
        ov = overrides.get(norm(title))
        if ov:
            cls.update(ov)
        cls.update(weekly=weekly, on_date=on_date, mins=dur, title=title)
        bucket = slots.setdefault((wd, mins), [])
        # the same class listed twice in one slot is a calendar duplicate
        if any(norm(c["display"]) == norm(cls["display"]) for c in bucket):
            continue
        bucket.append(cls)
        seen.setdefault(norm(title), (cls, bool(ov)))

    # Informational only. Nothing here can stop a publish; it exists so the
    # Actions summary shows what the sync made of a title it had not seen.
    inferred = [(c["display"], c) for _, (c, was_override) in sorted(seen.items())
                if not was_override]
    if inferred:
        report.append("Classes published straight from the calendar, with what "
                      "the sync read from each title:")
        for display, c in inferred:
            report.append(f"- **{display}**: {c['discipline'] or 'no discipline named'}, "
                          f"{c['audience']}, {c['level']} (shown under {c['category']})")
        report.append("")
        report.append("Nothing needs doing. Add an entry to scripts/calendar-map.json "
                      "only to state one of these by hand instead.")
    return slots


def slot_count(slots):
    return sum(len(v) for v in slots.values())


def week_columns(slots):
    """Mon to Sat always; Sunday only in a week that has a Sunday class.

    AC-2 of REQ-074: an ordinary week must render exactly six columns and be
    byte-identical to how it rendered before Sunday was supported, so the
    seventh column cannot simply always be there and usually empty.
    """
    cols = list(range(6))
    if any(wd == 6 for (wd, _) in slots):
        cols.append(6)
    return cols


def render_region(slots, defaults):
    cols = week_columns(slots)
    head = ("          <thead><tr><th scope=\"col\">Time</th>"
            + "".join(f"<th scope=\"col\">{DAY_TH[wd]}</th>" for wd in cols)
            + "</tr></thead>")
    lines = ["        <table class=\"sched\">", head, "          <tbody>"]
    for mins in sorted({m for (_, m) in slots}):
        lines.append("            <tr>")
        lines.append(f"              <th scope=\"row\">{fmt_time(mins)}</th>")
        for wd in cols:
            bucket = slots.get((wd, mins)) or []
            if bucket:
                cells = ""
                for cls in bucket:
                    tags = "".join(f"<span>{esc(b)}</span>" for b in badges(cls, defaults))
                    cells += (f"<span class=\"scell is-{cls['category']}\""
                              f" data-mins=\"{cls['mins']}\">"
                              f"<b>{esc(cls['display'])}</b>{tags}</span>")
                lines.append(f"              <td>{cells}</td>")
            else:
                lines.append("              <td></td>")
        lines.append("            </tr>")
    lines += ["          </tbody>", "        </table>"]
    return "\n".join(lines)


def esc(s):
    """Calendar titles are gym-authored text landing in HTML, so they are
    escaped on the way in rather than trusted."""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def render_schedule_json(slots):
    """The single runtime record of the week.

    Both JavaScript schedule surfaces read this one file: the booking wizard's
    day and time chips, and the live "on the mats right now" band. They used to
    carry their own hand-maintained copies of the week, which is why the site
    could show three different schedules at once.
    """
    days = {str(d): [] for d in range(7)}
    for (wd, mins), bucket in slots.items():
        # the runtime week is Sunday-first, matching JS getDay()
        key = str((wd + 1) % 7)
        for cls in bucket:
            days[key].append((mins, {
                "t": fmt_clock(mins),
                "label": cls["display"],
                "prog": cls.get("audience") or "Adults",
                "cat": cls["category"],
                "lvl": cls.get("level") or "All levels",
                "mins": cls["mins"],
            }))
    for k in days:
        days[k] = [e for _, e in sorted(days[k], key=lambda x: (x[0], x[1]["label"]))]
    return days, json.dumps(
        {"generated": datetime.now(TZ).isoformat(timespec="seconds"),
         "days": days}, indent=2) + "\n"


def render_schedule_data(days):
    """The free-trial page's inline #scheduleData block.

    The booking wizard needs the week before it can draw a single chip, so
    this ships inline rather than as a fetch: a wizard that renders empty for
    a round trip is a wizard people abandon. Same data as
    calendar/schedule.json, which is what the rest of the site reads.
    """
    def one(c):
        # This JSON sits inside a <script> element, where JSON escaping alone is
        # not enough: a class the gym happens to name "</script>..." would close
        # the tag and everything after it would parse as markup. Escaping the
        # three characters that can start a tag or an entity keeps the block
        # inert no matter what gets typed into Google Calendar, and they decode
        # back to themselves on JSON.parse.
        s = json.dumps({k: c[k] for k in ("t", "label", "prog", "cat", "lvl", "mins")},
                       separators=(",", ":"))
        return (s.replace("&", "\\u0026").replace("<", "\\u003c")
                 .replace(">", "\\u003e"))

    rows = []
    for d in range(7):
        entries = ",".join(one(c) for c in days[str(d)])
        rows.append(f'  "{d}": [{entries}]')
    return ('      <script type="application/json" id="scheduleData">\n{\n'
            + ",\n".join(rows) + "\n}\n      </script>")


def ics_escape(s):
    return re.sub(r"[,;\\]", lambda m: "\\" + m.group(0), s)


def fold(line):
    if len(line) <= 74:
        return line
    out, rest = line[:74], line[74:]
    while rest:
        out += "\r\n " + rest[:73]
        rest = rest[73:]
    return out


def render_feed(slots, category, calname):
    L = ["BEGIN:VCALENDAR", "VERSION:2.0",
         "PRODID:-//High Street Jiu Jitsu//Class schedule//EN",
         "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
         "X-WR-CALNAME:" + calname, "X-WR-TIMEZONE:America/Phoenix",
         "BEGIN:VTIMEZONE", "TZID:America/Phoenix", "BEGIN:STANDARD",
         "DTSTART:19700101T000000", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0700",
         "TZNAME:MST", "END:STANDARD", "END:VTIMEZONE"]
    flat = []
    for (wd, mins), bucket in slots.items():
        for cls in bucket:
            flat.append((wd, mins, cls))
    for wd, mins, cls in sorted(flat, key=lambda x: (x[0], x[1], x[2]["display"])):
        if category and cls["category"] != category:
            continue
        name = cls["display"].replace("‑", "-").replace("‐", "-")
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        weekly = cls.get("weekly", True)
        if weekly:
            first = ANCHOR_MONDAY + timedelta(days=wd)
        else:
            first = cls.get("on_date") or (ANCHOR_MONDAY + timedelta(days=wd))
        stamp_d = first.strftime("%Y%m%d")
        s_h, s_m = divmod(mins, 60)
        end_mins = mins + cls.get("mins", DEFAULT_MINS)
        e_h, e_m = divmod(end_mins, 60)
        L.append("BEGIN:VEVENT")
        uid = (f"hsjj-{wd + 1}-{mins}-{slug}" if weekly
               else f"hsjj-once-{stamp_d}-{mins}-{slug}")
        L.append(f"UID:{uid}@highstreetjiujitsu.com")
        L.append(f"DTSTAMP:{stamp_d}T000000Z")
        L.append(f"DTSTART;TZID=America/Phoenix:{stamp_d}T{s_h:02d}{s_m:02d}00")
        # a class running past midnight rolls the end date forward
        if e_h >= 24:
            e_day = (first + timedelta(days=e_h // 24)).strftime("%Y%m%d")
            L.append(f"DTEND;TZID=America/Phoenix:{e_day}T{e_h % 24:02d}{e_m:02d}00")
        else:
            L.append(f"DTEND;TZID=America/Phoenix:{stamp_d}T{e_h:02d}{e_m:02d}00")
        if weekly:
            L.append(f"RRULE:FREQ=WEEKLY;BYDAY={BYDAY[wd]}")
        L.append("SUMMARY:" + ics_escape(name))
        cats = [cls.get("discipline"), cls.get("audience"), cls.get("level")]
        L.append("CATEGORIES:" + ",".join(ics_escape(c) for c in cats if c))
        L.append("LOCATION:" + ics_escape("High Street Jiu Jitsu, 5310 E High St Ste 102, Phoenix, AZ 85054"))
        L.append("END:VEVENT")
    L.append("END:VCALENDAR")
    return "\r\n".join(fold(x) for x in L) + "\r\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ics", help="read this ICS file instead of SCHEDULE_ICS_URL")
    ap.add_argument("--repo-root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--allow-shrink", action="store_true")
    ap.add_argument("--report", default="sync-report.md")
    args = ap.parse_args()
    root = Path(args.repo_root)
    report = []
    try:
        overrides = load_overrides(root)
        events = fetch_events(args, report)
        slots = build_slots(events, overrides, report)
        total = slot_count(slots)

        page_path = root / "schedule" / "index.html"
        page = page_path.read_text()
        try:
            pre, rest = page.split(MARK_BEGIN + "\n", 1)
            current_region, post = rest.split("\n        " + MARK_END, 1)
        except ValueError:
            report.append("schedule/index.html has no schedule-sync markers; refusing to guess.")
            sys.exit(4)

        current_cells = current_region.count("<span class=\"scell")
        if total < max(1, current_cells / 2) and not args.allow_shrink:
            report.append(
                f"The calendar produced {total} classes for this week, but the "
                f"published schedule has {current_cells}. That looks like a mid-edit "
                "or wrong-calendar state, so nothing was published. If the smaller "
                "schedule is intended, run the workflow manually with allow_shrink.")
            sys.exit(3)

        new_region = render_region(slots, DEFAULTS)
        changed = []
        if new_region != current_region:
            page_path.write_text(pre + MARK_BEGIN + "\n" + new_region + "\n        " + MARK_END + post)
            changed.append("schedule/index.html")

        days, jtext = render_schedule_json(slots)
        jf = root / "calendar" / "schedule.json"
        jbody = jtext.encode()
        # the generated stamp changes every run, so compare the week itself
        def week_of(b):
            try:
                return json.loads(b.decode())["days"]
            except Exception:
                return None
        if not jf.exists() or week_of(jf.read_bytes()) != week_of(jbody):
            jf.parent.mkdir(exist_ok=True)
            jf.write_bytes(jbody)
            changed.append("calendar/schedule.json")

        trial_path = root / "free-trial" / "index.html"
        if trial_path.exists():
            tp = trial_path.read_text()
            if DATA_BEGIN in tp and DATA_END in tp:
                pre_t, rest_t = tp.split(DATA_BEGIN + "\n", 1)
                cur_data, post_t = rest_t.split("\n      " + DATA_END, 1)
                new_data = render_schedule_data(days)
                if new_data != cur_data:
                    trial_path.write_text(pre_t + DATA_BEGIN + "\n" + new_data
                                          + "\n      " + DATA_END + post_t)
                    changed.append("free-trial/index.html")

        for slug_name, category, calname in FEEDS:
            f = root / "calendar" / f"{slug_name}.ics"
            body = render_feed(slots, category, calname).encode()
            if not f.exists() or f.read_bytes() != body:
                f.parent.mkdir(exist_ok=True)
                f.write_bytes(body)
                changed.append(f"calendar/{slug_name}.ics")

        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a") as fh:
                fh.write(f"changed={'yes' if changed else 'no'}\n")
        print(f"classes={total} changed={','.join(changed) if changed else 'nothing'}")
    finally:
        if report:
            Path(args.report).write_text("\n".join(report) + "\n")
            print("\n".join(report), file=sys.stderr)


if __name__ == "__main__":
    main()
