# Design: nutrition tracking (food log, photo logging, targets, GLP-1 support)

Status: **APPROVED** · 2026-10-06 · plan 1 (core) implemented

## 1. Scope and boundary

- **A tracker, not clinical nutrition.** VITLS sits at the level of kaloricketabulky.cz / Cal AI: it records intake,
  compares it with targets and shows relationships. It never derives medical limits or doses. People with a condition
  (diabetes, kidney disease, …) enter the targets their clinician gave them; the coach never changes those.
- **Primary users:** bodybuilders, gym-goers, biohackers (fast, accurate macro logging, protein anchor, cut/bulk phases),
  and **people on GLP-1 therapy** (semaglutide, tirzepatide), whose risk is the opposite: under-eating, lean-mass loss,
  low fluid/fiber, nausea.
- **Logging paths:** photo (main path), barcode, search, text/voice in chat, repeat a previous meal, Apple Health /
  Health Connect import.
- **Food photos are stored**, privately (§6).

Out of scope for v1: recipes built from ingredients (repeat-meal covers most repeats), meal planning, weekly review page.

## 2. Food reference database

No mature open-source project unifies the open food databases behind one interface (researched 2026-10-05:
OpenNutriTracker-Backend, GPL-3.0, USDA + BLS + national tables in one Postgres schema; Liberado MCP, MIT, local
cache with USDA + Open Food Facts fallback; wger, AGPL, imports Open Food Facts). We follow their **pattern** in our own
Postgres without taking their code.

| Source | Content | License | How |
|---|---|---|---|
| USDA FoodData Central (Foundation + SR Legacy) | ~8k generic foods | CC0 | bulk import |
| ANSES CIQUAL 2025 | 3,484 foods, 74 constituents | Etalab Open License 2.0 | bulk import |
| BLS 4.0 (Germany) | ~7.1k foods | CC BY 4.0 | bulk import |
| Open Food Facts | ~2.8M branded products, barcodes | ODbL | live API on demand, per-product cache (no full dump, which would make our derived database ODbL) |

- `pnpm foods:import` downloads, maps each source's nutrients and units (kJ→kcal, mg, µg) onto the nutrient catalog and
  bulk-loads; idempotent on `(source, source_ref)`.
- Sources are **not merged**; search ranks by name match, then source (European tables before USDA).
- Open Food Facts: called for a barcode or an unmatched branded product, with a proper User-Agent; cached products
  refresh after 90 days.
- Slovak/Czech names: the sources have none. One-off translation of the ~3k most common generic foods into
  `food_names` (sk, cs), reviewed before use; everything else is searchable in en/fr/de. The coach names foods in
  English from photos anyway.
- Attribution page in settings: USDA (CC0), ANSES CIQUAL (Etalab 2.0), BLS (CC BY 4.0), Open Food Facts (ODbL).
- NutriDatabaze.cz is excluded: free registration but copyright-protected, not an open license.

## 3. Data model

**Nutrient catalog** (`packages/health-ingest`, beside the metric catalog): one list of nutrient keys with canonical
unit and the matching **Apple HealthKit** `HKQuantityTypeIdentifierDietary…` type and **Health Connect**
`NutritionRecord` field. Keys and units are chosen to convert 1:1; the base set is the intersection of both platforms
(energy, protein, fat, saturated fat, carbohydrates, sugars, fiber, sodium, potassium, cholesterol, caffeine, alcohol,
water, main vitamins and minerals). Adding a nutrient is one catalog entry.

**Reference tables (shared, not PHI):**

| Table | Columns | Key |
|---|---|---|
| `foods` | id, source (`usda`/`ciqual`/`bls`/`off`/`custom`), source_ref, name, brand?, barcode?, basis (`100g`/`100ml`), owner_email (custom foods only, visible to their author) | id; unique (source, source_ref) |
| `food_nutrients` | food_id, nutrient, amount per basis | (food_id, nutrient) |
| `food_portions` | food_id, label ("1 egg", "1 tbsp"), grams or ml | (food_id, label) |
| `food_names` | food_id, lang, name | (food_id, lang); `pg_trgm` + full-text indexes |

**User tables (PHI, owner-scoped, encrypted text columns):**

| Table | Columns |
|---|---|
| `meals` | id, owner_email, eaten_at (TIMESTAMPTZ), local_date, meal_type (`breakfast`/`lunch`/`dinner`/`snack`/null — the HealthKit/Health Connect enum), note (encrypted), photo (private-blob handle), entry (`photo`/`barcode`/`search`/`manual`/`copy`/`import`), source (`vitls` or the importing provider), external_id |
| `meal_items` | meal_id, food_id?, name (snapshot, encrypted), amount, unit (`g`/`ml`), nutrients (JSON snapshot of the item's totals), estimated (bool) |

- **Nutrient snapshot per item:** updating the reference database never rewrites history.
- An item without a database match (e.g. "home goulash ~350 g") stores the estimated nutrients with `estimated = true`.
- **Daily intake totals are ordinary daily metrics** (`intake_energy`, `intake_protein`, `intake_fat`, `intake_carbs`,
  `intake_fiber`, `intake_sodium`, `intake_water`, …, source `food`, aggregation `sum`), recomputed for the affected day on
  every meal write or delete. Dashboard widgets, `show-widget`, `get-health` trends and baselines and the coach's
  cross-metric reasoning (intake vs weight, HRV) work with no new code.

## 4. Apple Health / Health Connect compatibility

- **Import:** the companion reads nutrition other apps wrote (MyFitnessPal, Cronometer, Yazio, …) and sends it through
  the existing ingest contract, extended with
  `meals: [{ externalId, eatenAt, mealType?, name?, items: [{ name, nutrients }] }]`. Imported items have nutrients but no
  `food_id`; HealthKit food correlations map to one meal, Health Connect `NutritionRecord`s with the same time and meal
  type group into one meal.
- **Export:** the companion writes VITLS meals back to Health (a HealthKit food correlation / Health Connect
  `NutritionRecord` per item, `HydrationRecord` for water) so other apps see them.
- **No loops:** on import, records whose source is VITLS are skipped.
- **No double counting:** if a day has meals logged in VITLS and imported meals, the daily totals come from VITLS; the
  imported meals are listed as "also in Apple Health". (The reverse of the metric rule, where a tracker beats manual
  entry: here the deliberate VITLS log is the more precise source.)

## 5. Actions and coach

**New actions:**

| Action | Purpose |
|---|---|
| `search-foods` | Name (sk/cs/en, typo-tolerant) or barcode. Local database first; Open Food Facts for unmatched barcodes/brands, cached. Returns nutrients per 100 g/ml and named portions. Read-only. |
| `log-meal` | Create, or update with `mealId`. Items are `{ foodId, amount, unit or portion }` or `{ name, nutrients, estimated }`. Optional photo, meal type, time, note. `fromMealId` copies a meal ("same as yesterday"). Recomputes the day's `intake_*` metrics. Chat renderer `vitls.meal` shows the meal card. |
| `delete-meal` | Deletes a meal and its photo, recomputes the day. |
| `create-food` | A user's own food: name, brand, barcode, nutrients per 100 g/ml, portions — typically filled by the coach from a photo of a nutrition label. |
| `export-health-report` | Doctor export for a date range: intake, weight, symptoms, GLP-1 doses; CSV and PDF, delivered as a private download. |

**Extended, not new:**
- `get-health` gains a `meals` section (meals with items for a range); daily totals already come back as `intake_*` metrics.
- Widget schema (dashboard and `show-widget`) gains kinds `nutrition` (today's tiles vs targets with
  met / short / over states, PULSE "Today") and `meals` (today's meals with photos). Intake trends are plain metric widgets.
- `update-coach-profile` gains nutrition targets and medication (§7).

**Coach behaviour** (runtime skill `food-logging` + AGENTS.md tool row):
- Food photo → identify items, estimate grams, `search-foods` per item, then `log-meal` straight away (no "shall I log
  it?": the meal card edits amounts in one tap), plus at most one sentence of context ("protein 142/175 g, dinner left").
- Barcode photo → `search-foods` by code; nutrition-label photo → `create-food`.
- Ambiguity ("half-fat or low-fat quark?") → one `ask-question` with buttons; otherwise estimate and flag.
- Text or voice ("2 eggs and toast") → same flow without a photo.
- **Tone follows the persona** the user chose. A strict persona may be blunt about numbers ("600 kcal over today, we
  balance it tomorrow"), but never attacks the person — the narrowed form of the rule in `03-coach.md`, kept as a
  safeguard for users prone to disordered eating. `03-coach.md` is updated accordingly.

## 6. Photos and privacy

- **Storage:** a custom `private-blob` provider (`registerPrivateBlobProvider`) over S3-compatible storage — MinIO in
  `infra/docker-compose.yml` locally (`vitls-minio`, infra naming rule), EU-hosted S3 in production (provider chosen at
  deploy). No public URL ever exists; a photo is served only to its owner through an authenticated read.
- **Encryption:** objects are encrypted before upload with the owner's key from the existing field-key ring
  (AES-256-GCM, HKDF per tenant); the bucket only holds ciphertext.
- **Client-side before upload:** resize to ~1600 px and **strip EXIF, including GPS**.
- **Deletion:** `delete-meal` deletes the photo; account offboarding deletes all photos.
- **Model provider:** a photo reaches the model provider (Anthropic) like any chat message. Privacy notice must say so;
  EU data-processing options to be confirmed (open item).
- **First implementation task (spike):** confirm how agent-native stores chat image attachments. Plain file upload
  returns a public URL; the framework has a private-blob path for uploads (`setPrivateBlobPublicUploadFallbackEnabled`).
  Requirement: a chat photo lands in private storage and `log-meal` only references its handle.

## 7. Targets and GLP-1 support

**Nutrition targets** in the coach profile:

```ts
nutritionTargets: [
  { nutrient: "protein", min: 175, per: "day", setBy: "user" | "coach" | "clinician" },
  { nutrient: "fat",     max: 65,  per: "day" },
  { nutrient: "carbs",   min: 30, max: 45, per: "meal", setBy: "clinician" },
]
energy: { kind: "fixed", kcal: 2300 }
      | { kind: "dynamic", maintenanceKcal: 2300, offsetKcal: -750, addActivity: true }
```

- **Direction** drives tile state: `min` → met at or above; `max` → over above; both → in range or not.
- **Dynamic energy** (PULSE): maintenance + today's tracker active energy + offset. Diet break → offset 0; bulk → positive.
- `setBy: "clinician"` targets are entered by the user and never changed or derived by the coach; fitness targets
  (e.g. protein per kg) may be proposed by the coach.

**GLP-1 goal module** (onboarding goal "I'm on GLP-1 therapy"):
1. Default floors for protein, fluid, fiber and energy, proposed as commonly recommended values with "confirm with your
   doctor"; the user confirms or edits.
2. Medication in the profile (drug, injection weekday, weekly rhythm); each dose change logged as point metric
   `glp1_dose` (mg). Doses are never advised.
3. Symptoms as point metrics, scale 0–4: `appetite`, `nausea`, `constipation` — logged through the existing
   `log-health-data` (chat sentence or "Log value"); also useful outside GLP-1.
4. Relationships the coach watches: intake by day since injection, nausea after fatty meals, weight loss above
   1 %/week (existing rule), lean-mass trend together with strength training.
5. Optional afternoon nudge through existing notifications ("50/120 g protein — a skyr and a handful of nuts will do"),
   in the persona's tone.

## 8. UI

- New route `/food` ("Jedálniček" in navigation): today's `nutrition` tiles (same component as the widget), today's
  meals by meal type as meal cards (photo, items, totals; tap an item to edit the amount, optimistic recompute; menu:
  Repeat, Delete), day switcher.
- One primary action **Add meal**: Photo (opens the coach sidebar with the photo, §5), Barcode (camera scan in the PWA →
  `search-foods` → amount dialog, no coach), Search (autocomplete, recent and favourites first → amount, no coach).
- **One meal-card component** for chat (`log-meal` result), `/food` and the `meals` widget — the `HealthWidget` pattern.
- Onboarding adds a `nutrition` widget to the dashboard when the user has a nutrition-related goal.

## 9. Testing

Vitest against PGlite, as elsewhere:
- Import: small fixture extracts of USDA, CIQUAL and BLS → nutrient mapping, unit conversion, idempotent re-import.
- `search-foods`: Slovak, English and misspelled names; source ranking; barcode; Open Food Facts from recorded fixtures.
- `log-meal` / `delete-meal`: nutrients from grams and portions; snapshot unchanged after a reference update; `intake_*`
  totals after create, edit, delete and copy; another user's `mealId` cannot be touched.
- Health import: VITLS-sourced records skipped; same-day VITLS + imported meals → totals from VITLS.
- Targets: tile states for min, max and range; dynamic energy from active energy.
- Photos: private-blob encrypt/decrypt against local storage; reading another owner's photo fails; client EXIF/GPS strip.
- Then: `security-audit` of the new photo and export endpoints (as for ingest) and an end-to-end photo log in the browser.

## 10. Reducing-entropy check

Mindset: *data over abstractions* — nutrients in long format beside the metric catalog; daily intake as plain metrics
so every chart, widget and trend works unchanged; one meal-card component; photo recognition done by the existing coach
agent instead of a second vision pipeline (agent-native: no inline LLM calls in actions).
Not built: a separate nutrition analytics layer, a merged "golden record" across food sources, a dedicated vision
service, recipes, meal plans.

## 11. Open items

- EU data-processing terms for photos sent to the model provider.
- Production EU object storage provider.
- Chat attachment → private-blob path (spike, §6).
