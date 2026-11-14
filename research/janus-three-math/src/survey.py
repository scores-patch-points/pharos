# Marginal structural survey of the reasoning log (read-only). Marginal counts only:
# no per-key or per-claim co-occurrence statistics (those are reserved for the stamped test).
import json, collections, sys
F = sys.argv[1]
C = collections.Counter
kind, role, verdict, pol, source, sup, giver, schema = C(), C(), C(), C(), C(), C(), C(), C()
rels, sessions, grounds, rolekeys, fp_present, basis_prefix = C(), set(), set(), C(), C(), C()
days = C(); run_claims = C()
n = 0
for line in open(F, encoding="utf-8"):
    r = json.loads(line); n += 1
    kind[r.get("kind")] += 1; role[r.get("role")] += 1; giver[r.get("giver")] += 1; schema[r.get("schema")] += 1
    sup["null" if r.get("supersedes") is None else "set"] += 1
    days[(r.get("appendedAt") or "")[:10]] += 1
    if r.get("session") is not None: sessions.add(r["session"])
    if r.get("kind") == "reasoning-claim":
        verdict[r.get("verdict")] += 1; pol[r.get("polarity")] += 1; source[r.get("source")] += 1
        rels[r.get("rel")] += 1; grounds.add(r.get("ground"))
        rolekeys[tuple(sorted((r.get("roles") or {}).keys()))] += 1
        fp_present["fp" if r.get("fingerprint") else "nofp"] += 1
        basis_prefix[(r.get("basis") or "").split(":")[0]] += 1
    if r.get("kind") == "reasoning-run":
        t = r.get("text", "")
        import re
        m = re.search(r"(\d+) claim\(s\), (\d+) note", t)
        ok = re.search(r"ok=(\w+)", t)
        run_claims[("claims>0" if m and int(m.group(1)) > 0 else "claims=0", "notes>0" if m and int(m.group(2)) > 0 else "notes=0", ok.group(1) if ok else "?")] += 1
out = dict(lines=n, kind=kind, role=role, giver=giver, schema=schema, supersedes=sup,
  verdict=verdict, polarity=pol, source=source, distinct_rels=len(rels), top_rels=rels.most_common(15),
  sessions=len(sessions), distinct_grounds=len(grounds), rolekeys=[[list(k), v] for k, v in rolekeys.most_common(8)],
  fingerprint=fp_present, basis_prefix=basis_prefix, days=sorted(days.items()), run_shape=[[list(k), v] for k, v in run_claims.items()])
print(json.dumps(out, indent=1, default=lambda o: dict(o)))
