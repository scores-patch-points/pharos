# The stamped test (PREREG.md, sha256 in PREREG.md.sha256). Read-only on the log.
# Usage: python3 -I settle.py <log.jsonl> <out.json>
import json, sys

SEED, DRAWS = 20261114, 1000

class LCG:
    def __init__(self, seed): self.s = seed & 0xFFFFFFFF
    def next(self):
        self.s = (1664525 * self.s + 1013904223) & 0xFFFFFFFF
        return self.s
    def below(self, n): return self.next() % n

def shuffle(xs, rng):
    xs = list(xs)
    for i in range(len(xs) - 1, 0, -1):
        j = rng.below(i + 1); xs[i], xs[j] = xs[j], xs[i]
    return xs

def unit(r, resolution):
    if resolution == "fingerprint": return r.get("fingerprint")
    roles = tuple(sorted((k, str(v)) for k, v in (r.get("roles") or {}).items()))
    return ("-" if r.get("polarity") == "-" else "+", r.get("rel"), roles)

def runs_from_log(path, resolution):
    runs = []  # list of {ground: frozenset(units)}
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        if r["kind"] == "reasoning-run": runs.append({}); continue
        if r["kind"] != "reasoning-claim": continue
        runs[-1].setdefault(r["ground"], set()).add(unit(r, resolution))
    return [{g: frozenset(s) for g, s in run.items()} for run in runs]

def per_ground(runs, order):
    seq = {}
    for i in order:
        for g, s in runs[i].items(): seq.setdefault(g, []).append(s)
    return seq

def stats(runs, order):
    zs, finals, contrasts, informative = [], [], [], 0
    for g, S in per_ground(runs, order).items():
        m = len(S)
        if m < 3: continue
        d = [len(S[k] ^ S[k - 1]) for k in range(1, m)]
        if not any(d): continue
        informative += 1
        tail = 0
        for x in reversed(d):
            if x == 0: tail += 1
            else: break
        zs.append(tail / (m - 1)); finals.append(1 if d[-1] == 0 else 0)
        h = len(d) // 2
        first, second = d[:h], d[len(d) - h:] if h else []
        if h: contrasts.append(sum(1 for x in second if x) / h - sum(1 for x in first if x) / h)
    T = sum(zs) / len(zs) if zs else 0.0
    F = sum(finals) / len(finals) if finals else 0.0
    C = sum(contrasts) / len(contrasts) if contrasts else 0.0
    return dict(T=T, F=F, contrast=C, informative=informative)

def test(runs):
    order = list(range(len(runs)))
    obs = stats(runs, order)
    rng = LCG(SEED); null = []
    for _ in range(DRAWS): null.append(stats(runs, shuffle(order, rng)))
    ge = sum(1 for x in null if x["T"] >= obs["T"])
    p = (1 + ge) / (1 + DRAWS)
    Ts = sorted(x["T"] for x in null)
    if obs["informative"] < 10: verdict = "UNDERPOWERED"
    elif p >= 0.05: verdict = "FAIL"
    elif obs["F"] >= 0.5: verdict = "PASS"
    else: verdict = "PARTIAL"
    return dict(observed=obs, p=p, verdict=verdict, null_T_mean=sum(Ts) / len(Ts), null_T_p95=Ts[int(0.95 * len(Ts))],
                null_F_mean=sum(x["F"] for x in null) / len(null), null_contrast_mean=sum(x["contrast"] for x in null) / len(null))

def harness():
    A, B = frozenset({"a"}), frozenset({"b"})
    # (a) changes for 5 runs then repeats for 10: 15 runs, d has 14 entries, 10 terminal zeros
    seq = [frozenset({f"x{i}"}) for i in range(5)] + [frozenset({"x4"})] * 10
    runs = [{"/g": s} for s in seq]
    za = stats(runs, range(len(runs)))["T"]
    ok_a = abs(za - 10 / 14) < 1e-12
    # (b) 40 grounds converging: each ground differs for its first 6 runs, then stable, over 18 runs
    runs = []
    for k in range(18):
        runs.append({f"/g{j}": (frozenset({f"v{j}.{k}"}) if k < 6 else frozenset({f"v{j}.5"})) for j in range(40)})
    rb = test(runs); ok_b = rb["verdict"] == "PASS"
    # (c) 40 grounds alternating A B A B ...
    runs = [{f"/g{j}": (A if k % 2 == 0 else B) for j in range(40)} for k in range(18)]
    rc = test(runs); ok_c = rc["verdict"] != "PASS"
    return dict(a=dict(z=za, ok=ok_a), b=dict(verdict=rb["verdict"], p=rb["p"], ok=ok_b), c=dict(verdict=rc["verdict"], p=rc["p"], ok=ok_c),
                ok=ok_a and ok_b and ok_c)

if __name__ == "__main__":
    log, out = sys.argv[1], sys.argv[2]
    h = harness()
    result = dict(prereg_sha256=open(sys.argv[3]).read().strip() if len(sys.argv) > 3 else None, harness=h)
    if h["ok"]:
        for res in ("unit", "fingerprint"):
            runs = runs_from_log(log, res)
            result[res] = dict(runs=len(runs), **test(runs))
    json.dump(result, open(out, "w"), indent=1)
    print(json.dumps(result, indent=1))
