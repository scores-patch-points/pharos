# EXPLORATORY, written AFTER the stamped test ran (not pre-registered). Read-only on the log.
# Descriptive counts that ground MAP.md and EXTRAPOLATE.md, and a look at what drove the settle FAIL.
import json, sys, collections, re
log = sys.argv[1]
runs, run_meta = [], []
for line in open(log, encoding="utf-8"):
    r = json.loads(line)
    if r["kind"] == "reasoning-run":
        m = re.search(r"ok=(\w+)(?: errors=(\d+))?", r["text"])
        run_meta.append(dict(id=r["id"], session=r["session"], ok=m.group(1) if m else None, errors=int(m.group(2)) if m and m.group(2) else None, at=r["appendedAt"]))
        runs.append([]); continue
    runs[-1].append(r)

def u(r):
    return ("-" if r.get("polarity") == "-" else "+", r["rel"], tuple(sorted((k, str(v)) for k, v in (r.get("roles") or {}).items())))

out = {}
# --- arithmetic: restatement (successor) counts per unit at a ground, across runs
stated = collections.Counter(); runs_of = collections.defaultdict(set)
for i, run in enumerate(runs):
    for r in run: stated[(r["ground"], u(r))] += 1; runs_of[(r["ground"], u(r))].add(i)
cnt = collections.Counter(len(v) for v in runs_of.values())
out["arith_units"] = len(runs_of)
out["arith_runs_per_unit"] = sorted(cnt.items())
out["arith_same_run_repeats"] = sum(1 for k, v in stated.items() if v > len(runs_of[k]))
# would-be "corroborated" if every run were a source and grounding were ignored
out["arith_units_in_2plus_runs"] = sum(1 for v in runs_of.values() if len(v) >= 2)
gruns = collections.defaultdict(set)
for i, run in enumerate(runs):
    for r in run:
        if r.get("verdict") in ("cited", "event"): gruns[(r["ground"], u(r))].add(i)
out["arith_units_in_2plus_runs_grounded"] = sum(1 for v in gruns.values() if len(v) >= 2)
cited = [(i, r["ground"]) for i, run in enumerate(runs) for r in run if r.get("verdict") == "cited"]
out["cited_lines"] = [[i, g] for i, g in cited]

# --- geometry: cuts (denials) and incidence
units_by_g = collections.defaultdict(set)
for k in runs_of: units_by_g[k[0]].add(k[1])
pos_neg_same_ground = 0; pos_neg_same_run = 0
for g, us in units_by_g.items():
    for (p, rel, roles) in us:
        if p == "-" and ("+", rel, roles) in us: pos_neg_same_ground += 1
for i, run in enumerate(runs):
    us = set((r["ground"], u(r)) for r in run)
    for (g, (p, rel, roles)) in us:
        if p == "-" and (g, ("+", rel, roles)) in us: pos_neg_same_run += 1
out["geo_negations"] = sum(1 for k in runs_of if k[1][0] == "-")
out["geo_neg_units_with_pos_twin_same_ground_any_run"] = pos_neg_same_ground
out["geo_neg_with_pos_twin_same_run"] = pos_neg_same_run
# referent graph per (run, ground): nodes = ARG0/ARG1 values, edges = claims with both
comps = collections.Counter(); sizes = []; degmax = []
for run in runs:
    byg = collections.defaultdict(list)
    for r in run: byg[r["ground"]].append(r)
    for g, rs in byg.items():
        adj = collections.defaultdict(set)
        for r in rs:
            a, b = (r.get("roles") or {}).get("ARG0"), (r.get("roles") or {}).get("ARG1")
            if a is not None and b is not None and a != b: adj[a].add(b); adj[b].add(a)
            elif a is not None: adj[a]
        seen, nc = set(), 0
        for v in adj:
            if v in seen: continue
            nc += 1; st = [v]
            while st:
                x = st.pop()
                if x in seen: continue
                seen.add(x); st.extend(adj[x] - seen)
        comps[nc] += 1; sizes.append(len(adj)); degmax.append(max((len(s) for s in adj.values()), default=0))
out["geo_ground_readings"] = sum(comps.values())
out["geo_components_per_reading"] = sorted(comps.items())[:12]
sizes.sort(); degmax.sort()
out["geo_nodes_per_reading_med_max"] = [sizes[len(sizes) // 2], sizes[-1]]
out["geo_maxdegree_med_max"] = [degmax[len(degmax) // 2], degmax[-1]]
out["geo_grounds"] = len(units_by_g)
out["geo_ground_depths"] = sorted(collections.Counter(len([x for x in g.split("/") if x]) for g in units_by_g).items())
# lintGfp would never compare across sibling grounds: pairs of claims in a run on different grounds
apart = 0
for run in runs:
    c = collections.Counter(r["ground"] for r in run); n = sum(c.values())
    apart += (n * (n - 1) - sum(v * (v - 1) for v in c.values())) // 2
out["geo_cross_ground_pairs_never_compared"] = apart

# --- calculus / judgement: run verdicts
out["runs_ok"] = collections.Counter(m["ok"] for m in run_meta)
errs = [m["errors"] for m in run_meta if m["errors"] is not None]
out["run_errors_sum_med_max"] = [sum(errs), sorted(errs)[len(errs) // 2], max(errs)]
# post-hoc on the FAIL: where along each 18-run ground do changes happen? (step index profile)
seq = collections.defaultdict(list)
for i, run in enumerate(runs):
    byg = collections.defaultdict(set)
    for r in run: byg[r["ground"]].add(u(r))
    for g, s in byg.items(): seq[g].append((i, frozenset(s)))
prof = collections.Counter(); n18 = 0; change_runs = collections.Counter()
for g, S in seq.items():
    if len(S) != 18: continue
    n18 += 1
    for k in range(1, 18):
        if S[k][1] != S[k - 1][1]: prof[k] += 1; change_runs[S[k][0]] += 1
out["posthoc_18run_grounds"] = n18
out["posthoc_change_count_by_step"] = [prof.get(k, 0) for k in range(1, 18)]
out["posthoc_runs_carrying_most_changes"] = [[i, c, run_meta[i]["ok"], run_meta[i]["errors"], run_meta[i]["at"][:16]] for i, c in change_runs.most_common(8)]
# do flips return to an earlier reading (A B A) rather than to a new one?
ret = new = 0
for g, S in seq.items():
    hist = []
    for k, (_, s) in enumerate(S):
        if k and s != S[k - 1][1]:
            if s in hist: ret += 1
            else: new += 1
        hist.append(s)
out["posthoc_changes_returning_to_earlier_reading"] = ret
out["posthoc_changes_to_new_reading"] = new
print(json.dumps(out, indent=1, default=lambda o: dict(o) if isinstance(o, collections.Counter) else str(o)))
