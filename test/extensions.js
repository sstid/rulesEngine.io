// Root mocha hook happens after/before all tests in the suite.
const expect = require('expect');
expect.extend({
    async toThrowAsynchronously(message) {
        try {
            await this.actual();
            expect.assert(
                false,
                'expected %s to throw an error',
                this.actual.displayName || this.actual.name || this.actual
            );
        } catch (error) {
            expect.assert(error instanceof Error, 'expected %s to be an instance of Error', error);
            expect.assert(error.message === message, `expected '${error.message}' to equal '${message}'`);
        }
    },
    toHaveBeenCalledTimes(expectedNumberOfCalls) {
        expect.assert(
            this.actual.__isSpy,
            'The "actual" argument in expect(actual).toHaveBeenCalledTimes() must be a spy, %s was given',
            this.actual
        );
        expect.assert(
            this.actual.calls.length === expectedNumberOfCalls,
            `expected spy to have been called ${expectedNumberOfCalls} times, instead it was called ${this.actual.calls.length} times`
        );
    },
    toIncludeAllOf(values) {
        const actual = Array.isArray(this.actual) ? this.actual : Object.keys(this.actual);
        expect.assert(
            Array.isArray(values),
            'The "expected" argument in expect(actual).toIncludeAllOf(expected) must be an array or an object, %s was given',
            values
        );
        expect.assert(
            values.every(expected => actual.includes(expected)),
            'Expected %s to include %s',
            this.actual,
            values
        );
    }
});
