# AI patch token accounting — 2026-11-04

The one-shot Gateway bridge returns `agentMeta.usage`, the normalized usage
for the whole request (including any provider attempts). No fixed 25,000 was
found in the app. Live non-applying probes reported 45 input + 5 output = 50
for a tiny message, and 12,292 input + 472 output = 12,764 for a real musical
patch request without catalogue candidates. The latter included 12,289 cache-
write tokens in input; these are not cache hits. Large input counts include
instructions, control schema, current state, and catalogue, not just user text.

Backend input = uncached input + cacheRead + cacheWrite from Gateway normalized
(disjoint) counters. Total = that input + output, never an unchecked aggregate.
Reasoning is already included in output; do not add reasoning again. Browser
also computes the total/page accumulation from input + output, shows cached
input as a subset, and shows uncached input = input - cacheRead. Invalid or
missing usage remains unknown, never an assumed zero. Cancelled/time-limited
requests may still have consumed unreported tokens.

Regression coverage: backend `test_ai_patch.py` includes inconsistent 25,000
aggregates, missing totals, cache/normalization, validation-error usage and
unknown usage. `ai-token-usage-browser.cjs` exercises actual UI responses in
Chromium/WebKit: stale total 25,000 with components 9,000 + 200 shows 9,200;
45 + 5 shows 50; page sum is 9,250; missing usage is explicitly unreported.
No live production patch, source audio, saved schema or Song rendering changes.
