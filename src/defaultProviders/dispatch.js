module.exports = function (rulesEngine) {
    return async function dispatch(message, context) {
        if (rulesEngine.cacheAge) {
            const workflow = await rulesEngine.createWorkflow(context);
            //no await here:
            rulesEngine.execute(message, workflow, context);
        } else {
            //no await here:
            rulesEngine.execute(message, context);
        }
    };
};
