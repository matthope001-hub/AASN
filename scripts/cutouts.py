"""AABL — make transparent cut-out headshots (like AAHL's NHL mugs).

MLB headshots come on a grey square. This removes the background with rembg
and saves aabl/headshots/<mlb_id>.png for every player in the current boxes.
Runs in GitHub Actions (.github/workflows/cutouts.yml), which commits the files.

Env: SUPABASE_URL, SUPABASE_KEY (anon key is enough: box_options is public),
     FORCE=1 to redo players that already have a cut-out.
"""
import io, json, os, sys, urllib.request
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


def main():
    season = sb("config?select=season&order=season.desc&limit=1")[0]["season"]
    ids = sorted({o["mlb_id"] for o in sb(f"box_options?select=mlb_id&season=eq.{season}")})
    todo = [i for i in ids if FORCE or not os.path.exists(os.path.join(OUT, f"{i}.png"))]
    print(f"Season {season}: {len(ids)} pool players, {len(todo)} to process")
    if not todo:
        return
    session = new_session("isnet-general-use")
    done, failed = 0, []
    for pid in todo:
        src = f"https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best/v1/people/{pid}/headshot/67/current"
        try:
            with urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
                raw = r.read()
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
            cut = remove(img, session=session, post_process_mask=True)
            box = cut.getbbox()
            if not box:
                raise ValueError("empty cut-out")
            # Keep the full width/bottom so the shoulders still sit on the card edge.
            cut = cut.crop((0, max(0, box[1] - 8), cut.width, cut.height))
            cut.thumbnail((300, 300), Image.LANCZOS)
            cut.save(os.path.join(OUT, f"{pid}.png"), optimize=True)
            done += 1
        except Exception as e:  # keep going; the site falls back to the original photo
            failed.append(f"{pid}: {e}")
    print(f"Made {done} cut-outs, {len(failed)} failed")
    for f in failed[:20]:
        print("  " + f)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as fh:
            fh.write(f"## AABL cut-out headshots\nSeason {season}: made {done}, failed {len(failed)}\n")


if __name__ == "__main__":
    sys.exit(main())
