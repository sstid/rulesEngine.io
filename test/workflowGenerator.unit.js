const expect = require('expect');

const workflowGenerator = require('../src/workflowGenerator');
const steps = require('../src/defaultProviders/steps');

describe('Workflow Generator', () => {
    afterEach(() => {
        expect.restoreSpies();
    });

    it('Returns an object wth an `execute` function', () => {
        const result = workflowGenerator.prepareGenerator({}, {}, {});
        expect(typeof result.createWorkflow).toBe('function');
    });

    describe('When the generator is prepared', () => {
        let repositorySpy, logSpy;
        let generator;
        beforeEach(() => {
            repositorySpy = { find: expect.createSpy() };
            logSpy = {
                debug: expect.createSpy(),
                info: expect.createSpy(),
                warn: expect.createSpy(),
                error: expect.createSpy()
            };

            generator = workflowGenerator.prepareGenerator(steps, repositorySpy, logSpy);
        });
        it('throws an error if the context has no verb', async () => {
            await expect(() => generator.createWorkflow({})).toThrowAsynchronously('`context.verb` is required');
        });
        it('throws an error if the context`s verb is not one of the step verbs', async () => {
            await expect(() => generator.createWorkflow({ verb: 'test' })).toThrowAsynchronously('Invalid verb test');
        });

        describe('When a valid verb is passed in', () => {
            it('calls the rules repository for each verbs step', async () => {
                repositorySpy.find.andReturn(Promise.resolve([]));
                const result = await generator.createWorkflow({ verb: 'create' });
                expect(repositorySpy.find).toHaveBeenCalledTimes(3);
                expect(repositorySpy.find.calls[0].arguments[0].verb).toEqual('willCreate');
                expect(repositorySpy.find.calls[1].arguments[0].verb).toEqual('doingCreate');
                expect(repositorySpy.find.calls[2].arguments[0].verb).toEqual('didCreate');
                expect(result.length).toEqual(0);
                expect(result.toJSON()).toEqual([]);
                expect(result.toString()).toEqual('- No Workflow Defined -');
            });

            it('strips out anything form the rules other than basic information', async () => {
                repositorySpy.find.andCall(async ({ verb }) => {
                    let findResult = [];
                    switch (verb) {
                        case 'doingCreate':
                            findResult = [
                                {
                                    verb: 'v',
                                    namespace: 'ns',
                                    relation: 'rel',
                                    status: 'success',
                                    description: 'Lorem Ipsum',
                                    prerequisites: [],
                                    logic: () => {},
                                    onError: () => {},
                                    extra1: 6,
                                    tenantId: 123
                                }
                            ];
                    }
                    return findResult;
                });
                const result = await generator.createWorkflow({
                    verb: 'create',
                    namespace: 'ns',
                    relation: 'rel',
                    status: 'success'
                });

                expect(Object.keys(result[0])).toEqual([
                    'verb',
                    'namespace',
                    'relation',
                    'status',
                    'description',
                    'prerequisites',
                    'logic',
                    'onError',
                    'originalContext'
                ]);
                expect(result.toJSON()).toEqual([{ name: 'v_ns_rel_success', description: 'Lorem Ipsum' }]);
                // prettier-ignore
                expect(result.toString()).toEqual(
                    '─┐ Workflow for create_ns_rel_success - \n' +
                    ' └── v_ns_rel_success - Lorem Ipsum\n'
                );
            });

            it('calls the rules repository for any prerequisites', async () => {
                repositorySpy.find.andCall(async ({ verb }) => {
                    let findResult = [];
                    switch (verb) {
                        case 'willCreate':
                            findResult = [
                                {
                                    verb: 'willCreate',
                                    namespace: 'ns',
                                    relation: 'rel',
                                    description: 'Duplicate Prevention',
                                    prerequisites: [{ context: { verb: 'count' } }],
                                    logic: () => {}
                                }
                            ];
                            break;
                        case 'doingCreate':
                            findResult = [
                                {
                                    verb: 'doingCreate',
                                    description: 'Create ns/rel on repository',
                                    logic: () => {}
                                }
                            ];
                            break;
                        case 'doingCount':
                            findResult = [
                                {
                                    verb: 'doingCount',
                                    description: 'Do count on repository',
                                    logic: () => {}
                                }
                            ];
                            break;
                    }
                    return findResult;
                });
                const result = await generator.createWorkflow({ verb: 'create', namespace: 'ns', relation: 'rel' });
                expect(repositorySpy.find).toHaveBeenCalledTimes(6);
                expect(repositorySpy.find.calls[0].arguments[0].verb).toEqual('willCreate');
                expect(repositorySpy.find.calls[1].arguments[0].verb).toEqual('doingCreate');
                expect(repositorySpy.find.calls[2].arguments[0].verb).toEqual('didCreate');
                expect(repositorySpy.find.calls[3].arguments[0].verb).toEqual('willCount');
                expect(repositorySpy.find.calls[4].arguments[0].verb).toEqual('doingCount');
                expect(repositorySpy.find.calls[5].arguments[0].verb).toEqual('didCount');

                expect(result.toJSON()).toEqual([
                    {
                        prerequisites: [
                            [
                                {
                                    name: 'TRANSFORMATION_{generic}_{generic}',
                                    description: 'Data transformation towards count_ns_rel'
                                },
                                { name: 'doingCount_{generic}_{generic}', description: 'Do count on repository' }
                            ]
                        ],
                        name: 'willCreate_ns_rel',
                        description: 'Duplicate Prevention'
                    },
                    { name: 'doingCreate_{generic}_{generic}', description: 'Create ns/rel on repository' }
                ]);
                // prettier-ignore
                expect(result.toString()).toEqual(
                    '─┐ Workflow for create_ns_rel - \n' +
                    ' ├─┐ willCreate_ns_rel - Duplicate Prevention\n' +
                    ' │ ├── TRANSFORMATION_{generic}_{generic} - Data transformation towards count_ns_rel\n' +
                    ' │ └── doingCount_{generic}_{generic} - Do count on repository\n' +
                    ' └── doingCreate_{generic}_{generic} - Create ns/rel on repository\n'
                );
            });
            it('throws an error for misconfigured prerequisites', async () => {
                repositorySpy.find.andCall(async ({ verb }) => {
                    let findResult = [];
                    switch (verb) {
                        case 'willCreate':
                            findResult = [
                                {
                                    verb: 'willCreate',
                                    namespace: 'ns',
                                    relation: 'rel',
                                    description: 'Duplicate Prevention',
                                    prerequisites: [{ context: { noVerb: 'in this context' } }],
                                    logic: () => {}
                                }
                            ];
                            break;
                    }
                    return findResult;
                });
                await expect(
                    async () => await generator.createWorkflow({ verb: 'create', namespace: 'ns', relation: 'rel' })
                ).toThrowAsynchronously(
                    "Prerequisite 0 for rule willCreate_ns_rel - Duplicate Prevention should have a 'context' object, with a 'verb' property."
                );
            });

            it('adds a transformation to prerequisites that supports both fixed values, as well as functions', async () => {
                repositorySpy.find.andCall(async ({ verb }) => {
                    let findResult = [];
                    switch (verb) {
                        case 'willCreate':
                            findResult = [
                                {
                                    verb: 'willCreate',
                                    namespace: 'ns',
                                    relation: 'rel',
                                    description: 'Duplicate Prevention',
                                    prerequisites: [
                                        {
                                            context: { verb: 'count' },
                                            query: ({ data }) => {
                                                return { _id: data._id };
                                            },
                                            payload: [{ op: 'replace', path: '/online', value: true }]
                                        }
                                    ],
                                    logic: () => {}
                                }
                            ];
                            break;
                    }
                    return findResult;
                });
                const result = await generator.createWorkflow({ verb: 'create', namespace: 'ns', relation: 'rel' });

                //get the first rule, from the first prerequisite workflow, from the first rule out of the main workflow:
                const transformationRule = result[0].prerequisites[0][0];
                const data = {
                    _id: 444
                };
                const context = {
                    verb: 'create',
                    namespace: 'ns',
                    relation: 'rel'
                };
                const transformationResult = await transformationRule.logic({ data, context });
                expect(transformationResult).toEqual({
                    query: { _id: 444 },
                    payload: [{ op: 'replace', path: '/online', value: true }]
                });
            });
        });
    });
});
