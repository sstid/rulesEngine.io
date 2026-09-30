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

            it('attaches the prerequisite`s declared routing as a frozen prereqContext (minus status/action)', async () => {
                repositorySpy.find.andCall(async ({ verb }) => {
                    let findResult = [];
                    switch (verb) {
                        case 'willCreate':
                            findResult = [
                                {
                                    verb: 'willCreate',
                                    namespace: 'item',
                                    relation: 'item',
                                    description: 'Cross-collection lookup',
                                    prerequisites: [
                                        {
                                            context: {
                                                verb: 'get',
                                                namespace: 'order',
                                                relation: 'order',
                                                type: 'find',
                                                status: 'success',
                                                action: 'import'
                                            }
                                        }
                                    ],
                                    logic: () => {}
                                }
                            ];
                            break;
                    }
                    return findResult;
                });
                const result = await generator.createWorkflow({
                    verb: 'create',
                    namespace: 'item',
                    relation: 'item',
                    tenantId: 'tenant-1'
                });

                const wf = result[0].prerequisites[0];
                // Exact shape: declared `type` survives, declared status/action are stripped, and
                // nothing from the merged build-time context (e.g. tenantId) leaked in.
                // (spread copy: expect v1's deep-equal reports frozen objects as unequal)
                expect({ ...wf.prereqContext }).toEqual({
                    verb: 'get',
                    namespace: 'order',
                    relation: 'order',
                    type: 'find'
                });
                expect(Object.isFrozen(wf.prereqContext)).toBe(true);
            });

            it('attaches `when` to the compiled prerequisite workflow without evaluating it onto the data', async () => {
                const whenFn = () => false;
                repositorySpy.find.andCall(async ({ verb }) => {
                    if (verb !== 'willCreate') return [];
                    return [
                        {
                            verb: 'willCreate',
                            namespace: 'ns',
                            relation: 'rel',
                            description: 'Gated prerequisite',
                            prerequisites: [
                                {
                                    context: { verb: 'count' },
                                    when: whenFn,
                                    query: () => ({ criteria: {} })
                                }
                            ],
                            logic: () => {}
                        }
                    ];
                });
                const result = await generator.createWorkflow({ verb: 'create', namespace: 'ns', relation: 'rel' });

                const wf = result[0].prerequisites[0];
                expect(wf.when).toBe(whenFn);

                // The TRANSFORMATION evaluates the other keys onto the step data; `when` is a gate
                // for the executioner and must not appear in the transformation result.
                const transformationResult = await wf[0].logic({
                    data: {},
                    context: { verb: 'create', namespace: 'ns', relation: 'rel' }
                });
                expect(Object.keys(transformationResult)).toEqual(['query']);
            });

            it('does not inherit the parent status/action into prerequisite rule selection', async () => {
                repositorySpy.find.andCall(async ({ verb, status, action }) => {
                    let findResult = [];
                    switch (verb) {
                        case 'willCreate':
                            findResult = [
                                {
                                    verb: 'willCreate',
                                    namespace: 'ns',
                                    relation: 'rel',
                                    status: 'success',
                                    description: 'Success-phase rule with a plain prerequisite',
                                    prerequisites: [{ context: { verb: 'count' } }],
                                    logic: () => {}
                                }
                            ];
                            break;
                        case 'doingCount':
                            // The generic count rule carries no status/action: a repository only
                            // returns it for a status-less, action-less lookup.
                            if (status === undefined && action === undefined) {
                                findResult = [{ verb: 'doingCount', description: 'Do count on repository', logic: () => {} }];
                            }
                            break;
                    }
                    return findResult;
                });
                const result = await generator.createWorkflow({
                    verb: 'create',
                    namespace: 'ns',
                    relation: 'rel',
                    status: 'success',
                    action: 'import'
                });

                const countCalls = repositorySpy.find.calls.filter(c =>
                    ['willCount', 'doingCount', 'didCount'].includes(c.arguments[0].verb)
                );
                expect(countCalls.length).toEqual(3);
                countCalls.forEach(c => {
                    expect(c.arguments[0].status).toEqual(undefined);
                    expect(c.arguments[0].action).toEqual(undefined);
                });

                // ...so the generic count rule actually made it into the compiled prereq workflow
                const prereqWorkflow = result[0].prerequisites[0];
                expect(prereqWorkflow.length).toEqual(2); // TRANSFORMATION + doingCount
                expect(prereqWorkflow[1].verb).toEqual('doingCount');
            });

            it('honors a status the prerequisite declares itself', async () => {
                repositorySpy.find.andCall(async ({ verb }) => {
                    if (verb !== 'willCreate') return [];
                    return [
                        {
                            verb: 'willCreate',
                            namespace: 'ns',
                            relation: 'rel',
                            description: 'Rule with a success-status prerequisite',
                            prerequisites: [{ context: { verb: 'get', status: 'success' } }],
                            logic: () => {}
                        }
                    ];
                });
                await generator.createWorkflow({ verb: 'create', namespace: 'ns', relation: 'rel' });

                const getCalls = repositorySpy.find.calls.filter(c =>
                    ['willGet', 'doingGet', 'didGet'].includes(c.arguments[0].verb)
                );
                expect(getCalls.length).toEqual(3);
                getCalls.forEach(c => {
                    expect(c.arguments[0].status).toEqual('success');
                });
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
