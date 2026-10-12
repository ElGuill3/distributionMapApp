import { copyFile, readdir, rmdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'static');
const generatedSuffixes = ['.d.ts.map', '.js.map', '.d.ts', '.js'];

async function cleanGeneratedOutput(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await cleanGeneratedOutput(target);
      await rmdir(target).catch(error => {
        if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') throw error;
      });
    } else if (generatedSuffixes.some(suffix => entry.name.endsWith(suffix))) {
      await rm(target);
    }
  }
}

function compileTypeScript() {
  const executable = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  );
  return new Promise((resolve, reject) => {
    const compiler = spawn(
      executable,
      ['--project', path.join(root, 'tsconfig.json')],
      {
        cwd: root,
        stdio: 'inherit',
        shell: false,
      }
    );
    compiler.once('error', reject);
    compiler.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`TypeScript compilation failed (${signal ?? `exit ${code}`}).`)
        );
    });
  });
}

await cleanGeneratedOutput(outputRoot);
await compileTypeScript();
await copyFile(
  path.join(root, 'frontend', 'src', 'styles', 'styles.css'),
  path.join(outputRoot, 'styles.css')
);
