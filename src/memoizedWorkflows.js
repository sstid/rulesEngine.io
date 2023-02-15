const memoize = require('memoizee');

module.exports = (createWorkflow, cacheAge) =>
    memoize(createWorkflow, {
        maxAge: cacheAge,
        promise: true,
        normalizer: context => JSON.stringify(context)
    });
