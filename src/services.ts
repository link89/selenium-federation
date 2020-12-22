import { RemoteDriver, LocalDriver, DriverMatchCriteria, SessionPathParams, localDriverSchema, Configuration } from "./schemas";
import { LocalSession, RemoteSession, Session } from "./sessions";
import { DEFAULT_HOST_IP_PLACEHOLDER } from "./constants";
import { Request } from "koa";
import { Watchdog } from "./watchdog";
import axios, { AxiosResponse } from "axios";
import Bluebird from "bluebird";
import { flatten, minBy, shuffle } from "lodash";


export abstract class DriverService<D extends object, S extends Session>{
  private sessionsMap: Map<string, S>;
  private sessionDriverMap: WeakMap<S, D>;
  private sessionWatchdogMap: WeakMap<S, Watchdog>;
  private driverSessionsMap: WeakMap<D, Set<S>>;

  constructor(
    protected readonly drivers: D[],
    protected readonly config: Configuration,
  ) {
    this.sessionsMap = new Map();
    this.sessionDriverMap = new WeakMap();
    this.sessionWatchdogMap = new WeakMap();
    this.driverSessionsMap = new WeakMap();
    for (const driver of this.drivers) {
      this.driverSessionsMap.set(driver, new Set());
    }
  }

  get activeSessions(): number {
    return this.sessionsMap.size;
  }

  addDriver(driver: D) {
    this.drivers.push(driver);
    this.driverSessionsMap.set(driver, new Set());
  }

  addSession(session: S, driver: D, watchdog: Watchdog) {
    this.sessionsMap.set(session.id!, session);
    this.driverSessionsMap.get(driver)!.add(session);
    this.sessionDriverMap.set(session, driver);
    this.sessionWatchdogMap.set(session, watchdog);
  }

  removeSession(session: S) {
    this.sessionsMap.delete(session.id!);
    const driver = this.sessionDriverMap.get(session);
    this.driverSessionsMap.get(driver!)!.delete(session);
    this.sessionDriverMap.delete(session);
    this.sessionWatchdogMap.delete(session);
  }

  get sessions() {
    return this.sessionsMap.values();
  }

  getSession(id: string) {
    const session = this.sessionsMap.get(id);
    if (!session) {
      throw Error(`Session Not Found!`);
    }
    return session;
  }

  getWatchdogBySession(session: S) {
    return this.sessionWatchdogMap.get(session);
  }

  getSessionsByDriver(driver: D) {
    return this.driverSessionsMap.get(driver);
  }

  async startSession(session: S, request: Request, driver: D) {
    const response = await session.start(request);
    const watchdog = new Watchdog(() => {
      this.deleteSession(session.id!);
    }, this.config.browserIdleTimeout);
    this.addSession(session, driver, watchdog);
    return response;
  }

  async deleteSession(sessionId: string) {
    const session = this.getSession(sessionId);
    await session.stop();
    this.getWatchdogBySession(session)?.stop();
    this.removeSession(session);
  }

  async forward(request: Request, params: SessionPathParams) {
    const sessionId = params.sessionId;
    const session = this.getSession(sessionId);
    this.getWatchdogBySession(session)?.feed();
    return await session.forward(request, params.suffix);
  }

  abstract init(): void;
  abstract registerDriver(driver: RemoteDriver): Promise<void>;
  abstract getAvailableDrivers(): Promise<LocalDriver[]>;
  abstract createSession(request: Request): Promise<AxiosResponse>;
}


export class LocalDriverService extends DriverService<LocalDriver, LocalSession> {

  private async register() {
    await axios.request({
      method: 'POST',
      baseURL: this.config.registerTo,
      url: '/register',
      data: {
        url: this.config.registerAs || `http://${DEFAULT_HOST_IP_PLACEHOLDER}:${this.config.port}/wd/hub`,
      }
    }).catch(console.error);
  }

  init() {
    console.log(`working on local mode`);
    // kill session process on exit
    ['SIGTERM', 'SIGINT'].forEach(signal =>
      process.on(signal, () => {
        for (const session of this.sessions) {
          session.kill();
        }
        process.exit();
      })
    );
    // register to remote service
    if (this.config.registerTo) {
      console.log(`register to ${this.config.registerTo}`);

      this.register();
      setInterval(async () => {
        this.register();
      }, 1e3 * this.config.registerTimeout / 3);
    }
  }

  async registerDriver(driver: RemoteDriver) {
    throw Error("This node is running on local mode.");
  }

  async getAvailableDrivers() {
    if (this.activeSessions >= this.config.maxSessions) {
      return [];
    }
    return this.drivers.filter(driver => this.getSessionsByDriver(driver)!.size < driver.maxSessions);
  }

  async createSession(request: Request) {
    const criteria = getMatchCriteria(request.body);
    const candidates = (await this.getAvailableDrivers())
      .filter(driver => isCriteriaMatch(driver, criteria));

    if (!candidates.length) {
      throw Error(`No Drivers Available!`);
    }
    const driver = candidates[0];
    const session = new LocalSession(
      driver.browserName,
      driver.webdriverPath,
      driver.webdriverArgs!,
      driver.webdriverEnvs,
      driver.defaultCapabilities
    );
    return this.startSession(session, request, driver);
  }
}


export class RemoteDriverService extends DriverService<RemoteDriver, RemoteSession> {
  init() {
    console.log(`working on remote mode`);
  }

  private async checkHealth(driver: RemoteDriver) {
    return axios.request({
      method: 'GET',
      baseURL: driver.url,
      url: '/available-drivers',
      timeout: 5e3,
    });
  }

  async registerDriver(driver: RemoteDriver) {
    await this.checkHealth(driver);
    const found = this.drivers.find(d => d.url === driver.url);
    if (found) {
      found.registerAt = Date.now()
    } else {
      console.log(`register new remote driver: ${driver.url}`);
      this.addDriver(driver);
    }
  }

  async getAvailableDrivers() {
    return this.getCandidates().then(candidates => candidates.map(([rd, ld]) => ld));
  }

  async createSession(request: Request) {

    const criteria = getMatchCriteria(request.body);
    const candidates: [RemoteDriver, LocalDriver][] = (await this.getCandidates())
      .filter(([remoteDriver, localDriver]) => isCriteriaMatch(localDriver, criteria));

    if (!candidates.length) {
      throw Error(`No Drivers Available!`);
    }
    const driver = this.getTheLeastBusyDriver(candidates);
    const session = new RemoteSession(driver.url);
    return this.startSession(session, request, driver);
  }

  private getTheLeastBusyDriver(candidates: [RemoteDriver, LocalDriver][]): RemoteDriver {
    return minBy(shuffle(candidates), ([rd, ld]) => this.getSessionsByDriver(rd)?.size || Number.MAX_VALUE)![0];
  }

  private async getCandidates(): Promise<[RemoteDriver, LocalDriver][]> {
    const packedCandidates: [RemoteDriver, LocalDriver][][] = await Bluebird.map(this.activeRemoteDriver, async remoteDriver => {
      const response = await axios.request<LocalDriver[]>({
        method: 'GET',
        baseURL: remoteDriver.url,
        url: '/available-drivers',
        timeout: 5e3,
      }).catch((e) => console.log(e));

      if (!response) return [];
      return response.data.
        filter(localDriver => localDriverSchema.isValidSync(localDriver)).
        map(localDriver => [remoteDriver, localDriver]);
    }, { concurrency: 8 });
    return flatten(packedCandidates);
  }

  private get activeRemoteDriver() {
    const now = Date.now();
    return this.drivers.filter(driver => driver.registerAt + 1e3 * this.config.registerTimeout > now);
  }
}

const isCriteriaMatch = (driver: LocalDriver, criteria: DriverMatchCriteria): boolean =>
  (driver.browserName === criteria.browserName) &&
  (criteria.tags.every(tag => driver.tags!.includes(tag))) &&
  (criteria.platformName ? driver.platformName === criteria.platformName : true) &&
  (criteria.uuid ? driver.uuid === criteria.uuid : true) &&
  (criteria.browserVersion ? driver.browserVersion === criteria.browserVersion : true)

const getMatchCriteria = (requestBody: any): DriverMatchCriteria => {
  const capabilities = requestBody?.desiredCapabilities;
  const browserName: string = capabilities?.browserName;
  if (!browserName || 'string' !== typeof browserName) throw Error(`browserName is invalid!`);
  const extOptions = capabilities?.extOptions;
  const tags = extOptions?.tags || [];
  const uuid = extOptions?.uuid;
  const browserVersion = capabilities?.browserVersion;
  return { browserName, tags, uuid, browserVersion, platformName: capabilities.platformName};
}
