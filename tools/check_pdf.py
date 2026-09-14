#!/usr/bin/env python3
"""
Audit a PDF that PDFScan produced and report what is wrong with it.

    python3 tools/check_pdf.py "Invoices July 2026.pdf"

Every check prints the number it judged on, so a disagreement is about the
number and not about impressions. Written for the PDFScan output pipeline:
US Letter pages at 612x792pt, one scan per page, JPEG-embedded images.

Needs pypdf and Pillow. Works on pypdf 3.x and 6.x.
"""

import io
import os
import re
import sys
import zlib
from collections import Counter

try:
    import pypdf
except ImportError:
    sys.exit("pypdf missing:  pip install pypdf Pillow")
try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.exit("Pillow/numpy missing:  pip install pypdf Pillow numpy")

PAGE_W, PAGE_H = 612.0, 792.0
MARK_H = 26.0          # footer strip the free tier reserves
TOL = 1.5              # pt of slack before a difference counts

results = []
def ok(name, detail):   results.append(("PASS", name, detail))
def warn(name, detail): results.append(("WARN", name, detail))
def bad(name, detail):  results.append(("FAIL", name, detail))


# ----------------------------------------------------------------- geometry
def mul(m, n):
    """Concatenate two PDF matrices [a b c d e f]."""
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return [a*A + b*C, a*B + b*D,
            c*A + d*C, c*B + d*D,
            e*A + f*C + E, e*B + f*D + F]


def placements(page):
    """Return [(name, x0, y0, x1, y1)] for every image drawn on the page.

    Tracks the full graphics-state stack rather than regexing for a single
    `cm`, so it reads output from any engine, not just the one that happened
    to make the sample.
    """
    try:
        raw = page.get_contents().get_data().decode("latin1")
    except Exception:
        return []
    ctm, stack, out = [1, 0, 0, 1, 0, 0], [], []
    num = r"-?\d*\.?\d+"
    token = re.compile(
        rf"({num})\s+({num})\s+({num})\s+({num})\s+({num})\s+({num})\s+cm"
        rf"|(q)\b|(Q)\b|/([A-Za-z0-9_.]+)\s+Do"
    )
    for m in token.finditer(raw):
        if m.group(1):
            ctm = mul([float(m.group(i)) for i in range(1, 7)], ctm)
        elif m.group(7):
            stack.append(list(ctm))
        elif m.group(8):
            if stack:
                ctm = stack.pop()
        elif m.group(9):
            xs, ys = [], []
            for ux, uy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                a, b, c, d, e, f = ctm
                xs.append(ux*a + uy*c + e)
                ys.append(ux*b + uy*d + f)
            out.append((m.group(9), min(xs), min(ys), max(xs), max(ys)))
    return out


def xobjects(page):
    try:
        xo = page["/Resources"]["/XObject"].get_object()
    except Exception:
        return {}
    return {k: v.get_object() for k, v in xo.items()}


def as_pil(obj):
    """Decode an image XObject to PIL, or None if it isn't a plain JPEG."""
    filt = str(obj.get("/Filter"))
    data = obj._data
    try:
        if "DCTDecode" in filt:
            return Image.open(io.BytesIO(data)).convert("RGB")
        if "FlateDecode" in filt:
            w, h = int(obj["/Width"]), int(obj["/Height"])
            raw = zlib.decompress(data)
            mode = "RGB" if len(raw) >= w*h*3 else "L"
            return Image.frombytes(mode, (w, h), raw[:w*h*(3 if mode == "RGB" else 1)]).convert("RGB")
    except Exception:
        return None
    return None


# ------------------------------------------------------------------- checks
def check(path):
    size_kb = os.path.getsize(path) / 1024
    r = pypdf.PdfReader(path)
    n = len(r.pages)

    boxes = {(round(float(p.mediabox.width), 1), round(float(p.mediabox.height), 1)) for p in r.pages}
    if len(boxes) == 1 and boxes == {(PAGE_W, PAGE_H)}:
        ok("page size", f"all {n} pages {PAGE_W:.0f}x{PAGE_H:.0f}pt (US Letter)")
    else:
        warn("page size", f"mixed or non-Letter: {sorted(boxes)}")

    # --- placements: overflow, margins, footer strip, per-page image ids ---
    overflow, margins, footer = [], [], []
    overflow_pages, page_keys, ids = set(), [], Counter()
    for i, p in enumerate(r.pages):
        ph = float(p.mediabox.height); pw = float(p.mediabox.width)
        keys = set()
        for nm, o in xobjects(p).items():
            if o.get("/Subtype") == "/Image":
                k = (int(o.get("/Width", 0)), int(o.get("/Height", 0)), len(o._data))
                keys.add(k); ids[k] += 1
        page_keys.append(keys)
        for nm, x0, y0, x1, y1 in placements(p):
            h, w = y1 - y0, x1 - x0
            if y0 < -TOL or y1 > ph + TOL or x0 < -TOL or x1 > pw + TOL:
                overflow.append((i + 1, round(w, 1), round(h, 1), round(ph, 1)))
                overflow_pages.add(i)
            margins.append((round(x0, 1), round(pw - x1, 1), round(ph - y1, 1), round(y0, 1)))
            footer.append(round(y0, 1))

    # A scan appearing on two pages is only spill if one of those pages is
    # also overflowing. Someone who scans the same receipt twice produces a
    # legitimate duplicate, and flagging that as a bug would train you to
    # ignore this check.
    phantom = [i for i in range(1, n)
               if (page_keys[i] & page_keys[i - 1])
               and (i in overflow_pages or i - 1 in overflow_pages)]
    dupes = sum(1 for k, c in ids.items() if c > 1)
    if phantom:
        bad("phantom pages",
            f"{len(phantom)} page(s) are spill — the scan above them overflowed and "
            f"continued onto a new page; {n} pages from {len(ids)} distinct scans")
    elif dupes:
        ok("phantom pages",
           f"{n} pages, {len(ids)} distinct scans — {dupes} scan(s) legitimately repeat, no spill")
    else:
        ok("phantom pages", f"{n} pages, {len(ids)} distinct scans — one page per scan")

    if overflow:
        pg, w, h, ph = overflow[0]
        bad("overflow",
            f"{len(overflow)} placement(s) run off the page — e.g. p{pg}: image {h}pt tall "
            f"on a {ph}pt page, overflows by {round(h - ph, 1)}pt")
    else:
        ok("overflow", "every image sits inside its page box")

    if margins and overflow:
        # A negative margin is the overflow measured from the other side; it is
        # not a margin. Reporting it as one would let a broken file read as fine.
        warn("letterboxing", "not measurable while images overflow — fix overflow first")
        warn("footer mark", "not measurable while images overflow")
    elif margins:
        L = max(m[0] for m in margins); R = max(m[1] for m in margins)
        T = max(m[2] for m in margins); B = min(m[3] for m in margins)
        side = max(L, R)
        detail = f"left {L}pt, right {R}pt, top {T}pt, bottom {B}pt"
        if side > 40:
            warn("letterboxing", f"{detail} — {side}pt of blank page beside the scan")
        else:
            ok("letterboxing", detail)

        if any(abs(b - MARK_H) < 6 for b in footer):
            ok("footer mark", f"~{MARK_H:.0f}pt strip reserved below the scan (free tier)")
        elif max(footer) < 6:
            ok("footer mark", "no reserved strip — Pro output")
        else:
            warn("footer mark", f"bottom gap {min(footer)}pt — expected ~0 (Pro) or ~{MARK_H:.0f} (free)")

    # --- encoding, resolution, weight ---
    encs, dpis, pil = Counter(), [], []
    for p in r.pages:
        place = {nm: (x1 - x0, y1 - y0) for nm, x0, y0, x1, y1 in placements(p)}
        for nm, o in xobjects(p).items():
            if o.get("/Subtype") != "/Image":
                continue
            encs[str(o.get("/Filter")).strip("[]/'")] += 1
            w = int(o.get("/Width", 0))
            drawn = place.get(nm, (0, 0))[0]
            if drawn > 1:
                dpis.append(w / (drawn / 72.0))
            im = as_pil(o)
            if im is not None and len(pil) < 6:
                pil.append(im)

    main = encs.most_common(1)[0][0] if encs else "none"
    if "DCT" in main:
        ok("encoding", f"{main} (JPEG) — {dict(encs)}")
    elif "Flate" in main:
        bad("encoding",
            f"{main} (lossless) — a CSS filter on the image forces this and inflates "
            f"the file several times over; keep filters off the <img>")
    else:
        warn("encoding", f"{main} — {dict(encs)}")

    if dpis:
        lo, hi = min(dpis), max(dpis)
        if lo < 110:
            warn("resolution", f"{lo:.0f}-{hi:.0f} dpi at print size — under ~120 starts to look soft")
        elif hi > 320:
            warn("resolution", f"{lo:.0f}-{hi:.0f} dpi — over ~300 is weight with no visible gain")
        else:
            ok("resolution", f"{lo:.0f}-{hi:.0f} dpi at print size")

    per = size_kb / max(n, 1)
    if per > 1024:
        bad("file size", f"{size_kb/1024:.1f} MB total, {per/1024:.2f} MB/page — too big to email")
    elif per > 400:
        warn("file size", f"{size_kb/1024:.1f} MB total, {per:.0f} KB/page")
    else:
        ok("file size", f"{size_kb/1024:.2f} MB total, {per:.0f} KB/page")

    # --- pixel checks: bleaching and the background ring ---
    if pil:
        bleached, rings = [], []
        for im in pil:
            a = np.asarray(im.resize((360, int(360*im.height/im.width))), dtype=float)
            g = a.mean(2)
            extreme = float(((g < 8) | (g > 247)).mean())
            midtone = float(((g > 60) & (g < 200)).mean())
            bleached.append((extreme, midtone))

            bright = a.mean(2); warm = a[:, :, 0] - a[:, :, 2]
            paper = (bright > 235) & (warm < 7)
            h, w = paper.shape
            edges, hit_cap = [], False
            for lines, span in ((( paper[i] for i in range(h//4)), h),
                                (( paper[h-1-i] for i in range(h//4)), h),
                                (( paper[:, i] for i in range(w//4)), w),
                                (( paper[:, w-1-i] for i in range(w//4)), w)):
                c, cap = 0, span//4
                for L in lines:
                    if L.mean() > 0.75:
                        break
                    c += 1
                if c >= cap:
                    # Never found paper walking inward: the page is dim overall,
                    # not ringed. Reporting 25% here would be an artefact.
                    hit_cap = True
                edges.append(c/span*100)
            rings.append(None if hit_cap else max(edges))

        ex = sum(b[0] for b in bleached)/len(bleached)
        mid = sum(b[1] for b in bleached)/len(bleached)
        if ex > 0.92 and mid < 0.04:
            bad("tone", f"{ex*100:.0f}% of pixels pure black or white, only {mid*100:.1f}% midtone "
                        f"— the scan has been thresholded, not cleaned")
        elif mid < 0.08:
            warn("tone", f"only {mid*100:.1f}% midtone — contrast is pushed hard")
        else:
            ok("tone", f"{mid*100:.0f}% midtone, {ex*100:.0f}% at the extremes — natural range kept")

        measured = [x for x in rings if x is not None]
        if not measured:
            warn("edge ring", "could not locate the paper edge — the page is dim overall, "
                              "so there is no white to measure the border against")
        else:
            worst = max(measured); med = sorted(measured)[len(measured)//2]
            if worst > 1.5:
                warn("edge ring", f"background visible up to {worst:.1f}% of an edge "
                                  f"(median page {med:.1f}%) — 'Trim scan edges' would cut it")
            else:
                ok("edge ring", f"max {worst:.1f}% of an edge — no meaningful border")
    else:
        warn("pixels", "could not decode images for tone/ring analysis")

    return r


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for path in sys.argv[1:]:
        results.clear()
        print()
        print(f"  {os.path.basename(path)}")
        print("  " + "-" * 68)
        try:
            check(path)
        except Exception as e:
            print(f"  could not read: {e}")
            continue
        icon = {"PASS": "  ok  ", "WARN": " warn ", "FAIL": " FAIL "}
        for status, name, detail in results:
            head = f"  {icon[status]} {name:<14}"
            body = detail
            print(f"{head} {body[:200]}")
            while len(body) > 200:
                body = body[200:]
                print(" " * 24 + body[:200])
        fails = sum(1 for s, _, _ in results if s == "FAIL")
        warns = sum(1 for s, _, _ in results if s == "WARN")
        print("  " + "-" * 68)
        print(f"  {fails} failed, {warns} warnings, "
              f"{sum(1 for s,_,_ in results if s=='PASS')} passed")
    print()
    return 1 if any(s == "FAIL" for s, _, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
