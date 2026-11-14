# Surf, sniff and SIG: the project owner's design, as pasted 2026-11-14 (verbatim)

Pasted into the EOQL session with no words of his own around it. Kept here so other sessions can read the exact text.

---

Give each one a separate job and keep their authority separate. Surf brings material in. Vector sniffing suggests where to look and what might be related. SIG decides whether anything actually differs. Vectors can propose but never decide, and SIG is what controls when surfing stops.
The loop

1. Gap. A question's shape has an unfilled slot, or a prediction points somewhere. That's the only trigger for surfing.
2. Sniff to aim. Embedding similarity ranks which unread sources or regions are closest to the gap. This is cheap, wide, and approximate.
3. Surf. Fetch the top candidates and log them as bylined events with content hashes.
4. Sniff to pair. For each new event, similarity proposes neighbors already in the log: possible paraphrases, duplicates, or the same claim from another source.
5. SIG. Compare the event structurally against those neighbors, or against the predicted state. This is the step that judges difference, and it records a mark only if something actually differs.
6. INS at read. Under the reader's ground, decide whether the marked difference matters to the question.
7. Stop or continue. If the last fetches produced no SIG inside the question's cone, stop surfing. If they did, the new marks reshape the gap and the loop continues.

Rules

* Vectors never create marks or sameness. Embeddings can't see negation or who did what to whom, so "the council approved it" and "the council did not approve it" can score as near-identical. Similarity can only nominate candidates. Marks and identity edges come from SIG.
* The most important checks happen where vectors say "similar." High similarity with no structural difference means a restatement, so no mark. High similarity with a flipped polarity, a swapped role, or a different date is a contradiction, and SIG should look hardest there. That's the zone vectors miss, and it's where your discrepancy finder lives.
* Low similarity proves nothing either. A paraphrase in another language or register can score low. Vectors are a recall tool for finding candidates. Precision comes from SIG.
* The embedding model is part of the ground. Similarity depends on which model produced it, so the model and its version are a bylined ground event. Changing models means re-proposing candidates, not rewriting the log.
* Surf stops on SIG yield, not on a fetch count. When new material keeps producing no differences that matter, you've reached the edge of what's knowable for this question. This is the same "differences that make no difference" stopping rule, applied outward.
* Restatement isn't always waste. For "what is the value," a second source saying the same thing adds nothing. For "is it corroborated," it's the whole point. The question's shape decides whether surfing should keep collecting agreement.

Learning over time. Sources whose fetches historically produced SIG for a kind of question get sniffed and surfed earlier. Sources that only echo get pushed down, except for corroboration questions. That's the predictive part: SIG history steers future surfing. Keep the shuffled-history control from the earlier test plan, so you can tell real learning from a trail that's just reinforcing itself.
How to test it. On the Wikidata slice, plant contradictions that are nearly identical in wording (flipped negation, swapped subject and object, changed date), plus paraphrases that are lexically far apart. Measure three things: how many contradictions vectors alone would have merged, how many SIG catches, and how much surfing the SIG-yield stopping rule saves compared with a fixed fetch budget.
