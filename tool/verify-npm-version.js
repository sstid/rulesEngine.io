#!/usr/bin/env node

'use strict';

const { execFileSync } = require('node:child_process');
const packageJson = require('../package.json');

function verifyNpmVersion({ name, version, eventName, requireVersionBump = true, lookupVersion = lookupNpmVersion }) {
    const packageVersion = `${name}@${version}`;

    try {
        lookupVersion(packageVersion);
    } catch (error) {
        const registryOutput = getErrorOutput(error);
        if (registryOutput.includes('E404')) {
            return { version, shouldPublish: true };
        }

        throw new Error(
            `Could not verify ${packageVersion} against npm.${registryOutput ? `\n${registryOutput}` : ''}`
        );
    }

    if (eventName === 'pull_request' && requireVersionBump) {
        throw new Error(`${packageVersion} already exists. Bump the package version in this pull request.`);
    }

    return { version, shouldPublish: false };
}

function lookupNpmVersion(packageVersion) {
    execFileSync('npm', ['view', packageVersion, 'version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function getErrorOutput(error) {
    return [error.stdout, error.stderr, error.message]
        .filter(Boolean)
        .map(value => String(value).trim())
        .filter(Boolean)
        .join('\n');
}

function main() {
    try {
        const result = verifyNpmVersion({
            name: packageJson.name,
            version: packageJson.version,
            eventName: process.env.GITHUB_EVENT_NAME,
            requireVersionBump: process.env.RULES_ENGINE_REQUIRE_VERSION_BUMP !== 'false'
        });

        process.stdout.write(`version=${result.version}\n`);
        process.stdout.write(`should-publish=${result.shouldPublish}\n`);
    } catch (error) {
        process.stderr.write(`::error::${error.message}\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = { verifyNpmVersion };
