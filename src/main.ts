import * as utils from '@iobroker/adapter-core';
import * as path from 'node:path';
import { GoodweRpc, type SensorMeta } from './lib/goodweRpc';
import { PythonEnv } from './lib/pythonEnv';

type Protocol = 'UDP' | 'TCP';

interface GoodweWeConfig extends ioBroker.AdapterConfig {
    host: string;
    pollInterval: number;
    protocol: Protocol;
    pythonCmd: string;
    pythonArgs: string;
    pythonPackages: string;
    timeout: number;
    retries: number;
}

class GoodweWe extends utils.Adapter {
    private rpc?: GoodweRpc;
    private pollTimer?: ioBroker.Interval;
    private sensorMeta = new Map<string, SensorMeta>();

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'goodwe_we' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private unitToRole(unit?: string): string | undefined {
        switch (unit) {
            case 'V':
                return 'value.voltage';
            case 'A':
                return 'value.current';
            case 'W':
                return 'value.power';
            case 'kWh':
                return 'value.energy';
            case 'Hz':
                return 'value.frequency';
            case '°C':
                return 'value.temperature';
            case '%':
                return 'level';
            default:
                return undefined;
        }
    }

    private async ensureBasics(): Promise<void> {
        await this.setObjectNotExistsAsync('info', { type: 'channel', common: { name: 'Info' }, native: {} });
        await this.setObjectNotExistsAsync('runtime', { type: 'channel', common: { name: 'Runtime' }, native: {} });
        await this.setObjectNotExistsAsync('control', { type: 'channel', common: { name: 'Control' }, native: {} });

        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: { name: 'Connected', type: 'boolean', role: 'indicator.connected', read: true, write: false },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.lastUpdate', {
            type: 'state',
            common: { name: 'Last update (ISO)', type: 'string', role: 'text', read: true, write: false },
            native: {},
        });

        await this.setObjectNotExistsAsync('control.minSoc', {
            type: 'state',
            common: {
                name: 'Reserve SOC (Min SOC)',
                type: 'number',
                role: 'level',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: true,
            },
            native: {},
        });
    }

    private async ensureRuntimeState(key: string, sampleValue: unknown): Promise<void> {
        const id = `runtime.${key}`;
        const meta = this.sensorMeta.get(key);

        const type =
            typeof sampleValue === 'number' ? 'number' : typeof sampleValue === 'boolean' ? 'boolean' : 'string';

        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: {
                name: meta?.name ?? key,
                type,
                read: true,
                write: false,
                unit: meta?.unit,
                role: meta?.unit
                    ? (this.unitToRole(meta.unit) ?? (type === 'string' ? 'text' : 'value'))
                    : type === 'string'
                      ? 'text'
                      : 'value',
            },
            native: {},
        });
    }

    private async refreshMinSoc(): Promise<void> {
        if (!this.rpc) {
            return;
        }
        const soc = await this.rpc.getMinSoc();
        await this.setStateAsync('control.minSoc', soc.min_soc, true);
    }

    private async pollOnce(): Promise<void> {
        if (!this.rpc) {
            return;
        }

        try {
            const data = await this.rpc.readRuntime();

            await this.setStateAsync('info.connection', true, true);
            await this.setStateAsync('info.lastUpdate', new Date().toISOString(), true);

            for (const [k, v] of Object.entries(data)) {
                await this.ensureRuntimeState(k, v);

                let stateVal: ioBroker.StateValue;
                if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
                    stateVal = v;
                } else if (v === null || v === undefined) {
                    stateVal = null;
                } else {
                    stateVal = JSON.stringify(v);
                }

                await this.setStateAsync(`runtime.${k}`, stateVal, true);
            }
        } catch (e: any) {
            this.log.warn(`Poll failed: ${e?.message ?? e}`);
            await this.setStateAsync('info.connection', false, true);
        }
    }

    private async onReady(): Promise<void> {
        await this.ensureBasics();

        const cfg = this.config as unknown as GoodweWeConfig;

        const host = String(cfg.host || '');
        if (!host) {
            this.log.error('No host configured.');
            await this.setStateAsync('info.connection', false, true);
            return;
        }

        const protocol = String(cfg.protocol || 'UDP').toUpperCase() as Protocol;
        const pollSec = Number(cfg.pollInterval || 10);
        const timeout = Number(cfg.timeout || 5);
        const retries = Number(cfg.retries || 20);

        const pythonCmd = String(cfg.pythonCmd || (process.platform === 'win32' ? 'py' : 'python3'));
        const pythonArgs = String(cfg.pythonArgs || (process.platform === 'win32' ? '-3' : ''));
        const pythonPackages = String(cfg.pythonPackages || 'goodwe>=0.4.8,<1.0');

        const dataDir = utils.getAbsoluteInstanceDataDir(this);
        const venvPython = await PythonEnv.ensureVenv(dataDir, { pythonCmd, pythonArgs, pythonPackages }, s =>
            this.log.info(s),
        );

        const scriptPath = path.join(__dirname, '..', 'python', 'goodwe_rpc.py');

        this.rpc = new GoodweRpc(venvPython, scriptPath, [
            '--host',
            host,
            '--protocol',
            protocol,
            '--timeout',
            String(timeout),
            '--retries',
            String(retries),
        ]);
        this.rpc.start();

        try {
            const sensors = await this.rpc.getSensors();
            for (const s of sensors) {
                this.sensorMeta.set(s.id, s);
            }
        } catch (e: any) {
            this.log.warn(`getSensors failed (continuing without meta): ${e?.message ?? e}`);
        }

        this.subscribeStates('control.*');

        await this.refreshMinSoc();
        await this.pollOnce();

        this.pollTimer = this.setInterval(async () => {
            await this.pollOnce();
        }, pollSec * 1000);
    }

    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state || state.ack) {
            return;
        }
        if (!this.rpc) {
            return;
        }

        const rel = id.replace(`${this.namespace}.`, '');
        if (rel !== 'control.minSoc') {
            return;
        }

        try {
            const minSoc = Math.max(0, Math.min(100, Number(state.val)));
            await this.rpc.setMinSoc(minSoc);
            await this.refreshMinSoc();
            await this.pollOnce();
        } catch (e: any) {
            this.log.warn(`setMinSoc failed: ${e?.message ?? e}`);
            await this.refreshMinSoc();
        }
    }

    private onUnload(callback: () => void): void {
        try {
            if (this.pollTimer) {
                this.clearInterval(this.pollTimer);
            }
            this.rpc?.stop();
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new GoodweWe(options);
} else {
    (() => new GoodweWe())();
}
