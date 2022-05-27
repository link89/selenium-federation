import _ from "lodash";
import * as yup from 'yup';
import { AutoCmdError, Configuration, DriverConfiguration, DriverDto, driverDtoSchema, NodeDto, nodeDtoSchema, RegisterDto, WebdriverError } from './types';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { alwaysTrue, identity } from './utils';
import { Either, Left, Right } from 'purify-ts';
import Bluebird from 'bluebird';
import { Watchdog } from './utils';
import { RequestCapabilities, ResponseCapabilities, createSession, ISession } from './session';
import { AUTO_CMD_ERRORS, WEBDRIVER_ERRORS } from './constants';
import { ProcessManager } from "./process";
import { config } from "yargs";

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
  expireAfter: number;
}

export class RemoteService {

  private nodesIndex = new Map<string, RegistedNode>();
  private sessionIndex = new Map<string, SessionRecord>();
  private lastSessionReclaimTime = 0;

  constructor(
    private config: Configuration,
    private axios: AxiosInstance,
  ) { }

  async getBestMatch(request: RequestCapabilities): Promise<Candidate | undefined> {
    const nodeUrls = this.getNodes().map(node => node.url);
    const candidates: (Candidate | undefined)[] = await Bluebird.map(nodeUrls, async nodeUrl => {
      try {
        const res = await this.axios.request({
          method: 'GET',
          baseURL: nodeUrl,
          url: '/wd/hub/best-match',
          data: request.data,
          timeout: 2e3,
        });
        const driver = await driverDtoSchema.validate(res.data);  // remove this if it is too slow
        return { nodeUrl, driver};
      } catch (e) {
        console.error(e); // supress error
      }
    });
    return _.sample(candidates.filter(c => c));
  }

  async newWebdirverSession(request: RequestCapabilities): Promise<Either<WebdriverError, AxiosResponse>> {
    const candidate = await this.getBestMatch(request);
    if (!candidate){
      return Left({
        ...WEBDRIVER_ERRORS.SESSION_NOT_CREATED,
        message: `no availabe capbilities could be found`,
        stacktrace: new Error().stack || '',
      });
    }

    try {
      const res = await this.axios.request({
        method: 'POST',
        baseURL: candidate.nodeUrl,
        url: '/wd/hub/session',
        data: request.data,
      });
      const sessionId = res.data?.sesssionId || res.data?.value?.sessionId;
      if (!sessionId) throw Error(`cannot find session id in response`);
      this.sessionIndex.set(sessionId, {
        nodeUrl: candidate.nodeUrl,
        sessionId,
        expireAfter: Date.now() + this.config.sessionTimeout,
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
    const session = this.getSession(sessionId);
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

  public async forwardAutoCmd(sessionId: string, request: AxiosRequestConfig): Promise<Either<WebdriverError, AxiosResponse>> {
    const session = this.getSession(sessionId);
    if (!session) {
      return Left({
        ...WEBDRIVER_ERRORS.INVALID_SESSION_ID,
        message: `session id ${sessionId} is invalid`,
        stacktrace: new Error().stack || '',
      });
    }
    request.baseURL = session.nodeUrl;
    request.url = `/wd/hub/session/${session.sessionId}/auto-cmd`;
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
    this.deleteSession(sessionId);
    return await this.forwardWebdriverRequest(sessionId, path, request);
  }



  async onRegister(nodeUrl: string) {
    const res = await this.axios.request({
      method: 'GET',
      baseURL: nodeUrl,
      url: '/wd/hub/nodes',
      timeout: 5e3,
    });
    const nodes = await yup.array(nodeDtoSchema).defined().validate(res.data);  // remove this if it is too slow
    const expireAfter = Date.now() + this.config.registerTimeout;
    nodes.forEach(node => {
      this.nodesIndex.set(node.config.uuid, { url: nodeUrl, node, expireAfter });
    });
  }

  getNodes(): RegistedNode[] {
    const now = Date.now();
    for (const [key, value] of this.nodesIndex.entries()) {
      if (value.expireAfter >= now) {
        // It's safe to do so according to https://stackoverflow.com/a/35943995/3099733
        // PS: Don't do this in Python.
        this.nodesIndex.delete(key);
      }
    }
    return [...this.nodesIndex.values()];
  }

  private getSession(sessionId: string): SessionRecord | undefined {
    const session = this.sessionIndex.get(sessionId);
    if (!session) return;
    session.expireAfter = Date.now() + this.config.sessionTimeout;
    return session;
  }

  private deleteSession(sessionId: string) {
    this.sessionIndex.delete(sessionId);

    // a quick and dirty method to reclaim expired session to avoid memory leak
    // may use formal ttl cache if this implemetation have problem
    const now = Date.now();
    if (this.lastSessionReclaimTime < now) {
      this.lastSessionReclaimTime = now + 1800e3;
      for (const [id, session] of this.sessionIndex.entries()) {
        if (session.expireAfter < now) {
          this.sessionIndex.delete(id);
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

  constructor(
    private readonly config: Configuration,
    private readonly webdriverManagers: WebdriverManager[],
    private readonly processManager: ProcessManager,
    private readonly axios: AxiosInstance,
  ) { }

  init() {
    ['SIGINT', 'SIGTERM'].forEach(signal => {
      process.on(signal, () => {
        console.log(`terminating...`);
        return this.forceTerminate().then(() => {
          process.exit();
        });
      })
    });
    if (this.config.registerTo) {
      this.autoRegister(1000);
    }
  }

  public get busySlots() {
    return _.sumBy(this.webdriverManagers, driver => driver.busySlots);
  }

  public get availableSlots() {
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

  private get activeSessions() {
    return _.flatMap(this.webdriverManagers, driver => [...driver.activeSessions]);
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

  private onSessionChange() {
    this.register();
  }

  private async autoRegister(interval: number) {
    if (this.nextRegisterTime < Date.now()) {
      await this.register(); // suppressed error
    }
    setTimeout(() => this.autoRegister(interval), interval);
  }

  private async register() {
    if (!this.config.registerTo) return;

    // suggest a new time for next auto register
    this.nextRegisterTime = Date.now() + this.config.registerTimeout * 800 // 800 = 1000 x 80%, 80% of timeout
    const data: RegisterDto = { registerAs: this.config.registerAs };
    try {
      const res = await this.axios.request({
        method: 'GET',
        url: this.config.registerTo,
        data,
        timeout: 5e3,
      });
      return res;
    } catch (e) {
      console.error(e); // suppress error
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
    return this.driverConfig.sessionTimeout || this.config.sessionTimeout;
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
  if (request.browserUuid && request.browserUuid != driver.uuid) return false;
  if (request.browserTags && !matchTags(request.browserTags, driver.tags)) return false;

  if (request.platformName && request.platformName != config.platformName) return false;
  if (request.nodeUuid && request.nodeUuid != config.uuid) return false;
  if (request.nodeTags && !matchTags(request.nodeTags, config.tags)) return false;

  return true;
}

function matchTags(requestTags: string[], targetTags: string[]) {
  return requestTags.every( tag =>  tag.startsWith('!') ? (!targetTags.includes(tag.slice(1))) : targetTags.includes(tag));
}