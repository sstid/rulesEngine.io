const { getChildContext } = require('./contextProvider');
const { workflowToString, workflowToJSON, taskToDescription, taskToShortName } = require('./workflowSerialization');

const TRANSFORMATION = 'TRANSFORMATION';
const pick = require('lodash.pick');
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
                const prereqContext = getChildContext(context, prereq.context);
                const prereqWorkflow = await createWorkflowForVerb(prereqContext);
                //if the prerequisite has a transformation to apply to the data before running the prerequisite workflow
                //prepend that transformation as an ad-hoc task to the prerequisite workflow
                // eslint-disable-next-line no-unused-vars
                const { context: __stripped, ...prereqPayload } = prereq;
                const description = `Data transformation towards ${taskToShortName(prereqContext)}`;
                const verb = TRANSFORMATION;
                return [
                    {
                        verb,
                        description,
                        logic: async ({ data, context, dispatch, log }) => {
                            const result = {};
                            const prereqContext = getChildContext(context, { ...prereq.context, verb, description });
                            for (const [key, value] of Object.entries(prereqPayload)) {
                                result[key] = await getObjectOrFunctionResult(value, {
                                    data,
                                    context: prereqContext,
                                    dispatch,
                                    log
                                });
                            }
                            return result;
                        }
                    }
                ].concat(prereqWorkflow);
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
