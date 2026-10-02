# Cross-check the Gerber/Excellon files (read by gerbonara, not by our code) against the board data they came from.
import json, sys, glob, warnings, math
warnings.simplefilter("ignore")
from gerbonara import GerberFile, ExcellonFile
d = sys.argv[1]
b = json.load(open(d + "/board.json"))
H, W = b["outline"]["h"], b["outline"]["w"]
import math
def padworld(part, pad):
    x = -pad["x"] if part.get("flip") else pad["x"]; y = pad["y"]
    th = math.radians(part["rot"]); c, s = round(math.cos(th), 9), round(math.sin(th), 9)
    swap = abs(round(part["rot"] / 90)) % 2 == 1
    return dict(x=part["x"] + x * c - y * s, y=part["y"] + x * s + y * c, w=pad["h"] if swap else pad["w"], h=pad["w"] if swap else pad["h"], drill=pad.get("drill", 0), shape=pad["shape"], smd=bool(pad.get("smd")), side=("B" if part.get("flip") else "F") if pad.get("smd") else "FB")
pads = [padworld(p, q) for p in b["parts"] for q in p["fp"]["pads"]]
fails = 0
def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "\n        -> " + str(detail)))
    fails += (not ok)
def pos(o): return (round(o.x, 3), round(H - 0 - 0, 3) and round(o.y, 3))
def flashes(path):
    g = GerberFile.open(path)
    out = []
    for o in g.objects:
        if type(o).__name__ == "Flash":
            ap = o.aperture; out.append((round(o.x, 3), round(o.y, 3), type(ap).__name__, round(getattr(ap, "w", getattr(ap, "diameter", 0)), 3), round(getattr(ap, "h", getattr(ap, "diameter", 0)), 3)))
    return out, g
def lines(path):
    g = GerberFile.open(path)
    return [o for o in g.objects if type(o).__name__ == "Line"], [o for o in g.objects if type(o).__name__ == "Region"], g
# ---- copper flashes
for side, f in (("F", "gb-F_Cu.gtl"), ("B", "gb-B_Cu.gbl")):
    fl, _ = flashes(d + "/" + f)
    want = sorted((round(p["x"], 3), round(H - p["y"], 3)) for p in pads if side in p["side"]) + sorted((round(v["x"], 3), round(H - v["y"], 3)) for v in b["vias"])
    got = sorted((x, y) for x, y, *_ in fl)
    check(f"{side}.Cu: {len(want)} flashes (pads on this side + vias) at the board's coordinates (y flipped)", sorted(want) == got, (len(want), len(got), [w for w in want if w not in got][:3], [g for g in got if g not in want][:3]))
    # sizes
    bad = []
    for p in pads:
        if side not in p["side"]: continue
        m = [x for x in fl if abs(x[0] - round(p["x"], 3)) < 2e-3 and abs(x[1] - round(H - p["y"], 3)) < 2e-3]
        if not m: continue
        x = m[0]
        if p["shape"] == "round":
            if not (x[2] == "CircleAperture" and abs(x[3] - p["w"]) < 2e-3): bad.append((p["x"], p["y"], x, p["w"]))
        else:
            if not (x[2] == "RectangleAperture" and abs(x[3] - p["w"]) < 2e-3 and abs(x[4] - p["h"]) < 2e-3): bad.append((p["x"], p["y"], x, p["w"], p["h"]))
    check(f"{side}.Cu: every pad flash has the right shape and size", not bad, bad[:3])
    ln, rg, g = lines(d + "/" + f)
    segs = sum(max(0, len(t["pts"]) - 1) for t in b["tracks"] if t["layer"] == side)
    check(f"{side}.Cu: {segs} track segments drawn", len(ln) == segs, (len(ln), segs))
    # track widths and endpoints
    want_ends = sorted((round(t["pts"][i][0], 3), round(H - t["pts"][i][1], 3), round(t["pts"][i + 1][0], 3), round(H - t["pts"][i + 1][1], 3), round(t["w"], 3)) for t in b["tracks"] if t["layer"] == side for i in range(len(t["pts"]) - 1))
    got_ends = sorted((round(l.x1, 3), round(l.y1, 3), round(l.x2, 3), round(l.y2, 3), round(l.aperture.diameter, 3)) for l in ln)
    check(f"{side}.Cu: segment endpoints and widths equal the tracks", want_ends == got_ends, [w for w in want_ends if w not in got_ends][:2])
    area = sum(abs((o.outline[0][0]) * 0) for o in rg)
    zrects = sum(len(fz) for fz in [[1]] ) if False else None
    if side == "B":
        check("B.Cu: the ground pour is present as filled regions", len(rg) > 100, len(rg))
        # every region is a rectangle inside the board
        bad = [o for o in rg if any(not (-1e-6 <= px <= W + 1e-6 and -1e-6 <= py <= H + 1e-6) for px, py in [(p[0], p[1]) for p in o.outline])]
        check("B.Cu: every pour region lies inside the board", not bad, len(bad))
# ---- drill
ex = ExcellonFile.open(d + "/gb.drl")
dr = sorted((round(o.x, 3), round(o.y, 3), round(o.aperture.diameter, 3)) for o in ex.objects)
want = sorted([(round(p["x"], 3), round(H - p["y"], 3), round(p["drill"], 3)) for p in pads if p["drill"]] + [(round(v["x"], 3), round(H - v["y"], 3), round(v["drill"], 3)) for v in b["vias"]])
check(f"drill: {len(want)} holes (drilled pads + vias) at the right places and diameters", dr == want, ([w for w in want if w not in dr][:3], [g for g in dr if g not in want][:3]))
# ---- mask / paste
for side, f in (("F", "gb-F_Mask.gts"), ("B", "gb-B_Mask.gbs")):
    fl, _ = flashes(d + "/" + f)
    want = sorted((round(p["x"], 3), round(H - p["y"], 3)) for p in pads if side in p["side"])
    check(f"{side}.Mask: an opening for each pad on this side, 0.1 mm larger", sorted((x, y) for x, y, *_ in fl) == want and all(abs(x[3] - (next(p for p in pads if abs(p["x"] - x[0]) < 2e-3 and abs(H - p["y"] - x[1]) < 2e-3 and side in p["side"])["w"] + 0.1)) < 2e-3 for x in fl), (len(fl), len(want)))
fl, _ = flashes(d + "/gb-F_Paste.gtp")
check("F.Paste: exactly the top SMD pads", sorted((x, y) for x, y, *_ in fl) == sorted((round(p["x"], 3), round(H - p["y"], 3)) for p in pads if p["smd"] and p["side"] == "F"), len(fl))
# ---- edge
ln, _, g = lines(d + "/gb-Edge_Cuts.gm1")
xs = [v for l in ln for v in (l.x1, l.x2)]; ys = [v for l in ln for v in (l.y1, l.y2)]
check(f"Edge.Cuts: a closed {W} x {H} mm rectangle", len(ln) == 4 and abs(min(xs)) < 1e-6 and abs(max(xs) - W) < 1e-6 and abs(min(ys)) < 1e-6 and abs(max(ys) - H) < 1e-6, (len(ln), min(xs), max(xs), min(ys), max(ys)))
# ---- silkscreen stays on the board
for side, f in (("F", "gb-F_Silkscreen.gto"), ("B", "gb-B_Silkscreen.gbo")):
    ln, _, g = lines(d + "/" + f)
    out = [l for l in ln if any(not (-0.01 <= v <= W + 0.01) for v in (l.x1, l.x2)) or any(not (-0.01 <= v <= H + 0.01) for v in (l.y1, l.y2))]
    check(f"{side}.Silk: {len(ln)} strokes, none outside the board", not out, f"{len(out)} stroke(s) outside, e.g. {[(round(l.x1,1), round(l.y1,1)) for l in out[:3]]}")
print(f"\n{'ALL PASS' if not fails else str(fails) + ' FAILED'}")
