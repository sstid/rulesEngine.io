const expect = require('expect');

const consoleLogger = require('../src/defaultProviders/logging');
const RulesArrayRepository = require('../src/defaultProviders/RulesArrayRepository');

const workflowGenerator = require('../src/workflowGenerator');
const workflowExecutioner = require('../src/workflowExecutioner');

const RulesEngine = require('../src/index');

describe('rulesEngine.io', () => {
    let prepareGeneratorSpy, createWorkflowSpy, prepareEngineSpy, executeWorkflowSpy;
    const rulesArray = [{ verb: 'doingTest' }];
    const rulesProvider = { find: () => {} };

    beforeEach(() => {
        createWorkflowSpy = expect.createSpy();
        prepareGeneratorSpy = expect
            .spyOn(workflowGenerator, 'prepareGenerator')
            .andReturn({ createWorkflow: createWorkflowSpy });

        executeWorkflowSpy = expect.createSpy();
        prepareEngineSpy = expect
            .spyOn(workflowExecutioner, 'prepareEngine')
            .andReturn({ execute: executeWorkflowSpy });
    });

    afterEach(() => {
        expect.restoreSpies();
    });

    describe('constructor', () => {
        it('Throws an error when no rules or rules provider are provided', async () => {
            expect(() => new RulesEngine()).toThrow(
                '`rules` should be passed as the first argument to the rulesEngine.io constructor'
            );
        });
        it('Throws an error when an object without find method is provided', async () => {
            expect(() => new RulesEngine({})).toThrow(
                '`rules` should either be an array, or an object with a `find` method.'
            );
        });

        it('Throws an error when an empty rules array is provided', async () => {
            expect(() => new RulesEngine([])).toThrow('At least 1 rule should be provided.');
        });

        it('Can be instantiated with only a rules array', () => {
            const instance = new RulesEngine(rulesArray);
            expect(instance).toBeA(RulesEngine);
            expect(instance).toBeA(RulesEngine);
            expect(Object.keys(instance.STEPS).length).toEqual(5);
            expect(instance.STEPS).toIncludeAllOf(['get', 'count', 'create', 'update', 'remove']);
            expect(Object.keys(instance.STATES).length).toEqual(2);
            expect(instance.STATES.success).toEqual('success');
            expect(instance.STATES.fail).toEqual('fail');
            expect(instance.cacheAge).toEqual(5000);
            expect(instance.log).toInclude(consoleLogger);
            expect(instance.rulesRepository).toBeA(RulesArrayRepository);

            expect(prepareGeneratorSpy).toHaveBeenCalledWith(instance.STEPS, instance.rulesRepository, instance.log);
            expect(prepareEngineSpy).toHaveBeenCalledWith(instance.dispatch, instance.log, {
                states: instance.STATES,
                enableWorkflowStack: false
            });
        });

        it('Can be instantiated with only a rules provider', () => {
            const instance = new RulesEngine(rulesProvider);
            expect(instance.rulesRepository).toEqual(rulesProvider);
            expect(prepareGeneratorSpy).toHaveBeenCalledWith(instance.STEPS, instance.rulesRepository, instance.log);
        });

        describe('When additional settings are provided', () => {
            it('Throws an error when dispatch is not a function', async () => {
                const settings = {
                    dispatch: true
                };
                expect(() => new RulesEngine(rulesArray, settings)).toThrow('`dispatch` should be a function.');
            });

            it('Uses the provided dispatch function', async () => {
                const settings = {
                    dispatch: () => 'PASSED'
                };
                const rulesEngine = new RulesEngine(rulesArray, settings);
                expect(rulesEngine.dispatch()).toEqual('PASSED');
            });

            it('Allows overriding the states', async () => {
                const states = ['state1', 'state2'];
                const instance = new RulesEngine(rulesArray, { states });
                expect(Object.keys(instance.STATES).length).toEqual(2);
                expect(instance.STATES.success).toEqual('state1');
                expect(instance.STATES.fail).toEqual('state2');
            });

            it('Allows overriding the cacheAge', async () => {
                const instance = new RulesEngine(rulesArray, { cacheAge: 360000 });
                expect(instance.cacheAge).toEqual(360000);
            });

            it('allows overriding the log', async () => {
                const logging = {
                    debug: () => 'Overridden',
                    info: () => 'Overridden',
                    warn: () => 'Overridden',
                    error: () => 'Overridden'
                };
                const instance = new RulesEngine(rulesArray, { logging });
                expect(instance.log.debug).toEqual(logging.debug);
                expect(instance.log.info).toEqual(logging.info);
                expect(instance.log.warn).toEqual(logging.warn);
                expect(instance.log.error).toEqual(logging.error);
            });
            it('allows partially overriding the log', async () => {
                const logging = { debug: () => 'Overridden' };
                const instance = new RulesEngine(rulesArray, { logging });
                expect(instance.log.debug).toEqual(logging.debug);
                expect(instance.log.info).toEqual(consoleLogger.info);
                expect(instance.log.warn).toEqual(consoleLogger.warn);
                expect(instance.log.error).toEqual(consoleLogger.error);
            });

            it('Allows adding to the steps', async () => {
                const steps = {
                    import: ['willImport', 'doingImport', 'didImport'],
                    refresh: ['willRefresh', 'doingRefresh', 'didRefresh']
                };
                const instance = new RulesEngine(rulesArray, { steps });
                expect(Object.keys(instance.STEPS).length).toEqual(7);
                expect(instance.STEPS).toIncludeAllOf([
                    'get',
                    'count',
                    'create',
                    'update',
                    'remove',
                    'import',
                    'refresh'
                ]);
            });

            it('Allows overriding predefined steps', async () => {
                const steps = {
                    get: ['gaatZoeken', 'zoek', 'heeftGezocht']
                };
                const instance = new RulesEngine(rulesArray, { steps });
                expect(Object.keys(instance.STEPS).length).toEqual(5);
                expect(instance.STEPS).toIncludeAllOf(['get', 'count', 'create', 'update', 'remove']);
                expect(instance.STEPS.get).toEqual(['gaatZoeken', 'zoek', 'heeftGezocht']);
            });

            it('Allows enabling the workflow Stack', async () => {
                const instance = new RulesEngine(rulesArray, { enableWorkflowStack: true });
                expect(prepareEngineSpy).toHaveBeenCalledWith(instance.dispatch, instance.log, {
                    states: instance.STATES,
                    enableWorkflowStack: true
                });
            });
        });
    });

    describe('execute()', () => {
        let rulesEngine;
        beforeEach(() => {
            rulesEngine = new RulesEngine(rulesArray);
        });

        describe('when provided with a workflow and a context', () => {
            it('directly executes that workflow', async () => {
                const data = { value: new Date() };
                const workflow = [{ verb: 'doingTest' }];
                const context = { verb: 'test' };
                await rulesEngine.execute(data, workflow, context);
                expect(createWorkflowSpy).toNotHaveBeenCalled();
                expect(executeWorkflowSpy).toHaveBeenCalledWith(data, workflow, context);
            });
        });
        describe('when not provided with a workflow', () => {
            let workflow = [{ verb: 'doingTest' }];
            beforeEach(() => {
                createWorkflowSpy.andReturn(Promise.resolve(workflow));
            });

            it('Generates a workflow based on the given context', async () => {
                const data = { value: new Date() };
                const context = { verb: 'test', namespace: 'ns', relation: 'rel' };
                await rulesEngine.execute(data, context);
                expect(createWorkflowSpy).toHaveBeenCalledWith(context);
                expect(executeWorkflowSpy).toHaveBeenCalledWith(data, workflow, context);
            });

            it('does not cache workflows', async () => {
                const data = { value: new Date() };
                const context = { verb: 'test', namespace: 'ns', relation: 'rel' };
                await rulesEngine.execute(data, context);
                await rulesEngine.execute(data, context);
                expect(createWorkflowSpy).toHaveBeenCalledTimes(2);
            });
        });

        describe('When no proper context is passed in', () => {
            it('Throws an error if just a workflow is passed in', async () => {
                const data = { value: new Date() };
                const workflow = [{ verb: 'doingTest' }];
                await expect(() => rulesEngine.execute(data, workflow)).toThrowAsynchronously(
                    'A proper `Context` is required. The 3rd argument is missing, and the 2nd argument does not appear to be a context.'
                );
            });

            it('Throws an error if required context information is missing', async () => {
                const data = { value: new Date() };
                const context = { verb: 'test' };
                await expect(() => rulesEngine.execute(data, context)).toThrowAsynchronously(
                    'A proper `Context` is required. The 3rd argument is missing, and the 2nd argument does not appear to be a context.'
                );
            });
        });
    });

    describe('createWorkflow()', () => {
        let rulesEngine;
        beforeEach(() => {
            rulesEngine = new RulesEngine(rulesArray);
        });

        it('Calls the workflow generator to create a workflow', async () => {
            await rulesEngine.createWorkflow({});
            expect(createWorkflowSpy).toHaveBeenCalled();
            expect(createWorkflowSpy).toHaveBeenCalledTimes(1);
        });

        describe('When called twice', () => {
            it('Calls the workflow generator only once if the context is the same', async () => {
                const context = { value: new Date() };
                await rulesEngine.createWorkflow(context);
                await rulesEngine.createWorkflow(context);
                expect(createWorkflowSpy).toHaveBeenCalled();
                expect(createWorkflowSpy).toHaveBeenCalledTimes(1);
            });

            it('Calls the workflow generator twice if the contexts are different', async () => {
                await rulesEngine.createWorkflow({ value: 'context1' });
                await rulesEngine.createWorkflow({ value: 'context2' });
                expect(createWorkflowSpy).toHaveBeenCalled();
                expect(createWorkflowSpy).toHaveBeenCalledTimes(2);
            });

            it('Calls the workflow generator twice if the cache expires in between', async () => {
                rulesEngine = new RulesEngine(rulesArray, { cacheAge: 1 });
                const context = { value: new Date() };
                await rulesEngine.createWorkflow(context);
                await wait(2);
                await rulesEngine.createWorkflow(context);
                expect(createWorkflowSpy).toHaveBeenCalled();
                expect(createWorkflowSpy).toHaveBeenCalledTimes(2);
            });

            it('does not share cache between instances', async () => {
                const rulesEngine1 = new RulesEngine(rulesArray);
                const rulesEngine2 = new RulesEngine(rulesArray);
                const context = { value: new Date() };
                await rulesEngine1.createWorkflow(context);
                await rulesEngine2.createWorkflow(context);
                expect(createWorkflowSpy).toHaveBeenCalled();
                expect(createWorkflowSpy).toHaveBeenCalledTimes(2);
            });
        });
    });
});

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
