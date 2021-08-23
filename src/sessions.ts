import { execSync, spawn, ChildProcess } from "child_process";
import { logException, retry, Semaphore } from "./utils";
import getPort from "get-port";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { Request } from "koa";
import { isNil,} from "lodash";
import { cloneDeep, defaultsDeep, isEmpty } from "lodash";
import Bluebird from "bluebird";
import { newHttpError } from "./error";
import { SessionDto } from "./schemas";


export abstract class Session {
  public id?: string;
  public option?: any;
  public abstract start(request: Request): Promise<AxiosResponse>;
  public abstract stop(): Promise<void>;
  public abstract forward(request: Request, path?: string): Promise<AxiosResponse>;

  toSessionDto(): SessionDto {
    return { id: this.id!, option: this.option };
  }
}


export class LocalSession extends Session {

  private port?: number;
  private childProcess?: ChildProcess;
  private semaphore: Semaphore;

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
    this.semaphore = new Semaphore(1);
  }

  public async start(request: Request) {
    try {
      return await this._start(request);
    } catch (e) {
      this.kill();
      throw newHttpError(500, e.message, { stack: e.stack });
    }
  }

  public async stop() {
    await Bluebird.delay(500);
    this.kill();
  }

  public async forward(request: Request, path?: string) {
    const url = `/${this.id}${isNil(path) ? '' : ('/' + path)}`;
    try {
      await this.semaphore.wait();
      return await axios.request(this.sanitizeRequest({
        baseURL: this.baseUrl,
        url,
        method: request.method as any,
        data: request.body,
        headers: request.headers,
        params: request.query,
        timeout: 120e3,
      }));
    } catch (e) {
      if (!e.response) throw newHttpError(500, e.message, { stack: e.stack });
      return e.response;
    } finally {
      this.semaphore.signal();
    }
  }

  private async _start(request: Request) {
    this.port = await getPort();
    this.childProcess = spawn(this.webdriverPath, [...this.args, `--port=${this.port}`],
      {
        stdio: 'inherit', detached: !this.isWindows, windowsHide: this.isWindows,
        env: { ...process.env, ...this.envs, ...getEnvsFromRequest(request.body) }
      });
    await Bluebird.delay(200); // wait for process ready to serve
    const requestData = sanitizeCreateSessionRequest(request.body, this.defaultCapabilities);
    const response = await retry<AxiosResponse>(
      () => axios.request({ method: 'POST', url: this.baseUrl, data: requestData, timeout: 5e3 }),
      {
        max: 5,
        interval: 1e3,
        condition: (e) => !e.response,
      });
    this.id = response?.data?.sessionId || response?.data?.value?.sessionId;
    this.option = requestData;
    if (!this.id) {
      throw newHttpError(500, "Invalid response!", response);
    }
    return response!;
  }

  public kill() {
    if (this.childProcess && !this.childProcess.killed) {
      try {
        if (this.isWindows) {
          execSync(`taskkill /T /F /PID ${this.childProcess.pid}`);
        } else {
          process.kill(-this.childProcess.pid!);
        }
      } catch (e) {
        logException(e);
      }
    }
  }

  private get isWindows() {
    return "win32" === process.platform;
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
      delete request.headers?.['content-length'];
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
      timeout: 60e3,
    });
    this.id = response?.data?.sessionId || response?.data?.value.sessionId;
    if (!response || !this.id) {
      throw newHttpError(500, "Invalid response!", response);
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
        timeout: 120e3,
      });
    } catch (e) {
      if (!e.response) throw newHttpError(500, e.message, { stack: e.stack });
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
    desiredCapabilities: defaultCaps,
  }) : _caps;
}

const getEnvsFromRequest = (requestBody: any) => {
  const caps = requestBody.desiredCapabilities || requestBody.capabilities?.alwaysMatch;
  return caps?.extOptions?.envs || {};
}