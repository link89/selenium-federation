import { execSync, spawn, ChildProcess } from "child_process";
import { retry } from "./utils";
import getPort from "get-port";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { Request } from "koa";
import { isNil,} from "lodash";
import { cloneDeep, defaultsDeep, isEmpty } from "lodash";


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
    private browserName: string,
    private webdriverPath: string,
    private args: string[],
    private envs: any,
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
    this.kill();
  }

  public async forward(request: Request, path?: string) {
    const url = `/${this.id}${isNil(path) ? '' : ('/' + path)}`;
    try {
      return await axios.request(this.sanitizeRequest({
        baseURL: this.baseUrl,
        url,
        method: request.method as any,
        data: request.body,
        headers: request.headers,
        params: request.query,
      }));
    } catch (e) {
      if (!e.response) throw e;
      return e.response;
    }
  }

  private async _start(request: Request) {
    this.port = await getPort();
    this.childProcess = spawn(this.webdriverPath, [...this.args, `--port=${this.port}`],
      { stdio: 'inherit', detached: true, env: { ...process.env, ...this.envs, ...getEnvs(request.body) } });
    const response = await retry<AxiosResponse>(
      () => axios.request({ method: 'POST', url: this.baseUrl, data: sanitizeCreateSessionRequest(request.body, this.defaultCapabilities) }),
      {
        max: 5,
        interval: 1e3,
        condition: (e) => !e.response,
      });
    this.id = response?.data?.sessionId || response?.data?.value?.sessionId;
    if (!response || !this.id) {
      throw Error(`Invalid response: ${JSON.stringify(response)}`);
    }
    return response;
  }

  private kill() {
    if (this.childProcess && !this.childProcess.killed) {
      try {
        if ("win32" === process.platform) {
          execSync(`taskkill /T /F /PID ${this.childProcess.pid}`);
        } else {
          process.kill(-this.childProcess.pid);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  private sanitizeRequest(request: AxiosRequestConfig) {
    const headers = { ...request.headers };
    delete headers.host;
    request.headers = headers;

    const method = request.method?.toUpperCase();
    if ('safari' == this.browserName && ('GET' === method || 'DELETE' == method) && isEmpty(request.data)) {
      // FIX: https://github.com/webdriverio/webdriverio/issues/3187
      // Request failed with status 400 due to Response has empty body on safari
      delete request.data;
    }
    return request;
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
      data: request.body,
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
    try {
      return await axios.request({
        baseURL: this.baseUrl,
        url,
        method: request.method as any,
        data: request.body,
        headers: request.headers,
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
  // some drivers are sensitive to invalid fields and values
  // work around by just removing those fields
  delete _caps?.desiredCapabilities?.extOptions;
  delete _caps?.capabilities?.alwaysMatch?.extOptions;
  delete _caps?.desiredCapabilities?.browserVersion;
  delete _caps?.capabilities?.alwaysMatch?.browserVersion;
  // merge with default capabilities
  return defaultCaps ? defaultsDeep(_caps, {
    capabilities: {
      alwaysMatch: defaultCaps,
    },
    desiredCapabilities: defaultCaps,
  }) : _caps;
}

const getEnvs = (requestBody: any) => {
  const caps = requestBody.desiredCapabilities || requestBody.capabilities?.alwaysMatch;
  return caps?.extOptions?.envs || {};
}