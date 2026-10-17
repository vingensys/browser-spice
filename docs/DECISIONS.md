# Decisions

## Build tooling: stay without a bundler (decided 2026-10-17)

**Decision.** The app stays plain scripts listed in `js/scripts.json`, loaded in order by `js/boot.js`. No bundler in
the main app.

**Why.** No install step is the product's selling point; a clone is runnable by `npm run serve` or any static host.
`js/scripts.json` already gives ordered loading, cache busting, and the service worker's offline list from one file.
Every module is under 2,100 lines, and the unit tests load files directly in Node without a transform.

**Trigger to revisit.** Bundle only when one of these happens:
1. A feature needs a third-party library that is not a single self-contained file (a PDF writer, an XLSX writer, an Eagle / Altium parser stack).
2. The cold-load size passes about 3 MB of JavaScript, or first paint on a mid-range phone passes 3 s.
3. A TypeScript or JSX migration is agreed.

**How, when triggered.** Use esbuild as a dev dependency, and bundle *only the new heavy dependency* into one
lazily loaded file under `vendor/` (as `vendor/ngspice` already is), built by an `npm run vendor` step and committed
or fetched in `postinstall`. The core scripts stay unbundled. The service worker already caches whatever `scripts.json` and `vendor/` list.

**Not done on purpose.** Converting the global-class style to ES modules: it would touch every file and test for no user-visible gain.
