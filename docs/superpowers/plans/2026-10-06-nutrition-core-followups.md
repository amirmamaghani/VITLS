# Nutrition core — deferred follow-ups

Minor findings deferred during plan 1 execution (2026-10-06); triaged as not blocking merge. Pick up in plans 2–5.

- Task 1: minor (deferred): ug/cl/dl conversion factors untested.
- Task 1: minor (deferred): the NutrientKey type test uses toMatchTypeOf and would not catch a regression to string (probe confirmed current type is correct).
- Task 2: minor (deferred): food-tables test only checks table existence; normalize test lacks %/digits/empty cases; foods.created_by unindexed; pg_trgm branch untested on PGlite.
- Task 3: minor (deferred): empty names → .values([]) throws; re-import test only checks changed protein; select-then-insert race for concurrent importers; O(foods×rows) hydration filter.
- Task 3: minor (deferred): a second upsert of the same custom (source, sourceRef) can still overwrite content (not ownership); only createFood writes custom foods and uses a random sourceRef.
- Task 4: minor (deferred): unit-prefix check uses raw startsWith (could drop "cup" before "cupcake"); happy-path-only coverage (no unit-without-modifier, missing energy, empty nutrients).
- Task 5: minor (deferred, suggest fixing in final wave): foods:import prints no DB target / no guard for the shared .env DB (caused the incident); unknown source validated after migrations; exits 0 when all files missing; BLS code regexes rely on value column preceding Datenherkunft/Referenz columns; "gesättigte" unanchored; rich-text cells stringify as [object Object]; USDA single-folder merge undocumented in CLI header.
- Task 6: minor (deferred): no sanity range check on OFF values; 3 s wait for OFF when <3 local hits; kJ-only OFF products dropped.
- Task 7: minor (deferred): order-dependent tests sharing a mutated egg fixture; no lib-level validation of note length / empty item names / entry "copy" without source (actions validate with zod in Task 8 — confirm there); portion silently overrides unit; update-with-bad-items path untested.
- Task 7: minor (deferred, suggest fixing in final wave): existing meal (old day) read before the tx/lock — concurrent move/delete of the SAME meal can leave one day's intake stale, and an update racing a delete inserts orphan items then throws in toView; fix = re-read the meal FOR UPDATE inside the tx before computing days. Concurrency test runs on single-connection PGlite (documents the contract only).
- Task 8: minor (deferred): foodId/mealId/fromMealId lack .max(); nutrient values unbounded above; duplicated nutrients zod schema in log-meal and create-food (plan-mandated); import order nits; no direct action-schema tests. (INITIAL_TOOL_NAMES wiring is Task 10.)
- Task 9: minor (deferred): overlapping-edit rollback can drop a later optimistic edit; min={1} blocks fractional amounts (plan-mandated); `as never` mutation casts (plan-mandated); Delete not styled destructive.
- Task 9: minor (deferred): two consecutive failed saves roll back to a state containing the first unpersisted edit; overlapping saves can reach the server out of order (full item list each time) — client latest-wins only.
- Task 10: minor (deferred, suggest fixing in final wave): skill example "Protein 142/175 g" presumes a target (targets come in plan 3) — risk of invented targets; text/voice and estimate steps don't name entry "manual"; "yesterday" range not specified.
- Final: parked — CLI guard checks DATABASE_URL, not <APP>_DATABASE_URL_UNPOOLED — Ruling: only DATABASE_URL is configured in this repo; revisit if an unpooled URL is ever set — cost if wrong: migrations against a remote unpooled DB without --yes.
- Final: parked — barcode cache hit lost when an OFF text search cached the product first under OFF's normalized code — Ruling: results stay correct, only an extra OFF call — cost if wrong: extra latency per such scan.
- Final: parked — logMeal fromMealId template read outside the tx (template deleted concurrently → insert error instead of 404) — Ruling: pre-existing, rare, no data corruption — cost if wrong: an opaque error on a rare race.
- Final: parked — custom-food content can be overwritten by an upsert with the same sourceRef — Ruling: createFood uses random UUID sourceRefs and is the only custom writer — cost if wrong: none today.
