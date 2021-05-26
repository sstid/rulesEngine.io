const expect = require('expect');

const dispatchProvider = require('../../src/defaultProviders/dispatch');

describe('Default Dispatch Provider', () => {
    it('returns an object with a dispatch function', () => {
        const dispatch = dispatchProvider();
        expect(typeof dispatch).toBe('function');
    });
    describe('When ', () => {
        function setup(cacheAge) {
            const rulesEngine = {
                createWorkflow: expect.createSpy().andReturn([]),
                execute: expect.createSpy().andCall(async message => {
                    await wait(200);
                    message.x = 5;
                }),
                cacheAge
            };
            const dispatch = dispatchProvider(rulesEngine);
            return { rulesEngine, dispatch };
        }

        it('does not call createWorkflow when cacheAge is set to 0', async () => {
            const { rulesEngine, dispatch } = setup(0);
            let message = { x: 1 };
            const context = new Date();
            await dispatch(message, context);
            expect(message.x).toEqual(1);
            expect(rulesEngine.execute).toHaveBeenCalled();
            expect(rulesEngine.createWorkflow).toNotHaveBeenCalled();
            expect(rulesEngine.execute.calls[0].arguments[1]).toEqual(context);
            expect(rulesEngine.execute.calls[0].arguments[2]).toNotExist();
        });

        it('calls createWorkflow when cacheAge is > 0', async () => {
            const { rulesEngine, dispatch } = setup(10);
            let message = { x: 1 };
            const context = new Date();
            await dispatch(message, context);
            //message should not be updated, as we are not awaiting the rules engine execution.
            expect(message.x).toEqual(1);
            expect(rulesEngine.createWorkflow).toHaveBeenCalled();
            expect(rulesEngine.execute).toHaveBeenCalled();
            expect(rulesEngine.execute.calls[0].arguments[1]).toEqual([]);
            expect(rulesEngine.execute.calls[0].arguments[2]).toEqual(context);
        });

        it('calls the new workflow asynchronously without waiting on it', async () => {
            const { dispatch } = setup(0);
            let message = { x: 1 };
            const context = new Date();
            await dispatch(message, context);
            expect(message.x).toEqual(1);
            await wait(500);
            //message should (eventually) be updated
            expect(message.x).toEqual(5);
        });
    });
});

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
