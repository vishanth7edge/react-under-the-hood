# React Under the Hood

A teaching tool that lets students step through what React does after one interaction: state update → render →
reconciliation → commit → browser DOM.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # model tests (reconciliation, keys, memo, effects, interrupted render)
npm run build
```

## The screen

| Panel | What it shows | Source |
| --- | --- | --- |
| **A · Interactive React app** | A real React 19 component, plus a log of real renders, commits, effects and DOM mutations (MutationObserver) | Observed |
| **B · Component state & hooks** | The focused fiber's hook list, previous → next state, and the update queue (applied / skipped / waiting, with lanes) | Model |
| **C · Virtual DOM & Fiber** | React elements from the previous vs next render, and the current and work-in-progress fiber trees (hover to see alternates) | Model |
| **D · Reconciliation & diff** | Previous vs next children with reuse / move / insert / delete decisions, and why | Model |
| **E · Browser DOM** | The DOM before the update and at the current step, nodes built off-screen, and every commit mutation | Model |
| **F · Execution debugger** | Reset · Back · Play/Pause · Forward · Speed · Inspect node, the pipeline (Trigger → … → Effects, plus an Abandoned branch) and a clickable timeline | — |

Click any fiber, DOM node, diff row, mutation or effect to open the inspector. Keyboard: `←` `→` step, `Space`
play/pause, `R` reset, `Esc` close the inspector.

## Scenarios

1. **State & hooks**: `Counter`. One click: the update is queued on hook 1, processed during render, and only the `"0"` text node changes.
2. **Lists & keys**: reorder + add with keys (reuse, move, insert) vs without keys (the ticked state stays at position 0 and lands on the wrong task, in both the model and real React).
3. **Props & re-renders**: a parent re-render renders a plain child (with no DOM change) and bails out of a `memo()` child.
4. **Effects timing**: `useLayoutEffect` before paint, `useEffect` after commit. The observed log shows React flushing passive effects early for a click.
5. **Interrupted render**: `startTransition` with a slow list. "Fast typing" sends two keystrokes 15 ms apart. The first transition render is abandoned, the urgent text update commits, then the transition restarts. The real app's log shows the uncommitted render too.

## Observed vs simulated

React DevTools has no supported API to pause and single-step Fiber work, so panels B–E replay a small educational
renderer in `src/model/`. It follows React's design (double-buffered fibers, begin/complete work, keyed child
reconciliation with `lastPlacedIndex`, lanes, mutation/layout/passive commit phases) but it is **not** React's source,
and React's real internals change between versions. Panel A is real React, and every step is labelled
**Observed · real React** or **Simulated · model**.

## Code map

- `src/model/renderer.ts`: the step-recording renderer (hooks, render, reconcile, commit)
- `src/model/scenarios.ts`: model components (with the JSX shown to students) and the action → trace scripts
- `src/live/LiveApps.tsx`: the real React versions of the same components
- `src/live/observed.ts`: render/commit logging and the MutationObserver
- `src/panels/`: panels A–F and the inspector

To add a scenario, write the model component in `scenarios.ts`, its real twin in `LiveApps.tsx`, an `Action` that
the live component emits, and a case in `ModelSession.apply`.
