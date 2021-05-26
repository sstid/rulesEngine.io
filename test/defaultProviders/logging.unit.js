const expect = require('expect');

const consoleLogger = require('../../src/defaultProviders/logging');

describe('Console Logger', () => {
    let logSpy, infoSpy, warnSpy, errorSpy;
    beforeEach(() => {
        logSpy = expect.spyOn(console, 'log');
        infoSpy = expect.spyOn(console, 'info');
        warnSpy = expect.spyOn(console, 'warn');
        errorSpy = expect.spyOn(console, 'error');
    });

    afterEach(() => {
        expect.restoreSpies();
    });

    describe('.debug()', () => {
        it('outputs to console.log', () => {
            consoleLogger.debug('test', {}, []);
            expect(logSpy).toHaveBeenCalledWith('test');
            expect(infoSpy).toNotHaveBeenCalled();
            expect(warnSpy).toNotHaveBeenCalled();
            expect(errorSpy).toNotHaveBeenCalled();
        });
    });

    describe('.info()', () => {
        it('outputs to console.info', () => {
            consoleLogger.info('test', {}, []);
            expect(logSpy).toNotHaveBeenCalled();
            expect(infoSpy).toHaveBeenCalledWith('test');
            expect(warnSpy).toNotHaveBeenCalled();
            expect(errorSpy).toNotHaveBeenCalled();
        });
    });

    describe('.warn()', () => {
        it('outputs to console.warn', () => {
            consoleLogger.warn('test', {}, []);
            expect(logSpy).toNotHaveBeenCalled();
            expect(infoSpy).toNotHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith('test');
            expect(errorSpy).toNotHaveBeenCalled();
        });
    });

    describe('.error()', () => {
        it('outputs to console.error', () => {
            consoleLogger.error(new Error('test'), {}, []);
            expect(logSpy).toNotHaveBeenCalled();
            expect(infoSpy).toNotHaveBeenCalled();
            expect(warnSpy).toNotHaveBeenCalled();
            expect(errorSpy.calls[0].arguments[0].message).toEqual('test');
        });
    });
});
