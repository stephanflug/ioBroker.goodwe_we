import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import * as readline from 'node:readline';

type RpcResponse = { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string };

/**
 *
 */
export interface SensorMeta {
    /**
     *
     */
    id: string;
    /**
     *
     */
    name: string;
    /**
     *
     */
    unit?: string;
}

/**
 * JSON-RPC-like client that communicates with a persistent Python worker process.
 */
export class GoodweRpc {
    private proc?: ChildProcessWithoutNullStreams;
    private rl?: readline.Interface;
    private nextId = 1;

    private readonly pending = new Map<
        number,
        {
            resolve: (v: unknown) => void;
            reject: (e: Error) => void;
        }
    >();

    /**
     * @param pythonExe Path to the Python executable (e.g. venv python).
     * @param scriptPath Path to the `goodwe_rpc.py` script.
     * @param args Arguments passed to the Python worker.
     */
    public constructor(
        private readonly pythonExe: string,
        private readonly scriptPath: string,
        private readonly args: string[],
    ) {}

    /**
     *
     */
    public start(): void {
        this.proc = spawn(this.pythonExe, [this.scriptPath, ...this.args], { stdio: ['pipe', 'pipe', 'pipe'] });

        this.proc.on('exit', code => {
            const err = new Error(`Python worker exited with code ${code}`);
            for (const [, p] of this.pending) {
                p.reject(err);
            }
            this.pending.clear();
        });

        this.rl = readline.createInterface({ input: this.proc.stdout });
        this.rl.on('line', line => {
            try {
                const msg = JSON.parse(line) as RpcResponse;
                const p = this.pending.get(msg.id);
                if (!p) {
                    return;
                }
                this.pending.delete(msg.id);

                if (msg.ok) {
                    p.resolve(msg.data);
                } else {
                    p.reject(new Error(msg.error));
                }
            } catch {
                // Ignore malformed output lines from the worker
            }
        });
    }

    /**
     *
     */
    public stop(): void {
        this.rl?.close();
        this.proc?.kill();
    }

    private call(cmd: string, value?: unknown): Promise<unknown> {
        if (!this.proc?.stdin.writable) {
            return Promise.reject(new Error('Python worker not running'));
        }

        const id = this.nextId++;
        const payload: Record<string, unknown> = { id, cmd };
        if (value !== undefined) {
            payload.value = value;
        }

        const p = new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });

        this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        return p;
    }

    /**
     *
     */
    public async getSensors(): Promise<SensorMeta[]> {
        return (await this.call('get_sensors')) as SensorMeta[];
    }

    /**
     *
     */
    public async readRuntime(): Promise<Record<string, unknown>> {
        return (await this.call('read_runtime')) as Record<string, unknown>;
    }

    /**
     *
     */
    public async getMinSoc(): Promise<{ min_soc: number; ongrid_dod: number }> {
        return (await this.call('get_min_soc')) as { min_soc: number; ongrid_dod: number };
    }

    /**
     *
     */
    public async setMinSoc(minSoc: number): Promise<unknown> {
        return this.call('set_min_soc', minSoc);
    }
}
