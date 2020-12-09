import { RemoteDriver, LocalDriver, DriverMatchCriteria, SessionPathParams, localDriverSchema, Configuration } from "./schemas";
import { LocalSession, RemoteSession, Session } from "./sessions";
import { Request } from "koa";
import { Watchdog } from "./watchdog";
import axios, { AxiosResponse } from "axios";
import Bluebird from "bluebird";
import { flatten } from "lodash";


export abstract class DriverService<D extends object, S extends Session>{
  private sessions: Map<string, S>;
  private sessionDriverMap: WeakMap<S, D>;
  private sessionWatchdogMap: WeakMap<S, Watchdog>;
  private driverSessionsMap: WeakMap<D, Set<S>>;

  constructor(
    protected readonly drivers: D[],
    protected readonly config: Configuration,
  ) {
    this.sessions = new Map();
    this.sessionDriverMap = new WeakMap();
    this.sessionWatchdogMap = new WeakMap();
    this.driverSessionsMap = new WeakMap();
    for (const driver of this.drivers) {
      this.driverSessionsMap.set(driver, new Set());
    }
  }

  get activeSessions(): number {
    return this.sessions.size;
  }

  addDriver(driver: D) {
    this.drivers.push(driver);
    this.driverSessionsMap.set(driver, new Set());
  }

  addSession(session: S, driver: D, watchdog: Watchdog) {
    this.sessions.set(session.id!, session);
    this.driverSessionsMap.get(driver)!.add(session);
    this.sessionDriverMap.set(session, driver);
    this.sessionWatchdogMap.set(session, watchdog);
  }

  removeSession(session: S) {
    this.sessions.delete(session.id!);
    const driver = this.sessionDriverMap.get(session);
    this.driverSessionsMap.get(driver!)!.delete(session);
    this.sessionDriverMap.delete(session);
    this.sessionWatchdogMap.delete(session);
  }

  getSession(id: string) {
    const session = this.sessions.get(id);
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
        url: this.config.registerAs,
      }
    });
  }

  init() {
    console.log(`working on local mode`);
    if (this.config.registerTo) {
      if (!this.config.registerAs) throw Error(`"registerAs" is required when "registerTo" is set`)
      console.log(`register to ${this.config.registerTo}`);
      this.register();
      setInterval(async () => {
        this.register().catch(console.error);
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
    const session = new LocalSession(driver.browserName, driver.webdriverPath, driver.args!, driver.defaultCapabilities);
    return this.startSession(session, request, driver);
  }
}


export class RemoteDriverService extends DriverService<RemoteDriver, RemoteSession> {
  init() {
    console.log(`working on remote mode`);
  }

  async registerDriver(driver: RemoteDriver) {
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
    const driver = candidates[0][0];
    const session = new RemoteSession(driver.url);
    return this.startSession(session, request, driver);
  }

  private async getCandidates(): Promise<[RemoteDriver, LocalDriver][]> {
    const packedCandidates: [RemoteDriver, LocalDriver][][] = await Bluebird.map(this.activeRemoteDriver, async remoteDriver => {
      const response = await axios.request<LocalDriver[]>({
        method: 'GET',
        baseURL: remoteDriver.url,
        url: '/available-drivers',
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
  (criteria.version ? driver.version === criteria.version : true)

const getMatchCriteria = (obj: any): DriverMatchCriteria => {
  const capabilities = obj?.desiredCapabilities;
  const browserName: string = capabilities?.browserName;
  if (!browserName || 'string' !== typeof browserName) throw Error(`browserName is invalid!`);
  const extOptions = capabilities?.extOptions;
  const tags = extOptions?.tags || [];
  const uuid = extOptions?.uuid;
  const version = capabilities?.version;
  return { browserName, tags, uuid, version, platformName: capabilities.platformName};
}
