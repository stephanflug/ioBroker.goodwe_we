"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var goodweRpc_exports = {};
__export(goodweRpc_exports, {
  GoodweRpc: () => GoodweRpc
});
module.exports = __toCommonJS(goodweRpc_exports);
var import_node_child_process = require("node:child_process");
var readline = __toESM(require("node:readline"));
class GoodweRpc {
  /**
   * @param pythonExe Path to the Python executable (e.g. venv python).
   * @param scriptPath Path to the `goodwe_rpc.py` script.
   * @param args Arguments passed to the Python worker.
   */
  constructor(pythonExe, scriptPath, args) {
    this.pythonExe = pythonExe;
    this.scriptPath = scriptPath;
    this.args = args;
  }
  proc;
  rl;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  /**
   *
   */
  start() {
    this.proc = (0, import_node_child_process.spawn)(this.pythonExe, [this.scriptPath, ...this.args], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.on("exit", (code) => {
      const err = new Error(`Python worker exited with code ${code}`);
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
    });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
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
      }
    });
  }
  /**
   *
   */
  stop() {
    var _a, _b;
    (_a = this.rl) == null ? void 0 : _a.close();
    (_b = this.proc) == null ? void 0 : _b.kill();
  }
  call(cmd, value) {
    var _a;
    if (!((_a = this.proc) == null ? void 0 : _a.stdin.writable)) {
      return Promise.reject(new Error("Python worker not running"));
    }
    const id = this.nextId++;
    const payload = { id, cmd };
    if (value !== void 0) {
      payload.value = value;
    }
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.proc.stdin.write(`${JSON.stringify(payload)}
`);
    return p;
  }
  /**
   *
   */
  async getSensors() {
    return await this.call("get_sensors");
  }
  /**
   *
   */
  async readRuntime() {
    return await this.call("read_runtime");
  }
  /**
   *
   */
  async getMinSoc() {
    return await this.call("get_min_soc");
  }
  /**
   *
   */
  async setMinSoc(minSoc) {
    return this.call("set_min_soc", minSoc);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GoodweRpc
});
//# sourceMappingURL=goodweRpc.js.map
