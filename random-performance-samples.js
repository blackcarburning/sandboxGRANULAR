(function (scope) {
    'use strict';
    // Independent of browser folder selection and all drum/bass randomizers.
    const sources = Object.freeze(['samples_vocal', 'samples_piano', 'samples_orch', 'sampledrop', 'sampledrop2', 'splice_claw']);
    const excludedFolder = /(?:^|[^a-z])(?:bass(?:es)?|drums?|drumkits?|percussion|kicks?|snares?|hi[ _-]?hats?|hats?|cymbals?)(?:$|[^a-z])/i;
    function eligibleFile(file, sourceKey) {
        if (!sources.includes(sourceKey) || (file?.sourceKey && file.sourceKey !== sourceKey)) return false;
        const path = file?.relativePath;
        if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || /[\x00-\x1f]/.test(path)) return false;
        const parts = path.split('/');
        if (parts.some(part => !part || part === '.' || part === '..')) return false;
        if (!/\.(wav|wave|mp3|ogg|flac|m4a|aiff?|aac|opus)$/i.test(parts.at(-1))) return false;
        return !parts.slice(0, -1).some(part => excludedFolder.test(part));
    }
    async function chooseSample({ catalogUrl, fetch: request = scope.fetch.bind(scope), signal, guard = () => {}, current = null, random = Math.random }) {
        const folders = [...sources];
        for (let index = folders.length - 1; index > 0; index--) {
            const pick = Math.floor(random() * (index + 1));
            [folders[index], folders[pick]] = [folders[pick], folders[index]];
        }
        let lastError;
        for (const sourceKey of folders) {
            guard();
            if (signal?.aborted) throw new Error('Random sample load cancelled.');
            try {
                const url = new URL(catalogUrl); url.searchParams.set('source', sourceKey);
                const response = await request(url.href, { cache: 'no-store', signal });
                if (response.status === 401 || response.status === 403) throw Object.assign(new Error('Sign in again before loading a random sample.'), { authentication: true });
                const payload = await response.json();
                guard();
                if (!response.ok || !payload.ok) throw new Error(payload.error || `Sample folder unavailable (${response.status}).`);
                if (payload.sourceKey && payload.sourceKey !== sourceKey) throw new Error('Sample folder identity did not match the requested folder.');
                const files = (Array.isArray(payload.files) ? payload.files : []).filter(file => eligibleFile(file, sourceKey)
                    && !(current?.sourceKey === sourceKey && current?.relativePath === file.relativePath));
                if (!files.length) continue;
                const selected = files[Math.floor(random() * files.length)];
                return { sourceKey, relativePath: selected.relativePath, fileName: selected.name || selected.relativePath.split('/').pop() };
            } catch (error) {
                guard();
                if (signal?.aborted || error.name === 'AbortError' || error.authentication) throw error;
                lastError = error;
            }
        }
        throw new Error(`No new eligible samples found in the six allowed folders.${lastError ? ` ${lastError.message}` : ''}`);
    }
    const api = Object.freeze({ sources, eligibleFile, chooseSample });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else scope.MygrainRandomSamples = api;
})(typeof window === 'object' ? window : globalThis);
