const expect = require('expect');
const contextProvider = require('../src/contextProvider');

describe('contextProvider', function() {
    afterEach(function() {
        contextProvider._private.reset();
    });
    describe('getChildContext', function() {
        it('merges the parent context with the the step originalContext', function() {
            contextProvider.setContextExcludedFields(['someField']);
            const step = { originalContext: { verb: 'a', namespace: 'ns', relation: 'rel', someField: 'someValue' } };
            const parentContext = { verb: 'b' };
            const childContext = contextProvider.getChildContext(parentContext, step);
            expect(childContext).toEqual({ verb: 'b', namespace: 'ns', relation: 'rel' });
        });
        describe('parent has no original context', function() {
            it('uses the regular step context instead, perferring the verb from the step context', function() {
                contextProvider.setContextExcludedFields(['someField']);
                const step = { context: { verb: 'a', namespace: 'ns', relation: 'rel', someField: 'someValue' } };
                const parentContext = { verb: 'b' };
                const childContext = contextProvider.getChildContext(parentContext, step);
                expect(childContext).toEqual({ verb: 'a', namespace: 'ns', relation: 'rel' });
            });
            describe('the step context info is directly on the root of that object', function() {
                it('uses the given step context info', function() {
                    contextProvider.setContextExcludedFields(['someField']);
                    const step = { verb: 'a', namespace: 'ns', relation: 'rel', someField: 'someValue' };
                    const parentContext = { verb: 'b' };
                    const childContext = contextProvider.getChildContext(parentContext, step);
                    expect(childContext).toEqual({ verb: 'a', namespace: 'ns', relation: 'rel' });
                });
            });
        });
        describe('no context is included with the step at all', function() {
            it('uses the parent context', function() {
                contextProvider.setContextExcludedFields(['someField']);
                const step = {};
                const parentContext = { verb: 'b' };
                const childContext = contextProvider.getChildContext(parentContext, step);
                expect(childContext).toEqual({ verb: 'b' });
            });
        });

        describe('This is a TRANSFORMATION child step', function() {
            it('prefers the TRANSFORMATION verb over the parent context verb', function() {
                const logic = () => {};
                const step = {
                    verb: 'TRANSFORMATION',
                    namespace: 'ns',
                    relation: 'rel',
                    someField: 'someValue',
                    logic,
                    description: 'someDescription'
                };
                const parentContext = { verb: 'b' };
                const childContext = contextProvider.getChildContext(parentContext, step);
                expect(childContext).toEqual({
                    verb: 'TRANSFORMATION'
                });
            });
        });
    });
    describe('getContextExcludedFields', function() {
        it('returns whatever fields are excluded from context', function() {
            contextProvider.setContextExcludedFields(['someField']);
            expect(contextProvider.getContextExcludedFields()).toEqual(
                ['onError', 'logic', 'prereqs', 'description', 'someField']
            );
        });
    });
});