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
    verb: 'willCreate',
    description: 'Do a count using the provided data`s title to make sure no other records exist with that title',
    priority: 10,
    prerequisites: [
        {
            context: {
                verb: 'count'
            },
            /**
             *
             * @param {object} parameters
             * @param {any} parameters.data the data object as provided to the parent rule
             * @returns
             */
            query: async ({ data }) => {
                return { title: data.title };
            }
        }
    ],
    /**
     * @param {object} parameters
     * @param {any} parameters.data the data object to work on
     * @param {any[]} parameters.prerequisiteResults Array of resulting objects from each prerequisite, or an empty array if there were none.
     * @param {Context} parameters.context the context for the current request
     * @param {WorkflowStack} [parameters.workflowStack] for debugging only, the workflowStack as applicable at the start of executing `logic()` I.e. the current rule is marked with _ACTIVE, if enabled.
     * @param {LoggingProvider} parameters.log Logging object to output your logging needs
     **/
    logic: async ({ data, prerequisiteResults, context, workflowStack, log }) => {
        const [countResult] = prerequisiteResults;
        if (countResult > 0) {
            const message = `Duplicate Exception: another ${context.namespace}/${context.relation} with the same title already exists.`;
            log.warn(message, context, workflowStack);
            throw new Error(message);
        }
        return data;
    }
};
