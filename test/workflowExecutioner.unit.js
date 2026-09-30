const expect = require('expect');

const workflowExecutioner = require('../src/workflowExecutioner');

describe('Workflow Executioner', () => {
    afterEach(() => {
        expect.restoreSpies();
    });

    it('Returns an object wth an `execute` function', () => {
        const result = workflowExecutioner.prepareEngine(() => {}, {}, {});
        expect(typeof result.execute).toBe('function');
    });

    describe('When the engine is prepared', () => {
        let dispatchSpy, logSpy;
        let engine;
        beforeEach(() => {
            dispatchSpy = expect.createSpy();
            logSpy = {
                debug: expect.createSpy(),
                info: expect.createSpy(),
                warn: expect.createSpy(),
                error: expect.createSpy()
            };

            engine = workflowExecutioner.prepareEngine(dispatchSpy, logSpy, {
                states: { success: 'success', fail: 'fail' },
                enableWorkflowStack: true
            });
        });
        describe('Workflow Execution', () => {
            it('returns an async message if there is no workflow', async () => {
                const message = { ts: new Date() };
                const workflow = [];
                const context = {};
                const promise = engine.execute(message, workflow, context);
                expect(promise).toBeA(Promise);
                expect(await promise).toEqual(message);
            });

            it('executes a simple workflow', async () => {
                const message = { x: 2 };
                //result 1: y = x+1
                //result 2: z = y * 3
                const workflow = [
                    {
                        logic: ({ data: { x } }) => ({ y: x + 1 })
                    },
                    {
                        logic: ({ data: { y } }) => ({ z: y * 3 })
                    }
                ];
                const context = {};
                const result = await engine.execute(message, workflow, context);
                expect(result.z).toEqual(9);
                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
            });

            it('uses the input as output if the rule returns nothing', async () => {
                const message = { x: 2 };
                // x = 9 (but no result)
                //result 2: z = x * 3
                const workflow = [
                    {
                        logic: () => {
                            return; //nothing
                        }
                    },
                    {
                        logic: ({ data: { x } }) => ({ z: x * 3 })
                    }
                ];
                const context = {};
                const result = await engine.execute(message, workflow, context);
                expect(result.z).toEqual(6);
                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
            });

            it('does not mutate the input', async () => {
                const message = { x: 2 };
                // x = 9 (but no result)
                //result 2: z = x * 3
                const workflow = [
                    {
                        logic: ({ data }) => {
                            data.x = 9;
                            return; //nothing
                        }
                    },
                    {
                        logic: ({ data: { x } }) => ({ z: x * 3 })
                    }
                ];
                const context = {};
                const result = await engine.execute(message, workflow, context);
                expect(result.z).toEqual(6);
                expect(message).toEqual({ x: 2 });
            });
        });

        // Hand-built prerequisite workflows must carry the routing seed the generator attaches at
        // compile time (the engine throws without it). An empty seed keeps the parent context
        // flowing through unchanged, which is what these arithmetic fixtures expect.
        const seedPrereq = (prereqWorkflow, seed = {}) => {
            prereqWorkflow.prereqContext = Object.freeze(seed);
            return prereqWorkflow;
        };

        describe('Prerequisite Handling', () => {
            it('executes prerequisites', async () => {
                const message = { x: 2 };
                //prerequisiteResult t = (x+1)
                //result y = x + t * 3
                const workflow = [
                    {
                        prerequisites: [seedPrereq([{ logic: ({ data: { x } }) => ({ t: x + 1 }) }])],
                        logic: ({ data: { x }, prerequisiteResults }) => ({ y: x + prerequisiteResults[0].t * 3 })
                    }
                ];
                const context = {};
                const result = await engine.execute(message, workflow, context);
                expect(result.y).toEqual(11);
                expect(dispatchSpy).toHaveBeenCalledTimes(2);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
                expect(dispatchSpy.calls[1].arguments[1].status).toEqual('success');
            });

            it('executes a complex workflow in order (with prerequisites before each rule)', async () => {
                const message = { x: 2 };
                //result 1: y = ((x+1)*(x+2) * x)
                //result 2: z = (y * ((y+1) + 2) * 3)
                const workflow = [
                    {
                        prerequisites: [
                            seedPrereq([{ logic: ({ data: { x } }) => ({ t: x + 1 }) }]),
                            seedPrereq([{ logic: ({ data: { x } }) => Promise.resolve({ t: x + 2 }) }])
                        ],
                        logic: ({ data: { x }, prerequisiteResults }) => ({
                            x,
                            t1: prerequisiteResults[0].t,
                            t2: prerequisiteResults[1].t,
                            y: prerequisiteResults[0].t * prerequisiteResults[1].t * x
                        })
                    },
                    {
                        prerequisites: [
                            seedPrereq([
                                { logic: ({ data: { y } }) => ({ t3: y + 1 }) },
                                { logic: ({ data: { t3 } }) => ({ t3, t4: t3 + 2 }) }
                            ])
                        ],
                        logic: ({ data: { x, y, t1, t2 }, prerequisiteResults }) => ({
                            x,
                            y,
                            t1,
                            t2,
                            t3: prerequisiteResults[0].t3,
                            t4: prerequisiteResults[0].t4,
                            z: (y + prerequisiteResults[0].t4) * 3
                        })
                    }
                ];
                const context = {};
                const result = await engine.execute(message, workflow, context);
                expect(result.x).toBe(2);
                expect(result.y).toBe(24);
                expect(result.t1).toBe(3);
                expect(result.t2).toBe(4);
                expect(result.t3).toBe(25);
                expect(result.t4).toBe(27);
                expect(result.z).toBe(153);

                //dispatch is called 4 times:
                expect(dispatchSpy).toHaveBeenCalledTimes(4);
                //- once for each of the 2 (separate/parallel) prerequisites of the first rule
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
                expect(dispatchSpy.calls[0].arguments[0]).toEqual({ t: 3 });

                expect(dispatchSpy.calls[1].arguments[1].status).toEqual('success');
                expect(dispatchSpy.calls[1].arguments[0]).toEqual({ t: 4 });

                //- once for the combined result of the 2 sequential prerequisites of the 2nd rule
                expect(dispatchSpy.calls[2].arguments[1].status).toEqual('success');
                expect(dispatchSpy.calls[2].arguments[0]).toEqual({ t3: 25, t4: 27 });

                //- once for the final result of the whole workflow
                expect(dispatchSpy.calls[3].arguments[1].status).toEqual('success');
                expect(dispatchSpy.calls[3].arguments[0]).toEqual(result);
            });

            describe('the workflow succeeded for the "get" verb ', function() {
                it('dispatches a success', async () => {
                    const message = { x: 2 };
                    const workflow = [
                        {
                            logic: ({ data: { x } }) => ({ y: x + 1 })
                        }
                    ];
                    const context = { verb: 'get' };
                    await engine.execute(message, workflow, context);
                    expect(dispatchSpy).toHaveBeenCalled();
                    expect(dispatchSpy.calls[0].arguments[0].y).toEqual(3);
                    expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
                });
            });
        });

        // The README promises `prerequisiteResults` is ALWAYS an array — `[]` when the rule
        // declares no prerequisites, in declaration order otherwise — so rules may destructure
        // positionally without defaults. Pin that contract.
        describe('prerequisiteResults contract', () => {
            it('passes an empty array (not undefined) when a rule has no prerequisites', async () => {
                let seen;
                const workflow = [
                    {
                        logic: ({ prerequisiteResults }) => {
                            seen = prerequisiteResults;
                            return { done: true };
                        }
                    }
                ];
                await engine.execute({}, workflow, {});
                expect(Array.isArray(seen)).toBe(true);
                expect(seen.length).toEqual(0);
            });

            it('supports array destructuring without a default when there are no prerequisites', async () => {
                // Would throw 'is not iterable' if prerequisiteResults were ever undefined.
                const workflow = [
                    {
                        logic: ({ prerequisiteResults: [first] }) => ({ firstIsUndefined: first === undefined })
                    }
                ];
                const result = await engine.execute({}, workflow, {});
                expect(result.firstIsUndefined).toBe(true);
            });

            it('keeps results in declaration order even when a later prerequisite finishes first', async () => {
                const slow = seedPrereq([
                    {
                        logic: async () => {
                            await new Promise(resolve => setTimeout(resolve, 25));
                            return { which: 'slow' };
                        }
                    }
                ]);
                const fast = seedPrereq([{ logic: () => ({ which: 'fast' }) }]);
                const workflow = [
                    {
                        prerequisites: [slow, fast],
                        logic: ({ prerequisiteResults: [first, second] }) => ({
                            order: [first.which, second.which]
                        })
                    }
                ];
                const result = await engine.execute({}, workflow, {});
                expect(result.order).toEqual(['slow', 'fast']);
            });
        });

        describe('Prerequisite `when` gate', () => {
            it('skips the whole mini-workflow (slot = undefined) when `when` returns false', async () => {
                const transformationSpy = expect.createSpy();
                const fetchSpy = expect.createSpy();
                const prereqWorkflow = seedPrereq(
                    [
                        { verb: 'TRANSFORMATION', logic: transformationSpy },
                        { verb: 'doingGet', logic: fetchSpy }
                    ],
                    { verb: 'get', namespace: 'order', relation: 'order' }
                );
                prereqWorkflow.when = () => false;

                let seenSlot = 'not set';
                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults }) => {
                            seenSlot = prerequisiteResults[0];
                            return { parentRan: true };
                        }
                    }
                ];
                const result = await engine.execute({}, workflow, { verb: 'update' });

                expect(seenSlot).toEqual(undefined);
                expect(result.parentRan).toBe(true);
                // Nothing in the mini-workflow ran — not even the TRANSFORMATION.
                expect(transformationSpy).toNotHaveBeenCalled();
                expect(fetchSpy).toNotHaveBeenCalled();
                // Only the main workflow dispatched a success; the skipped prereq dispatched nothing.
                expect(dispatchSpy).toHaveBeenCalledTimes(1);
            });

            it('supports a literal `when: false`', async () => {
                const fetchSpy = expect.createSpy();
                const prereqWorkflow = seedPrereq([{ logic: fetchSpy }]);
                prereqWorkflow.when = false;

                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults }) => ({ slotIsUndefined: prerequisiteResults[0] === undefined })
                    }
                ];
                const result = await engine.execute({}, workflow, {});
                expect(result.slotIsUndefined).toBe(true);
                expect(fetchSpy).toNotHaveBeenCalled();
            });

            it('runs the prerequisite as normal when `when` (async) returns true', async () => {
                const prereqWorkflow = seedPrereq([{ logic: () => ({ found: 1 }) }]);
                prereqWorkflow.when = async () => true;

                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults: [first] }) => ({ fromPrereq: first.found })
                    }
                ];
                const result = await engine.execute({}, workflow, {});
                expect(result.fromPrereq).toEqual(1);
            });

            it('evaluates `when` with the parent data and the prerequisite routing context', async () => {
                let seen;
                const prereqWorkflow = seedPrereq([{ logic: ({ data }) => data }], {
                    verb: 'get',
                    namespace: 'order',
                    relation: 'order'
                });
                prereqWorkflow.when = ({ data, context }) => {
                    seen = { x: data.x, namespace: context.namespace, relation: context.relation };
                    return false;
                };

                const workflow = [{ prerequisites: [prereqWorkflow], logic: ({ data }) => data }];
                await engine.execute({ x: 42 }, workflow, { verb: 'update', namespace: 'item', relation: 'item' });

                expect(seen).toEqual({ x: 42, namespace: 'order', relation: 'order' });
            });

            it('treats a throwing `when` like a failing prerequisite: error slot, parent continues', async () => {
                const fetchSpy = expect.createSpy();
                const prereqWorkflow = seedPrereq([{ logic: fetchSpy }]);
                prereqWorkflow.when = () => {
                    throw new Error('when blew up');
                };

                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults: [first] }) => ({
                            parentRan: true,
                            slotError: first.error.message
                        })
                    }
                ];
                const result = await engine.execute({}, workflow, {});
                expect(result.parentRan).toBe(true);
                expect(result.slotError).toEqual('when blew up');
                expect(fetchSpy).toNotHaveBeenCalled();
            });

            it('does not dispatch a failure for a throwing `when` (unlike a throw inside the steps)', async () => {
                // The one asymmetry between the two ways a prerequisite can blow up. A throw inside
                // the mini-workflow dispatches a `_failure` for the prerequisite's context; a
                // throwing `when` never entered the workflow, so nothing is dispatched for it.
                // Documented in the README — pinned here so it stays a decision, not an accident.
                const throwingWhen = seedPrereq([{ logic: ({ data }) => data }], {
                    verb: 'get',
                    namespace: 'order',
                    relation: 'order'
                });
                throwingWhen.when = () => {
                    throw new Error('when blew up');
                };
                await engine.execute({}, [{ prerequisites: [throwingWhen], logic: ({ data }) => data }], {
                    verb: 'update',
                    namespace: 'item',
                    relation: 'item'
                });
                const dispatchedStatuses = dispatchSpy.calls.map(c => c.arguments[1].status);
                expect(dispatchedStatuses).toEqual(['success']); // the main workflow's, and only that

                // Same failure one step later: the prerequisite DOES dispatch, under its own context.
                dispatchSpy.reset();
                const throwingStep = seedPrereq(
                    [
                        {
                            logic: () => {
                                throw new Error('step blew up');
                            }
                        }
                    ],
                    { verb: 'get', namespace: 'order', relation: 'order' }
                );
                await engine.execute({}, [{ prerequisites: [throwingStep], logic: ({ data }) => data }], {
                    verb: 'update',
                    namespace: 'item',
                    relation: 'item'
                });
                const failures = dispatchSpy.calls
                    .map(c => c.arguments[1])
                    .filter(c => c.status === 'fail')
                    .map(c => `${c.namespace}:${c.relation}`);
                expect(failures).toEqual(['order:order']);
            });

            it('resolves an ABORTED `when` to an undefined slot, like every other abort path', async () => {
                // An abort means "skip this, on purpose" wherever it is thrown, so a `when` that
                // aborts must leave the same slot as an abort thrown inside the prerequisite's own
                // steps: `undefined`. Only a HARD error leaves `{ error }`, which is how a parent
                // tells "skipped" from "broke" — see the Rule Abortion block below.
                const abort = new Error('skip this lookup');
                abort.aborted = true;
                const fetchSpy = expect.createSpy();
                const prereqWorkflow = seedPrereq([{ logic: fetchSpy }]);
                prereqWorkflow.when = () => {
                    throw abort;
                };

                let seenSlot = 'not set';
                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults }) => {
                            seenSlot = prerequisiteResults[0];
                            return { parentRan: true };
                        }
                    }
                ];
                const result = await engine.execute({}, workflow, {});

                expect(seenSlot).toEqual(undefined);
                expect(result.parentRan).toBe(true);
                expect(fetchSpy).toNotHaveBeenCalled();
                // Nothing was dispatched for the skipped prerequisite; only the main workflow's success.
                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
            });

            it('treats `when: null` as a falsy gate, not as "no gate"', async () => {
                // `undefined` is the only value that means "no gate". `null` is not in the declared
                // contract (`boolean | fn`), but it reaches the engine, because the silo copies
                // `when` onto the workflow it rebuilds whenever the value is not `undefined`
                // (`setupRulesEngine.js`). Both ends must read it the same way or a `null` gate is
                // silently ignored on one side and honoured on the other.
                const fetchSpy = expect.createSpy();
                const prereqWorkflow = seedPrereq([{ logic: fetchSpy }]);
                prereqWorkflow.when = null;

                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults: [first] }) => ({ slotIsUndefined: first === undefined })
                    }
                ];
                const result = await engine.execute({}, workflow, {});

                expect(fetchSpy).toNotHaveBeenCalled();
                expect(result.slotIsUndefined).toBe(true);
            });

            it('runs the prerequisite for an explicit `when: undefined`, as for an omitted one', async () => {
                // The other side of the boundary above: `undefined` still means "no gate", however
                // it got onto the array.
                const prereqWorkflow = seedPrereq([{ logic: () => ({ found: 1 }) }]);
                prereqWorkflow.when = undefined;

                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults: [first] }) => ({ fromPrereq: first.found })
                    }
                ];
                const result = await engine.execute({}, workflow, {});
                expect(result.fromPrereq).toEqual(1);
            });

            it('gives `when` the same `dispatch` and `log` the rule callbacks get', async () => {
                // `when` decides whether a lookup happens at all, so it is as entitled to reach the
                // engine's dispatcher and logger as `logic` and `onError` are.
                let seen = {};
                const prereqWorkflow = seedPrereq([{ logic: () => ({}) }]);
                prereqWorkflow.when = ({ dispatch, log }) => {
                    seen = { dispatch, log };
                    return false;
                };

                const workflow = [{ prerequisites: [prereqWorkflow], logic: ({ data }) => data }];
                await engine.execute({}, workflow, {});

                expect(seen.dispatch).toBe(dispatchSpy);
                expect(seen.log).toBe(logSpy);
            });
        });

        describe('Prerequisite routing context', () => {
            it('runs prerequisite steps under the prerequisite routing seed', async () => {
                const seen = [];
                const pickNs = c => ({ namespace: c.namespace, relation: c.relation });

                const prereqWorkflow = [
                    {
                        verb: 'TRANSFORMATION',
                        logic: ({ context }) => {
                            seen.push({ phase: 'transform', ...pickNs(context) });
                            return { query: {} };
                        }
                    },
                    {
                        verb: 'doingGet',
                        logic: ({ data, context }) => {
                            seen.push({ phase: 'get', ...pickNs(context) });
                            return { ...data, payload: [{ _id: 'o1' }] };
                        }
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({
                    verb: 'get',
                    namespace: 'order',
                    relation: 'order'
                });

                const workflow = [
                    {
                        verb: 'doingUpdate',
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults }) => ({
                            fromPrereq: prerequisiteResults[0].payload
                        })
                    }
                ];

                await engine.execute(
                    { payload: { _id: 'item-1' } },
                    workflow,
                    { verb: 'update', namespace: 'item', relation: 'item' }
                );

                expect(seen).toEqual([
                    { phase: 'transform', namespace: 'order', relation: 'order' },
                    { phase: 'get', namespace: 'order', relation: 'order' }
                ]);
            });

            it('prereq routing wins over a parentward step.originalContext', async () => {
                const seen = [];
                const prereqWorkflow = [
                    {
                        verb: 'doingGet',
                        // Simulates silo rebind painting the parent collection onto the step
                        originalContext: {
                            verb: 'update',
                            namespace: 'item',
                            relation: 'item'
                        },
                        logic: ({ context }) => {
                            seen.push({ namespace: context.namespace, relation: context.relation });
                            return { payload: [] };
                        }
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({
                    verb: 'get',
                    namespace: 'order',
                    relation: 'order'
                });

                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ data }) => data
                    }
                ];

                await engine.execute({}, workflow, { verb: 'update', namespace: 'item', relation: 'item' });

                expect(seen[0]).toEqual({ namespace: 'order', relation: 'order' });
            });

            // `context` inside a prerequisite is the PREREQUISITE's routing, which is right for a
            // callback resolving a query against the prerequisite's own collection but leaves a
            // WILDCARD rule (one declaring no namespace/relation) with no way to know which
            // collection its parent step is acting on. `parentContext` is that missing channel.
            it('exposes the declaring step context as `parentContext` inside a prerequisite', async () => {
                const seen = [];
                const prereqWorkflow = [
                    {
                        verb: 'TRANSFORMATION',
                        logic: ({ context, parentContext }) => {
                            seen.push({
                                phase: 'transform',
                                ctx: `${context.namespace}:${context.relation}`,
                                parent: `${parentContext.namespace}:${parentContext.relation}`
                            });
                            return { query: {} };
                        }
                    },
                    {
                        verb: 'doingGet',
                        logic: ({ data, context, parentContext }) => {
                            seen.push({
                                phase: 'get',
                                ctx: `${context.namespace}:${context.relation}`,
                                parent: `${parentContext.namespace}:${parentContext.relation}`
                            });
                            return { ...data, payload: [] };
                        }
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({
                    verb: 'get',
                    namespace: 'rulesEngine',
                    relation: 'customerWorkflow'
                });

                const workflow = [
                    {
                        verb: 'created',
                        prerequisites: [prereqWorkflow],
                        logic: ({ data }) => data
                    }
                ];

                await engine.execute({}, workflow, { verb: 'create', namespace: 'item', relation: 'item' });

                expect(seen).toEqual([
                    { phase: 'transform', ctx: 'rulesEngine:customerWorkflow', parent: 'item:item' },
                    { phase: 'get', ctx: 'rulesEngine:customerWorkflow', parent: 'item:item' }
                ]);
            });

            it('leaves `parentContext` undefined at the base level', async () => {
                let seen = 'not called';
                const workflow = [
                    {
                        logic: ({ data, parentContext }) => {
                            seen = parentContext;
                            return data;
                        }
                    }
                ];

                await engine.execute({}, workflow, { verb: 'create', namespace: 'item', relation: 'item' });

                expect(seen).toEqual(undefined);
            });

            it('gives `when` the declaring step context as `parentContext`', async () => {
                let seen;
                const prereqWorkflow = [
                    {
                        verb: 'doingGet',
                        logic: ({ data }) => ({ ...data, payload: [] })
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({
                    verb: 'get',
                    namespace: 'rulesEngine',
                    relation: 'customerWorkflow'
                });
                prereqWorkflow.when = ({ context, parentContext }) => {
                    seen = {
                        ctx: `${context.namespace}:${context.relation}`,
                        parent: `${parentContext.namespace}:${parentContext.relation}`
                    };
                    return true;
                };

                const workflow = [
                    {
                        verb: 'created',
                        prerequisites: [prereqWorkflow],
                        logic: ({ data }) => data
                    }
                ];

                await engine.execute({}, workflow, { verb: 'create', namespace: 'location', relation: 'location' });

                expect(seen).toEqual({
                    ctx: 'rulesEngine:customerWorkflow',
                    parent: 'location:location'
                });
            });

            it('keeps the parent namespace/relation for a verb-only routing seed', async () => {
                const seen = [];
                const prereqWorkflow = [
                    {
                        logic: ({ context }) => {
                            seen.push({ namespace: context.namespace, relation: context.relation });
                            return { payload: [] };
                        }
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({ verb: 'count' });

                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ data }) => data
                    }
                ];

                await engine.execute({}, workflow, { verb: 'update', namespace: 'item', relation: 'item' });

                expect(seen[0]).toEqual({ namespace: 'item', relation: 'item' });
            });

            it('runs prerequisite steps under the prerequisite verb, not TRANSFORMATION', async () => {
                // The generated TRANSFORMATION step keeps its own verb (getChildContext identifies it
                // by that), but its context is the parent of every step after it — so without the
                // routing verb the rest of the mini-workflow would run under 'TRANSFORMATION'.
                const seen = [];
                const prereqWorkflow = [
                    {
                        verb: 'TRANSFORMATION',
                        logic: ({ context }) => {
                            seen.push(context.verb);
                            return { query: {} };
                        }
                    },
                    {
                        verb: 'willGet',
                        originalContext: { verb: 'update', namespace: 'item', relation: 'item' },
                        logic: ({ context, data }) => {
                            seen.push(context.verb);
                            return data;
                        }
                    },
                    {
                        verb: 'doingGet',
                        originalContext: { verb: 'update', namespace: 'item', relation: 'item' },
                        logic: ({ context, data }) => {
                            seen.push(context.verb);
                            return { ...data, payload: [] };
                        }
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({
                    verb: 'get',
                    namespace: 'order',
                    relation: 'order'
                });

                const workflow = [{ prerequisites: [prereqWorkflow], logic: ({ data }) => data }];

                await engine.execute({}, workflow, { verb: 'update', namespace: 'item', relation: 'item' });

                expect(seen).toEqual(['TRANSFORMATION', 'get', 'get']);
            });

            it('dispatches the prerequisite success under the prerequisite verb', async () => {
                // What B2 needs: the success dispatch for a prerequisite mini-workflow must name the
                // prerequisite's own verb/collection, without the caller smuggling it on step data.
                const prereqWorkflow = [
                    { verb: 'TRANSFORMATION', logic: () => ({ payload: { _id: 'x' } }) },
                    { verb: 'doingCreate', logic: ({ data }) => data }
                ];
                prereqWorkflow.prereqContext = Object.freeze({
                    verb: 'create',
                    namespace: 'order',
                    relation: 'order'
                });

                const workflow = [{ prerequisites: [prereqWorkflow], logic: ({ data }) => data }];

                await engine.execute({}, workflow, { verb: 'update', namespace: 'item', relation: 'item' });

                const prereqDispatch = dispatchSpy.calls[0].arguments[1];
                expect(prereqDispatch.verb).toEqual('create');
                expect(prereqDispatch.namespace).toEqual('order');
                expect(prereqDispatch.relation).toEqual('order');
                // The parent workflow still dispatches under its own context.
                expect(dispatchSpy.calls[1].arguments[1].verb).toEqual('update');
            });

            it('throws when a prerequisite workflow is missing prereqContext', async () => {
                const prereqWorkflow = [{ logic: ({ data }) => data }];
                const workflow = [{ prerequisites: [prereqWorkflow], logic: ({ data }) => data }];
                const ctx = { verb: 'update', namespace: 'item', relation: 'item' };

                await expect(() => engine.execute({}, workflow, ctx)).toThrowAsynchronously(
                    'Prerequisite workflow is missing prereqContext. Prerequisite 0 of transformation_{generic}_{generic}.'
                );
            });

            it('names the declaring step and the prerequisite position in the wiring error', async () => {
                // A mini-workflow has no name of its own, so without this the message says only
                // that SOME prerequisite somewhere in the workflow was built wrong.
                const good = [{ logic: ({ data }) => data }];
                good.prereqContext = Object.freeze({ verb: 'get', namespace: 'order', relation: 'order' });
                const bad = [{ logic: ({ data }) => data }]; // no prereqContext

                const workflow = [
                    {
                        verb: 'willUpdate',
                        namespace: 'item',
                        relation: 'item',
                        prerequisites: [good, bad],
                        logic: ({ data }) => data
                    }
                ];
                const ctx = { verb: 'update', namespace: 'item', relation: 'item' };

                await expect(() => engine.execute({}, workflow, ctx)).toThrowAsynchronously(
                    'Prerequisite workflow is missing prereqContext. Prerequisite 1 of willUpdate_item_item.'
                );
            });

            it('throws when a NESTED prerequisite workflow is missing prereqContext', async () => {
                // The bad wiring sits one level down: a step INSIDE a prerequisite mini-workflow
                // declares its own prerequisite without a routing seed. `_executeWorkflow` treats
                // ordinary prerequisite failures as a result (`{ error }`) and does not rethrow for
                // prerequisite workflows, so a wiring error must be exempt from that or it degrades
                // to a dispatched failure while the parent rule carries on.
                const parentLogic = expect.createSpy().andReturn({});
                const nestedPrereqWorkflow = [{ logic: ({ data }) => data }]; // no prereqContext

                const prereqWorkflow = [
                    {
                        prerequisites: [nestedPrereqWorkflow],
                        logic: ({ data }) => data
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({
                    verb: 'get',
                    namespace: 'order',
                    relation: 'order'
                });

                const workflow = [{ prerequisites: [prereqWorkflow], logic: parentLogic }];
                const ctx = { verb: 'update', namespace: 'item', relation: 'item' };

                await expect(() => engine.execute({}, workflow, ctx)).toThrowAsynchronously(
                    'Prerequisite workflow is missing prereqContext. Prerequisite 0 of transformation_{generic}_{generic}.'
                );
                // Not degraded into a prerequisite result: the parent rule never ran...
                expect(parentLogic).toNotHaveBeenCalled();
                // ...and no _failure message was published for what is a build defect.
                expect(dispatchSpy).toNotHaveBeenCalled();
            });

            it('does not route a nested missing prereqContext into an intermediate onError', async () => {
                const onError = expect.createSpy();
                const nestedPrereqWorkflow = [{ logic: ({ data }) => data }]; // no prereqContext

                const prereqWorkflow = [
                    {
                        prerequisites: [nestedPrereqWorkflow],
                        logic: ({ data }) => data
                    }
                ];
                prereqWorkflow.prereqContext = Object.freeze({ verb: 'get', namespace: 'order', relation: 'order' });

                // The rule that owns the (well-formed) prerequisite has an onError of its own — the
                // wrapLegacyRule shape that returns `data` for a falsy handler result and would
                // silently continue with the prerequisite never having run.
                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ data }) => data,
                        onError
                    }
                ];
                const ctx = { verb: 'update', namespace: 'item', relation: 'item' };

                await expect(() => engine.execute({}, workflow, ctx)).toThrowAsynchronously(
                    'Prerequisite workflow is missing prereqContext. Prerequisite 0 of transformation_{generic}_{generic}.'
                );
                expect(onError).toNotHaveBeenCalled();
            });

            it('does not route a missing prereqContext into the parent step onError', async () => {
                const onError = expect.createSpy();
                const prereqWorkflow = [{ logic: ({ data }) => data }]; // no prereqContext
                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ data }) => data,
                        onError // a real rule would absorb the error here
                    }
                ];
                const ctx = { verb: 'update', namespace: 'item', relation: 'item' };

                await expect(() => engine.execute({}, workflow, ctx)).toThrowAsynchronously(
                    'Prerequisite workflow is missing prereqContext. Prerequisite 0 of transformation_{generic}_{generic}.'
                );
                expect(onError).toNotHaveBeenCalled();
            });
        });

        describe('Rule Abortion', () => {
            // The abort contract: a thrown error carrying `.aborted === true` is expected control
            // flow, not a failure. Main workflow → halts, execute RESOLVES to the `{ error }`
            // output (no throw) and nothing is dispatched. Prerequisite workflow → the slot is
            // `undefined` and the parent logic still runs. A HARD error in a prerequisite keeps
            // its `{ error }` slot (next test below) so a parent can tell "skipped" from "broke".
            it('halts the main workflow on an abort without dispatching or throwing', async () => {
                const abort = new Error('no need to continue');
                abort.aborted = true;
                const workflow = [
                    {
                        logic: () => {
                            throw abort;
                        }
                    },
                    {
                        logic: expect.createSpy()
                    }
                ];
                const result = await engine.execute({ x: 2 }, workflow, {});
                expect(result.error).toBe(abort);
                expect(workflow[1].logic).toNotHaveBeenCalled();
                expect(dispatchSpy).toNotHaveBeenCalled();
            });

            it('offers an abort to the step`s own onError before halting', async () => {
                // wrapLegacyRule's defaultOnError depends on this: the abort passes through the
                // rule's error handler (which may translate or re-throw it) before the halt.
                const abort = new Error('abort via onError');
                abort.aborted = true;
                const onError = expect.createSpy().andCall(({ error }) => {
                    throw error;
                });
                const workflow = [
                    {
                        logic: () => {
                            throw abort;
                        },
                        onError
                    }
                ];
                const result = await engine.execute({ x: 2 }, workflow, {});
                expect(onError).toHaveBeenCalled();
                expect(result.error).toBe(abort);
            });

            it('resolves an aborted prerequisite to an undefined slot and still runs the parent', async () => {
                const abort = new Error('skip this lookup');
                abort.aborted = true;
                const prereqWorkflow = seedPrereq([
                    {
                        logic: () => {
                            throw abort;
                        }
                    }
                ]);
                const workflow = [
                    {
                        prerequisites: [prereqWorkflow],
                        logic: ({ prerequisiteResults: [first] }) => ({
                            parentRan: true,
                            slotIsUndefined: first === undefined
                        })
                    }
                ];
                const result = await engine.execute({ x: 2 }, workflow, {});
                expect(result.parentRan).toBe(true);
                expect(result.slotIsUndefined).toBe(true);
                // The aborted prerequisite dispatched nothing; only the main workflow's success.
                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
            });

            it('Continues to execute the main logic if the prerequisite throws an error', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        prerequisites: [
                            seedPrereq([
                                {
                                    logic: () => {
                                        throw new Error('prerequisite aborted');
                                    }
                                }
                            ])
                        ],
                        logic: ({ data: { x }, prerequisiteResults }) => ({ t1: prerequisiteResults[0], y: x })
                    }
                ];
                const context = {};
                const result = await engine.execute(message, workflow, context);
                expect(result.t1).toExist();
                expect(result.t1.error.message).toEqual('prerequisite aborted');
                expect(result.y).toEqual(2);

                expect(dispatchSpy).toHaveBeenCalledTimes(2);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('fail');
                expect(dispatchSpy.calls[1].arguments[1].status).toEqual('success');
            });

            it('aborts the workflow when a previous step throws an error', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: () => {
                            throw new Error('Workflow Aborted');
                        }
                    },
                    {
                        logic: expect.createSpy()
                    }
                ];
                const context = {};
                await expect(() => engine.execute(message, workflow, context)).toThrowAsynchronously(
                    'Workflow Aborted'
                );
                expect(workflow[1].logic).toNotHaveBeenCalled();

                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('fail');
            });
        });

        describe('onError Handling', () => {
            it('Executes onError if defined on a failing rule', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: () => {
                            throw new Error('Workflow Aborted');
                        },
                        onError: expect.createSpy().andThrow(new Error('Error Handled'))
                    },
                    {
                        logic: expect.createSpy()
                    }
                ];
                const context = {};
                await expect(() => engine.execute(message, workflow, context)).toThrowAsynchronously('Error Handled');
                expect(workflow[0].onError).toHaveBeenCalled();
                expect(workflow[1].logic).toNotHaveBeenCalled();

                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('fail');
            });

            it('continues with the onError result if something is returned', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: () => {
                            throw new Error('Workflow Aborted');
                        },
                        onError: expect.createSpy().andReturn({ value: 'Error Handled' })
                    },
                    {
                        logic: expect.createSpy().andReturn({ data: 1, extra: 2 })
                    }
                ];
                const context = {};
                const result = await engine.execute(message, workflow, context);
                expect(workflow[0].onError).toHaveBeenCalled();
                expect(workflow[1].logic).toHaveBeenCalled();
                expect(result).toEqual(1);

                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
            });

            it('requires onError to return something or throw an error', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        verb: 'test',
                        logic: () => {
                            throw new Error('Workflow Aborted');
                        },
                        onError: expect.createSpy().andReturn(undefined)
                    }
                ];
                const context = {};
                await expect(() => engine.execute(message, workflow, context)).toThrowAsynchronously(
                    "'test_{generic}_{generic}.onError' should either throw an error, or produce a result"
                );

                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('fail');
            });
        });

        describe('When dispatching fails', () => {
            it('it still returns the original result', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: ({ data: { x } }) => ({ y: x + 1 })
                    }
                ];
                const context = {};
                dispatchSpy.andThrow(new Error('Dispatch Failed'));
                const result = await engine.execute(message, workflow, context);
                expect(result.y).toEqual(3);
                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('success');
            });
            it('it still returns the original error', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: () => {
                            throw new Error('Workflow failed');
                        }
                    }
                ];
                const context = {};
                dispatchSpy.andThrow(new Error('Dispatch Failed'));
                await expect(() => engine.execute(message, workflow, context)).toThrowAsynchronously('Workflow failed');
                expect(dispatchSpy).toHaveBeenCalledTimes(1);
                expect(dispatchSpy.calls[0].arguments[1].status).toEqual('fail');
            });
        });
        describe('No Dispatching happens', () => {
            it('the workflow succeeded for the "count" verb ', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: ({ data: { x } }) => ({ y: x + 1 })
                    }
                ];
                const context = { verb: 'count' };
                await engine.execute(message, workflow, context);
                expect(dispatchSpy).toHaveBeenCalled();
            });

            it('the workflow succeeded for a status ', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: ({ data: { x } }) => ({ y: x + 1 })
                    }
                ];
                const context = { status: 'success' };
                await engine.execute(message, workflow, context);
                expect(dispatchSpy).toNotHaveBeenCalled();
            });

            it('the workflow failed for a workflow with a status', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        logic: () => {
                            throw new Error('Workflow failed');
                        }
                    }
                ];
                const context = { status: 'success' };
                dispatchSpy.andThrow(new Error('Dispatch Failed'));
                await expect(() => engine.execute(message, workflow, context)).toThrowAsynchronously('Workflow failed');
                expect(dispatchSpy).toNotHaveBeenCalled();
            });
        });
    });
});
