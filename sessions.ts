import { spawn, ChildProcess} from "child_process";
import { retry } from "./utils";
import getPort from "get-port";
import axios, { AxiosResponse } from "axios";
import { Request } from "koa";
import { isNil,} from "lodash";
import { cloneDeep, defaultsDeep } from "lodash";


export abstract class Session {
  public id?: string;
  public abstract start(request: Request): Promise<AxiosResponse>;
  public abstract stop(): Promise<void>;
  public abstract forward(request: Request, path?: string): Promise<AxiosResponse>;
}


export class LocalSession extends Session {

  private port?: number;
  private childProcess?: ChildProcess;

  get baseUrl() {
    return `http://localhost:${this.port}/session`;
  }

  constructor(
    private webdriverPath: string,
    private args: string[],
    private defaultCapabilities: any,
  ) {
    super();
  }

  public async start(request: Request) {
    try {
      return await this._start(request);
    } catch (e) {
      this.kill();
      throw e;
    }
  }

  public async stop() {
    // firefox won't be closed after driver is got kill due to this bug:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1430064
    this.kill();
  }

  public async forward(request: Request, path?: string) {
    const url = `/${this.id}${isNil(path) ? '' : ('/' + path)}`;
    const headers = { ...request.headers };
    delete headers.host;
    try {
      return await axios.request({
        baseURL: this.baseUrl,
        url,
        method: request.method as any,
        data: request.body,
        headers,
        params: request.query,
      });
    } catch (e) {
      if (!e.response) throw e;
      return e.response;
    }
  }

  private async _start(request: Request) {
    this.port = await getPort();
    this.childProcess = spawn(this.webdriverPath, [...this.args, `--port=${this.port}`], { stdio: 'inherit' });
    const response = await retry<AxiosResponse>(
      () => axios.request({ method: 'POST', url: this.baseUrl, data: sanitizeCreateSessionRequest(request.body, this.defaultCapabilities) }),
      {
        max: 5,
        interval: 1e3,
        condition: (e) => !e.response,
      });
    this.id = response?.data?.sessionId || response?.data?.value.sessionId;
    if (!response || !this.id) {
      throw Error(`Invalid response: ${JSON.stringify(response)}`);
    }
    return response;
  }

  private kill() {
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill('SIGTERM');
    }
  }
}


export class RemoteSession extends Session {

  constructor(private baseUrl: string) {
    super();
  }

  public async start(request: Request) {
    const response = await axios.request({
      method: 'POST',
      baseURL: this.baseUrl,
      url: '/session',
      data: sanitizeCreateSessionRequest(request.body),
    });
    this.id = response?.data?.sessionId || response?.data?.value.sessionId;
    if (!response || !this.id) {
      throw Error(`Invalid response: ${JSON.stringify(response)}`);
    }
    return response;
  }

  public async stop() {
  }

  public async forward(request: Request, path?: string) {
    const url = `/session/${this.id}${isNil(path) ? '' : ('/' + path)}`;
    const headers = { ...request.headers };
    delete headers.host;
    try {
      return await axios.request({
        baseURL: this.baseUrl,
        url,
        method: request.method as any,
        data: request.body,
        headers,
        params: request.query,
      });
    } catch (e) {
      if (!e.response) throw e;
      return e.response;
    }
  }
}

const sanitizeCreateSessionRequest = (caps: any, defaultCaps?: any) => {
  const _caps = cloneDeep(caps);
  delete _caps?.capabilities;
  delete _caps?.desiredCapabilities?.extOptions;
  return defaultCaps ? defaultsDeep(_caps, { desiredCapabilities: defaultCaps }) : _caps;
}