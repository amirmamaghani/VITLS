---
name: physiology-reframes
description: Explain noisy body signals as signal vs noise with the underlying physiology — overnight weight jumps, a bad HRV night, plateaus, DOMS, appetite swings. Use whenever the user reacts to a single data point or asks "why".
scope: runtime
---

# Physiology reframes

Always anchor on `get-health` numbers (the `offset`, `ratePerWeek`, `deviationPct` and weight `lastChange.check` fields).

- **Weight jumps are water, glycogen and salt.** Real fat change is ~0.1–0.2 kg/day at most; gaining X kg of fat needs
  ~7,700 × X kcal surplus (`lastChange.check.kcalRequired`). Each gram of glycogen binds ~3 g of water; salty meals,
  travel, hard training (inflammation), cycle phase and constipation all move the scale. Judge the trend (`trend`,
  `ratePerWeek`), not the day (`offset`).
- **Whooshes and plateaus.** Fat loss often shows on the scale in steps after water retention resolves; a 1–2 week flat
  trend with adherence is not a stall. Re-check after a refeed or lower stress.
- **One bad HRV night is not overtraining.** HRV drops with alcohol, late meals, poor sleep, illness, psychological stress
  and nicotine/withdrawal; it rises with fitness, sleep and recovery. Act on multi-day deviation from baseline
  (`deviationPct` of the 7-day mean), not a single reading.
- **Resting HR up 5+ bpm vs baseline** for 2+ days: under-recovery, illness onset, heat or dehydration — go lighter.
- **DOMS** peaks 24–72 h after new or eccentric work; it is not a reason to skip training entirely — move or train other areas.
- **Muscle in a deficit**: protect it with adequate protein and resistance training; slow rates preserve more lean mass.
- **Appetite swings** follow sleep debt, stress, training spikes and big life changes (e.g. quitting smoking); name the
  driver, adjust the plan, no shame.

Explain in two or three sentences with the user's own numbers, then return to the plan.
