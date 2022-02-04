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
                expect(dispatchSpy).toHaveBeenCalled();
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

        describe('Prerequisite Handling', () => {
            it('executes prerequisites', async () => {
                const message = { x: 2 };
                //prerequisiteResult t = (x+1)
                //result y = x + t * 3
                const workflow = [
                    {
                        prerequisites: [[{ logic: ({ data: { x } }) => ({ t: x + 1 }) }]],
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
                            [{ logic: ({ data: { x } }) => ({ t: x + 1 }) }],
                            [{ logic: ({ data: { x } }) => Promise.resolve({ t: x + 2 }) }]
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
                            [
                                { logic: ({ data: { y } }) => ({ t3: y + 1 }) },
                                { logic: ({ data: { t3 } }) => ({ t3, t4: t3 + 2 }) }
                            ]
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

            describe('the workflow succeeded for the "get" verb ', function () {
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

        describe('Rule Abortion', () => {
            it('Continues to execute the main logic if the prerequisite throws an error', async () => {
                const message = { x: 2 };
                const workflow = [
                    {
                        prerequisites: [
                            [
                                {
                                    logic: () => {
                                        throw new Error('prerequisite aborted');
                                    }
                                }
                            ]
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
                expect(dispatchSpy).toNotHaveBeenCalled();
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
