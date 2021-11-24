import { spawn, execSync, ChildProcess } from 'child_process';
import { Duplex } from "stream";
import { promisify } from 'util';
import * as yup from 'yup';
import fs from 'fs';
import _ from 'lodash';
import { join as joinPath, dirname } from 'path';
import { createProxyServer } from 'http-proxy';

import { IncomingMessage } from 'http';
import { match } from "path-to-regexp";
import getPort from "get-port";
import { Configuration, LocalDriverConfiguration } from './schemas';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { retry } from './utils';
import { Either, Left, Right } from 'purify-ts';
import { RequestHandler } from './controllers';
import { Context, Request } from 'koa';
import Bluebird from 'bluebird';
import { Watchdog } from './watchdog';

const WEBDRIVER_ERRORS = {
  INVALID_SESSION_ID: {
    code: 404,
    error: 'invalid session id'
  },
  SESSION_NOT_CREATED: {
    code: 500,
    error: 'session not created',
  },
  UNKNOWN_ERROR: {
    code: 500,
    error: 'unknown error',
  },
};

const AUTO_CMD_ERRORS = {
  NOT_SUPPORTED: {
    code: 500,
    error: 'not supported'
  },
  UNKNOWN_ERROR: {
    code: 500,
    error: 'unknown error',
  },
}

const rmAsync = promisify(fs.rm);
const alwaysTrue = () => true;
const identity = (i: any) => i;

interface WebdriverError<T = unknown> {
  code: number;
  error: string;
  message: string;
  stacktrace: string;
  data?: T;
}

// just a alias
interface AutoCmdError<T = unknown> extends WebdriverError<T> {
}


class AutoCmdProcess {
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
      const data = JSON.stringify({args: 'health_check'});
      // wait for auto-cmd-http server ready
      await retry(async () => await autoCmdProcess.axios.post('/', data), { max: 10, interval: 1e3 });
    }
  }


  get isWindows() {
    return "win32" === process.platform;
  }

  killProcessGroup(process: ChildProcess) {
    if (!process.killed) {
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
    // a path start with // means relative to the configuration file
    if (path.startsWith('//')) {
      path = joinPath(dirname(this.config.configFilePath), params.path.substring(1));
    }
    console.log(`start webdriver process ${path} ${params.args}`);

    const webdriverProcess = spawn(path, [...params.args, `--port=${port}`],
      {
        stdio: 'inherit', detached: !this.isWindows, windowsHide: this.isWindows,
        env: { ...process.env, ...params.envs, }
      });
    return { port, webdriverProcess };
  }

  async getOrSpawnAutoCmdProcess() {
    const path = this.config.autoCmdPath;
    if (!path) return null;
    const args = this.config.autoCmdArgs;

    if (this.autoCmdProcess && this.autoCmdProcess.isActive) return this.autoCmdProcess;
    const port = await getPort();
    const autoCmdprocess = spawn(path, [...args, `--port=${port}`],
      { stdio: 'inherit', windowsHide: this.isWindows, env: process.env }
    );
    this.autoCmdProcess = new AutoCmdProcess(autoCmdprocess, port);
    return this.autoCmdProcess;
  }

}

const CUSTOM_CAPS = {
  TAGS: 'sf:tags',
  ENVS: 'sf:envs',
  CLEAN_DATA: 'sf:cleanData',
};



class RequestCapabilities {

  get data(): any {
    return this.request.body;
  }

  constructor(private request: Request) { }

  get href() { return this.request.href.replace(/\/$/, ""); }

  getSessionBaseUrl(isWebsocket: boolean) {
    let proto = this.request.protocol;
    if (isWebsocket) {
      proto = {
        'http': 'ws',
        'https': 'wss',
      }[proto] || 'ws';
    }
    return `${proto}://${this.request.host}${this.request.path}`;
  }

  get browserName() { return this.getValue('browserName'); }
  get browserVersion() { return this.getValue('browserVersion'); }
  get platformName() { return this.getValue('platformName'); }

  get tags(): string[] | undefined {
    const tags = this.getValue(CUSTOM_CAPS.TAGS);
    if (yup.array(yup.string().defined()).defined().isValidSync(tags)) {
      return tags;
    }
  }

  get envs(): any { return this.getValue(CUSTOM_CAPS.ENVS) || {}; }

  get cleanData(): boolean | undefined {
    const cleanData = this.getValue(CUSTOM_CAPS.CLEAN_DATA);
    if ('boolean' == typeof cleanData) {
      return cleanData;
    }
  }

  getValue(key: string): unknown {
    const caps = this.data.capabilities?.alwaysMatch || this.data.desiredCapabilities || {};
    return caps[key];
  }

  get sanitizedCapbilities() {
    const caps = _.cloneDeep(this.data || {});
    for (const key of ['browserVersion', 'extOptions', 'tags', ...Object.values(CUSTOM_CAPS)]) {
      if (caps.desiredCapabilities) {
        delete caps.desiredCapabilities[key];
      }
      if (caps.capabilities?.alwaysMatch) {
        delete caps.capabilities.alwaysMatch[key];
      }
    }
    return caps;
  }
}

class ResponseCapabilities {

  private data: any

  constructor(private raw: any, private request: RequestCapabilities) {
    // w3c || json wired
    this.data = raw?.value || raw;
  }

  get sessionId() {
    return this.data?.sessionId;
  }

  get sessionBaseUrl() {
    return `${this.request}`

  }

  get browserVersion() {
    return this.data?.capabilities?.browserVersion;
  }

  get chromeDebuggerAddress() {
    return this.data?.capabilities?.["goog:chromeOptions"]?.debuggerAddress;
  }

  get cdpEndpoint() {
    return `${this.request.getSessionBaseUrl(true)}/${this.sessionId}/se/cdp`;
  }

  get chromeUserDataDir() {
    return this.data?.capabilities?.chrome?.userDataDir;
  }

  get jsonObject() {
    const raw = _.cloneDeep(this.raw);
    // w3c || json wired
    const data = raw.value || raw;
    // TODO: firefox in the future
    if (this.chromeDebuggerAddress) {
      data.capabilities['se:cdp'] = this.cdpEndpoint;
      data.capabilities['se:cdpVersion'] = this.browserVersion;
    }
    return raw;
  }
}

export class WebdirverSession {

  public response?: ResponseCapabilities;
  private process?: ChildProcess;
  private port?: number;

  constructor(
    public request: RequestCapabilities,
    private webdriverConfiguration: LocalDriverConfiguration,
    private processManager: ProcessManager,
    private axios: AxiosInstance,
  ) { }

  get id(): string {
    const sessionId = this.response?.sessionId;
    if (!sessionId || 'string' != typeof sessionId) {
      throw new Error(`sessionId is invalid: ${sessionId}`);
    }
    return sessionId;
  }

  get cleanData(): boolean {
    const cleanData = this.request?.cleanData;
    // priority: request > config > default (true)
    return _.isNil(cleanData) ? this.webdriverConfiguration.cleanData : cleanData;
  }

  get debuggerAddress() {
    return this.response?.chromeDebuggerAddress;
  }

  async getCdpEndpoint() {
    if (!this.debuggerAddress) return;
    const res = await this.axios.request({
      baseURL: 'http://' + this.debuggerAddress,
      url: '/json/version',
      method: 'GET',
    });
    return res.data?.webSocketDebuggerUrl as string;
  }

  async start() {
    const { port, webdriverProcess } = await this.processManager.spawnWebdriverProcess({
      path: this.webdriverConfiguration.webdriverPath,
      envs: { ...this.webdriverConfiguration.webdriverEnvs, ...this.request.envs },
      args: this.webdriverConfiguration.webdriverArgs,
    });
    this.port = port;
    this.process = webdriverProcess;
    this.axios.defaults.baseURL = `http://localhost:${this.port}`;
    await this.waitForReady();
    const res = await this.createSession(this.request);
    this.response = res;
    return res;
  }

  async stop() {
    await this.axios.delete(`/session/${this.id}`);
    this.killProcessGroup();
    const userDataDir = this.response?.chromeUserDataDir;
    if (this.cleanData && userDataDir) {
      try {
        console.log(`clean data: ${userDataDir}`);
        await rmAsync(userDataDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`ignore error during rm ${userDataDir}`, e);
      }
    }
  }

  async forward(request: AxiosRequestConfig) {
    return await this.axios.request(request);
  }

  private async waitForReady() {
    await retry(async () => await this.axios.get('/status'), { max: 10, interval: 1e2 });
  }

  private async createSession(request: RequestCapabilities) {
    const res = await this.axios.post('/session', this.withDefaultCaps(request.sanitizedCapbilities));

    return new ResponseCapabilities(res.data, request);
  }

  private withDefaultCaps(caps: any) {
    return _.defaultsDeep(this.webdriverConfiguration.defaultCapabilities || {}, caps || {});
  }

  private killProcessGroup() {
    if (this.process) {
      try {
        this.processManager.killProcessGroup(this.process)
      } catch (e) {
        console.warn(`ingore error during kill process`, e);
      }
    }
  }
}

export class LocalWebdriverManager {
  private readonly sessions: Map<string, WebdirverSession> = new Map();
  private readonly watchDogs: WeakMap<WebdirverSession, Watchdog> = new WeakMap();
  private pendingSessions: number = 0;

  constructor(
    private config: Configuration,
    private driverConfig: LocalDriverConfiguration,
    private readonly processManager: ProcessManager,
  ) { }

  isMatch(request: RequestCapabilities): boolean {
    if (request.browserName && request.browserName != this.driverConfig.browserName) {
      return false;
    }
    if (request.browserVersion && this.driverConfig.browserVersion && request.browserVersion != this.driverConfig.browserVersion) {
      return false;
    }
    if (request.platformName && request.platformName != this.driverConfig.platformName) {
      return false;
    }
    if (request.tags && request.tags.every(tag => !this.driverConfig.tags.includes(tag))) {
      return false;
    }
    return true;
  }

  getScore(request: RequestCapabilities) {
    return this.availableSlots / this.driverConfig.maxSessions;
  }

  get busySlots() {
    return this.sessions.size + this.pendingSessions;
  }

  get availableSlots() {
    return this.driverConfig.maxSessions - this.busySlots;
  }

  get activeSessions() {
    return this.sessions.values();
  }

  get sessionTimeoutInSeconds() {
    return this.driverConfig.browserIdleTimeout || this.config.browserIdleTimeout;
  }

  public hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  public async makeSession(request: RequestCapabilities): Promise<ResponseCapabilities> {
    let session!: WebdirverSession;
    try {
      this.pendingSessions++;
      session = new WebdirverSession(
        request,
        this.driverConfig,
        this.processManager,
        axios.create({ timeout: 30e3 })
      );
      const res = await session.start();
      this.addSession(session);

      const watchDog = new Watchdog(() => this.destroySession(session.id), this.sessionTimeoutInSeconds);
      this.watchDogs.set(session, watchDog);

      return res;
    } catch (e) {
      if (session) {
        await session.stop();
      }
      throw e;
    } finally {
      this.pendingSessions--;
    }
  }

  public async destroySession(sessionId: string) {
    const session = this.getSession(sessionId);
    if (!session) {
      console.warn(`No session with id ${sessionId} to destroy!`)
      return;
    }
    this.watchDogs.get(session)?.stop();
    await session.stop();
    this.deleteSession(sessionId);
  }

  public getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.watchDogs.get(session)?.feed();
    }
    return session;
  }

  private addSession(session: WebdirverSession) {
    this.sessions.set(session.id, session);
  }

  private deleteSession(id: string) {
    this.sessions.delete(id);
  }
}

export class LocalService {

  static of(config: Configuration, processManager: ProcessManager) {
    if (!config.localDrivers || config.localDrivers.length < 1) {
      throw new Error(`At least one localDrivers must be configed!`);
    }
    return new LocalService(
      config,
      config.localDrivers.map(localDriver => new LocalWebdriverManager(config, localDriver, processManager)),
      processManager,
    );
  }

  constructor(
    private readonly config: Configuration,
    private readonly localDriverManagers: LocalWebdriverManager[],
    private readonly processManager: ProcessManager,
  ) { }

  init() {
    ['SIGINT', 'SIGTERM'].forEach(signal => {
      process.on(signal, () => {
        console.log(`terminating...`);
        return this.forceTerminate().then(() => {
          process.exit();
        });
      })
    })
  }

  public get busySlots() {
    return _.sumBy(this.localDriverManagers, driver => driver.busySlots);
  }

  public get availableSlots() {
    return this.config.maxSessions - this.busySlots;
  }

  public getMatchedWebdrivers(request: RequestCapabilities): LocalWebdriverManager[] {
    return this.localDriverManagers.filter(driver => driver.isMatch(request));
  }

  public getAvailableWebdrivers(request: RequestCapabilities): LocalWebdriverManager[] {
    return this.getMatchedWebdrivers(request).filter(driver => driver.availableSlots > 0);
  }

  public getBestAvailableWebdirver(request: RequestCapabilities) {
    return _.maxBy(this.getAvailableWebdrivers(request), driver => driver.getScore(request))
  }

  public async newWebdirverSession(request: RequestCapabilities): Promise<Either<WebdriverError, ResponseCapabilities>> {
    if (!this.availableSlots) {
      return Left({
        ...WEBDRIVER_ERRORS.SESSION_NOT_CREATED,
        message: `no free slots in node ${this.config.uuid}`,
        stacktrace: new Error().stack || '',
      });
    }

    const driver = this.getBestAvailableWebdirver(request);
    if (!driver) {
      return Left({
        ...WEBDRIVER_ERRORS.SESSION_NOT_CREATED,
        message: `no availabe capbilities could be found`,
        stacktrace: new Error().stack || '',
      });
    }

    try {
      const res = await driver.makeSession(request);
      return Right(res);
    } catch (e) {
      return Left({
        ...WEBDRIVER_ERRORS.SESSION_NOT_CREATED,
        message: e.message || '',
        stacktrace: e.stack || '',
      });
    }
  }

  public async deleteWebdirverSession(sessiondId: string) {
    const driverManager = this.getWebdirverBySessionId(sessiondId);
    if (!driverManager) return;
    await driverManager.destroySession(sessiondId);
  }

  public async forwardWebdriverRequest(sessionId: string, path: string, request: AxiosRequestConfig): Promise<Either<WebdriverError, AxiosResponse>> {
    const session = this.getWebdriverSessionById(sessionId);
    if (!session) {
      return Left({
        ...WEBDRIVER_ERRORS.INVALID_SESSION_ID,
        message: `session id ${sessionId} is invalid`,
        stacktrace: new Error().stack || '',
      });
    }
    request.url = `/session/${sessionId}${path}`;
    request.validateStatus = alwaysTrue;
    request.transformRequest = identity;
    request.transformResponse = identity;
    try {
      const res = await session.forward(request);
      return Right(res);
    } catch (e) {
      return Left({
        ...WEBDRIVER_ERRORS.UNKNOWN_ERROR,
        message: e.message || '',
        stacktrace: e.stack || '',
      });
    }
  }

  public getWebdirverBySessionId(sessionId: string) {
    return this.localDriverManagers.find(driver => driver.hasSession(sessionId));
  }

  public getWebdriverSessionById(sessiondId: string) {
    for (const driverManager of this.localDriverManagers) {
      const session = driverManager.getSession(sessiondId);
      if (session) return session;
    }
  }

  private get activeSessions() {
    return _.flatMap(this.localDriverManagers, driver => [...driver.activeSessions]);
  }

  public async forceTerminate() {
    await Bluebird.map(this.activeSessions, async session => {
      await session.stop();
    }, { concurrency: 4 });
  }

  public async getCdpEndpointBySessionId(sessionId: string) {
    const webdriverSession = this.getWebdriverSessionById(sessionId);
    return await webdriverSession?.getCdpEndpoint();
  }

  public async forwardAutoCmdRequest(request: AxiosRequestConfig): Promise<Either<AutoCmdError,  AxiosResponse>> {

    try {
      const autoCmdProcess = await this.processManager.getOrSpawnAutoCmdProcess();
      if (!autoCmdProcess) {
        return Left({
          ...AUTO_CMD_ERRORS.NOT_SUPPORTED,
          message: `auto-cmd not supported on this node due to miss autoCmdPath in configuration`,
          stacktrace: new Error().stack || '',
        });
      }
      request.validateStatus = alwaysTrue;
      request.transformRequest = identity;
      request.transformResponse = identity;
      const res = await autoCmdProcess.axios.request(request);
      return Right(res);
    } catch(e) {
      return Left({
        ...AUTO_CMD_ERRORS.UNKNOWN_ERROR,
        message: e.message || '',
        stacktrace: e.stack || '',
      });
    }
  }
}

interface HttpResponse {
  headers: { [key: string]: string };
  body: string;
  jsonBody: any;
  status: number;
}

export class LocalServiceController {

  constructor(
    private readonly localService: LocalService,
  ) { }

  onNewWebdriverSessionRequest: RequestHandler = async (ctx, next) => {
    const request = new RequestCapabilities(ctx.request);
    const result = await this.localService.newWebdirverSession(request);
    result.ifLeft(err => {
      this.setHttpResponse(ctx, {
        status: err.code,
        jsonBody: { value: err },
      });
    }).ifRight(response => {
      this.setHttpResponse(ctx, {
        status: 200,
        jsonBody: response.jsonObject,
      });
    });
  }

  onDeleteWebdirverSessionRequest: RequestHandler = async (ctx, next) => {
    const { sessionId } = this.getSessionParams(ctx);
    await this.localService.deleteWebdirverSession(sessionId);
    this.setHttpResponse(ctx, {
      status: 200,
      jsonBody: { value: null },
    });
  }

  onWebdirverSessionRqeust: RequestHandler = async (ctx, next) => {
    const { sessionId, path } = this.getSessionParams(ctx);
    const fromRequest: Request = ctx.request;
    const toRequest: AxiosRequestConfig = {
      method: fromRequest.method as any,
      data: fromRequest.rawBody,
      headers: fromRequest.headers,
      params: fromRequest.query,
      timeout: 30e3,
    };

    const result = await this.localService.forwardWebdriverRequest(sessionId, path, toRequest);
    result.ifLeft(err => {
      this.setHttpResponse(ctx, {
        status: err.code,
        jsonBody: { value: err },
      });
    }).ifRight(response => {
      this.setHttpResponse(ctx, {
        status: 200,
        body: response.data,
        headers: response.headers,
      });
    });
  }

  onError: RequestHandler = (ctx, next) => {
    next().catch(e => {
      this.setHttpResponse(ctx, {
        status: 500,
        jsonBody: {
          ...WEBDRIVER_ERRORS.UNKNOWN_ERROR,
          message: e.message || '',
          stacktrace: e.stack || '',
        }
      });
    });
  }

  onWebsocketUpgrade = async (req: IncomingMessage, socket: Duplex, header: Buffer) => {
    const sessionId = this.getSessionIdFromPath(req.url);
    if (!sessionId) {
      return socket.destroy();
    }
    const cdpEndpoint = await this.localService.getCdpEndpointBySessionId(sessionId);
    if (!cdpEndpoint) {
      return socket.destroy();
    }
    // FIXME: I'am not should if the proxy will get reclaimed by the system.
    // Potential memory leak risk alert!
    const proxy = createProxyServer({
      target: cdpEndpoint,
    });
    proxy.ws(req, socket, header);
  }

  onAutoCmdRequest: RequestHandler = async (ctx, next) => {
    const fromRequest: Request = ctx.request;
    const toRequest: AxiosRequestConfig = {
      method: fromRequest.method as any,
      data: fromRequest.rawBody,
      headers: fromRequest.headers,
      params: fromRequest.query,
      timeout: 30e3,
    }

    const result = await this.localService.forwardAutoCmdRequest(toRequest);
    result.ifLeft(err => {
      this.setHttpResponse(ctx, {
        status: err.code,
        jsonBody: { value: err },
      });
    }).ifRight(response => {
      this.setHttpResponse(ctx, {
        status: 200,
        body: response.data,
        headers: response.headers,
      });
    });
  }

  private cdpPathPattern = match<{ sessionId: string }>('/wd/hub/session/:sessionId/se/cdp', { decode: decodeURIComponent });

  private getSessionIdFromPath(pathname?: string) {
    if (!pathname) return;
    const match = this.cdpPathPattern(pathname);
    return match ? match?.params?.sessionId : undefined;
  }

  private setHttpResponse = (ctx: Context, response: Partial<HttpResponse>) => {
    if (response.status) {
      ctx.status = response.status;
    }
    if (response.headers) {
      ctx.set(response.headers);
    }
    if (void 0 != response.body) {
      ctx.body = response.body;
    } else if (response.jsonBody) {
      ctx.body = JSON.stringify(response.jsonBody);
    }
  }

  private getSessionParams = (ctx: Context) => {
    const params = ctx?.params;
    const sessionId = params?.sessionId;
    if (!sessionId) {
      throw new Error(`sessionId is empty`);
    }
    return { sessionId, path: params[0] ? '/' + params[0] : '' };
  }
}
