# VITLS

The AI coach that runs your whole body — reads your vitals, protects your progress, remembers your story, holds you accountable.
Domain: vitls.ai. PWA built on [agent-native](https://github.com/BuilderIO/agent-native).

## Layout

| Path | What |
|---|---|
| `apps/app` | The VITLS agent-native app (chat coach, agent-designed dashboards, integrations) |
| `apps/companion` | Thin Expo companion app — syncs Apple Health / Health Connect to VITLS (pairing, permissions, sync status) |
| `apps/web` | Marketing site for vitls.ai — Next.js, next-intl (en, sk, cs, es, it, ru), GSAP, liquid glass; agent instructions at `/llms.txt` |
| `packages/typescript-config` | Shared tsconfig presets |
| `docs/research` | Foundation research (framework map, reuse shortlist, PULSE notes, wearables) |
| `docs/decisions` | Decision log |
| `.claude/skills` | Dev skills; `agent-native-first` gates every app change, `expo-overview` routes every companion change (Expo skills tracked in `skills-lock.json`, update with `npx skills update`) |

## Develop

Requires Node 22 (`.nvmrc`) and pnpm 12.

```bash
pnpm install
pnpm dev          # turbo run dev
pnpm typecheck
pnpm doctor       # agent-native doctor guards
pnpm web          # marketing site on :3000
```

## License

[AGPL-3.0](LICENSE). If you run a modified version as a network service, you must offer its source to your users.

Third-party data keeps its own license: `vendor/exercises-dataset` is a git submodule (`git submodule update --init`), and food data imported by `pnpm foods:import` comes from Open Food Facts (ODbL).
