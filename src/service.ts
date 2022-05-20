import _ from "lodash";
import { AutoCmdError, Configuration, LocalDriverConfiguration, WebdriverError } from './types';
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { alwaysTrue, identity } from './utils';
import { Either, Left, Right } from 'purify-ts';
import Bluebird from 'bluebird';
import { Watchdog } from './watchdog';
import { RequestCapabilities, ResponseCapabilities, createSession, ISession} from './session';
import { AUTO_CMD_ERRORS, WEBDRIVER_ERRORS } from './constants';
import { ProcessManager } from "./process";

export class LocalWebdriverManager {
  private readonly sessions: Map<string, ISession> = new Map();
  private readonly watchDogs: WeakMap<ISession, Watchdog> = new WeakMap();
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

  private addSession(session: ISession) {
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