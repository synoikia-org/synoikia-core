# TypeScript

The compiler settings are in `tsconfig.base.json`: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `NodeNext` modules. Don't change them per plugin.

## Imports and modules

- Use `import type` for anything used only as a type. Put a `.js` extension on every relative import.
- Relative paths only, no path aliases. Node built-ins with the `node:` prefix.
- A plugin's `src/` keeps the layout of the others: `index.ts` calls `runPlugin()`, `plugin.ts` builds the handlers with `definePlugin`, and `auth.ts` signs the requests. A `client.ts` talks to the upstream, and a `catalog.ts` turns discovery and `plugin.yaml` into operations. Add a file only when a second concern appears.
- Plugin-facing types (`PluginHandlers`, `OperationDescriptor`, …) come from `@synoikia/plugin-sdk`. Don't redeclare them.

## Upstream data is `unknown`

- Type responses, events and specs as `unknown` and narrow them with `isPlainObject`, `requireString`, `requireField` or a small type guard. No `any`.
- Avoid `as`. When a cast is needed (a library gap, a record already checked), keep it next to the check that makes it true. `x!` is fine only right after a check or for a test fixture.
- `satisfies` to check an object literal against a type without widening it.
- With `noUncheckedIndexedAccess`, handle the `undefined` from `arr[i]` and `record[key]` (`?.`, `??`, an early return) rather than asserting it away.
- A shape the code doesn't recognize fails closed: redact it or throw, don't pass it on.

## Errors

- Throw `PluginError` with an `ErrorCodes` value for failures core should see. Use `upstreamError` and `errorMessage` to map upstream failures. Messages name the operation and the cause, never a secret or a raw upstream body.
- Return a discriminated union (`{ ok: true; … } | { ok: false; reason: … }`) for an expected outcome the caller branches on. Don't add a generic `Result<T, E>` type or library.
- `catch (err)` gives `unknown`: narrow with `instanceof` or use `errorMessage(err)`.

## Functions and data

- Prefer plain functions and object literals. Use a class only for a client with state (a connection, a session, pending requests).
- Small pure helpers over clever generics. Add a type parameter only when two real callers need it.
- Fixed sets of values: an `as const` array and a union derived from it, never an `enum`.
- Constants that are policy (limits, timeouts) live in `plugin.yaml` when they are plugin settings, else `UPPER_SNAKE` at the top of the module that owns them.
