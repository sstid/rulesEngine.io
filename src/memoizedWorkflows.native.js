const memoize = require('lodash.memoize');
module.exports = createWorkflow => memoize(createWorkflow, context => JSON.stringify(context));
