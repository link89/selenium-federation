import axios, { AxiosInstance } from "axios";
import { spawn, execSync, ChildProcess } from 'child_process';
import getPort from "get-port";
import { Configuration } from "./types";
import { retry } from "./utils";

interface ProcessParams {
  path: string;
  args: string[];
  envs: { [key: string]: string };
  cwd?: string;
}

export class AutoCmdProcess {
  public readonly axios: AxiosInstance;

  constructor(
    private readonly process: ChildProcess,
    public readonly port: number,
  ) {
    this.axios = axios.create({
      baseURL: `http://localhost:${port}/auto-cmd/`,
    })
  }

  get isActive() {
    return !this.process.killed;
  }
}

export class ProcessManager {

  private autoCmdProcess?: AutoCmdProcess;

  constructor(
    private config: Configuration,
  ) { }

  async init() {
    const autoCmdProcess = await this.getOrSpawnAutoCmdProcess();
    if (autoCmdProcess) {
      const data = { args: 'health_check' };
      // wait for auto-cmd-http server ready
      await retry(async () => await autoCmdProcess.axios.post('/', data), { max: 20, interval: 1e3 });
    }
  }

  get isWindows() {
    return "win32" === process.platform;
  }

  killProcessGroup = (process: ChildProcess) => {
    if (!process.killed || null == process.exitCode ) {
      console.log(`kill process group ${process.pid}`);
      const cmd = this.isWindows ? `taskkill /T /F /PID ${process.pid}` : `kill -9 -- -${process.pid}`;
      try {
        execSync(cmd);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async spawnWebdriverProcess(params: ProcessParams) {
    const port = await getPort();
    let path = params.path;
    console.log(`start webdriver process ${path} ${params.args}`);
    const webdriverProcess = spawn(path, [...params.args, `--port=${port}`], {
      stdio: 'inherit', detached: !this.isWindows, windowsHide: this.isWindows,
      env: { ...process.env, ...params.envs, }, cwd: params.cwd,
    });
    return { port, webdriverProcess };
  }

  async spawnNodeJsProcess(params: ProcessParams) {
    const port = await getPort();
    let path = params.path;
    console.log(`start nodejs process ${path} ${params.args}`);
    const nodejsProcess = spawn(path, [...params.args, `--inspect=:${port}`, `-i`], {
      stdio: ['pipe', 1, 2], detached: !this.isWindows, windowsHide: this.isWindows,
      env: { ...process.env, ...params.envs, }, cwd: params.cwd,
    });
    return { port, nodejsProcess };
  }

  async getOrSpawnAutoCmdProcess() {
    if (this.autoCmdProcess && this.autoCmdProcess.isActive) return this.autoCmdProcess;
    if (!this.config.autoCmdHttp) return null;
    if (this.config.autoCmdHttp.disable) return null;

    const path = this.config.autoCmdHttp.path;
    if (!path) return null;

    const args = this.config.autoCmdHttp.args;
    const port = await getPort();
    const autoCmdprocess = spawn(path, [...args, `--port=${port}`],
      { stdio: 'inherit', windowsHide: this.isWindows, env: process.env }
    );
    // TODO: handle process error properly
    autoCmdprocess.on('error', (err) => console.error(err));
    this.autoCmdProcess = new AutoCmdProcess(autoCmdprocess, port);
    return this.autoCmdProcess;
  }
}