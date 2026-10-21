import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as https from 'node:https';
import * as os from 'node:os';

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


/** Download the official PyPA bootstrap only when both local recovery methods fail. */
async function downloadGetPip(destination: string): Promise<void> {
    const url = 'https://bootstrap.pypa.io/get-pip.py';
    await new Promise<void>((resolve, reject) => {
        const req = https.get(url, { timeout: 60_000 }, response => {
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`PyPA bootstrap download failed (HTTP ${response.statusCode})`));
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > 8 * 1024 * 1024) {
                    req.destroy(new Error('PyPA bootstrap exceeded 8 MB'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
                fs.writeFile(destination, Buffer.concat(chunks)).then(() => resolve(), reject);
            });
        });
        req.on('timeout', () => req.destroy(new Error('PyPA download timed out')));
        req.on('error', reject);
    });
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

        let needCreate = !(await exists(path.join(venvDir, 'pyvenv.cfg'))) || !(await exists(venvPython));
        if (!needCreate) {
            try {
                const { stdout: baseVersion } = await execFileAsync(cfg.pythonCmd, [...baseArgs, '-c',
                    'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { timeout: 30_000 });
                const { stdout: venvVersion } = await execFileAsync(venvPython, ['-c',
                    'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { timeout: 30_000 });
                const config = await fs.readFile(path.join(venvDir, 'pyvenv.cfg'), 'utf-8');
                const storedVersion = /^version\s*=\s*(\d+\.\d+)/m.exec(config)?.[1];
                needCreate = baseVersion.trim() !== venvVersion.trim() || storedVersion !== venvVersion.trim();
            } catch {
                needCreate = true;
            }
        }
        if (needCreate) {
            log(`Creating a fresh Python venv in ${venvDir} ...`);
            await fs.rm(venvDir, { recursive: true, force: true });
            await execFileAsync(cfg.pythonCmd, [...baseArgs, '-m', 'venv', '--without-pip', venvDir], { timeout: 10 * 60_000 });
        }

        const hasPip = async (): Promise<boolean> => {
            try {
                await execFileAsync(venvPython, ['-m', 'pip', '--version'], { timeout: 30_000 });
                return true;
            } catch {
                return false;
            }
        };

        if (!(await hasPip())) {
            log('Python pip missing in venv; attempting automatic installation ...');
            try {
                await execFileAsync(venvPython, ['-m', 'ensurepip', '--upgrade'], { timeout: 120_000 });
            } catch {
                // Debian minimal images may omit ensurepip.
            }

            if (!(await hasPip())) {
                try {
                    await execFileAsync(cfg.pythonCmd, [
                        ...baseArgs, '-m', 'pip', '--python', venvDir, 'install', '--upgrade', 'pip',
                    ], { timeout: 120_000 });
                } catch {
                    // The system Python may not contain pip either.
                }
            }

            if (!(await hasPip())) {
                log('Installing pip from the official PyPA bootstrap (bootstrap.pypa.io) ...');
                const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goodwe-pip-'));
                try {
                    const bootstrap = path.join(tempDir, 'get-pip.py');
                    await downloadGetPip(bootstrap);
                    await execFileAsync(venvPython, [bootstrap, '--disable-pip-version-check'], {
                        timeout: 10 * 60_000,
                    });
                } catch (error) {
                    throw new Error(
                        `Unable to install pip in the Python environment: ${error instanceof Error ? error.message : String(error)}. ` +
                        'Check HTTPS access to bootstrap.pypa.io and pypi.org and Python venv support.',
                    );
                } finally {
                    await fs.rm(tempDir, { recursive: true, force: true });
                }
            }

            if (!(await hasPip())) {
                throw new Error('Python pip is unavailable after automatic installation.');
            }
        }

        let installRequired = true;
        if (await exists(marker)) {
            try {
                const old = JSON.parse(await fs.readFile(marker, 'utf-8')) as {
                    pythonPackages?: string;
                };
                if (old?.pythonPackages === cfg.pythonPackages) {
                    try {
                        await execFileAsync(venvPython, ['-c', 'import goodwe'], { timeout: 30_000 });
                        installRequired = false;
                    } catch {
                        log('Python package verification failed; reinstalling packages ...');
                    }
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
