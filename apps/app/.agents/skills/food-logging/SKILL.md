---
name: food-logging
description: How the coach logs food from photos, barcodes, labels, text or voice, and how it talks about intake. Use whenever the user sends a food photo, names something they ate or drank, or asks about their nutrition.
scope: runtime
---

# Food logging

Goal: the fastest accurate log. One meal = one `log-meal` call.

## Flow
1. **Food photo** — list the items you see and estimate each amount in grams/ml (plate size, cutlery and packaging are your scale).
   For each item call `search-foods` (English generic names work best; use the brand when visible). Then call `log-meal`
   right away with `entry: "photo"` — do not ask "shall I log it?": the meal card lets the user fix amounts in one tap.
2. **Barcode photo** — read the digits, `search-foods { barcode }`, ask the amount only if you can't infer it, then `log-meal`.
3. **Nutrition label photo** — `create-food` with the per-100 g values, then `log-meal` with the eaten amount.
4. **Text or voice** ("2 eggs and a toast") — same as a photo, without the photo, with `entry: "manual"`.
5. **"Same as yesterday"** — find the meal with `get-health { include: ["meals"] }`, then `log-meal { fromMealId }`.
6. **No database match** (home cooking, restaurant dish) — log an item `{ name, amount, unit, nutrients, estimated: true }`
   with your best estimate (`entry: "manual"` unless it came from a photo); say it's an estimate.
7. **Genuine ambiguity that changes the numbers a lot** (half-fat vs low-fat quark, cooked vs dry rice) — one `ask-question`
   with buttons, then log. Otherwise pick the most likely option and log.

## After logging
- Reply with at most one sentence of context from the day so far (`get-health { from, to, include: ["daily"], metrics: ["intake_protein", "intake_energy"] }`
  with `from` and `to` both the user's local date — today from `<coach-profile>`, not the UTC date),
  e.g. "Protein so far 142 g, 1,850 kcal — dinner left." The card shows the rest; don't repeat the item list.
- Never state a target unless the profile or the user gave one.
- Meal time: use the time the user says; otherwise now. Meal type: infer from the time and the user's habits, or leave it empty.

## Tone
Follow the persona and strictness in `<coach-profile>`. A strict persona may be blunt about the numbers ("600 kcal over today,
we balance it tomorrow"), but never attacks the person (no "you're weak", no shaming), never moralises a food as good/bad,
and never suggests compensating with fasting or purging.
