# Independent check of the copper pour in the Gerber: read the regions back, rebuild the other copper, measure the gap.
import json, sys, math, warnings
warnings.simplefilter("ignore")
from gerbonara import GerberFile
from shapely.geometry import Point, LineString, box
from shapely.ops import unary_union
d = sys.argv[1]
b = json.load(open(d + "/board.json")); H = b["outline"]["h"]
g = GerberFile.open(d + "/gb-B_Cu.gbl")
rects = []
for o in g.objects:
    if type(o).__name__ == "Region":
        xs = [p[0] for p in o.outline]; ys = [p[1] for p in o.outline]
        rects.append(box(min(xs), min(ys), max(xs), max(ys)))
pour = unary_union(rects)
print(f"pour read back from the Gerber: {len(rects)} regions, area {pour.area:.0f} mm2, {len(list(pour.geoms)) if pour.geom_type=='MultiPolygon' else 1} piece(s)")
# pads, vias, tracks on B with their nets (tracks and vias take the net of what they touch)
def padworld(part, pad):
    x = -pad["x"] if part.get("flip") else pad["x"]; y = pad["y"]
    th = math.radians(part["rot"]); c, s = round(math.cos(th), 9), round(math.sin(th), 9)
    swap = abs(round(part["rot"] / 90)) % 2 == 1
    sd = ("B" if part.get("flip") else "F") if pad.get("smd") else "FB"
    return dict(x=part["x"] + x * c - y * s, y=part["y"] + x * s + y * c, w=pad["h"] if swap else pad["w"], h=pad["w"] if swap else pad["h"], round=pad["shape"] == "round", side=sd)
items = []   # dict(kind, geom, net, ends)
for pi, p in enumerate(b["parts"]):
    for qi, q in enumerate(p["fp"]["pads"]):
        w = padworld(p, q)
        if "B" not in w["side"]: continue
        net = p["nets"][qi] if qi < len(p["nets"]) else ""
        geom = Point(w["x"], H - w["y"]).buffer(min(w["w"], w["h"]) / 2) if w["round"] else box(w["x"] - w["w"] / 2, H - w["y"] - w["h"] / 2, w["x"] + w["w"] / 2, H - w["y"] + w["h"] / 2)
        items.append(dict(kind="pad", geom=geom, net=net))
for v in b["vias"]: items.append(dict(kind="via", geom=Point(v["x"], H - v["y"]).buffer(v["d"] / 2), net=None))
for t in b["tracks"]:
    if t["layer"] == "B": items.append(dict(kind="track", geom=LineString([(x, H - y) for x, y in t["pts"]]).buffer(t["w"] / 2), net=None))
# nets for vias / tracks: spread through touching items (tracks on F also carry the via nets)
fl = [dict(kind="track", geom=LineString([(x, H - y) for x, y in t["pts"]]).buffer(t["w"] / 2), net=None) for t in b["tracks"] if t["layer"] == "F"]
allit = items + fl
fpads = []
for p in b["parts"]:
    for qi, q in enumerate(p["fp"]["pads"]):
        w = padworld(p, q)
        if "F" in w["side"] and not any(x["geom"].distance(Point(w["x"], H - w["y"])) == 0 and x["kind"] == "pad" for x in items):
            geom = box(w["x"] - w["w"] / 2, H - w["y"] - w["h"] / 2, w["x"] + w["w"] / 2, H - w["y"] + w["h"] / 2); fpads.append(dict(kind="pad", geom=geom, net=p["nets"][qi]))
allit += fpads
changed = True
while changed:
    changed = False
    for a in allit:
        if a["net"] is None:
            for o in allit:
                if o is not a and o["net"] and a["geom"].intersects(o["geom"]): a["net"] = o["net"]; changed = True; break
bad = []; checked = 0
for it in items:
    if it["net"] in (None, "0"): continue
    checked += 1
    gap = it["geom"].distance(pour)
    if gap < 0.2 - 0.005: bad.append((it["kind"], it["net"], round(gap, 3)))
print(f"{checked} pieces of copper on other nets checked: smallest gap to the pour = {min((it['geom'].distance(pour) for it in items if it['net'] not in (None,'0')), default=0):.3f} mm (rule 0.2)")
print("PASS  the pour keeps the clearance to every other net" if not bad else f"FAIL  {len(bad)} too close: {bad[:5]}")
gnd = [it for it in items if it["net"] == "0" and it["kind"] == "pad"]
print(f"ground pads on the back: {len(gnd)}; touching the pour or connected by its spokes: {sum(1 for it in gnd if it['geom'].buffer(0.45).intersects(pour))}")
