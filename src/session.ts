import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { retry, rmAsync } from "./utils";
import { ChildProcess } from 'child_process';
import { LocalDriverConfiguration } from "./types";
import { Request } from 'koa';
import * as yup from 'yup';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { ProcessManager } from "./process";

const CUSTOM_CAPS_FIELDS = {
  TAGS: 'sf:tags',
  ENVS: 'sf:envs',
  CLEAN_USER_DATA: 'sf:cleanUserData',
};

export class RequestCapabilities {

  get data() { return this.request.body as any; }
  get href() { return this.request.href.replace(/\/$/, ""); }

  constructor(private request: Request) { }

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
    const tags = this.getValue(CUSTOM_CAPS_FIELDS.TAGS);
    if (yup.array(yup.string().defined()).defined().isValidSync(tags)) return tags;
  }
  get environmentVariables(): any { return this.getValue(CUSTOM_CAPS_FIELDS.ENVS) || {}; }

  get shouldcleanUserData(): boolean | undefined {
    const cleanUserData = this.getValue(CUSTOM_CAPS_FIELDS.CLEAN_USER_DATA);
    if ('boolean' == typeof cleanUserData) {
      return cleanUserData;
    }
  }

  private getValue(key: string): unknown {
    const caps = this.data.capabilities?.alwaysMatch || this.data.desiredCapabilities || {};
    return caps[key];
  }

  get sanitizedCapbilities() {
    const caps = _.cloneDeep(this.data || {});
    for (const key of ['browserVersion', 'extOptions', 'tags', ...Object.values(CUSTOM_CAPS_FIELDS)]) {
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

export class ResponseCapabilities {

  private rawResponseData: any

  constructor(private rawResponse: any, private request: RequestCapabilities) {
    this.rawResponseData = rawResponse?.value || rawResponse; //  w3c format || json wired format
  }

  get sessionId() {
    return this.rawResponseData?.sessionId;
  }

  get sessionBaseUrl() {
    return `${this.request}`
  }

  get browserVersion() {
    return this.rawResponseData?.capabilities?.browserVersion;
  }

  get chromeDebuggerAddress() {
    return this.rawResponseData?.capabilities?.["goog:chromeOptions"]?.debuggerAddress;
  }

  get cdpEndpoint() {
    return `${this.request.getSessionBaseUrl(true)}/${this.sessionId}/se/cdp`;
  }

  get chromeUserDataDir() {
    return this.rawResponseData?.capabilities?.chrome?.userDataDir;
  }

  get jsonObject() {
    const raw = _.cloneDeep(this.rawResponse);
    // patch capabilities
    const newResponseData = raw.value || raw;
    // set cdp endpoint
    if (this.chromeDebuggerAddress) {
      newResponseData.capabilities['se:cdp'] = this.cdpEndpoint;
      newResponseData.capabilities['se:cdpVersion'] = 'FIXME';  // FIXME
    }
    return raw;
  }
}

export interface ISession {
  id: string;
  getCdpEndpoint: () => Promise<string | void>;
  start: () => Promise<ResponseCapabilities>;
  stop: () => Promise<void>;
  forward: (request: AxiosRequestConfig) => Promise<AxiosResponse<any> | void>;
  cost: number;
}

export function createSession(
  request: RequestCapabilities,
  webdriverConfiguration: LocalDriverConfiguration,
  processManager: ProcessManager,
  axios: AxiosInstance,
) {
  switch (request.browserName) {
    case 'chrome': return new ChromeDriverSession(request, webdriverConfiguration, processManager, axios);
    case 'auto-cmd': return new AutoCmdSession(request, webdriverConfiguration, processManager, axios);
    default: return new CommonWebdriverSession(request, webdriverConfiguration, processManager, axios);
  }
}

class AutoCmdSession implements ISession {
  public readonly cost = 0;  // auto cmd session won't have any cost
  public readonly id: string;

  constructor(
    public request: RequestCapabilities,
    protected webdriverConfiguration: LocalDriverConfiguration,
    protected processManager: ProcessManager,
    protected axios: AxiosInstance,
  ) {
    this.id = uuidv4();
  }

  async getCdpEndpoint() { return; }

  async start() {
    const autoCmd = await this.processManager.getOrSpawnAutoCmdProcess();
    if (!autoCmd) throw Error(`auto-cmd is not supported`);
    const res = {
      sesssionId: this.id,
      value: {
        sessionId: this.id,
      }
    };
    return new ResponseCapabilities(res, this.request)
  }

  async stop() { }

  async forward(request: AxiosRequestConfig) {
    // request to auto-cmd is handle on service layer
    // this is just a placeholder
    return;
  }
}


abstract class AbstractWebdriveSession implements ISession {
  public readonly cost = 1;

  public response?: ResponseCapabilities;
  protected process?: ChildProcess;
  protected port?: number;

  constructor(
    public request: RequestCapabilities,
    protected webdriverConfiguration: LocalDriverConfiguration,
    protected processManager: ProcessManager,
    protected axios: AxiosInstance,
  ) { }

  get id(): string {
    const sessionId = this.response?.sessionId;
    if (!sessionId || 'string' != typeof sessionId) {
      throw new Error(`sessionId is invalid: ${sessionId}`);
    }
    return sessionId;
  }

  async start() {
    const { port, webdriverProcess } = await this.processManager.spawnWebdriverProcess({
      path: this.webdriverConfiguration.webdriverPath,
      envs: { ...this.webdriverConfiguration.webdriverEnvs, ...this.request.environmentVariables },
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
    await this.afterStop();
  }

  async forward(request: AxiosRequestConfig) {
    return await this.axios.request(request);
  }

  async getCdpEndpoint(): Promise<string | undefined> { return; }

  async afterStop() { }

  private async waitForReady() {
    await retry(async () => await this.axios.get('/status'), { max: 10, interval: 1e2 });
  }

  private async createSession(request: RequestCapabilities) {
    const res = await this.axios.post('/session', this.mergeDefaultCaps(request.sanitizedCapbilities));
    return new ResponseCapabilities(res.data, request);
  }

  private mergeDefaultCaps(caps: any) {
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

class CommonWebdriverSession extends AbstractWebdriveSession { }

class ChromeDriverSession extends AbstractWebdriveSession {

  get shouldCleanUserData(): boolean {
    const cleanUserData = this.request?.shouldcleanUserData;
    return _.isNil(cleanUserData) ? this.webdriverConfiguration.cleanUserData : cleanUserData;
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

  async afterStop() {
    const userDataDir = this.response?.chromeUserDataDir;
    if (this.shouldCleanUserData && userDataDir) {
      try {
        console.log(`clean user data: ${userDataDir}`);
        await rmAsync(userDataDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`ignore error during rm ${userDataDir}`, e);
      }
    }
  }
}