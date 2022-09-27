import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { v4 as uuidv4 } from 'uuid';
import { retry } from "./utils";
import { ChildProcess } from 'child_process';
import { DriverConfiguration, SessionDto } from "./types";
import { Request } from 'koa';
import _ from 'lodash';
import { ProcessManager } from "./process";
import { SF_CAPS_FIELDS } from "./constants";
import * as fs from 'fs';
import { exec } from 'shelljs';


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
    return `${proto}://${this.request.host}${_.trimEnd(this.request.path, '/')}`;
  }

  getBaseUrl(isWebsocket: boolean) {
    let proto = this.request.protocol;
    if (isWebsocket) {
      proto = {
        'http': 'ws',
        'https': 'wss',
      }[proto] || 'ws';
    }
    return `${proto}://${this.request.host}`;
  }

  get browserName() { return this.getValue('browserName'); }
  get browserVersion() { return this.getValue('browserVersion'); }
  get browserUUID() { return this.getValue(SF_CAPS_FIELDS.BROWSER_UUID); }
  get browserTags(): string[] | undefined { return this.getValue(SF_CAPS_FIELDS.BROWSER_TAGS) as any };

  get platformName() { return this.getValue('platformName'); }

  get downloadFolder() {
    switch (this.browserName) {
      case 'chrome': return this.data.desiredCapabilities?.["goog:chromeOptions"]?.prefs?.["download.default_directory"];
      case 'MicrosoftEdge': return;
      case 'firefox': return;
      case 'safari': return;
      case 'nodejs': return;
      default: throw Error(`browser ${this.browserName} is not supported`);
    }
  }

  get nodeUUID() { return this.getValue(SF_CAPS_FIELDS.NODE_UUID); }
  get nodeTags(): string[] | undefined { return this.getValue(SF_CAPS_FIELDS.NODE_TAGS) as any };

  get environmentVariables(): any { return this.getValue(SF_CAPS_FIELDS.ENVS) || {}; }

  get shouldcleanUserData(): boolean | undefined {
    const cleanUserData = this.getValue(SF_CAPS_FIELDS.CLEAN_USER_DATA);
    if ('boolean' == typeof cleanUserData) {
      return cleanUserData;
    }
  }

  private getValue(key: string): unknown {
    const caps = this.data.capabilities?.alwaysMatch || this.data.desiredCapabilities || {};
    return caps[key];
  }

  get sanitizedCapbilities() {
    const caps = _.cloneDeep(this.data);
    for (const key of ['browserVersion', 'extOptions', 'tags', ...Object.values(SF_CAPS_FIELDS)]) {
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

  public readonly rawResponseCapabilities: any;
  public readonly sessionId: string;
  public readonly browserName: string;
  public readonly browserVersion: string;

  constructor(private rawResponse: any, private request: RequestCapabilities) {
    this.rawResponseCapabilities = rawResponse?.value?.capabilities || rawResponse?.value; //  w3c format || json wired format
    this.sessionId = rawResponse.sessionId || rawResponse.value.sessionId;  //  w3c format || json wired format

    this.browserName = this.rawResponseCapabilities?.browserName;
    this.browserVersion = this.rawResponseCapabilities?.browserVersion;
  }

  get cdpEndpoint() {
    return `${this.request.getSessionBaseUrl(true)}/${this.sessionId}/se/cdp`;
  }

  get downloadDirectoryEndpoint() {
    return `${this.request.getSessionBaseUrl(false)}/${this.sessionId}/download-directory`
  }

  get provisionEndpoint() {
    return `${this.request.getBaseUrl(false)}/provision`
  }

  get chromeDebuggerAddress() {
    return this.rawResponseCapabilities?.["goog:chromeOptions"]?.debuggerAddress;
  }

  get chromeUserDataDir() {
    return this.rawResponseCapabilities?.chrome?.userDataDir;
  }

  get msEdgeDebuggerAddress() {
    return this.rawResponseCapabilities?.["ms:edgeOptions"]?.debuggerAddress;
  }

  get msEdgeUserDataDir() {
    return this.rawResponseCapabilities?.msedge?.userDataDir;
  }

  get firefoxProfilePath() {
    return this.rawResponseCapabilities?.['moz:profile'];
  }

  get isCdpSupported(): boolean {
    return Boolean(this.chromeDebuggerAddress || this.msEdgeDebuggerAddress || 'nodejs' == this.browserName);
  }

  get jsonObject() {
    const copiedResponse = _.cloneDeep(this.rawResponse);
    // patch capabilities
    const copiedResponseCapabilities = copiedResponse?.value?.capabilities || copiedResponse?.value;
    // set cdp endpoint
    if (this.isCdpSupported) {
      copiedResponseCapabilities['se:cdp'] = this.cdpEndpoint;
      copiedResponseCapabilities['se:cdpVersion'] = 'FIXME';  // FIXME
    }
    // set node session url
    copiedResponseCapabilities['sf:sessionUrl'] = `${this.request.getSessionBaseUrl(false)}/${this.sessionId}`;
    copiedResponseCapabilities['sf:autoDownloadUrl'] = this.downloadDirectoryEndpoint;
    copiedResponseCapabilities['sf:provisionUrl'] = this.provisionEndpoint;
    return copiedResponse;
  }
}

export interface ISession {
  id: string;
  getCdpEndpoint: () => Promise<string | void>;
  start: () => Promise<ResponseCapabilities>;
  stop: () => Promise<void>;
  kill: () => void;
  forward: (request: AxiosRequestConfig) => Promise<AxiosResponse<any>>;
  jsonObject: SessionDto;
  downloadFolder: string | undefined;
}

export function createSession(
  request: RequestCapabilities,
  webdriverConfiguration: DriverConfiguration,
  processManager: ProcessManager,
  axios: AxiosInstance,
) {
  switch (request.browserName) {
    case 'chrome': return new ChromiumSession(request, webdriverConfiguration, processManager, axios);
    case 'MicrosoftEdge': return new ChromiumSession(request, webdriverConfiguration, processManager, axios);
    case 'firefox': return new FirefoxSession(request, webdriverConfiguration, processManager, axios);
    case 'safari': return new SafariSession(request, webdriverConfiguration, processManager, axios);
    case 'nodejs': return new NodeJsSession(request, webdriverConfiguration, processManager, axios);
    default: throw Error(`browser ${request.browserName} is not supported`);
  }
}

abstract class AbstractWebdriveSession implements ISession {

  public response?: ResponseCapabilities;
  protected process?: ChildProcess;
  protected port?: number;

  constructor(
    public request: RequestCapabilities,
    protected webdriverConfiguration: DriverConfiguration,
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

  get jsonObject() {
    return {
      id: this.id,
      responseCapabilities: this.response?.jsonObject,
    };
  }

  async start() {
    await this.preStart();
    const { port, webdriverProcess } = await this.processManager.spawnWebdriverProcess({
      path: this.webdriverConfiguration.command.path,
      envs: { ...this.webdriverConfiguration.command.envs, ...this.request.environmentVariables },
      args: this.webdriverConfiguration.command.args,
      cwd: this.webdriverConfiguration.command.cwd,
    });
    this.port = port;
    this.process = webdriverProcess;
    this.axios.defaults.baseURL = `http://localhost:${this.port}`;
    console.log(`webdriver process ${this.process.pid}: wait for ready`);
    await this.waitForReady();
    console.log(`webdriver process ${this.process.pid}: ready`);
    const res = await this.createSession(this.request);
    this.response = res;
    return res;
  }

  async stop() {
    console.log(`${this.id}: delete session`);
    await this.axios.delete(`/session/${this.id}`, { timeout: 5e3 }).catch(e => console.error(e));
    console.log(`${this.id}: kill process`);
    this.kill();
    await this.mayCleanUserData();
    await this.postStop();
    console.log(`${this.id}: finish`);
  }

  async forward(request: AxiosRequestConfig) {
    return await this.axios.request(request);
  }

  get shouldCleanUserData(): boolean {
    const cleanUserData = this.request?.shouldcleanUserData;
    return _.isNil(cleanUserData) ? this.webdriverConfiguration.cleanUserData : cleanUserData;
  }

  async getCdpEndpoint(): Promise<string | undefined> { return; }

  async preStart() { }
  async postStop() { }

  get userDataDir(): string | undefined { return undefined; }

  get downloadFolder() {
    return this.request.downloadFolder || this.webdriverConfiguration.defaultCapabilities["sf:autoDownloadDirectory"];
  }

  private async waitForReady() {
    await retry(async () => await this.axios.get('/status'), { max: 10, interval: 5e2 });
  }

  private async createSession(request: RequestCapabilities) {
    const res = await this.axios.post('/session', this.mergeDefaultCaps(request.sanitizedCapbilities));
    console.log(`create session:`);
    console.log(JSON.stringify(res.data, null, 2));
    return new ResponseCapabilities(res.data, request);
  }

  private mergeDefaultCaps(caps: any) {
    const defaultCaps = this.webdriverConfiguration.defaultCapabilities;
    if (caps.desiredCapabilities) {
      _.merge(caps.desiredCapabilities, defaultCaps);
    }
    if (caps.capabilities?.alwaysMatch) {
      _.merge(caps.capabilities.alwaysMatch, defaultCaps);
    }
    return caps;
  }

  public kill() {
    if (this.process) {
      try {
        this.processManager.killProcessGroup(this.process)
      } catch (e) {
        console.warn(`ingore error during kill process`, e);
      }
    }
  }

  async mayCleanUserData() {
    const userDataDir = this.userDataDir;
    if (this.shouldCleanUserData && userDataDir) {
      try {
        console.log(`clean user data: ${userDataDir}`);
        await fs.promises.rm(userDataDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`ignore error during rm ${userDataDir}`, e);
      }
    }
  }

}

class CommonWebdriverSession extends AbstractWebdriveSession { }

class ChromiumSession extends CommonWebdriverSession {

  async getCdpEndpoint() {
    const debuggerAddress = this.response?.chromeDebuggerAddress || this.response?.msEdgeDebuggerAddress;
    if (!debuggerAddress) return;
    const res = await this.axios.request({
      baseURL: 'http://' + debuggerAddress,
      url: '/json/version',
      method: 'GET',
    });
    return res.data?.webSocketDebuggerUrl as string;
  }

  get userDataDir() {
    return this.response?.chromeUserDataDir || this.response?.msEdgeUserDataDir;
  }
}

class FirefoxSession extends CommonWebdriverSession {
  get userDataDir() {
    return this.response?.firefoxProfilePath;
  }
}

class SafariSession extends CommonWebdriverSession {
  async preStart() {
    // sometimes safaridriver may failed to reclaim
    // it is a valid work around to fix this issue
    exec('pkill safaridriver');
  }
}

class NodeJsSession implements ISession {
  public id: string;
  downloadFolder!: string;
  protected process?: ChildProcess;
  protected port?: number;
  public response?: ResponseCapabilities;

  constructor(
    public request: RequestCapabilities,
    protected webdriverConfiguration: DriverConfiguration,
    protected processManager: ProcessManager,
    protected axios: AxiosInstance,
  ) {
    this.id = uuidv4();
  }

  async start() {
    const { port, nodejsProcess } = await this.processManager.spawnNodeJsProcess({
      path: this.webdriverConfiguration.command.path,
      envs: { ...this.webdriverConfiguration.command.envs, ...this.request.environmentVariables },
      args: this.webdriverConfiguration.command.args,
      cwd: this.webdriverConfiguration.command.cwd,
    });
    this.port = port;
    this.process = nodejsProcess;
    this.response = new ResponseCapabilities({
      value: {
        sessionId: this.id,
        capabilities: {
          browserName: 'nodejs',
        }
      }
    }, this.request);
    return this.response;
  }

  public async forward(request: AxiosRequestConfig): Promise<any> {
    throw Error(`nodejs session not support webdriver protocols`)
  }

  public async stop() {
    this.kill();
  }

  public kill() {
    if (this.process) {
      try {
        this.processManager.killProcessGroup(this.process)
      } catch (e) {
        console.warn(`ingore error during kill process`, e);
      }
    }
  }

  async getCdpEndpoint() {
    const res = await retry(async () => {
      return await this.axios.request({
        baseURL: `http://localhost:${this.port}`,
        url: '/json',
        method: 'GET',
      });
    }, { max: 5, interval: 1e3 });

    return res!.data?.[0]?.webSocketDebuggerUrl as string;
  }

  get jsonObject(): SessionDto {
    return {
      id: this.id,
      responseCapabilities: this.response?.jsonObject
    }
  }
}