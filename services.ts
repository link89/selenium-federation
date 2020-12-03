import { RemoteDriver, LocalDriver, DriverMatchCriteria, SessionPathParams, localDriverSchema } from "schemas";
import { LocalSession, RemoteSession, Session } from "sessions";
import { Request } from "koa";
import { Watchdog } from "watchdog";
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
    protected readonly browserIdleTimeout: number,
  ) {
    this.sessions = new Map();
    this.sessionDriverMap = new WeakMap();
    this.sessionWatchdogMap = new WeakMap();
    this.driverSessionsMap = new WeakMap();
    for (const driver of this.drivers) {
      this.driverSessionsMap.set(driver, new Set());
    }
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
    }, this.browserIdleTimeout);
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

  abstract getAvailableDrivers(): Promise<LocalDriver[]>;
  abstract createSession(request: Request): Promise<AxiosResponse>;
}


export class LocalDriverService extends DriverService<LocalDriver, LocalSession> {

  async getAvailableDrivers() {
    return this.drivers.filter(driver => this.getSessionsByDriver(driver)!.size < driver.maxSessions)
  }

  async createSession(request: Request) {
    const criteria = sanitizeMatchCriteria(request.body);
    const candidates = (await this.getAvailableDrivers())
      .filter(driver => isCriteriaMatch(driver, criteria));

    if (!candidates.length) {
      throw Error(`No Drivers Available!`);
    }
    const driver = candidates[0];
    const session = new LocalSession(driver.webdriverPath, driver.args!, driver.defaultCapabilities);
    return this.startSession(session, request, driver);
  }
}


export class RemoteDriverService extends DriverService<RemoteDriver, RemoteSession> {

  async getAvailableDrivers() {
    return this.getCandidates().then(candidates => candidates.map(([rd, ld]) => ld));
  }

  async createSession(request: Request) {

    const criteria = sanitizeMatchCriteria(request.body);
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
    const packedCandidates: [RemoteDriver, LocalDriver][][] = await Bluebird.map(this.drivers, async remoteDriver => {
      const response = await axios.request<LocalDriver[]>({
        method: 'GET',
        baseURL: remoteDriver.url,
        url: '/available-sessions',
      }).catch((e) => console.log(e));

      if (!response) return [];
      return response.data.
        filter(localDriver => localDriverSchema.isValidSync(localDriver)).
        map(localDriver => [remoteDriver, localDriver]);
    }, { concurrency: 8 });
    return flatten(packedCandidates);
  }
}


const isCriteriaMatch = (driver: LocalDriver, criteria: DriverMatchCriteria): boolean =>
  driver.browserName === criteria.browserName && criteria.tags.every(tag => driver.tags!.includes(tag));


const sanitizeMatchCriteria = (obj: any): DriverMatchCriteria => {
  const capabilities = obj?.desiredCapabilities;
  const browserName: string = capabilities?.browserName;
  if (!browserName || 'string' !== typeof browserName) throw Error(`browserName is invalid!`);
  const extOptions = capabilities?.extOptions;
  const tags = extOptions?.tags || [];
  return { browserName, tags };
}
