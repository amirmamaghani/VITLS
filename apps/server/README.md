# @vitls/server

NestJS backend (devices pairing, health ingest, BetterAuth magic link).

## Run

```sh
pnpm infra:up                      # Postgres/Timescale + Mailpit
DATABASE_URL=postgres://vitls:vitls@localhost:5435/vitls \
BETTER_AUTH_SECRET=<32+ chars> BETTER_AUTH_URL=http://localhost:3001 \
VITLS_FIELD_KEYS=k1:<base64 32 bytes> PORT=3001 \
pnpm --filter @vitls/server dev
```

Migrate first with `pnpm --filter @vitls/server db:migrate`.

## Test

`pnpm --filter @vitls/server test` (needs `vitls_test` DB up; `pretest` migrates it). Stop any dev server first.
`test/e2e-gccli.spec.ts` spawns the real `gccli-sync` pair client against the app, then pushes a batch with the issued token.
