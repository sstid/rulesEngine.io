const { cloneDeep } = require('lodash');
const { taskToShortName, taskToDescription } = require('./workflowSerialization');
const { getChildContext } = require('./contextProvider');

const MISSING_PREREQ_CONTEXT_MESSAGE = 'Prerequisite workflow is missing prereqContext.';

// The verb of the ad-hoc step `workflowGenerator` prepends to every prerequisite mini-workflow.
const TRANSFORMATION = 'TRANSFORMATION';

// Most steps declare no prerequisites; share one frozen empty array instead of allocating per step.
const NO_PREREQUISITES = Object.freeze([]);

/**
 * A wiring error is a defect in how the workflow was built (or cloned), not a runtime step failure.
 * It must surface to the caller of `execute` at ANY nesting depth: it may not be absorbed by a
 * step's `onError`, may not be converted into a prerequisite result, and may not publish a
 * `_failure` message as though the workflow legitimately failed.
 */
function createWiringError(message) {
    const error = new Error(message);
    error.isWiringError = true;
    return error;
}
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
     * @param {object} [prereqRouting] the authoritative routing context (the prerequisite's declared
     *   keys) when this workflow is a prerequisite mini-workflow; namespace/relation from it win
     *   over any step.originalContext
     * @param {object} [declaringContext] the live context of the step that DECLARED this
     *   prerequisite, i.e. the parent's routing before `prereqRouting` overwrote it. Surfaced to
     *   rules as `parentContext`; see `_executeStep`.
     * @returns
     */
    async function _executeWorkflow(
        data,
        context,
        workflow = [],
        workflowStack,
        isPrerequisiteWorkflow = true,
        prereqRouting,
        declaringContext
    ) {
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
                    output = await _executeStep(
                        step,
                        output.data,
                        output.context,
                        workflowStack,
                        prereqRouting,
                        declaringContext
                    );
                } catch (error) {
                    if (enableWorkflowStack) {
                        step._ABORTED = error.message;
                    }
                    // A wiring error is not a step failure: do not turn it into `{ error }` (which
                    // would dispatch a _failure message and — inside a prerequisite mini-workflow —
                    // be handed to the parent rule as its prerequisite result). Let it escape.
                    if (error?.isWiringError) throw error;
                    output = { error };
                } finally {
                    if (enableWorkflowStack) {
                        delete step._ACTIVE;
                    }
                }
            }
        }

        if (output?.error?.aborted) {
            return output;
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
     * @param {Rule} step
     * @param {any} data
     * @param {Context} incomingContext the context this step starts from: the previous step's output context, or the workflow's seed context for the first step
     * @param {WorkflowStack[]} [workflowStack]
     * @param {object} [prereqRouting] the prerequisite's declared routing when this step runs inside a prerequisite mini-workflow; see `_executeWorkflow`
     * @param {object} [declaringContext] the context of the step that declared that prerequisite; surfaced to rules as `parentContext`
     * @returns {Promise<{data:any,context:Context}>}
     */
    async function _executeStep(step, data, incomingContext, workflowStack, prereqRouting, declaringContext) {
        const context = prereqRouting
            ? getPrereqStepContext(incomingContext, step, prereqRouting)
            : getChildContext(incomingContext, step);
        log.info(`Starting ${taskToDescription(step)}`, context, workflowStack);

        // A prerequisite workflow without its routing seed is a wiring error (hand-built workflow,
        // or a clone that dropped the array property). Validate ABOVE the try: this must fail the
        // workflow loudly, never be absorbed by the step's own onError handler.
        const prereqWorkflows = step.prerequisites || NO_PREREQUISITES;
        for (const preReqWorkflow of prereqWorkflows) {
            if (preReqWorkflow.prereqContext == null) {
                // A mini-workflow with no routing seed has no name of its own, so the only way to
                // point at it is by the step that declared it and its position in that step's list.
                // `indexOf` runs on the way out to the throw, so the healthy path pays nothing.
                throw createWiringError(
                    `${MISSING_PREREQ_CONTEXT_MESSAGE} Prerequisite ${prereqWorkflows.indexOf(preReqWorkflow)} of ${taskToShortName(step)}.`
                );
            }
        }

        try {
            //execute prerequisites under their own routing context (live parent ⊕ prereq routing)
            const prerequisiteResults = await Promise.all(
                prereqWorkflows.map(async preReqWorkflow => {
                    const routing = preReqWorkflow.prereqContext;
                    const seedContext = { ...context, ...routing };
                    // `when` gates the whole mini-workflow — evaluated before ANY of its steps
                    // (including the TRANSFORMATION) so a skipped prerequisite costs nothing.
                    // Falsy → the slot is `undefined` and the parent logic still runs. `undefined`
                    // is the ONLY value that means "no gate": the silo copies `when` across
                    // whenever it is not `undefined` (`setupRulesEngine.js`), so reading it any
                    // other way here would honour a gate on one side and drop it on the other.
                    // A throwing `when` behaves like a failing prerequisite (`{ error }` slot,
                    // parent continues) — consistent with a throw inside the sub-workflow.
                    if (preReqWorkflow.when !== undefined) {
                        let shouldRun;
                        try {
                            shouldRun =
                                typeof preReqWorkflow.when === 'function'
                                    ? await preReqWorkflow.when({
                                          data,
                                          context: seedContext,
                                          parentContext: context,
                                          dispatch,
                                          log
                                      })
                                    : preReqWorkflow.when;
                        } catch (error) {
                            // An abort is expected control flow wherever it is thrown, so it lands
                            // in the same `undefined` slot as an abort from inside the steps. Only
                            // a hard error leaves `{ error }`, which is how the parent's logic
                            // tells "skipped" from "broke".
                            if (error?.aborted) return undefined;
                            log.error(
                                humanizeError(
                                    `'when' failed for prerequisite towards ${taskToShortName(seedContext)}.`,
                                    error
                                ),
                                seedContext,
                                workflowStack
                            );
                            return { error };
                        }
                        if (!shouldRun) return undefined;
                    }
                    const prereqResult = await _executeWorkflow(
                        data,
                        seedContext,
                        preReqWorkflow,
                        workflowStack,
                        true,
                        routing,
                        // `context` is this step's OWN context — the parent routing, before
                        // `routing` overwrote namespace/relation on `seedContext`. It is the only
                        // point in the call chain where the parent routing is still available, so
                        // capture it here and hand it down as `parentContext`.
                        context
                    );
                    // An ABORTED prerequisite (a step threw with `.aborted === true`) resolves its
                    // slot to `undefined` — an abort is expected control flow ("skip this lookup"),
                    // and the parent's logic decides what a missing result means. A hard error is
                    // different on purpose: the slot keeps `{ error }` (and the sub-workflow has
                    // already dispatched a failure), so the parent can tell "skipped" from "broke".
                    return prereqResult?.error?.aborted ? undefined : prereqResult;
                })
            );

            log.info(`Executing ${taskToShortName(step)}`, context, workflowStack);

            //clone data to leave original message unchanged.
            const clonedData = cloneDeep(data);
            //execute step itself
            let result = await step.logic({
                data: clonedData,
                prerequisiteResults,
                context,
                // Only set inside a prerequisite mini-workflow, where `context` has been overwritten
                // with the prerequisite's own routing. A WILDCARD rule (one declaring no
                // namespace/relation) has no constant to fall back on, so without this there is no
                // way for a prerequisite to know which collection the parent step is acting on.
                // `undefined` at the base level, where `context` already IS the parent routing.
                parentContext: declaringContext,
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
            // Wiring errors escape a nested step's `onError` too — the guard above only protects
            // THIS step's prerequisites; one raised deeper in a prerequisite mini-workflow arrives
            // here through the `Promise.all` and must keep travelling.
            if (error?.isWiringError) throw error;
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

/**
 * Child context for a step running inside a prerequisite mini-workflow. The prerequisite's declared
 * routing is authoritative: a step's originalContext may be stale or rebound parentward by a cache
 * layer, and must not win collection selection.
 *
 * `verb` is part of that routing, with one exception — the generated TRANSFORMATION step keeps its
 * own verb, because that is how `getChildContext` recognizes it. Every OTHER step gets the verb the
 * prerequisite declared, exactly as the steps of a base workflow all see the base verb (a `get`
 * workflow's `willGet`/`doingGet`/`got` steps all run under `verb: 'get'`). Without this the
 * TRANSFORMATION step's context becomes the parent of every step after it and paints
 * `verb: 'TRANSFORMATION'` over the rest of the mini-workflow — including the context the workflow's
 * success `dispatch` is called with. A consumer that needs the real verb there is otherwise forced
 * to smuggle it forward on step data, which is a private convention the engine cannot honor for
 * anyone else.
 */
function getPrereqStepContext(incomingContext, step, routing) {
    // `getChildContext` always returns a freshly built object, so overwrite in place rather than
    // spreading it again — this runs once per step of every prerequisite mini-workflow and the
    // context is a wide object (tenant, role, correlation, …).
    const ctx = getChildContext(incomingContext, step);
    if (routing.namespace != null) ctx.namespace = routing.namespace;
    if (routing.relation != null) ctx.relation = routing.relation;
    // Read the step's own verb the way `getChildContext` does; `ctx.verb` cannot be tested instead,
    // since it reads TRANSFORMATION both for the transformation step and for every step that
    // inherited it.
    if (routing.verb != null && (step.context ?? step).verb !== TRANSFORMATION) ctx.verb = routing.verb;
    return ctx;
}

function humanizeError(humanMessage, error) {
    const humanError = new Error(`${humanMessage} - ${error.message}`);
    humanError.stack = humanMessage + ' ' + error.stack;
    for (const key in error) {
        if (Object.hasOwnProperty.call(error, key)) {
            humanError[key] = error[key];
        }
    }
    return humanError;
}

module.exports = { prepareEngine };
