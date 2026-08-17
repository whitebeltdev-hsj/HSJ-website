#!/usr/bin/env python3
"""Sync the published class schedule from the gym's Google Calendar feed.

Runs inside the website repository (see .github/workflows/schedule-sync.yml).
Reads the calendar's secret iCal feed, expands this week's Monday-to-Saturday
events, and rewrites two things when the schedule actually changed:

  1. the table between <!-- schedule-sync:begin --> and
     <!-- schedule-sync:end --> in schedule/index.html (every schedule
     surface on the page derives from that table at runtime), and
  2. the five subscription feeds under calendar/.

The script never publishes a suspicious schedule: unknown event titles, two
classes in the same day-and-time slot, or a week that shrank by half or more
stop the run before any write, and the workflow turns the report into a
GitHub issue. Classes are 60 minutes sitewide (the page's CLASS_MINS
contract); only start times matter here.

Exit codes: 0 ok (changed or not), 2 content problem (unknown title or slot
collision), 3 shrink hold (rerun with --allow-shrink to accept), 4 fetch or
parse failure. A markdown report of any problem goes to --report.

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
DAYS = 6  # Monday .. Saturday
BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA"]
CLASS_MINS = 60
MARK_BEGIN = "<!-- schedule-sync:begin -->"
MARK_END = "<!-- schedule-sync:end -->"
# feeds anchor on a fixed reference week (a past Monday) so regenerated
# output is byte-stable day to day; RRULE:FREQ=WEEKLY keeps apps current
ANCHOR_MONDAY = date(2026, 1, 5)
FEEDS = [
    ("all", None, "High Street Jiu Jitsu"),
    ("adults", "adults", "High Street Jiu Jitsu Adults"),
    ("kids", "kids", "High Street Jiu Jitsu Kids"),
    ("muay-thai", "muaythai", "High Street Jiu Jitsu Muay Thai"),
    ("wrestling", "wrestling", "High Street Jiu Jitsu Wrestling"),
]


def norm(s):
    s = s.replace("‑", "-").replace("‐", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def fmt_time(mins):
    h, m = divmod(mins, 60)
    ampm = "a" if h < 12 else "p"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d}{ampm}"


def load_map(root):
    data = json.loads((root / "scripts" / "calendar-map.json").read_text())
    return {norm(c["display"]): c for c in data["classes"]}


def fetch_events(args, report):
    """Return a list of (weekday 0..5, start_minutes, raw_title) for this week."""
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
            out.append((wd, local.hour * 60 + local.minute, str(ev.get("SUMMARY", ""))))
        return out
    except SystemExit:
        raise
    except Exception as e:  # network, parse, or library failure
        report.append(f"Could not fetch or parse the calendar feed: {e}")
        sys.exit(4)


def build_slots(events, cmap, report):
    slots = {}
    unknown, collisions = set(), []
    for wd, mins, title in events:
        cls = cmap.get(norm(title))
        if not cls:
            unknown.add(title.strip() or "(untitled event)")
            continue
        key = (wd, mins)
        if key in slots and slots[key]["display"] != cls["display"]:
            collisions.append(
                f"{slots[key]['display']} and {cls['display']} both start "
                f"{fmt_time(mins)} on {['Mon','Tue','Wed','Thu','Fri','Sat'][wd]}")
            continue
        slots[key] = cls
    if unknown:
        report.append("The calendar has class names the website does not know yet:")
        report.extend(f"- **{t}**" for t in sorted(unknown))
        report.append("")
        report.append("Nothing was published; the site kept its current schedule. "
                      "Fix the event title's spelling, or reply here if this is a "
                      "new class and we will teach the website about it.")
    if collisions:
        report.append("Two different classes share one day and start time, which "
                      "the schedule cannot display:")
        report.extend(f"- {c}" for c in collisions)
    if unknown or collisions:
        sys.exit(2)
    return slots


def render_region(slots):
    head = ("          <thead><tr><th scope=\"col\">Time</th><th scope=\"col\">Mon</th>"
            "<th scope=\"col\">Tue</th><th scope=\"col\">Wed</th><th scope=\"col\">Thu</th>"
            "<th scope=\"col\">Fri</th><th scope=\"col\">Sat</th></tr></thead>")
    lines = ["        <table class=\"sched\">", head, "          <tbody>"]
    for mins in sorted({m for (_, m) in slots}):
        lines.append("            <tr>")
        lines.append(f"              <th scope=\"row\">{fmt_time(mins)}</th>")
        for wd in range(DAYS):
            cls = slots.get((wd, mins))
            if cls:
                lines.append(
                    f"              <td><span class=\"scell is-{cls['category']}\">"
                    f"<b>{cls['display']}</b><span>{cls['badge']}</span></span></td>")
            else:
                lines.append("              <td></td>")
        lines.append("            </tr>")
    lines += ["          </tbody>", "        </table>"]
    return "\n".join(lines)


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
    for (wd, mins), cls in sorted(slots.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[1]["display"])):
        if category and cls["category"] != category:
            continue
        name = cls["display"].replace("‑", "-").replace("‐", "-")
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        first = ANCHOR_MONDAY + timedelta(days=wd)
        stamp_d = first.strftime("%Y%m%d")
        s_h, s_m = divmod(mins, 60)
        e_h, e_m = divmod(mins + CLASS_MINS, 60)
        L.append("BEGIN:VEVENT")
        L.append(f"UID:hsjj-{wd + 1}-{mins}-{slug}@highstreetjiujitsu.com")
        L.append(f"DTSTAMP:{stamp_d}T000000Z")
        L.append(f"DTSTART;TZID=America/Phoenix:{stamp_d}T{s_h:02d}{s_m:02d}00")
        L.append(f"DTEND;TZID=America/Phoenix:{stamp_d}T{e_h:02d}{e_m:02d}00")
        L.append(f"RRULE:FREQ=WEEKLY;BYDAY={BYDAY[wd]}")
        L.append("SUMMARY:" + ics_escape(name))
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
        cmap = load_map(root)
        events = fetch_events(args, report)
        slots = build_slots(events, cmap, report)

        page_path = root / "schedule" / "index.html"
        page = page_path.read_text()
        try:
            pre, rest = page.split(MARK_BEGIN + "\n", 1)
            current_region, post = rest.split("\n        " + MARK_END, 1)
        except ValueError:
            report.append("schedule/index.html has no schedule-sync markers; refusing to guess.")
            sys.exit(4)

        current_cells = current_region.count("<span class=\"scell")
        if len(slots) < max(1, current_cells / 2) and not args.allow_shrink:
            report.append(
                f"The calendar produced {len(slots)} classes for this week, but the "
                f"published schedule has {current_cells}. That looks like a mid-edit "
                "or wrong-calendar state, so nothing was published. If the smaller "
                "schedule is intended, run the workflow manually with allow_shrink.")
            sys.exit(3)

        new_region = render_region(slots)
        changed = []
        if new_region != current_region:
            page_path.write_text(pre + MARK_BEGIN + "\n" + new_region + "\n        " + MARK_END + post)
            changed.append("schedule/index.html")
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
        print(f"slots={len(slots)} changed={','.join(changed) if changed else 'nothing'}")
    finally:
        if report:
            Path(args.report).write_text("\n".join(report) + "\n")
            print("\n".join(report), file=sys.stderr)


if __name__ == "__main__":
    main()
