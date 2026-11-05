import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const webRoot = resolve(projectRoot, 'public');

async function filesIn(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(entry => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? filesIn(path) : [path];
    }));
    return files.flat();
}

test('assets and imports resolve with public/ served as either the root or a subdirectory', async () => {
    for (const path of await filesIn(webRoot)) {
        if (path.startsWith(resolve(webRoot, 'dashboard/vendor'))) continue;
        const extension = extname(path);
        if (!['.html', '.js'].includes(extension)) continue;
        const source = await readFile(path, 'utf8');
        const references = extension === '.html'
            ? [...source.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])
            : [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
        for (const reference of references) {
            if (/^(https?:|data:|#)/.test(reference)) continue;
            for (const prefix of ['', '/public']) {
                const pagePath = relative(webRoot, path).split(sep).join('/');
                const asset = new URL(reference, `http://localhost${prefix}/${pagePath}`);
                assert.ok(asset.pathname.startsWith(`${prefix}/`), `${path}: ${reference} escapes the app subdirectory`);
                const target = resolve(webRoot, asset.pathname.slice(prefix.length + 1));
                assert.ok((await stat(target)).isFile(), `${path}: missing ${reference}`);
            }
        }
    }
});

test('Hosting entry points and legacy aliases target existing public pages', async () => {
    const config = JSON.parse(await readFile(resolve(projectRoot, 'firebase.json'), 'utf8'));
    assert.equal(config.hosting.public, 'public');
    for (const redirect of config.hosting.redirects) {
        assert.ok((await stat(resolve(webRoot, redirect.destination.replace(/^\//, '')))).isFile());
    }
    for (const source of ['/', '/Login-page/login.html', '/Login-page/accept-invitation.html', '/dashboard/dashboard.html']) {
        assert.ok(config.hosting.redirects.some(redirect => redirect.source === source), source);
    }
    assert.ok((await stat(resolve(projectRoot, config.firestore.rules))).isFile());
    assert.ok((await stat(resolve(projectRoot, config.functions[0].source, 'package.json'))).isFile());
});
