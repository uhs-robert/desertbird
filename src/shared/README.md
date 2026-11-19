# Shared

Code that the background page, the chrome runtime, the body script and the overlay all use. `protocol.ts` holds the message and Experiment call shapes.

## Files

- `swallow.ts`: one helper per reason a rejected promise is dropped (`ignore_refusal`, `best_effort`, `keep_chain`, `refused_as`, `warn_and_go`). The lint rule `no-restricted-syntax` in `eslint.config.mjs` bans a silent `.catch` or `.then` handler written inline, so use a helper and the name says why. The helpers are plain functions, because the body script bundle has a size guard. A handler passed as an identifier is not checked.
