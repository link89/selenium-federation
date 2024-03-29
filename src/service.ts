import _ from "lodash";
import * as yup from 'yup';
import { AutoCmdError, Configuration, DriverConfiguration, DriverDto, driverDtoSchema, NodeDto, nodeDtoSchema, RegisterDto, WebdriverError } from './types'; 
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { alwaysTrue, identity, retry, Semaphore } from './utils';
import { Either, Left, Right } from 'purify-ts';
import Bluebird from 'bluebird';
import { Watchdog } from './utils';
import { RequestCapabilities, ResponseCapabilities, createSession, ISession } from './session';
import { AUTO_CMD_ERRORS, LONG_TIMEOUT_IN_MS, REGISTER_TIMEOUT_IN_MS, WEBDRIVER_ERRORS } from './constants';
import { ProcessManager } from "./process";
import { Context } from "koa";
import { join } from 'path';
import send from 'koa-send';
import * as fs from 'fs';
import { setHttpResponse } from "./controllers";

export interface TerminateOptions {
  confirmed: boolean;
  force: boolean;
  cancel: boolean;
}

interface RegistedNode {
  url: string;
  node: NodeDto;
  expireAfter: number;
}

interface Candidate {
  nodeUrl: string;
  driver: DriverDto;
}

interface SessionRecord {
  nodeUrl: string;
  sessionId: string;
  createdAt: number;
}


export class HubService {

  private nodesIndex = new Map<string, RegistedNode>();
  private sessionCache = new Map<string, SessionRecord>();
  private createSessionMutex = new Semaphore(1);

  constructor(
    private config: Configuration,
    private axios: AxiosInstance,
  ) { }

  public init() {
    const sessionMaxAge = 300e3;  // 5 min in ms
    setInterval(() => this.cleanExpiredSessions(sessionMaxAge), sessionMaxAge);
  }

  async getBestMatch(request: RequestCapabilities): Promise<Candidate | undefined> {
    const nodeUrls = this.getNodes().map(node => node.url);
    const candidates: (Candidate | undefined)[] = await Bluebird.map(nodeUrls, async nodeUrl => {
      try {
        const res = await this.axios.request({
          method: 'POST',
          baseURL: nodeUrl,
          url: '/wd/hub/best-match',
          data: request.data,
          timeout: 2e3,
        });
        const driver = await driverDtoSchema.validate(res.data, { strict: true });  // skip validate if it is too slow
        return { nodeUrl, driver };
      } catch (e) {
        console.error(e); // supress error
      }
    });
    return _.sample(candidates.filter(c => c));
  }

  async newWebdirverSession(request: RequestCapabilities): Promise<Either<WebdriverError, AxiosResponse>> {
    /**
     * TODO: optimize when necessary
     *
     * Currently to distribute a create session request to registed nodes,
     * hub service will send best-match requests to all of them to pick up a node to handle it.
     *
     * I know that this design is not scale,
     * but it is easy to reason and to implement, and less error prone.
     * It should work well when registed nodes are few in number (maybe <100).
     * I will optimize this when necessary.
     */

    let resPromise: Promise<AxiosResponse>;
    let candidate: Candidate | undefined;

    try {
      await this.createSessionMutex.wait();
      candidate = await this.getBestMatch(request);
      if (!candidate) {
        return Left({
          ...WEBDRIVER_ERRORS.SESSION_NOT_CREATED,
          message: `no availabe capbilities could be found`,
          stacktrace: new Error().stack || '',
        });
      }
      resPromise = this.axios.request({
        method: 'POST',
        baseURL: candidate.nodeUrl,
        url: '/wd/hub/session',
        data: request.data,
      });
    } finally {
      this.createSessionMutex.signal();
    }

    try {
      const res = await resPromise;
      const sessionId = res.data?.sesssionId || res.data?.value?.sessionId;
      if (!sessionId) throw Error(`cannot find session id in response`);
      console.log(`${sessionId}: session created`);
      this.sessionCache.set(sessionId, {
        nodeUrl: candidate.nodeUrl,
        sessionId,
        createdAt: Date.now(),
      });
      return Right(res);
    } catch (e) {
      return Left({
        ...WEBDRIVER_ERRORS.SESSION_NOT_CREATED,
        message: e.message || '',
        stacktrace: e.stack || '',
      });
    }
  }

  public async forwardWebdriverRequest(sessionId: string, path: string, request: AxiosRequestConfig): Promise<Either<WebdriverError, AxiosResponse>> {
    const session = this.getSessionById(sessionId);
    if (!session) {
      return Left({
        ...WEBDRIVER_ERRORS.INVALID_SESSION_ID,
        message: `session id ${sessionId} is invalid`,
        stacktrace: new Error().stack || '',
      });
    }
    request.baseURL = session.nodeUrl;
    request.url = `/wd/hub/session/${sessionId}${path}`;
    request.validateStatus = alwaysTrue;
    request.transformRequest = identity;
    request.transformResponse = identity;
    try {
      const res = await this.axios.request(request);
      return Right(res);
    } catch (e) {
      return Left({
        ...WEBDRIVER_ERRORS.UNKNOWN_ERROR,
        message: e.message || '',
        stacktrace: e.stack || '',
      });
    }
  }

  public async forwardAutoCmd(params: { sessionId?: string, nodeId?: string }, request: AxiosRequestConfig): Promise<Either<WebdriverError, AxiosResponse>> {
    let path = '/wd/hub/auto-cmd';
    let nodeUrl: string;

    const sessionId = params.sessionId;
    const nodeId = params.nodeId;
    if (sessionId) {
      const session = this.getSessionById(sessionId);
      if (!session) {
        return Left({
          ...WEBDRIVER_ERRORS.INVALID_SESSION_ID,
          message: `session id ${sessionId} is invalid`,
          stacktrace: new Error().stack || '',
        });
      }
      nodeUrl = session.nodeUrl;
      path = `/wd/hub/session/${sessionId}/auto-cmd`;
    } else if (nodeId) {
      const node = this.getNodeById(nodeId);
      if (!node) {
        return Left({
          ...WEBDRIVER_ERRORS.INVALID_NODE_ID,
          message: `node id ${nodeId} is invalid`,
          stacktrace: new Error().stack || '',
        });
      }
      nodeUrl = node.url;
      path = `/wd/hub/nodes/${nodeId}/auto-cmd`;
    } else {
      return Left({
        ...WEBDRIVER_ERRORS.INVALID_ENDPOINT,
        message: `hub mode didn't implement /wd/hub/auto-cmd endpoint`,
        stacktrace: new Error().stack || '',
      });
    }

    request.baseURL = nodeUrl;
    request.url = path;
    request.validateStatus = alwaysTrue;
    request.transformRequest = identity;
    request.transformResponse = identity;
    try {
      const res = await this.axios.request(request);
      return Right(res);
    } catch (e) {
      return Left({
        ...WEBDRIVER_ERRORS.UNKNOWN_ERROR,
        message: e.message || '',
        stacktrace: e.stack || '',
      });
    }
  }

  public async deleteWebdriverSession(sessionId: string, path: string, request: AxiosRequestConfig): Promise<Either<WebdriverError, AxiosResponse>> {
    const res = await this.forwardWebdriverRequest(sessionId, path, request);
    if (res.isRight()) {
      this.deleteSessionById(sessionId);
      console.log(`${sessionId}: session deleted`);
    }
    return res;
  }

  async onRegister(nodeUrl: string) {
    console.log(`on node ${nodeUrl} registered`);
    const res = await this.axios.request({
      method: 'GET',
      baseURL: nodeUrl,
      url: '/wd/hub/nodes',
      timeout: 5e3,
    });

    const nodes = await yup.array(nodeDtoSchema).defined().validate(res.data, { strict: true });  // skip validate if it is too slow
    const expireAfter = Date.now() + REGISTER_TIMEOUT_IN_MS;
    nodes.forEach(node => {
      node.config.publicUrl = nodeUrl;
      this.nodesIndex.set(node.config.uuid, { url: nodeUrl, node, expireAfter });
    });
  }

  getNodes(): RegistedNode[] {
    const now = Date.now();
    for (const [key, value] of this.nodesIndex.entries()) {
      if (value.expireAfter < now) {
        // It's safe to do so according to https://stackoverflow.com/a/35943995/3099733
        // PS: Don't do this in Python.
        console.log(`remove expired node: ${key}`);
        this.nodesIndex.delete(key);
      }
    }
    return [...this.nodesIndex.values()];
  }

  private getNodeById(nodeId: string): RegistedNode | undefined {
    return this.nodesIndex.get(nodeId);
  }

  private getSessionById(sessionId: string): SessionRecord | undefined {
    // search session in cache first
    let session: SessionRecord | undefined = this.sessionCache.get(sessionId);
    if (!session) {
      console.log(`cannot find session ${sessionId} in cache, fallback to search in node records`)
      session = this.findSessionInNodeRecords(sessionId);
      if (!session) return;
      console.log(`found session in node records and add session ${sessionId} to cache`);
      this.sessionCache.set(sessionId, session);
    }
    return session;
  }

  private deleteSessionById(sessionId: string) {
    this.sessionCache.delete(sessionId);
  }

  private findSessionInNodeRecords(sessionId: string): SessionRecord | undefined {
    for (const node of this.getNodes()) {
      for (const driver of node.node.drivers) {
        for (const session of driver.sessions) {
          if (session.id === sessionId) {
            return {
              nodeUrl: node.url,
              sessionId: sessionId,
              createdAt: Date.now(),
            }
          }
        }
      }
    }
  }

  private cleanExpiredSessions(maxAge: number) {
    // a simple method to reclaim expired session by syncing with nodes records every 10min
    const now = Date.now();
    const activeSessionIds = new Set(
      _(this.getNodes())
        .flatMap(node => node.node.drivers)
        .flatMap(driver => driver.sessions)
        .map(session => session.id)
        .value()
    );

    console.log(`current active sessions are: `, activeSessionIds);
    console.log(`current session in index are: `, [...this.sessionCache.keys()]);

    for (const [id, session] of this.sessionCache.entries()) {
      // this session has been in index for more than 10min
      // we only clean old enough session to avoid some race condition (when the session is newly created)
      if (session.createdAt + maxAge < now) {
        // this session is not in the current active sessions
        if (!activeSessionIds.has(id)) {
          console.log(`${id}: remove expired session`);
          this.sessionCache.delete(id);
        }
      }
    }
  }
}

export class LocalService {

  static of(config: Configuration, processManager: ProcessManager) {
    return new LocalService(
      config,
      config.drivers.map(driver => new WebdriverManager(config, driver, processManager)),
      processManager,
      axios.create(),
    );
  }

  private nextRegisterTime: number = 0;
  private terminatingTimer?: NodeJS.Timer;

  get terminating() {
    return undefined !== this.terminatingTimer;
  }

  constructor(
    private readonly config: Configuration,
    private readonly webdriverManagers: WebdriverManager[],
    private readonly processManager: ProcessManager,
    private readonly axios: AxiosInstance,
  ) { }

  init() {
    ['SIGINT', 'SIGTERM', 'uncaughtException'].forEach(signal => {
      process.on(signal, (...argv) => {
        console.log(`on ${signal}, argv:`);
        console.log(argv);
        console.log(`terminating...`);
        this.closeActiveSessions();
        process.exit();
      })
    });
    if (this.config.registerTo) {
      this.autoRegister();
    }
  }


  public get busySlots() {
    return _.sumBy(this.webdriverManagers, driver => driver.busySlots);
  }

  public get availableSlots() {
    if (this.terminating) return 0;
    return this.config.maxSessions - this.busySlots;
  }

  public getMatchedWebdrivers(request: RequestCapabilities): WebdriverManager[] {
    return this.webdriverManagers.filter(driver => driver.isMatch(request));
  }

  public getAvailableWebdrivers(request: RequestCapabilities): WebdriverManager[] {
    return this.getMatchedWebdrivers(request).filter(driver => driver.availableSlots > 0);
  }

  public getBestAvailableWebdirver(request: RequestCapabilities) {
    return _.maxBy(this.getAvailableWebdrivers(request), driver => driver.getScore(request));
  }

  public getBestMatch(request: RequestCapabilities): DriverDto | undefined {
    if (!this.availableSlots) return;
    const driver = this.getBestAvailableWebdirver(request);
    if (!driver) return;
    return driver.jsonObject;
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
      this.onSessionChange();
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
    this.onSessionChange();
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
    return this.webdriverManagers.find(driver => driver.hasSession(sessionId));
  }

  public getWebdriverSessionById(sessiondId: string) {
    for (const driverManager of this.webdriverManagers) {
      const session = driverManager.getSession(sessiondId);
      if (session) return session;
    }
  }

  public async getCdpEndpointBySessionId(sessionId: string) {
    const webdriverSession = this.getWebdriverSessionById(sessionId);
    return await webdriverSession?.getCdpEndpoint();
  }

  public getDriverDtos(): DriverDto[] {
    return this.webdriverManagers.map(d => d.jsonObject);
  }

  public getNodeDtos(): NodeDto[] {
    return [{ config: this.config, drivers: this.getDriverDtos() }];
  }

  public async forwardAutoCmdRequest(request: AxiosRequestConfig): Promise<Either<AutoCmdError, AxiosResponse>> {
    try {
      const autoCmdProcess = await this.processManager.getOrSpawnAutoCmdProcess();
      if (!autoCmdProcess) {
        return Left({
          ...AUTO_CMD_ERRORS.NOT_SUPPORTED,
          message: `auto-cmd is not enable on this node`,
          stacktrace: new Error().stack || '',
        });
      }
      request.validateStatus = alwaysTrue;
      request.transformRequest = identity;
      request.transformResponse = identity;
      const res = await autoCmdProcess.axios.request(request);
      return Right(res);
    } catch (e) {
      return Left({
        ...AUTO_CMD_ERRORS.UNKNOWN_ERROR,
        message: e.message || '',
        stacktrace: e.stack || '',
      });
    }
  }

  public async terminate(options: TerminateOptions) {
    if (options.cancel) {
      console.log(`cancel service termination`);
      clearInterval(this.terminatingTimer);
      this.terminatingTimer = undefined;
      return;
    }

    if (!options.confirmed) {
      return;
    }

    if (options.force) {
      console.log(`force terminate service without waiting for active sessions exited in 5 seconds`);
      setTimeout(() => process.exit(1), 5e3); // leave some time for controller to send response.
    }

    console.log('terminate service when there is no active sessions');
    if (this.terminatingTimer) return;

    const checkIntervalInS = 5;
    this.terminatingTimer = setInterval(() => {
      if (!this.activeSessions.length) {
        console.log('terminate service now');
        process.exit(1);
      }
      console.log(`active sessions are detected, defer termintation to ${checkIntervalInS}s later...`);
    }, checkIntervalInS * 1e3);
  }

  private get activeSessions() {
    return _.flatMap(this.webdriverManagers, driver => [...driver.activeSessions]);
  }

  private closeActiveSessions() {
    this.activeSessions.forEach(async session => {
      session.kill();
    });
  }

  private onSessionChange() {
    this.register();
  }

  private async autoRegister() {
    if (this.nextRegisterTime < Date.now()) {
      await this.register(); // suppressed error
    }
    setTimeout(() => this.autoRegister(), 1e3);
  }

  private async register() {
    if (!this.config.registerTo) return;

    // suggest a new time for next auto register
    this.nextRegisterTime = Date.now() + REGISTER_TIMEOUT_IN_MS / 2;
    const data: RegisterDto = {
      registerAs: this.config.publicUrl || `http://%s:${this.config.port}`,
    };
    const baseURL = this.config.registerTo;
    try {
      const res = await this.axios.request({
        method: 'POST',
        baseURL,
        url: '/wd/hub/register',
        data,
        timeout: 5e3,
      });
      return res;
    } catch (e) {
      console.error(`register to ${baseURL} failed: ${String(e)}`); // suppress error
    }
  }
}

class WebdriverManager {
  private readonly sessions: Map<string, ISession> = new Map();
  private readonly watchDogs: WeakMap<ISession, Watchdog> = new WeakMap();
  private pendingSessions: number = 0;

  constructor(
    private config: Configuration,
    private driverConfig: DriverConfiguration,
    private readonly processManager: ProcessManager,
  ) { }

  isMatch(request: RequestCapabilities): boolean {
    return isRequestMatch(this.config, this.driverConfig, request);
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
    return this.driverConfig.sessionIdleTimeout || this.config.sessionIdleTimeout;
  }

  public hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  public async makeSession(request: RequestCapabilities): Promise<ResponseCapabilities> {
    let session!: ISession;
    try {
      this.pendingSessions++;
      session = createSession(
        request,
        this.driverConfig,
        this.processManager,
        axios.create({ timeout: LONG_TIMEOUT_IN_MS }),
      );
      const res = await session.start();
      console.log(`${session.id}: session created`);
      console.log(`downloadFolder: ${session.downloadFolder}`);
      this.addSession(session);

      const watchDog = new Watchdog(() => this.destroySession(session.id), this.sessionTimeoutInSeconds);
      this.watchDogs.set(session, watchDog);

      return res;
    } catch (e) {
      console.error(e);
      if (session) {
        session.kill();
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
    console.log(`${sessionId}: session deleted`);
  }

  public getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.watchDogs.get(session)?.feed();
    }
    return session;
  }

  public get jsonObject(): DriverDto {
    return {
      config: this.driverConfig,
      sessions: this.getSessions().map(s => s.jsonObject),
    };
  }

  private addSession(session: ISession) {
    this.sessions.set(session.id, session);
  }

  private deleteSession(id: string) {
    this.sessions.delete(id);
  }

  private getSessions(): ISession[] {
    return [...this.sessions.values()];
  }

}

function isRequestMatch(config: Configuration, driver: DriverConfiguration, request: RequestCapabilities): boolean {
  if (request.browserName && request.browserName != driver.browserName) return false;
  if (request.browserVersion && request.browserVersion != driver.browserVersion) return false;
  if (request.browserUUID && request.browserUUID != driver.uuid) return false;
  if (request.browserTags && !matchTags(request.browserTags, driver.tags)) return false;

  if (request.platformName && request.platformName != config.platformName) return false;
  if (request.nodeUUID && request.nodeUUID != config.uuid) return false;
  if (request.nodeTags && !matchTags(request.nodeTags, config.tags)) return false;

  return true;
}

function matchTags(requestTags: string[], targetTags: string[]) {
  return requestTags.every(tag => tag.startsWith('!') ? (!targetTags.includes(tag.slice(1))) : targetTags.includes(tag));
}

export async function getFile(ctx: Context, root: string, isJsonResponse = true) {
  if (!root) {
    setHttpResponse(ctx, {
      status: 404,
      body: 'download folder is undefine',
    });
    return;
  }
  const url = '/' + (ctx.params[0] || '');
  const encoding = ctx.query.encoding as BufferEncoding || 'utf-8';
  const path = join(root, url);
  try {
    const stat = await fs.promises.lstat(path);
    if (stat.isDirectory()) {
      const files = await fs.promises.readdir(path, { withFileTypes: true });
      ctx.status = 200;
      const filenames = files.map(f => f.name + (f.isDirectory() ? '/' : '')).sort();
      ctx.body = isJsonResponse ? filenames : renderDirectoyHtml(url, filenames)
    } else {
      if (isJsonResponse) {
        ctx.body = await fs.promises.readFile(path, { encoding });
      } else {
        await send(ctx, url, { hidden: true, root });
      }
    }
  } catch (e) {
    setHttpResponse(ctx, {
      status: 404,
      body: {
        message: e.message || '',
        stack: e.stack || '',
      }
    });
  }
}

export async function deleteFile(ctx: Context, root: string) {
  const filename = ctx.params[0];
  if (!root) {
    setHttpResponse(ctx, {
      status: 404,
      body: 'download folder is undefine',
    });
    return;
  }
  const path = join(root, "/", filename); 
  try {
    if(fs.existsSync(path)){
      fs.promises.unlink(join(root, '/', filename));
    }
    ctx.status = 204;
  } catch (e) {
    return setHttpResponse(ctx, {
      status: 500,
      body: {
        message: e.message || '',
        stack: e.stack || '',
      },
    });
  }
}

function renderDirectoyHtml(dir: string, paths: string[]) {
  return [
    `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"><html>`,
    `<title>Directory listing for ${dir}</title>`,
    `<body>`,
    `<h2>Directory listing for ${dir}</h2>`,
    `<hr>`,
    `<ul>`,
    ...paths.map(path => `<li><a href="${path}">${path}</a></li>`),
    `</ul>`,
    `<hr>`,
    `</body>`,
    `</html>`,
  ].join('\n');
}

