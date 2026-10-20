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
var pythonEnv_exports = {};
__export(pythonEnv_exports, {
  PythonEnv: () => PythonEnv
});
module.exports = __toCommonJS(pythonEnv_exports);
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var path = __toESM(require("node:path"));
var import_node_util = require("node:util");
var https = __toESM(require("node:https"));
var os = __toESM(require("node:os"));
const execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
async function exists(p) {
  try {
    await import_node_fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}
function splitArgs(argLine) {
  return argLine.trim() ? argLine.trim().split(/\s+/) : [];
}
async function downloadGetPip(destination) {
  const url = "https://bootstrap.pypa.io/get-pip.py";
  await new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 6e4 }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`PyPA bootstrap download failed (HTTP ${response.statusCode})`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          req.destroy(new Error("PyPA bootstrap exceeded 8 MB"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        import_node_fs.promises.writeFile(destination, Buffer.concat(chunks)).then(() => resolve(), reject);
      });
    });
    req.on("timeout", () => req.destroy(new Error("PyPA download timed out")));
    req.on("error", reject);
  });
}
class PythonEnv {
  /**
   * @param dataDir Adapter instance data directory.
   * @param cfg Python environment configuration.
   * @param log Logger callback.
   */
  static async ensureVenv(dataDir, cfg, log) {
    const venvDir = path.join(dataDir, "pyenv");
    const marker = path.join(venvDir, ".iobroker_goodwe_we_installed.json");
    const baseArgs = splitArgs(cfg.pythonArgs);
    const packages = cfg.pythonPackages.trim().split(/\s+/).filter(Boolean);
    await import_node_fs.promises.mkdir(venvDir, { recursive: true });
    const venvPython = process.platform === "win32" ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
    const needCreate = !await exists(path.join(venvDir, "pyvenv.cfg")) || !await exists(venvPython);
    if (needCreate) {
      log(`Creating venv in ${venvDir} ...`);
      await execFileAsync(cfg.pythonCmd, [...baseArgs, "-m", "venv", venvDir], { timeout: 10 * 6e4 });
    }
    const hasPip = async () => {
      try {
        await execFileAsync(venvPython, ["-m", "pip", "--version"], { timeout: 3e4 });
        return true;
      } catch {
        return false;
      }
    };
    if (!await hasPip()) {
      log("Python pip missing in venv; attempting automatic installation ...");
      try {
        await execFileAsync(venvPython, ["-m", "ensurepip", "--upgrade"], { timeout: 12e4 });
      } catch {}
      if (!await hasPip()) {
        try {
          await execFileAsync(cfg.pythonCmd, [...baseArgs, "-m", "pip", "--python", venvDir, "install", "--upgrade", "pip"], { timeout: 12e4 });
        } catch {}
      }
      if (!await hasPip()) {
        log("Installing pip from the official PyPA bootstrap (bootstrap.pypa.io) ...");
        const tempDir = await import_node_fs.promises.mkdtemp(path.join(os.tmpdir(), "goodwe-pip-"));
        try {
          const bootstrap = path.join(tempDir, "get-pip.py");
          await downloadGetPip(bootstrap);
          await execFileAsync(venvPython, [bootstrap, "--disable-pip-version-check"], { timeout: 6e5 });
        } catch (error) {
          throw new Error(`Unable to install pip in the Python environment: ${error instanceof Error ? error.message : String(error)}. Check HTTPS access to bootstrap.pypa.io and pypi.org and Python venv support.`);
        } finally {
          await import_node_fs.promises.rm(tempDir, { recursive: true, force: true });
        }
      }
      if (!await hasPip()) throw new Error("Python pip is unavailable after automatic installation.");
    }
    let installRequired = true;
    if (await exists(marker)) {
      try {
        const old = JSON.parse(await import_node_fs.promises.readFile(marker, "utf-8"));
        if ((old == null ? void 0 : old.pythonPackages) === cfg.pythonPackages) {
          installRequired = false;
        }
      } catch {
      }
    }
    if (installRequired) {
      log("Installing Python packages in venv ...");
      await execFileAsync(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], { timeout: 10 * 6e4 });
      await execFileAsync(venvPython, ["-m", "pip", "install", "--upgrade", ...packages], {
        timeout: 10 * 6e4
      });
      await import_node_fs.promises.writeFile(
        marker,
        JSON.stringify({ pythonPackages: cfg.pythonPackages, ts: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)
      );
    }
    return venvPython;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PythonEnv
});
//# sourceMappingURL=pythonEnv.js.map
