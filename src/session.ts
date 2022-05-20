import { AxiosInstance, AxiosRequestConfig } from "axios";
import _ from 'lodash';
import { retry, rmAsync } from "./utils";
import { ChildProcess } from 'child_process';
import { ProcessManager } from "./refactor";
import { LocalDriverConfiguration } from "./schemas";
import { Request } from 'koa';
import * as yup from 'yup';


const CUSTOM_CAPS = {
  TAGS: 'sf:tags',
  ENVS: 'sf:envs',
  CLEAN_DATA: 'sf:cleanData',
};


export class RequestCapabilities {

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

export class ResponseCapabilities {

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