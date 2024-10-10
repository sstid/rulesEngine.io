const { omit } = require('lodash');
let _contextExcludedFields = ['onError', 'logic', 'prereqs', 'description'];

const _private = {
    reset: () => {
        _contextExcludedFields = ['onError', 'logic', 'prereqs', 'description'];
    }
};
module.exports = { setContextExcludedFields, getContextExcludedFields, getChildContext, _private };

function setContextExcludedFields(fields = []) {
    _contextExcludedFields = [..._contextExcludedFields, ...fields];
}
function getContextExcludedFields() {
    // prevent mutation of the original reference.
    return [..._contextExcludedFields];
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
    let newContext = {
        ...parentContext,
        ...omit(step.originalContext, ['verb', ..._contextExcludedFields])
    };
    const stepContext = omit(step.context ?? step ?? [], _contextExcludedFields);

    if (stepContext.verb === 'TRANSFORMATION') {
        newContext.verb = stepContext.verb;
    } else if (stepContext.originalContext == null && stepContext != null && stepContext.verb != null) {
        newContext = { ...newContext, ...stepContext };
    }
    return newContext;
}
