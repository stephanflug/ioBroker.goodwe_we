"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var path = __toESM(require("node:path"));
var import_goodweRpc = require("./lib/goodweRpc");
var import_pythonEnv = require("./lib/pythonEnv");
class GoodweWe extends utils.Adapter {
  rpc;
  pollTimer;
  sensorMeta = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    super({ ...options, name: "goodwe_we" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  unitToRole(unit) {
    switch (unit) {
      case "V":
        return "value.voltage";
      case "A":
        return "value.current";
      case "W":
        return "value.power";
      case "kWh":
        return "value.energy";
      case "Hz":
        return "value.frequency";
      case "\xB0C":
        return "value.temperature";
      case "%":
        return "level";
      default:
        return void 0;
    }
  }
  async ensureBasics() {
    await this.setObjectNotExistsAsync("info", { type: "channel", common: { name: "Info" }, native: {} });
    await this.setObjectNotExistsAsync("runtime", { type: "channel", common: { name: "Runtime" }, native: {} });
    await this.setObjectNotExistsAsync("control", { type: "channel", common: { name: "Control" }, native: {} });
    await this.setObjectNotExistsAsync("info.connection", {
      type: "state",
      common: { name: "Connected", type: "boolean", role: "indicator.connected", read: true, write: false },
      native: {}
    });
    await this.setObjectNotExistsAsync("info.lastUpdate", {
      type: "state",
      common: { name: "Last update (ISO)", type: "string", role: "text", read: true, write: false },
      native: {}
    });
    await this.setObjectNotExistsAsync("control.minSoc", {
      type: "state",
      common: {
        name: "Reserve SOC (Min SOC)",
        type: "number",
        role: "level",
        unit: "%",
        min: 0,
        max: 100,
        read: true,
        write: true
      },
      native: {}
    });
  }
  async ensureRuntimeState(key, sampleValue) {
    var _a, _b;
    const id = `runtime.${key}`;
    const meta = this.sensorMeta.get(key);
    const type = typeof sampleValue === "number" ? "number" : typeof sampleValue === "boolean" ? "boolean" : "string";
    await this.setObjectNotExistsAsync(id, {
      type: "state",
      common: {
        name: (_a = meta == null ? void 0 : meta.name) != null ? _a : key,
        type,
        read: true,
        write: false,
        unit: meta == null ? void 0 : meta.unit,
        role: (meta == null ? void 0 : meta.unit) ? (_b = this.unitToRole(meta.unit)) != null ? _b : type === "string" ? "text" : "value" : type === "string" ? "text" : "value"
      },
      native: {}
    });
  }
  async refreshMinSoc() {
    if (!this.rpc) {
      return;
    }
    const soc = await this.rpc.getMinSoc();
    await this.setStateAsync("control.minSoc", soc.min_soc, true);
  }
  async pollOnce() {
    var _a;
    if (!this.rpc) {
      return;
    }
    try {
      const data = await this.rpc.readRuntime();
      await this.setStateAsync("info.connection", true, true);
      await this.setStateAsync("info.lastUpdate", (/* @__PURE__ */ new Date()).toISOString(), true);
      for (const [k, v] of Object.entries(data)) {
        await this.ensureRuntimeState(k, v);
        let stateVal;
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
          stateVal = v;
        } else if (v === null || v === void 0) {
          stateVal = null;
        } else {
          stateVal = JSON.stringify(v);
        }
        await this.setStateAsync(`runtime.${k}`, stateVal, true);
      }
    } catch (e) {
      this.log.warn(`Poll failed: ${(_a = e == null ? void 0 : e.message) != null ? _a : e}`);
      await this.setStateAsync("info.connection", false, true);
    }
  }
  async onReady() {
    var _a;
    await this.ensureBasics();
    const cfg = this.config;
    const host = String(cfg.host || "");
    if (!host) {
      this.log.error("No host configured.");
      await this.setStateAsync("info.connection", false, true);
      return;
    }
    const protocol = String(cfg.protocol || "UDP").toUpperCase();
    const pollSec = Number(cfg.pollInterval || 10);
    const timeout = Number(cfg.timeout || 5);
    const retries = Number(cfg.retries || 20);
    const pythonCmd = String(cfg.pythonCmd || (process.platform === "win32" ? "py" : "python3"));
    const pythonArgs = String(cfg.pythonArgs || (process.platform === "win32" ? "-3" : ""));
    const pythonPackages = String(cfg.pythonPackages || "goodwe>=0.4.8,<1.0");
    const dataDir = utils.getAbsoluteInstanceDataDir(this);
    const venvPython = await import_pythonEnv.PythonEnv.ensureVenv(
      dataDir,
      { pythonCmd, pythonArgs, pythonPackages },
      (s) => this.log.info(s)
    );
    const scriptPath = path.join(__dirname, "..", "python", "goodwe_rpc.py");
    this.rpc = new import_goodweRpc.GoodweRpc(venvPython, scriptPath, [
      "--host",
      host,
      "--protocol",
      protocol,
      "--timeout",
      String(timeout),
      "--retries",
      String(retries)
    ]);
    this.rpc.start();
    try {
      const sensors = await this.rpc.getSensors();
      for (const s of sensors) {
        this.sensorMeta.set(s.id, s);
      }
    } catch (e) {
      this.log.warn(`getSensors failed (continuing without meta): ${(_a = e == null ? void 0 : e.message) != null ? _a : e}`);
    }
    this.subscribeStates("control.*");
    await this.refreshMinSoc();
    await this.pollOnce();
    this.pollTimer = this.setInterval(async () => {
      await this.pollOnce();
    }, pollSec * 1e3);
  }
  async onStateChange(id, state) {
    var _a;
    if (!state || state.ack) {
      return;
    }
    if (!this.rpc) {
      return;
    }
    const rel = id.replace(`${this.namespace}.`, "");
    if (rel !== "control.minSoc") {
      return;
    }
    try {
      const minSoc = Math.max(0, Math.min(100, Number(state.val)));
      await this.rpc.setMinSoc(minSoc);
      await this.refreshMinSoc();
      await this.pollOnce();
    } catch (e) {
      this.log.warn(`setMinSoc failed: ${(_a = e == null ? void 0 : e.message) != null ? _a : e}`);
      await this.refreshMinSoc();
    }
  }
  onUnload(callback) {
    var _a;
    try {
      if (this.pollTimer) {
        this.clearInterval(this.pollTimer);
      }
      (_a = this.rpc) == null ? void 0 : _a.stop();
      callback();
    } catch {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new GoodweWe(options);
} else {
  (() => new GoodweWe())();
}
//# sourceMappingURL=main.js.map
