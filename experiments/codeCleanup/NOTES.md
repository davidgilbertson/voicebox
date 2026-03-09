# Code Cleanup Notes

## Goal

First pass at a static analyzer that finds parameters which appear to be optional in practice because no resolved caller passes an argument for them.

## Current scope

1. Starts from `src/main.jsx` and follows reachable relative JS/JSX imports.
2. Parses files with Babel, including JSX and class fields.
3. Collects top-level functions, exported functions, classes, and class methods.
4. Resolves direct identifier calls and a small amount of method dispatch.
5. Resolves class-internal `this.method()` calls.
6. Resolves simple instance aliases from `const x = new Class()` and hooks like `useState(() => new Class())`.
7. Resolves prop-backed member calls when a JSX prop is consistently fed from a known local class instance.
8. Writes JSON artifacts and logs findings.

## Intentional omissions

1. Dynamic imports are not traversed.
2. Dynamic property access like `obj[methodName]()` is ignored.
3. JSX element usage is only handled for simple `<Component />` identifiers, not member expressions like `<Foo.Bar />`.
4. Indirect calls through hooks, containers, or higher-order wrappers are mostly unresolved.
5. Nested local functions are not first-class analysis targets yet.
6. Spread arguments lower confidence because positional certainty is lost after the spread.

## Failed or deferred ideas

1. Starting with an AI summary file first would hide the important part, which is evidence quality. JSON plus a console report is a better first artifact.
2. Building a full precise call graph for plain JS is possible, but it is not a sensible first step here.

## Observations from seeding fake params

1. A collector bug initially skipped `export function ...` declarations, which hid cross-file findings like `clamp` and `installFocusVisibilityPolicy`. That is now fixed.
2. The current heuristic is good at catching trailing optional params that are never supplied.
3. It will also flag defaulted leading params when no resolved caller passes them, which is sometimes useful and sometimes noisier than the original cleanup goal.
4. For React function components, JSX should be treated like a one-argument call because the component receives a props object even when there are no JSX attributes.
5. Simple hook-backed class instances now resolve, which was enough to catch engine method calls in `AppShell`.
6. Class-internal `this.method()` dispatch is a larger chunk than expected in this repo and moved coverage noticeably.
7. Prop-backed engine calls inside components like `SettingsPanel`, `Recorder`, and `ScalesPage` are resolvable when the prop source is a stable local class instance.

## Good next steps

1. Track simple aliases like values returned from `useState(() => new Foo())`.
2. Support nested local functions.
3. Distinguish "never passed" from "only ever passed `undefined`".
4. Emit confidence levels per finding.
5. Expand JSX support to member components and better prop-shape reasoning.
