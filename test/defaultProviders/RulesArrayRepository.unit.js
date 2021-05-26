const expect = require('expect');

const RulesArrayRepository = require('../../src/defaultProviders/RulesArrayRepository');

describe('Rules Array Repository', () => {
    it('is a class with a find method', () => {
        const instance = new RulesArrayRepository();
        expect(instance).toBeA(RulesArrayRepository);
        expect(typeof instance.find).toBe('function');
    });

    describe('when passing in a context', () => {
        function setup() {
            const rules = [
                //straightforward cases:
                { verb: 'doingCreate', description: 'Applies to all creations' },
                {
                    verb: 'willCreate',
                    namespace: 'item',
                    description: 'Applied prior to all item namespace object creations'
                },
                {
                    verb: 'didCreate',
                    namespace: 'item',
                    relation: 'item',
                    description: 'Applied after item:item creations'
                },
                {
                    verb: 'create',
                    namespace: 'item',
                    relation: 'item',
                    status: 'success',
                    description: 'Executed asynchronously after successful item:item creations'
                },
                {
                    verb: 'create',
                    namespace: 'item',
                    relation: 'item',
                    status: 'fail',
                    description: 'Executed asynchronously after failed item:item creations'
                },
                //sorting
                {
                    verb: 'willUpdate',
                    namespace: 'location',
                    relation: 'room',
                    description: 'lowest priority executes later',
                    priority: 1
                },
                {
                    verb: 'willUpdate',
                    namespace: 'location',
                    relation: 'room',
                    description: 'no priority executes last'
                },
                {
                    verb: 'willUpdate',
                    namespace: 'location',
                    relation: 'room',
                    description: 'highest priority executes first',
                    priority: 10
                },
                //additional property matching:
                {
                    verb: 'delete',
                    namespace: 'location',
                    relation: 'building',
                    status: 'success',
                    description: 'only cascade deletes when the feature flag is set',
                    featureFlag: 'cascadeDelete',
                    priority: 5
                },
                {
                    verb: 'delete',
                    namespace: 'location',
                    relation: 'building',
                    status: 'success',
                    description: 'only execute for specific tenant',
                    tenantId: 345,
                    priority: 10
                },
                {
                    verb: 'delete',
                    namespace: 'location',
                    relation: 'building',
                    status: 'success',
                    description: 'executed for multiple tenants',
                    tenantId: [123, 987],
                    priority: 20
                }
            ];

            const rulesRepo = new RulesArrayRepository(rules);
            return { rulesRepo, rules };
        }

        it('distinguishes between success, and fail contexts', async () => {
            const { rulesRepo } = setup();
            const successContext = {
                verb: 'create',
                namespace: 'item',
                relation: 'item',
                status: 'success'
            };
            const failContext = {
                verb: 'create',
                namespace: 'item',
                relation: 'item',
                status: 'fail'
            };
            const successResult = await rulesRepo.find(successContext);
            expect(successResult.length).toEqual(1);
            expect(successResult[0].description).toEqual(
                'Executed asynchronously after successful item:item creations'
            );

            const failResult = await rulesRepo.find(failContext);
            expect(failResult.length).toEqual(1);
            expect(failResult[0].description).toEqual('Executed asynchronously after failed item:item creations');
        });

        it('requires relation to match, if defined on the rule', async () => {
            const { rulesRepo } = setup();
            const itemContext = {
                verb: 'didCreate',
                namespace: 'item',
                relation: 'item'
            };
            const patchContext = {
                verb: 'didCreate',
                namespace: 'item',
                relation: 'item-patch'
            };
            const itemResult = await rulesRepo.find(itemContext);
            expect(itemResult.length).toEqual(1);
            expect(itemResult[0].description).toEqual('Applied after item:item creations');

            const patchResult = await rulesRepo.find(patchContext);
            expect(patchResult.length).toEqual(0);
        });

        it('takes any relation if none is defined on the rule', async () => {
            const { rulesRepo } = setup();
            const itemContext = {
                verb: 'willCreate',
                namespace: 'item',
                relation: 'item'
            };
            const patchContext = {
                verb: 'willCreate',
                namespace: 'item',
                relation: 'item-patch'
            };
            const roomContext = {
                verb: 'willCreate',
                namespace: 'location',
                relation: 'room'
            };
            const itemResult = await rulesRepo.find(itemContext);
            expect(itemResult.length).toEqual(1);
            expect(itemResult[0].description).toEqual('Applied prior to all item namespace object creations');

            const patchResult = await rulesRepo.find(patchContext);
            expect(patchResult[0].description).toEqual('Applied prior to all item namespace object creations');

            const roomResult = await rulesRepo.find(roomContext);
            expect(roomResult.length).toEqual(0);
        });

        it('takes any namespace and relation if neither is defined on the rule', async () => {
            const { rulesRepo } = setup();
            const itemContext = {
                verb: 'doingCreate',
                namespace: 'item',
                relation: 'item'
            };
            const roomContext = {
                verb: 'doingCreate',
                namespace: 'location',
                relation: 'room'
            };
            const itemResult = await rulesRepo.find(itemContext);
            expect(itemResult.length).toEqual(1);
            expect(itemResult[0].description).toEqual('Applies to all creations');

            const roomResult = await rulesRepo.find(roomContext);
            expect(roomResult[0].description).toEqual('Applies to all creations');
        });

        it('sorts the rules based on priority if multiple are returned', async () => {
            const { rulesRepo } = setup();
            const context = {
                verb: 'willUpdate',
                namespace: 'location',
                relation: 'room'
            };
            const result = await rulesRepo.find(context);
            expect(result.length).toEqual(3);
            expect(result[0].description).toEqual('highest priority executes first');
            expect(result[1].description).toEqual('lowest priority executes later');
            expect(result[2].description).toEqual('no priority executes last');
        });

        it('restrict rules by any feature flags and other properties', async () => {
            const { rulesRepo } = setup();
            const noTenantContext = {
                verb: 'delete',
                namespace: 'location',
                relation: 'building',
                status: 'success',
                featureFlags: ['cascadeDelete']
            };
            const matchingTenantContext = {
                verb: 'delete',
                namespace: 'location',
                relation: 'building',
                status: 'success',
                tenantId: 345
            };
            const differentTenantContext = {
                verb: 'delete',
                namespace: 'location',
                relation: 'building',
                status: 'success',
                tenantId: 123,
                featureFlags: ['cascadeDelete']
            };
            const result1 = await rulesRepo.find(noTenantContext);
            expect(result1.length).toEqual(1);
            expect(result1[0].description).toEqual('only cascade deletes when the feature flag is set');
            const result2 = await rulesRepo.find(matchingTenantContext);
            expect(result2.length).toEqual(1);
            expect(result2[0].description).toEqual('only execute for specific tenant');
            const result3 = await rulesRepo.find(differentTenantContext);
            expect(result3.length).toEqual(2);
            expect(result3[0].description).toEqual('executed for multiple tenants');
            expect(result3[1].description).toEqual('only cascade deletes when the feature flag is set');
        });
    });
});
