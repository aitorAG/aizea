import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../..');

async function readJson<T>(relativePath: string): Promise<T> {
  const contents = await readFile(path.join(projectRoot, relativePath), 'utf8');
  return JSON.parse(contents) as T;
}

describe('release metadata parity', () => {
  it('keeps package, lockfile, changelog, and Tauri installer metadata aligned', async () => {
    const packageJson = await readJson<{ version: string }>('package.json');
    const packageLock = await readJson<{
      version: string;
      packages: { '': { version: string } };
    }>('package-lock.json');
    const tauriConfig = await readJson<{
      version: string;
      bundle: { targets: string[]; resources: Record<string, string> };
    }>('src-tauri/tauri.conf.json');
    const changelog = await readFile(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
    const newestHeading = changelog.match(/^## \[(.*?)\] — (\d{4}-\d{2}-\d{2})$/m);

    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[''].version).toBe(packageJson.version);
    expect(newestHeading?.[1]).toBe(packageJson.version);
    expect(newestHeading?.[2]).toBe('2026-10-09');
    expect(tauriConfig.version).toBe('../package.json');
    expect(tauriConfig.bundle.targets).toEqual(expect.arrayContaining(['msi', 'nsis']));
    expect(tauriConfig.bundle.resources['../.next/standalone']).toBe('standalone');
  });
});
