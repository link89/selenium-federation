import { RemoteDriver, LocalDriver, DriverMatchCriteria, SessionPathParams } from "schemas";
import { LocalSession, RemoteSession, Session } from "sessions";
import { Request } from "koa";
import { Watchdog } from "watchdog";


export abstract class DriverService<D extends object, S extends Session>{
  private  sessions: Map<string, S>;
  private  sessionDriverMap: WeakMap<S, D>;
  private  sessionWatchdogMap: WeakMap<S, Watchdog>;
  private  driverSessionsMap: WeakMap<D, Set<S>>;

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

  abstract getAvailableDrivers(): D[];
}


export class LocalDriverService extends DriverService<LocalDriver, LocalSession> {

  async createSession(request: Request) {
    const criteria = sanitizeMatchCriteria(request.body);
    const candidates = this.getAvailableDrivers()
      .filter(driver => driver.browserName === criteria.browserName)
      .filter(driver => criteria.tags.every(tag => driver.tags!.includes(tag)));

    if (candidates.length === 0) {
      throw Error(`No Drivers Available!`);
    }
    const driver = candidates[0];
    const session = new LocalSession(driver.webdriverPath, driver.args!, driver.defaultCapabilities);
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

  getAvailableDrivers() {
    return this.drivers.filter(driver => this.getSessionsByDriver(driver)!.size < driver.maxSessions)
  }
}

const sanitizeMatchCriteria = (obj: any): DriverMatchCriteria => {
  const capabilities = obj?.desiredCapabilities;
  const browserName: string = capabilities?.browserName;
  if (!browserName || 'string' !== typeof browserName) throw Error(`browserName is invalid!`);
  const extOptions = capabilities?.extOptions;
  const tags = extOptions?.tags || [];
  return { browserName, tags };
}
