import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

function splitArgs(argLine: string): string[] {
    return argLine.trim() ? argLine.trim().split(/\s+/) : [];
}

export interface PythonEnvConfig {
    pythonCmd: string;
    pythonArgs: string;
    pythonPackages: string;
}

export class PythonEnv {
    /**
     * @param dataDir Adapter instance data directory.
     * @param cfg Python environment configuration.
     * @param log Logger callback.
     */
    public static async ensureVenv(dataDir: string, cfg: PythonEnvConfig, log: (s: string) => void): Promise<string> {
        const venvDir = path.join(dataDir, 'pyenv');
        const marker = path.join(venvDir, '.iobroker_goodwe_we_installed.json');

        const baseArgs = splitArgs(cfg.pythonArgs);
        const packages = cfg.pythonPackages.trim().split(/\s+/).filter(Boolean);

        await fs.mkdir(venvDir, { recursive: true });

        const venvPython =
            process.platform === 'win32'
                ? path.join(venvDir, 'Scripts', 'python.exe')
                : path.join(venvDir, 'bin', 'python');

        const needCreate = !(await exists(path.join(venvDir, 'pyvenv.cfg'))) || !(await exists(venvPython));
        if (needCreate) {
            log(`Creating venv in ${venvDir} ...`);
            await execFileAsync(cfg.pythonCmd, [...baseArgs, '-m', 'venv', venvDir], { timeout: 10 * 60_000 });
        }

        let installRequired = true;
        if (await exists(marker)) {
            try {
                const old = JSON.parse(await fs.readFile(marker, 'utf-8')) as {
                    pythonPackages?: string;
                };
                if (old?.pythonPackages === cfg.pythonPackages) {
                    installRequired = false;
                }
            } catch {
                // If marker cannot be parsed, re-install packages
            }
        }

        if (installRequired) {
            log('Installing Python packages in venv ...');
            await execFileAsync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { timeout: 10 * 60_000 });
            await execFileAsync(venvPython, ['-m', 'pip', 'install', '--upgrade', ...packages], {
                timeout: 10 * 60_000,
            });

            await fs.writeFile(
                marker,
                JSON.stringify({ pythonPackages: cfg.pythonPackages, ts: new Date().toISOString() }, null, 2),
            );
        }

        return venvPython;
    }
}
