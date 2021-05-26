/**
 *
 * @typedef {import('../index').RulesProvider} RulesProvider
 * @typedef { import("../index").Rule } Rule
 * @typedef { import("../index").Context } Context
 * @typedef { import("../index").RulesEngine } Context
 */

/**
 *
 * @param {Rule[]} rules
 * @returns { RulesProvider } RulesProvider
 */
module.exports = class RulesArrayProvider {
    constructor(rules) {
        this.rules = rules;
    }

    /**
     *
     * @param {Context} context
     * @returns {Promise<Rule[]>}
     */
    async find({ verb, namespace, relation, status, featureFlags, ...context }) {
        return this.rules
            .filter(rule => {
                //first filter on any of the standard conditions:
                if (
                    !rule ||
                    //these have to match:
                    rule.verb !== verb ||
                    rule.status !== status ||
                    //IF these are defined on the rule, they have to match
                    !emptyOrMatch(rule.namespace, namespace) ||
                    !emptyOrMatch(rule.relation, relation)
                ) {
                    return false;
                }
                //then filter on any additional properties on the rule
                //E.g. to limit by tenant, user, or the user's role or other permissions
                const ruleCriteria = extractCriteria(rule);
                for (const key in ruleCriteria) {
                    if (Object.hasOwnProperty.call(ruleCriteria, key)) {
                        if (!emptyOrMatch(ruleCriteria[key], context[key])) return false;
                    }
                }
                //IF the rule has a featureFlag, that flag should also be on the context
                if (rule.featureFlag && (!featureFlags || !featureFlags.includes(rule.featureFlag))) return false;
                return true;
            })
            .sort((a, b) => {
                return (b.priority || 0) - (a.priority || 0);
            });
    }
};

const emptyOrMatch = (value1, value2) => {
    if (value1 === undefined) return true;
    if (Array.isArray(value1)) {
        return value1.includes(value2);
    }
    return value1 === value2;
};

const extractCriteria = rule => {
    // remove any known properties
    // eslint-disable-next-line no-unused-vars
    const { verb, namespace, relation, status, featureFlag, priority, description, logic, onError, ...criteria } = rule;
    return criteria;
};
