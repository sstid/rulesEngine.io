const DEFAULT_EXCLUDED_FIELDS = ['onError', 'logic', 'prereqs', 'description'];

let _contextExcludedFields = [...DEFAULT_EXCLUDED_FIELDS];
// Lookup sets kept in sync with `_contextExcludedFields`. `getChildContext` runs once per step of
// every workflow, so the exclusion test must not allocate — building `['verb', ...fields]` on each
// call was itself measurable.
let _excluded = new Set(_contextExcludedFields);
let _excludedPlusVerb = new Set(['verb', ..._contextExcludedFields]);

const _private = {
    reset: () => {
        _contextExcludedFields = [...DEFAULT_EXCLUDED_FIELDS];
        _syncExclusionSets();
    }
};
module.exports = { setContextExcludedFields, getContextExcludedFields, getChildContext, omitKeys, _private };

function setContextExcludedFields(fields = []) {
    _contextExcludedFields = [..._contextExcludedFields, ...fields];
    _syncExclusionSets();
}
function getContextExcludedFields() {
    // prevent mutation of the original reference.
    return [..._contextExcludedFields];
}

function _syncExclusionSets() {
    _excluded = new Set(_contextExcludedFields);
    _excludedPlusVerb = new Set(_contextExcludedFields);
    _excludedPlusVerb.add('verb');
}

/**
 * Copy `source`'s enumerable keys onto `target`, skipping `excluded`. Replaces a lodash `omit` +
 * spread on the hottest path in the engine: `omit` copies every key into a throwaway object and
 * then unsets, and it re-parses each excluded field as a possible deep path on every call.
 *
 * Deliberate narrowings vs `omit`: exclusion is by top-level key name only (a dotted field is not
 * interpreted as a path), and symbol keys are not copied. Context objects are plain routing data,
 * and a symbol key could never be named in the string exclusion list anyway.
 */
function _assignExcluding(target, source, excluded) {
    if (source == null) return target;
    // `for…in` walks own + inherited enumerable string keys, matching lodash's `getAllKeysIn`.
    for (const key in source) {
        if (!excluded.has(key)) target[key] = source[key];
    }
    return target;
}

/**
 * Drop-in replacement for `_.omit` at the call sites in this package, but NOT lodash-parity:
 * `excludedKeys` is a **Set**, not an array, and the narrowings in `_assignExcluding` apply
 * (top-level key names only — no deep paths; no symbol keys).
 *
 * Beyond being cheaper, this avoids lodash `omit`'s `delete`-based construction, which tips its
 * result into **dictionary mode**. That matters even on cold call sites whose *output* reaches the
 * hot path: `workflow.prereqContext` is built once at workflow-build time but spread
 * (`{ ...context, ...routing }`) on every prerequisite of every message, and spreading a
 * dictionary-mode object measured 7.4× slower.
 *
 * @param {object} source
 * @param {Set<string>} excludedKeys hoist this to a module constant — do not build one per call
 */
function omitKeys(source, excludedKeys) {
    return _assignExcluding({}, source, excludedKeys);
}

function getChildContext(parentContext, step) {
    // TRANSFORMATIONs interleave between the context that is defined with a prereq and
    // the actual rule fulfilling the prereq.  This means important things like namespace/relation/etc
    // that are part of the original prereq request's context will be lost if we don't do
    // something special here (TRANSFORMATIONS don't have namespace/relation/etc. so
    // they will wipe out those values).
    // We can't just recreate the context from the actual rule that fulfills the prereq because it
    // might (for instance) have a wildcard for namespace or relation.  We need the
    // original context from where the prereq is declared.
    // If this is called from workflowGenerator (probably for a prereq), it may have an
    // original context stored so that we can generate the correct values from that.
    const newContext = _assignExcluding({ ...parentContext }, step.originalContext, _excludedPlusVerb);

    // Read the two decision keys straight off the step rather than materializing a filtered copy of
    // it — most steps take a branch that never needs one. The `_excluded` checks keep the reads
    // honest: a caller may exclude any field, and an excluded key must read as absent.
    // `step` is always an object here (reading `.context` off a nullish step would already have
    // thrown), so `stepSource` needs no null guard of its own.
    const stepSource = step.context ?? step;
    const stepVerb = _excluded.has('verb') ? undefined : stepSource.verb;
    const stepOriginalContext = _excluded.has('originalContext') ? undefined : stepSource.originalContext;

    if (stepVerb === 'TRANSFORMATION') {
        newContext.verb = stepVerb;
    } else if (stepOriginalContext == null && stepVerb != null) {
        _assignExcluding(newContext, stepSource, _excluded);
    }
    return newContext;
}
