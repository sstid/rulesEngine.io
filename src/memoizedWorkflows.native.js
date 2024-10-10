const { memoize } = require('lodash');
module.exports = createWorkflow => memoize(createWorkflow, context => JSON.stringify(context));
