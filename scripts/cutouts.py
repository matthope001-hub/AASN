"""AABL — make transparent cut-out headshots (like AAHL's NHL mugs).

MLB headshots come on a grey square. This removes the background with rembg
and saves aabl/headshots/<mlb_id>.png for every player in the current boxes.
Runs in GitHub Actions (.github/workflows/cutouts.yml), which commits the files.

New photos are picked up automatically: aabl/headshots/sources.json keeps a
fingerprint of each MLB photo used, and a cut-out is redone whenever MLB's
photo changes (e.g. the yearly spring refresh).

Env: SUPABASE_URL, SUPABASE_KEY (anon key is enough: box_options is public),
     FORCE=1 to redo players that already have a cut-out.
"""
import hashlib, io, json, os, sys, urllib.request
from PIL import Image
from rembg import new_session, remove

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_KEY"]
FORCE = os.environ.get("FORCE") == "1"
OUT = os.path.join(os.path.dirname(__file__), "..", "aabl", "headshots")
os.makedirs(OUT, exist_ok=True)


def sb(path):
    headers = {"apikey": KEY, "Accept-Profile": "aabl"}
    if KEY.startswith("eyJ"):  # legacy JWT keys also go in Authorization
        headers["Authorization"] = f"Bearer {KEY}"
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch(pid):
    src = f"https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best/v1/people/{pid}/headshot/67/current"
    with urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
        return r.read()


def main():
    season = sb("config?select=season&order=season.desc&limit=1")[0]["season"]
    ids = sorted({o["mlb_id"] for o in sb(f"box_options?select=mlb_id&season=eq.{season}")})
    src_file = os.path.join(OUT, "sources.json")
    try:
        sources = json.load(open(src_file))
    except Exception:
        sources = {}
    session = None
    made, changed, failed = 0, 0, []
    for pid in ids:
        png = os.path.join(OUT, f"{pid}.png")
        try:
            raw = fetch(pid)
            fp = hashlib.sha1(raw).hexdigest()
            if not FORCE and os.path.exists(png) and sources.get(str(pid)) == fp:
                continue  # same photo as last time
            if not FORCE and os.path.exists(png) and str(pid) not in sources:
                sources[str(pid)] = fp  # first run with fingerprints: keep the existing cut-out
                continue
            if session is None:
                session = new_session("isnet-general-use")
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
            cut = remove(img, session=session, post_process_mask=True)
            box = cut.getbbox()
            if not box:
                raise ValueError("empty cut-out")
            # Keep the full width/bottom so the shoulders still sit on the card edge.
            cut = cut.crop((0, max(0, box[1] - 8), cut.width, cut.height))
            cut.thumbnail((300, 300), Image.LANCZOS)
            existed = os.path.exists(png)
            cut.save(png, optimize=True)
            sources[str(pid)] = fp
            if existed: changed += 1
            else: made += 1
        except Exception as e:  # keep going; the site falls back to the original photo
            failed.append(f"{pid}: {e}")
    with open(src_file, "w") as fh:
        json.dump(dict(sorted(sources.items())), fh, indent=0)
    print(f"Season {season}: {len(ids)} pool players · new {made} · updated photos {changed} · failed {len(failed)}")
    for f in failed[:20]:
        print("  " + f)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as fh:
            fh.write(f"## AABL cut-out headshots\nSeason {season}: new {made}, updated photos {changed}, failed {len(failed)}\n")


if __name__ == "__main__":
    sys.exit(main())
