# Changelog

## 2.0.0

### Breaking

-   A compiled prerequisite workflow must carry a `prereqContext` property. The engine throws `Prerequisite workflow is missing prereqContext.` rather than falling back to the parent context. `createWorkflow` sets it; anything that hand-builds or clones a compiled workflow must set or copy it, because `cloneDeep` and `Array.prototype.map` both drop non-index array properties.
-   Every step of a prerequisite workflow runs under the verb the prerequisite declared. Previously the generated data-transformation step's `verb: 'TRANSFORMATION'` became the parent context of every step after it, including the context the prerequisite's success dispatch was called with. That step still keeps its own verb.
-   A prerequisite no longer inherits the parent's `status` or `action`. Previously a prerequisite declared on a `_success`-phase rule selected only `_success` rules, which is usually none, and compiled an empty workflow without saying so.

### Added

-   `when` on a prerequisite declaration: a fixed value, or a sync/async function receiving `({ data, context, parentContext, dispatch, log })`, evaluated before the prerequisite workflow starts. Falsy skips the prerequisite, its result slot is `undefined`, and the rule's `logic` still runs; only an omitted (`undefined`) `when` means "no gate". A `when` that throws leaves `{ error }` in the slot, unless the error is an abort (`aborted === true`), which leaves the slot `undefined` like every other abort path.
-   `parentContext` in the `logic` and `when` parameters: the context of the step that declared the prerequisite, before the prerequisite's own routing replaced it. `undefined` at the base level.
