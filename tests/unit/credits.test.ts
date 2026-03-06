import { describe, expect, it, spyOn, beforeEach, afterEach } from 'bun:test';
import { fetchVerifierCredits, mapRawResponseToInternal } from '../../src/verifier.js';
import * as config from '../../src/config.js';

describe('Verifier Credit Fetching', () => {
    const originalApiKey = process.env.MYEMAILVERIFIER_API_KEY;

    beforeEach(() => {
        config.resetEnvCacheForTesting();
        delete process.env.MYEMAILVERIFIER_API_KEY;
    });

    afterEach(() => {
        config.resetEnvCacheForTesting();
        process.env.MYEMAILVERIFIER_API_KEY = originalApiKey;
    });

    it('should correctly parse credits from API response with "Credits" (uppercase)', async () => {
        spyOn(config, 'shouldSimulateVerifier').mockReturnValue(false);
        spyOn(config, 'getEnv').mockReturnValue({ MYEMAILVERIFIER_API_KEY: 'test-key' });

        const originalFetch = global.fetch;
        global.fetch = (async () => ({
            ok: true,
            json: async () => ({ Credits: "1234" })
        })) as any;

        try {
            const credits = await fetchVerifierCredits();
            expect(credits).toBe(1234);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should correctly parse credits from API response with "credits" (lowercase)', async () => {
        spyOn(config, 'shouldSimulateVerifier').mockReturnValue(false);
        spyOn(config, 'getEnv').mockReturnValue({ MYEMAILVERIFIER_API_KEY: 'test-key' });

        const originalFetch = global.fetch;
        global.fetch = (async () => ({
            ok: true,
            json: async () => ({ status: true, credits: 620 })
        })) as any;

        try {
            const credits = await fetchVerifierCredits();
            expect(credits).toBe(620);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should return null if API key is missing', async () => {
        spyOn(config, 'shouldSimulateVerifier').mockReturnValue(false);
        spyOn(config, 'getEnv').mockReturnValue({});

        const credits = await fetchVerifierCredits();
        expect(credits).toBeNull();
    });

    it('should return simulated credits in simulation mode', async () => {
        spyOn(config, 'shouldSimulateVerifier').mockReturnValue(true);

        const credits = await fetchVerifierCredits();
        expect(credits).toBe(9999);
    });

    it('should handle API error status codes', async () => {
        spyOn(config, 'shouldSimulateVerifier').mockReturnValue(false);
        spyOn(config, 'getEnv').mockReturnValue({ MYEMAILVERIFIER_API_KEY: 'test-key' });

        const originalFetch = global.fetch;
        global.fetch = (async () => ({
            ok: false,
            status: 404,
            text: async () => 'Not Found'
        })) as any;

        try {
            const credits = await fetchVerifierCredits();
            expect(credits).toBeNull();
        } finally {
            global.fetch = originalFetch;
        }
    });
});

describe('Verifier Response Mapping', () => {
    it('should handle various boolean-like formats for Disposable_Domain and Role_Based', () => {
        type Expected = {
            status: 'valid' | 'disposable' | 'role' | 'invalid' | 'catch-all' | 'unknown';
            risk: 'low' | 'medium' | 'high';
        };
        const testCases: Array<{ input: Record<string, unknown>; expected: Expected }> = [
            {
                input: { Status: 'Valid', Disposable_Domain: 'true', Role_Based: 'false' },
                expected: { status: 'disposable', risk: 'high' }
            },
            {
                input: { Status: 'Valid', Disposable_Domain: '1', Role_Based: '0' },
                expected: { status: 'disposable', risk: 'high' }
            },
            {
                input: { Status: 'Valid', Disposable_Domain: 1, Role_Based: 0 },
                expected: { status: 'disposable', risk: 'high' }
            },
            {
                input: { Status: 'Valid', Disposable_Domain: false, Role_Based: true },
                expected: { status: 'role', risk: 'low' }
            }
        ];

        for (const tc of testCases) {
            const actual = mapRawResponseToInternal(tc.input);
            expect(actual.status).toBe(tc.expected.status);
            expect(actual.risk).toBe(tc.expected.risk);
        }
    });
});
