/* eslint-disable no-unused-vars */
/* eslint-disable no-console */
module.exports = {
    /**
     * Called with detailed debugging information
     * @param {string | object} message
     * @param {object} context
     * @param {object} [workflowStack] workflow Stack, if enabled
     */
    debug: (message, context, workflowStack) => console.log(message),

    /**
     *
     * @param {string} message
     * @param {object} context
     * @param {object} [workflowStack] workflow Stack, if enabled
     */
    info: (message, context, workflowStack) => console.info(message),

    /**
     * Called for logging expected error conditions
     * @param {string} warning
     * @param {object} context
     * @param {object} [workflowStack] workflow Stack, if enabled
     */
    warn: (warning, context, workflowStack) => console.warn(warning),

    /**
     * Called for unhandled errors.
     * @param {Error} error Javascript Error object. Note: this object is not serializable by default
     * @param {string} error.message
     * @param {string} error.stack
     * @param {object} context
     * @param {object} [workflowStack] workflow Stack, if enabled
     */
    error: (error, context, workflowStack) => console.error(error),
};
