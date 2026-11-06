# Design: body context (medications, symptoms, menstrual cycle, calendar widget)

Status: **DRAFT** · 2026-10-07

## 1. Scope and regulatory boundary

- **Goal:** the coach can explain *why* the user feels or measures the way they do. Medications/supplements, how the
  user feels (symptoms) and the menstrual cycle become **context** for the data VITLS already has (weight, sleep,
  HRV, intake, training). It is a diary plus descriptive patterns, not a separate tracker product.
- **Wellness software, not a medical device** (EU MDR / MDCG 2019-11, FDA General Wellness). VITLS records, stores,
  displays and *describes* data and supports lifestyle goals. The intended purpose — in copy, marketing and coach
  messages — never claims diagnosis, monitoring of a disease or treatment, or prediction. To be confirmed by a
  regulatory review before launch.

**In scope**
- Medication/supplement diary (name, unit, rhythm; doses as logged by the user).
- How-you-feel check-in: symptoms on a 0–4 scale, common and custom.
- Period log, cycle day, approximate next-period estimate for planning.
- Descriptive patterns by the coach ("nausea was higher on days 1–2 after the injection"), lifestyle tips tied to the
  user's goals.
- One reusable `calendar` widget (Flo-style month grid and compact weeks).

**Never (would make VITLS a medical device)**
- Fertile window, ovulation prediction, "safe days", pregnancy detection — no fertility or contraception purpose.
- Dose advice of any kind (increase, decrease, skip, titrate, move an injection).
- Calling a symptom a side effect / adverse event of a drug; drug safety or efficacy assessments; drug interactions as
  a feature.
- Risk scores, clinical alerts, detecting conditions from data (PCOS, cycle disorders, anemia, …), disease monitoring.
- Marketing claims such as "manage GLP-1 side effects" or "track your treatment".

**Not imported:** ovulation tests, sexual activity, pregnancy tests, cervical mucus, basal body temperature (inputs to
fertility features; BBT may be added later as context only).

## 2. Data model

Follows option 1 of the brainstorm: numbers go into the existing long-format metric tables; sensitive names go into
encrypted facts. No new metric tables.

**Metric catalog** (`packages/health-ingest/src/catalog.ts`):

| Key | Kind | Unit | Value |
|---|---|---|---|
| `symptom.<slug>` | point | `score` | 0–4. Slug is a short English name (`nausea`, `bloating`, `hair_loss`, …); same family for common and custom symptoms |
| `dose.<factId>` | point | unit from the fact (`mg`, `ug`, `count`, …) | one taken dose; current dose = last entry |
| `menstruation` | daily | `score` | 0 none · 1 spotting · 2 light · 3 medium · 4 heavy |

- The catalog learns **metric families**: a definition with a key prefix (`symptom.`, `dose.`) matches any suffix of
  `[a-z0-9_]{1,40}`. `dose.<factId>` is accepted only when the fact exists, belongs to the owner and has not been
  removed.
- The list of common symptom slugs lives in the coach skill (§3), not in code.

**Facts** — implements the `coach_facts` proposal from `02-data-model-and-ingest.md §7`, with one type for now:

```ts
coach_facts: { id, type: "medication", body: encryptedJson, created_at, updated_at, ...ownableColumns }
// body (encrypted)
{ name: string, unit: CanonicalUnit, rhythm: { kind: "daily" } | { kind: "weekly", weekday: 1-7 } | { kind: "as_needed" },
  endedAt?: YYYY-MM-DD }
```

- One type covers medications and supplements (same shape). Contraception is a medication fact.
- Dose history is the `dose.*` rows; a change of dose needs no fact change.
- Removing a fact deletes the fact and all its `dose.<factId>` rows (right to erasure).
- Other fact types (`condition`, `injury`) stay an open item of `02 §7`.

**Derived on read** (pure function in `shared/`, used by `get-health` and the widget):
- `cycle = { day, avgLength, nextEstimate }` from period starts (a start = first `menstruation ≥ 1` day after ≥ 5 days
  without). Returned only after ≥ 2 recorded starts; `avgLength` = mean of the last up to 6 cycle lengths;
  `nextEstimate` = last start + `avgLength`. No phases are stored or computed in code; the coach describes phases in
  text from `day` and `avgLength`.
- Days since a dose are computed by the coach from the `dose.*` timestamps returned by `get-health`.

**Import:** the companion maps HealthKit `menstrualFlow` and Health Connect `MenstruationFlowRecord` /
`MenstruationPeriodRecord` to `menstruation` (unspecified → 2).

## 3. Coach

**Actions**

| Action | Change |
|---|---|
| `save-medication` (new) | `{ id?, name, unit, rhythm, endedAt?, remove? }` — create, edit, end or remove a medication/supplement fact. `remove` also deletes its doses. |
| `get-coach-profile` | Returns active medications (`id, name, unit, rhythm`), so they appear in `<coach-profile>` every turn. |
| `log-health-data` | No code change; description mentions `symptom.<slug>`, `dose.<id>`, `menstruation`. |
| `get-health` | Returns the new metrics and `cycle` when available. |

**Chat flows**
- "I took 5 mg" → `log-health-data` with `dose.<id>`.
- "I feel sick and bloated" → ask for 0–4 (or `ask-question` buttons) → `symptom.nausea`, `symptom.bloating`.
- "My period started" → `menstruation` (ask the flow if unclear).
- A new medication is never created silently: confirm name and unit, then `save-medication`.

**Onboarding** — stage `constraints` gains two optional questions: medications/supplements to track
(`save-medication`), and "Track your cycle? It helps me read swings in weight, sleep and energy" (yes / no / later; on
yes, ask for the start of the last period).

**Skill `body-context`** (new) plus a few lines in the boundary section of `apps/app/CLAUDE.md`:
- ✅ Describe co-occurrence in the data: "nausea was higher on days 1–2 after the injection", "weight tends to be ~1 kg
  higher in the second half of your cycle — usually water".
- ✅ General lifestyle tips tied to the user's goals (protein, smaller portions, fluids, sleep, strength training),
  never framed as treating a drug's effects.
- ❌ Never say a drug *causes* a symptom or call it a side effect; say it *occurs together / on those days*.
- ❌ Never suggest doses, stopping, moving an injection or changing contraception → "discuss this with your doctor".
- ❌ No fertile window, ovulation, safe days or pregnancy talk. Every period estimate says "approximate, not
  contraception".
- ❌ No diagnoses from data.
- 🚨 Safety redirect: a symptom at 4/4 or red-flag words (severe abdominal pain, blood, fainting, persistent vomiting)
  → one general sentence "please contact a doctor now / call 112"; no triage.
- Common symptom slugs: `nausea`, `appetite`, `digestion`, `reflux`, `energy`, `mood`, `headache`, `cramps`,
  `bloating`, `hot_flashes`.

**Morning readout** may use the context ("day 2 after your injection — last time protein fell short, have a skyr
ready"; "second half of your cycle, a higher weight is normal"). An injection-day reminder is a calendar reminder only,
through the existing `manage-notifications`.

## 4. UI

### `calendar` widget (one component, many places)

Replaces catalog v2 widgets **#5 `streak`** and **#25 `calendar` heatmap** (`07-widget-catalog.md`), and its blocks
`DotGrid` and `Heatmap`.

```ts
{ kind: "calendar",
  view: "month" | "weeks",      // Flo-style month grid | compact last `weeks` weeks (habit streaks, training heat)
  weeks?: number,               // 4–12, default 4; "weeks" view only
  marks: [{ metric: string, min?: number, max?: number, style: "fill" | "dot" | "heat" }],  // up to 3
  title?, wide? }
```

- **One data function** `calendarDays(rows, marks, cycle?) → { day, fill?, dots[], heat?, estimate? }[]` in `shared/`.
- **Rendering** (SVG/CSS, no recharts, three colours, no shadows, Monday-first):
  - `fill` — solid coral circle behind the day number, opacity by value (menstruation 1–4);
  - estimate — dashed coral ring on `cycle.nextEstimate` days (automatic when a mark uses `menstruation`);
  - `dot` — small ink/grey dot under the number (dose, symptom ≥ `min`, weigh-in);
  - `heat` — cell tint in opacity steps (training minutes, steps);
  - `min`/`max` met = dot; the current streak shows as the header figure (replaces `streak`);
  - today — thin ink ring.
- **Places:** dashboard (Cycle, Injections, Training, Habits presets), chat via `show-widget`.
- **Tap a day** → day detail (everything logged that day) → "Log value" sheet with that date prefilled (back-filling).
- **Month switch:** arrows in the header, fade/vertical transition; no horizontal sliding (product rule).

### Other UI
- "Log value" sheet: sections *How you feel* (symptoms 0–4 as segmented buttons, common slugs + custom), *Period*
  (0–4), *Dose* (pick from active medications).
- Medications list in profile settings (add / end / remove via `save-medication`).
- Symptom charts reuse the existing `line` view and `compare` (e.g. nausea vs protein intake).
- Doctor export stays with `export-health-report` (`06-nutrition.md`); it gains these metrics and the medication list.

## 5. Privacy

- Medication names, units and rhythms are encrypted (`encryptedJson`, `02 §6`). Metric values and keys are not (needed
  for SQL aggregation); generic keys (`menstruation`, `symptom.*`, `dose.<id>`) are protected like other health
  metrics: DB-at-rest encryption, TLS, owner scoping.
- **Open item (legal):** whether the signup consent for health data covers medications and the cycle (GDPR art. 9).
  If not, add one consent timestamp to the profile and gate these features on it.
- Account offboarding deletes facts with the other health data.

## 6. Changes to other designs

- `06-nutrition.md §7` GLP-1 module items 2–3: `glp1_dose` and the symptom metrics `appetite`, `nausea`,
  `constipation` are replaced by `dose.<factId>` and `symptom.<slug>`; medication lives in `coach_facts`, not the
  profile.
- `07-widget-catalog.md`: #5 `streak` and #25 `calendar` are replaced by the `calendar` widget here; `DotGrid` and
  `Heatmap` leave §4. The v2 implementation plan (`docs/superpowers/plans/2026-10-07-widget-catalog.md`) must drop those tasks before it is executed.

## 7. Testing

Vitest against PGlite, as elsewhere:
- Catalog: family keys accepted/rejected (`symptom.nausea` ok, `symptom.` / bad chars rejected, `dose.<foreign or
  removed id>` rejected).
- `save-medication`: create/edit/end; `remove` deletes the fact and its doses; body stored encrypted; owner scoping.
- `cycle`: none below 2 starts; start detection across spotting gaps; average of up to 6 cycles; estimate date.
- `calendarDays`: fill/dot/heat/estimate/streak for each mark style.
- Gallery renders `calendar` in both views with demo data and empty state; schema accepts the kind.
- Companion mapping test for menstruation flow; typecheck + doctor.
