'use strict';

const assert = require('node:assert/strict');

const { verifyNpmVersion } = require('../tool/verify-npm-version');

describe('verifyNpmVersion', () => {
    it('marks an unpublished version for publishing', () => {
        const result = verifyNpmVersion({
            name: 'rulesengine.io',
            version: '1.2.7',
            eventName: 'pull_request',
            lookupVersion: () => {
                const error = new Error('npm view failed');
                error.stderr = 'npm error code E404';
                throw error;
            }
        });

        assert.deepEqual(result, { version: '1.2.7', shouldPublish: true });
    });

    it('rejects a pull request that reuses a published version', () => {
        assert.throws(
            () =>
                verifyNpmVersion({
                    name: 'rulesengine.io',
                    version: '1.2.6',
                    eventName: 'pull_request',
                    lookupVersion: () => '1.2.6'
                }),
            /rulesengine\.io@1\.2\.6 already exists/
        );
    });

    it('allows a corrective pull request that does not change the package runtime', () => {
        const result = verifyNpmVersion({
            name: 'rulesengine.io',
            version: '1.2.7',
            eventName: 'pull_request',
            requireVersionBump: false,
            lookupVersion: () => '1.2.7'
        });

        assert.deepEqual(result, { version: '1.2.7', shouldPublish: false });
    });

    it('does not republish an existing version after merge', () => {
        const result = verifyNpmVersion({
            name: 'rulesengine.io',
            version: '1.2.6',
            eventName: 'push',
            lookupVersion: () => '1.2.6'
        });

        assert.deepEqual(result, { version: '1.2.6', shouldPublish: false });
    });

    it('fails when npm returns an unexpected error', () => {
        assert.throws(
            () =>
                verifyNpmVersion({
                    name: 'rulesengine.io',
                    version: '1.2.7',
                    eventName: 'pull_request',
                    lookupVersion: () => {
                        const error = new Error('npm view failed');
                        error.stderr = 'npm error code E500';
                        throw error;
                    }
                }),
            /Could not verify rulesengine\.io@1\.2\.7 against npm/
        );
    });
});
