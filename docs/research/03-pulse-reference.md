# PULSE — reference notes

PULSE (`../pulse`) is the personal prototype that inspired VITLS. It is an **idea source**, not a spec to port 1:1.
Everything hard-coded for one person there (phases, deficits, exercises, thresholds) becomes per-user settings,
goals or coach memory in VITLS.

## Generalisation principle (non-negotiable)

PULSE served exactly one person with one goal (a fat-loss cut with a V-taper focus). VITLS must serve **any user,
any physical goal, any combination of goals**. Therefore:

- No metric, threshold, target, constant or exercise is assumed universal; each is either physiology (shared engine)
  or a per-user parameter (goal, phase, target, preference) with sensible defaults.
- Goals are composable modules (fat loss, muscle gain, endurance, VO2max, strength, swim, longevity, …); each declares
  the metrics it needs, the widgets it contributes, its targets, and its coaching rules. New goals are additive.
- Every widget must work for a user with none of PULSE's data (no scale, no food log, no tape) and degrade gracefully.
- PULSE-specific content below is listed only as an example of *what kind* of thing a goal module contains.

## Data captured

- Weight log (date, weight, device BF%, source), food log (date, meal, item, qty, kcal, P/F/C, notes),
  activity log (type, distance, duration, kcal), tape measurements (shoulders, chest, waist, hips, L/R arms, L/R thighs, neck), weekly waist.
- Garmin via `gccli`: weigh-ins (weight, BF, muscle, water), activities, VO2max, RHR (+7d avg), active kcal, steps/goal,
  vigorous minutes, HRV (weekly avg, last night), fitness age.
- Manual overrides exist because devices miss data (gym-scale weigh-ins, unrecorded activities, strength sets without reps/load).

## Metric math worth generalising

- **Trend weight:** EMA α≈0.15; raw − trend = water/glycogen offset (±0.3 kg labels).
- **Stabilisation MAs:** EMA α≈0.06 ("30d"), α≈0.022 ("90d"); drift = 7d mean − 30d MA; macro = 30d − 90d.
- **Rate & implied deficit:** trend slope (kg/week) → `deficit ≈ −rate/7 × 7700`.
- **Fat vs water decomposition:** daily raw Δ = trend Δ (fat) + residual (water); plausibility ceiling ~0.1–0.2 kg real fat/day.
- **Body fat:** device BF% with EMA; lean = weight × (1 − BF); goal weight for target BF = lean / (1 − target).
  Alternative FFM-anchor method kept as an option.
- **TDEE:** maintenance (BMR + NEAT) + device active kcal; daily budget = TDEE − phase deficit; carbs fill the remainder after protein anchor + fat cap.
- **Projection:** exponential decay to a floor (`dW/dt = −k(W − floor)`), k fitted to current rate, slowdown factor; bands from residual percentiles; milestone dates.
- **Weekly OHLC candles** on trend (open/close) and raw (high/low).
- **Proportions:** shoulder:waist (V-taper), waist:height.

## Widgets observed

Today (macro tiles with met/short/within-limit/over states) · Training today (exercise list, sets×reps, cues, demo GIF + steps modal) ·
Overview KPIs (body / fitness / movement) · Cut & stabilisation tracker · Body measurements table + V-taper ·
Progress-to-goal bars · Trend charts (weight with fat/water vectors, MAs, goal lines, intake-vs-TDEE strip; BF%, muscle, water%,
training minutes, active kcal, ride volume, projection) · Weekly OHLC · Food log by meal + 7-day protein/kcal.

## Coach voice & behaviours

- Long-term coach and accountability partner; no generic motivation; analyse trends, challenge assumptions, explain trade-offs, evidence over myths; **ask when data is incomplete**.
- Never tell the user to push through pain; injury-aware exercise substitution.
- Signature reframe: overnight jumps are water/glycogen/salt — e.g. +1.2 kg fat in 4 days would need ~10,000 kcal surplus.
- Non-negotiable protein anchor; fat cap; deficit from carbs/volume; electrolytes before sugar.
- Anti-binge framing: every meal is independent; diet breaks/refeeds as tools.
- Rules designed to survive weak willpower.

## Lessons learned (design for correction)

1. Body-fat method changed several times (flat device correction → fixed InBody FFM anchor → re-anchored → device BF directly).
   A single scan anchor created false confidence; cross-check sources. → **BF method must be a per-user setting with history.**
2. Linear projections were too optimistic → decay-to-floor model.
3. Very aggressive average deficit risked rebound → phase-based deficits and anti-yo-yo MAs.
4. Phase decisions flip-flopped → phases need explicit rationale stored in memory.
5. Visual water-vs-fat explanation materially reduced panic over daily jumps.
6. Medication names were removed from docs → treat medication as sensitive; store minimally.
7. Waist tape is the BIA-independent truth check.
