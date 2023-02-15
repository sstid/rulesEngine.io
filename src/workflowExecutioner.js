const cloneDeep = require('lodash.clonedeep');
const { taskToShortName, taskToDescription } = require('./workflowSerialization');
const { getChildContext } = require('./contextProvider');
/**
 * @typedef { import("./index").WorkflowStack } WorkflowStack
 * @typedef { import("./index").Context } Context
 * @typedef { import("./index").Rule } Rule
 * @typedef { import("./index").LoggingProvider } LoggingProvider
 */

/**
 *
 * @param {(data:object,context:object)=>Promise<void>} dispatch
 * @param {LoggingProvider} log
 * @param {object} options
 * @param {object} options.states
 * @param {string} options.states.success
 * @param {string} options.states.fail
 * @param {boolean} options.enableWorkflowStack
 * @returns {Promise<any>}
 */
function prepareEngine(dispatch, log, { states, enableWorkflowStack }) {
    return {
        /**
         *
         * @param {object} data
         * @param {object} [data.query]
         * @param {object} [data.payload]
         * @param {Rule[]} workflow
         * @param {object} context
         * @param {string} context.verb
         * @param {string} context.namespace
         * @param {string} context.relation
         * @param {string} [context.status]
         * @param {string[]} [context.featureFlags]
         */
        execute: async function execute(data, workflow, context) {
            // If requested, pass the workflow in as stack as well (by reference).
            // As we update steps on the workflow, it will reflect on the stack as well
            const workflowStackSeed = enableWorkflowStack ? workflow : undefined;
            log.info(`== Executing workflow for ${taskToShortName(context)} ==`, context, workflowStackSeed);
            try {
                const result = await _executeWorkflow(data, context, workflow, workflowStackSeed, false);
                log.info(`== Workflow finished for ${taskToShortName(context)} ==`, context, workflowStackSeed);
                return result;
            } catch (error) {
                log.error(
                    humanizeError(`== Workflow failed for ${taskToShortName(context)} ==`, error),
                    context,
                    workflowStackSeed
                );
                throw error;
            }
        }
    };

    /**
     *
     * @param {object} data
     * @param {*} context
     * @param {Rule[]} workflow
     * @param {Rule[]} workflowStack
     * @param {boolean} [isPrerequisiteWorkflow] false on the first call (to the base-workflow), true for any prerequisite workflows
     * @returns
     */
    async function _executeWorkflow(data, context, workflow = [], workflowStack, isPrerequisiteWorkflow = true) {
        let output;
        if (workflow.length < 1) {
            log.debug('Empty workflow.');
            return data;
        }

        for (let i = 0; i < workflow.length; i++) {
            const step = workflow[i];
            // prefer previous output as input for next step.
            output = { data, context, ...output };
            if (output.error) {
                if (enableWorkflowStack) {
                    step._SKIPPED = true;
                    delete step.prerequisites;
                }
                output = { error: output.error };
            } else {
                if (enableWorkflowStack) {
                    step._ACTIVE = true;
                }
                try {
                    //`_executeStep` _ALWAYS_ returns `{ data, context }`, or else some sort of error is thrown
                    //and if we don't await it here we can't handle the error here
                    output = await _executeStep(step, output.data, output.context, workflowStack);
                } catch (error) {
                    if (enableWorkflowStack) {
                        step._ABORTED = error.message;
                    }
                    output = { error };
                } finally {
                    if (enableWorkflowStack) {
                        delete step._ACTIVE;
                    }
                }
            }
        }

        if (output.data && workflow.length) {
            //dispatch success
            await _dispatchSuccess(output.data, output.context || context, workflowStack);
        } else if (output.error && workflow.length) {
            // dispatch fail
            await _dispatchFailure(data, output.error, output.context || context, workflowStack);
            if (!isPrerequisiteWorkflow) throw output.error;
            return output;
        }
        return output.data;
    }

    /**
     *
     * @param {Rule} step
     * @param {any} data
     * @param {Context} context
     * @param {WorkflowStack[]} [workflowStack]
     * @returns {Promise<{data:any,context:Context}>}
     */
    async function _executeStep(step, data, parentContext, workflowStack) {
        const context = getChildContext(parentContext, step);
        log.info(`Starting ${taskToDescription(step)}`, context, workflowStack);
        try {
            //execute prerequisites
            const prerequisiteResults = await Promise.all(
                (step.prerequisites || []).map(preReqWorkflow =>
                    _executeWorkflow(data, context, preReqWorkflow, workflowStack)
                )
            );

            log.info(`Executing ${taskToShortName(step)}`, context, workflowStack);

            //clone data to leave original message unchanged.
            const clonedData = cloneDeep(data);
            //execute step itself
            let result = await step.logic({
                data: clonedData,
                prerequisiteResults,
                context,
                workflowStack,
                dispatch,
                log
            });

            //figure out what was exactly returned
            if (!result) {
                //nothing
                result = { data, context };
            } else if (result.data) {
                //actually nested data
                result = { ...result, context };
            } else {
                //otherwise assume the entire object is just the returned data
                result = { data: result, context };
            }

            //log that we are done
            log.info(`Finished ${taskToShortName(step)}`, context, workflowStack);
            return result;
        } catch (error) {
            log.error(humanizeError(`${taskToShortName(step)} failed.`, error), context, workflowStack);
            if (step.onError) {
                log.info(`Processing custom error handling for ${taskToShortName(step)}.`, context, workflowStack);
                let errorHandlingResult = await step.onError({ error, data, context, workflowStack, dispatch, log });
                if (!errorHandlingResult) {
                    throw new Error(
                        `'${taskToShortName(step)}.onError' should either throw an error, or produce a result`
                    );
                }
                if (!errorHandlingResult.data) {
                    //assume the entire object is just the returned data
                    errorHandlingResult = { ...errorHandlingResult, context };
                }
                return errorHandlingResult;
            } else {
                throw error;
            }
        }
    }

    /**
     * Dispatch a `__success` message
     */
    async function _dispatchSuccess(data, context, workflowStack) {
        // Don't go in a never ending loop for success
        if (context.status) {
            return;
        }
        //but for anything else, dispatch:
        try {
            await dispatch(data, { ...context, status: states.success });
        } catch (error) {
            log.error(humanizeError('Failed to send success dispatch.', error), context, workflowStack);
        }
    }

    /**
     * Dispatch a `__fail` message
     */
    async function _dispatchFailure(data, error, context, workflowStack) {
        //no failure dispatch of failed successes or failures
        if (context.status) {
            return;
        }
        try {
            await dispatch({ ...data, error }, { ...context, status: states.fail });
        } catch (error) {
            log.error(humanizeError('Failed to send failure dispatch.', error), context, workflowStack);
        }
    }
}

function humanizeError(humanMessage, error) {
    const humanError = new Error(`${humanMessage} - ${error.message}`);
    humanError.stack = humanMessage + ' ' + error.stack;
    return humanError;
}

module.exports = { prepareEngine };
