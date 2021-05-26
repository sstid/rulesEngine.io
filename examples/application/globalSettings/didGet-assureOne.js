/**
 * @typedef { import("../../../src/index").WorkflowStack } WorkflowStack
 * @typedef { import("../../../src/index").Context } Context
 * @typedef { import("../../../src/index").Rule } Rule
 * @typedef { import("../../../src/index").LoggingProvider } LoggingProvider
 */

/**
 * @type {Rule}
 */
module.exports = {
    verb: 'didGet',
    namespace: 'application',
    relation: 'globalSettings',
    description: 'Assure there is always a global settings object.',
    priority: 10,
    prerequisites: [
        {
            context: {
                verb: 'create'
            },
            /**
             *
             * @param {object} parameters
             * @param {any} parameters.data the data object as provided to the parent rule
             * @param {Context} parameters.context the context for the current request
             * @param {LoggingProvider} parameters.log Logging object to output your logging needs
             * @returns
             */
            payload: async ({ data, log, context }) => {
                // if doingGet obtained (at least) one record, we don't need to do anything:
                if (data && Array.isArray(data) && data.length) {
                    throw new Error('Global Settings already exist. No need to create a new one.');
                }
                log.info(`Creating new global settings for ${context.tenantTitle}.`);
                // but if no globalSettings object existed, create a default one
                return { title: 'Global Settings', timeout: 500 };
            }
        }
    ],
    /**
     * @param {object} parameters
     * @param {any} parameters.data the data object to work on
     * @param {any[]} parameters.prerequisiteResults Array of resulting objects from each prerequisite, or an empty array if there were none.
     * @param {Context} parameters.context the context for the current request
     * @param {WorkflowStack} [parameters.workflowStack] for debugging only, the workflowStack as applicable at the start of executing `logic()` I.e. the current rule is marked with _ACTIVE, if enabled.
     * @param {(data:object,context:Context)=>Promise<void>} parameters.dispatch the dispatch function to emit events
     * @param {LoggingProvider} parameters.log Logging object to output your logging needs
     **/
    logic: async ({ data, prerequisiteResults }) => {
        const [newGlobalSettings] = prerequisiteResults;
        return [].concat(data).concat(newGlobalSettings);
    }
};
