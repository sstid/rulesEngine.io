const { getChildContext, omitKeys } = require('./contextProvider');
const { workflowToString, workflowToJSON, taskToDescription, taskToShortName } = require('./workflowSerialization');

const TRANSFORMATION = 'TRANSFORMATION';
const { pick } = require('lodash');

// Hoisted: `omitKeys` takes a Set, and building one per call would undo the point.
const STATUS_AND_ACTION = new Set(['status', 'action']);
/**
 *
 * @param {object} steps
 * @param {object} rulesRepository
 * @param {function} rulesRepository.find
 * @param {object} log
 * @param {function} log.info
 */
function prepareGenerator(steps, rulesRepository, log) {
    return {
        /**
         *
         * @param {object} context
         * @param {string} context.verb
         * @param {string} context.namespace
         * @param {string} context.relation
         * @param {string} [context.status]
         * @param {string[]} [context.featureFlags]
         * @returns { Promise<Rule[]> } Array of rules
         */
        createWorkflow: async function createWorkflow(context) {
            const workflow = await createWorkflowForVerb(context);

            /**
             * Returns a (multi-line) string representation of the workflow
             */
            workflow.toString = () => workflowToString(workflow, context);

            /**
             * Non-Idempotent serialization to JSON representation of workflow
             */
            workflow.toJSON = () => workflowToJSON(workflow);
            return workflow;
        }
    };

    async function createWorkflowForVerb(context) {
        if (!context || !context.verb) throw new Error('`context.verb` is required');
        const { verb } = context;
        if (!steps[verb]) throw new Error(`Invalid verb ${verb}`);
        log.info(`Building workflow for ${taskToShortName(context)}`, context);

        //look up what rules we have for each tense of the verb
        const arrayOfRulesArrays = await Promise.all(
            steps[verb].map(step =>
                rulesRepository
                    .find({
                        ...context,
                        verb: step
                    })
                    .then(rules =>
                        //limit the result to as little as possible to limit memory footprint (and not pollute/stuff the workflow stack)
                        rules.map(rule => {
                            const match = pick(rule, [
                                'verb',
                                'namespace',
                                'relation',
                                'status',
                                'description',
                                'prerequisites',
                                'logic',
                                'onError'
                            ]);
                            match.originalContext = context;
                            return match;
                        })
                    )
            )
        );
        //arrayOfRulesArrays is now an array, with containing possibly empty (sub) array for each of the verbs
        //we just need to string them together
        const applicableRules = arrayOfRulesArrays.reduce((acc, val) => acc.concat(val), []);
        return await Promise.all(applicableRules.map(rule => createWorkflowsForPrerequisites(rule, context)));
    }

    async function createWorkflowsForPrerequisites(rule, context) {
        if (!rule.prerequisites || !rule.prerequisites.length) return rule;
        const prerequisiteWorkflows = await Promise.all(
            rule.prerequisites.map(async (prereq, index) => {
                if (!prereq.context || !prereq.context.verb) {
                    throw new Error(
                        `Prerequisite ${index} for rule ${taskToDescription(
                            rule
                        )} should have a 'context' object, with a 'verb' property.`
                    );
                }
                // A prerequisite that does not declare status/action must not inherit the parent's:
                // a success-phase parent would otherwise select only _success prerequisite rules
                // (usually zero) and silently compile an empty prerequisite workflow. Values the
                // prerequisite declares itself still apply via the prereq.context merge below.
                const prereqContext = getChildContext(omitKeys(context, STATUS_AND_ACTION), prereq.context);
                const prereqWorkflow = await createWorkflowForVerb(prereqContext);
                //if the prerequisite has a transformation to apply to the data before running the prerequisite workflow
                //prepend that transformation as an ad-hoc task to the prerequisite workflow
                //(`when` is a gate consulted by the executioner, not a data transformation — strip
                //it here so it is never evaluated onto the step data)
                // eslint-disable-next-line no-unused-vars
                const { context: __stripped, when: __when, ...prereqPayload } = prereq;
                const description = `Data transformation towards ${taskToShortName(prereqContext)}`;
                const verb = TRANSFORMATION;
                const workflow = [
                    {
                        verb,
                        description,
                        logic: async ({ data, context, parentContext, dispatch, log }) => {
                            const result = {};
                            const prereqContext = getChildContext(context, { ...prereq.context, verb, description });
                            for (const [key, value] of Object.entries(prereqPayload)) {
                                result[key] = await getObjectOrFunctionResult(value, {
                                    data,
                                    context: prereqContext,
                                    // The declaring step's routing. `context` here is deliberately
                                    // the PREREQUISITE's — a callback resolving a query against the
                                    // prerequisite's own collection wants that — but a callback
                                    // that needs to know which collection the PARENT is acting on
                                    // (a wildcard rule has no declared constants to read instead)
                                    // has no other way to reach it.
                                    parentContext,
                                    dispatch,
                                    log
                                });
                            }
                            return result;
                        }
                    }
                ].concat(prereqWorkflow);
                // Routing seed for execution: the prerequisite's OWN declared context keys.
                // status/action are excluded — they must not overwrite the live values at execute
                // time. Sourced from prereq.context (the author's declaration), not the merged
                // prereqContext, which carries build-time per-request fields.
                // Built once per workflow build, but SPREAD per prerequisite per message by the
                // executioner — so it must be a fast-properties object, not a lodash `omit` result.
                workflow.prereqContext = Object.freeze(omitKeys(prereq.context, STATUS_AND_ACTION));
                // Gate for the whole mini-workflow, evaluated by the executioner BEFORE any of its
                // steps (including the TRANSFORMATION) run. Same clone caveat as prereqContext:
                // anything that rebuilds this array must carry the property across.
                if ('when' in prereq) workflow.when = prereq.when;
                return workflow;
            })
        );
        //`prerequisites` now is an array of arrays.
        //Each inner array is a "mini workflow" to resolve each prerequisite.
        //return the rule with the prerequisites workflows attached on it
        return { ...rule, prerequisites: prerequisiteWorkflows };
    }
}

async function getObjectOrFunctionResult(objectOrFunction, request) {
    if (objectOrFunction == undefined) return;
    if (typeof objectOrFunction === 'function') {
        return await objectOrFunction(request);
    }
    return objectOrFunction;
}

module.exports = { prepareGenerator };
