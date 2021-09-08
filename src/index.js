const memoize = require('memoizee');

const consoleLogger = require('./defaultProviders/logging');
const promiseDispatcher = require('./defaultProviders/dispatch');
const RulesArrayRepository = require('./defaultProviders/RulesArrayRepository');
const BASESTEPS = Object.freeze(require('./defaultProviders/steps'));

const workflowGenerator = require('./workflowGenerator');
const workflowExecutioner = require('./workflowExecutioner');
const { setContextExcludedFields } = require('./contextProvider');

/**
 * @typedef { import("./index").RulesEngine } RulesEngineClass
 * @typedef { import("./index").RulesProvider } RulesProvider
 * @typedef { import("./index").Settings } Settings
 * @typedef { import("./index").Context } Context
 * @typedef { import("./index").Rule } Rule
 */

class RulesEngine {
    /**
     * @constructor
     * @param {Rules[]|RulesProvider} rules
     * @param {Settings} [settings]
     */
    constructor(rules, settings = {}) {
        const { logging, dispatch, steps, states, cacheAge, enableWorkflowStack = false } = settings;
        setContextExcludedFields(settings.contextExcludedFields);
        this.STEPS = Object.freeze({ ...BASESTEPS, ...steps });
        this.log = { ...consoleLogger, ...(logging || {}) };
        this.cacheAge = isNumber(cacheAge) ? cacheAge : 5000;

        if (dispatch) {
            if (isFunction(dispatch)) {
                this.dispatch = dispatch;
            } else {
                throw new Error('`dispatch` should be a function.');
            }
        } else {
            this.dispatch = promiseDispatcher(this);
        }

        if (states && Array.isArray(states) && states.length === 2) {
            this.STATES = Object.freeze({ success: states[0], fail: states[1] });
        } else {
            this.STATES = Object.freeze({ success: 'success', fail: 'fail' });
        }
        if (!rules) {
            throw new Error('`rules` should be passed as the first argument to the rulesEngine.io constructor');
        }
        if (Array.isArray(rules)) {
            if (!rules.length) {
                throw new Error('At least 1 rule should be provided.');
            }
            this.rulesRepository = new RulesArrayRepository(rules);
        } else if (rules.find) {
            this.rulesRepository = rules;
        } else {
            throw new Error('`rules` should either be an array, or an object with a `find` method.');
        }

        this.generator = workflowGenerator.prepareGenerator(this.STEPS, this.rulesRepository, this.log);
        this.executioner = workflowExecutioner.prepareEngine(this.dispatch, this.log, {
            states: this.STATES,
            enableWorkflowStack
        });
        this._memoizedWorkflowCreation = memoize(this.generator.createWorkflow, {
            maxAge: this.cacheAge,
            promise: true,
            normalizer: context => JSON.stringify(context)
        });
    }

    /**
     *
     * @param {any} data
     * @param {Rule[] | Context} contextOrWorkflow
     * @param {Context} [context]
     * @returns {Promise<any>}
     */
    async execute(data, contextOrWorkflow, context) {
        //if no pre-generated workflow was passed in, generate one now
        let workflow = contextOrWorkflow;
        if (!context) {
            if (
                !contextOrWorkflow ||
                Array.isArray(contextOrWorkflow) ||
                !contextOrWorkflow.verb ||
                !contextOrWorkflow.namespace ||
                !contextOrWorkflow.relation
            ) {
                throw new Error(
                    'A proper `Context` is required. The 3rd argument is missing, and the 2nd argument does not appear to be a context.'
                );
            }
            context = contextOrWorkflow;
            workflow = await this.generator.createWorkflow(context);
        }
        return this.executioner.execute(data, workflow, context);
    }

    /**
     *
     * @param {Context} context
     * @returns {Rule[]}
     */
    async createWorkflow(context) {
        return this._memoizedWorkflowCreation(context);
    }
}

const isNumber = value => typeof value === 'number' && isFinite(value);

const isFunction = value => value && typeof value === 'function';

module.exports = RulesEngine;
