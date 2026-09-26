#!/usr/bin/env python3
"""Read the gym's Google reviews once a day and write reviews/reviews.json.

Runs inside the website repository's Pages workflow (.github/workflows/pages.yml),
never on a studio machine. Reads the Business Profile API (the owner-only
service whose content policy allows a copy to be kept for up to 30 days), which
the gym applied for and authorized per the client guide. The output file is
part of the Pages build artifact only: it is never committed, and the artifact
is kept for one day, so no copy outlives the policy.

What it writes (REQ-107):

  {"generated": "<UTC ISO>", "source": "google-business-profile",
   "averageRating": 5.0, "totalReviewCount": 26,
   "reviews": [{"id", "name", "photo", "stars", "text", "created", "updated", "reply"}]}

averageRating and totalReviewCount are the API's own fields, copied. Nothing is
filtered by rating. A review without a comment keeps an empty text.

It fails open: any failure (missing codes, refused token, 403 before Google's
approval, 429, network) writes the same file with "reviews": [] and an "error"
class, prints the reason to the job log, and exits 0, because the schedule sync
and every release ride the same workflow and a reviews problem must never stop
the site from deploying.

Environment: GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN (repository
secrets) and GBP_LOCATION (a repository variable, accounts/{a}/locations/{l}).
--discover lists the accounts and locations the codes can see, to fill
GBP_LOCATION once. Standard library only.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TOKEN_URL = "https://oauth2.googleapis.com/token"
ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
LOCATIONS_URL = "https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=name,title&pageSize=100"
REVIEWS_URL = "https://mybusiness.googleapis.com/v4/{location}/reviews?pageSize=50&orderBy=updateTime%20desc"
MAX_REVIEWS = 200
TIMEOUT = 30
STARS = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def empty(error=None):
    doc = {"generated": now_iso(), "source": "google-business-profile",
           "averageRating": None, "totalReviewCount": None, "reviews": []}
    if error:
        doc["error"] = error
    return doc


def access_token(client_id, client_secret, refresh_token):
    body = urllib.parse.urlencode({
        "client_id": client_id, "client_secret": client_secret,
        "refresh_token": refresh_token, "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.load(r)["access_token"]


def get_json(url, token):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.load(r)


def classify(exc):
    """A short error class for the JSON and the log, never the raw body."""
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code in (400, 401):
            return "token"
        if exc.code == 403:
            return "forbidden"
        if exc.code == 404:
            return "location"
        if exc.code == 429:
            return "quota"
        return "http-%d" % exc.code
    if isinstance(exc, urllib.error.URLError):
        return "network"
    if isinstance(exc, (KeyError, ValueError, TypeError)):
        return "shape"
    return "unknown"


def shape_review(r):
    reviewer = r.get("reviewer") or {}
    reply = r.get("reviewReply") or None
    return {
        "id": r.get("reviewId") or r.get("name", "").rsplit("/", 1)[-1],
        "name": reviewer.get("displayName") or "A Google user",
        "photo": reviewer.get("profilePhotoUrl") or None,
        "stars": STARS.get(r.get("starRating"), 0),
        "text": r.get("comment") or "",
        "created": r.get("createTime"),
        "updated": r.get("updateTime") or r.get("createTime"),
        "reply": {"text": reply.get("comment", ""), "updated": reply.get("updateTime")} if reply else None,
    }


def fetch_reviews(token, location):
    reviews, average, total, page_token = [], None, None, None
    while True:
        url = REVIEWS_URL.format(location=location)
        if page_token:
            url += "&pageToken=" + urllib.parse.quote(page_token)
        data = get_json(url, token)
        if average is None:
            average = data.get("averageRating")
            total = data.get("totalReviewCount")
        for r in data.get("reviews", []):
            reviews.append(shape_review(r))
            if len(reviews) >= MAX_REVIEWS:
                break
        page_token = data.get("nextPageToken")
        if not page_token or len(reviews) >= MAX_REVIEWS:
            break
    return {"generated": now_iso(), "source": "google-business-profile",
            "averageRating": average, "totalReviewCount": total, "reviews": reviews}


def discover(token):
    accounts = get_json(ACCOUNTS_URL, token).get("accounts", [])
    if not accounts:
        print("no accounts visible to these codes")
    for a in accounts:
        print("account:", a.get("name"), "|", a.get("accountName"))
        locs = get_json(LOCATIONS_URL.format(account=a["name"]), token).get("locations", [])
        for l in locs:
            print("  GBP_LOCATION=%s/%s  (%s)" % (a["name"], l["name"], l.get("title")))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="reviews/reviews.json")
    ap.add_argument("--discover", action="store_true", help="list accounts and locations, write nothing")
    args = ap.parse_args()

    cid = os.environ.get("GBP_CLIENT_ID", "")
    secret = os.environ.get("GBP_CLIENT_SECRET", "")
    refresh = os.environ.get("GBP_REFRESH_TOKEN", "")
    location = os.environ.get("GBP_LOCATION", "")
    out = Path(args.out)

    def write(doc):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        print("wrote %s: %d review(s)%s" % (out, len(doc["reviews"]), (", error " + doc["error"]) if doc.get("error") else ""))

    if not (cid and secret and refresh):
        if args.discover:
            print("GBP_CLIENT_ID, GBP_CLIENT_SECRET and GBP_REFRESH_TOKEN are needed", file=sys.stderr)
            return 2
        print("reviews: the GBP codes are not configured; writing the empty file")
        write(empty("unconfigured"))
        return 0
    try:
        token = access_token(cid, secret, refresh)
        if args.discover:
            discover(token)
            return 0
        if not location:
            print("reviews: GBP_LOCATION is not set; run with --discover to find it")
            write(empty("unconfigured"))
            return 0
        write(fetch_reviews(token, location))
        return 0
    except Exception as exc:  # fail open: the deploy must not stop on a reviews problem
        kind = classify(exc)
        print("reviews: %s (%s)" % (kind, type(exc).__name__), file=sys.stderr)
        if args.discover:
            return 2
        write(empty(kind))
        return 0


if __name__ == "__main__":
    sys.exit(main())
