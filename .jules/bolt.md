## 2024-04-12 - [Stats Calculation O(N^2) Bottleneck]
**Learning:** Found nested arrays lookup in stats iteration path inside `public/js/stats.js`. The functions doing loops on players used `Array.find` against a standings array resulting in O(N^2) complexity.
**Action:** Always replace `Array.find` inside loops with O(1) Map lookups when processing derived standings in stats engine.
## 2024-04-14 - [Stats MVP Sort O(N^2) Bottleneck]
**Learning:** Found redundant array reduce inside sort comparator in `public/js/stats.js` for `overallList`. `a.finishes.reduce` was computed on every comparison, resulting in inefficient sorting.
**Action:** Always pre-calculate derived metrics (like averages) outside of the `.sort()` comparator to keep the comparator O(1) time complexity.
## 2026-04-17 - [O(P^2 * R) Bottleneck in Game Scoring Loops]
**Learning:** Found that calculating O(N) derived values (like `minCardTotal` in Cabo) inside getter functions (`getRoundPoints`) called within nested rendering loops (iterating over rounds and players in `dashboard.js`) causes redundant O(P^2 * R) operations. This was amplified by inefficient `Object.entries().map().map()` intermediate array allocations in `applyRound`.
**Action:** Use a `WeakMap` to cleanly memoize derived data directly onto immutable state objects (like `roundData`), turning O(N) redundant calculations into O(1) lookups, and prefer `for...in` loops over chained array methods for critical calculation paths to avoid memory allocations.
## 2024-04-21 - [computeNightStats O(G*P*R) Recalculation on Render]
**Learning:** Found that `computeNightStats` in `public/js/stats.js` runs a heavy O(Games * Players * Rounds) operation every time the Recap screen renders or state updates. Because Firebase state syncing in `public/js/firebase.js` completely replaces the `games` object reference on any update to the room, we can use a WeakMap keyed by the `games` object to safely memoize this expensive calculation.
**Action:** Use `WeakMap` to memoize expensive derived state computations based on Firebase object references to skip redundant calculation cycles without creating memory leaks.

## 2024-05-02 - Layout Refactor: Fix Screen Scrolling and Sizing
**Learning:** Overlapping uses of `min-h-[100dvh]` on both the `#app` wrapper and inner screens (`home.js`, `winner.js`), combined with static `.screen` padding (`padding-bottom: 80px`), caused redundant vertical scrollbars on layout components designed to fit perfectly into the viewport.
**Action:** Changed `#app` to strictly `h-[100dvh]`, gave `.screen` a dynamic padding override `.no-nav` that disables the 80px bottom space when the router evaluates `bottom-nav` visibility, and converted internal screens to use `h-full` to respect the active container bounds.
## 2024-04-28 - [Memoizing roundPoints in Dashboard]
**Learning:** Found that `roundPoints` computation in `public/js/screens/dashboard.js` iterates over all rounds and players on every render. Because the dashboard re-renders frequently due to Firebase state syncs, this O(R*P) calculation causes unnecessary work and object allocation.
**Action:** Use a `WeakMap` keyed by the Firebase `game.rounds` object reference (storing both the result and a strict-equality check on the `playerIds` array) to memoize the computation. This prevents stale cache bugs when different state trees update asynchronously while avoiding redundant O(R*P) work on every render.
## 2024-05-18 - [isHost Synchronous localStorage Reads]
**Learning:** Found that `isHost()` in `public/js/state.js` reads `localStorage` synchronously. Because this function is called frequently during UI rendering cycles (e.g., in `recap.js`, `dashboard.js`), reading from disk repeatedly blocks the main thread unnecessarily.
**Action:** Always memoize synchronous `localStorage` reads in hot paths to prevent micro-stutters during UI rendering.
## 2024-05-25 - Prefetch vs Preload for background assets
**Learning:** Adding a `<link rel="preload">` for a heavy image asset that is NOT immediately visible on the initial screen (e.g., a sprite sheet for an overlay on a later page) is a performance anti-pattern. It forces the browser to prioritize that download, competing with critical CSS/JS and delaying the Largest Contentful Paint (LCP) of the initial screen.
**Action:** Always use `<link rel="prefetch">` for assets that are required for subsequent interactions or screens, allowing the browser to download them in the background during idle time without blocking the critical render path.
