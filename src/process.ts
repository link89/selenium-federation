import axios, { AxiosInstance } from "axios";
import { spawn, execSync, ChildProcess } from 'child_process';
import getPort from "get-port";
import { Configuration } from "./types";
import { retry } from "./utils";

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
    if (!process.killed) {
      console.log(`kill process group ${process.pid}`);
      if (this.isWindows) {
        execSync(`taskkill /T /F /PID ${process.pid}`);
      } else {
        execSync(`kill -- -${process.pid}`);
      }
    }
  }

  async spawnWebdriverProcess(params: { path: string, args: string[], envs: { [key: string]: string } }) {
    const port = await getPort();
    let path = params.path;
    console.log(`start webdriver process ${path} ${params.args}`);
    const webdriverProcess = spawn(path, [...params.args, `--port=${port}`], {
      stdio: 'inherit', detached: !this.isWindows, windowsHide: this.isWindows,
      env: { ...process.env, ...params.envs, }
    });
    return { port, webdriverProcess };
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