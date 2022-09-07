import { AxiosRequestConfig, AxiosResponse } from "axios";
import { LocalService, HubService, TerminateOptions, getFile, deleteFile } from "./service";
import { RequestCapabilities } from "./session";
import { Context, Request } from 'koa';
import Server from 'http-proxy';
import { Duplex } from "stream";
import { IncomingMessage } from 'http';
import { match } from "path-to-regexp";
import { logMessage, runProvisionTask, Semaphore, TaskResult } from "./utils";
import { LONG_TIMEOUT_IN_MS, WEBDRIVER_ERRORS } from "./constants";
import { Configuration, NodeDto, provisionTaskSchema, registerDtoSchema, RequestHandler, WebdriverError } from "./types";
import * as fs from 'fs';
import { join } from 'path';
import { Either } from "purify-ts";
import { ParsedUrlQuery } from 'querystring';
import { format } from 'util';
import { nanoid } from "nanoid";



interface HttpResponse {
  headers: { [key: string]: string };
  body: string | object;
  status: number;
}

export interface IController {
  onNewWebdriverSessionRequest: RequestHandler;
  onGetBestMatchRequest: RequestHandler;
  onDeleteWebdirverSessionRequest: RequestHandler;
  onWebdirverSessionCommandRqeust: RequestHandler;
  onWebsocketUpgrade: (req: IncomingMessage, socket: Duplex, header: Buffer) => Promise<void>;

  onAutoCmdRequest: RequestHandler;
  onAutoCmdRequestToNode: RequestHandler;
  onAutoCmdRequestToSession: RequestHandler;

  onFileRequestToSession: RequestHandler;

  onExecuteScriptToSession: RequestHandler;

  onNodeRegiester: RequestHandler;
  onGetNodesRequest: RequestHandler;
  onTermiateRequest: RequestHandler;
  onRunProvisionTask: RequestHandler;
}


export class HubController implements IController {

  constructor(
    private readonly hubService: HubService,
  ) { }

  onRunProvisionTask: RequestHandler = async (ctx, next) => {
    throw Error(`termiate endpoint is optional in hub mode`);
  }

  onExecuteScriptToSession: RequestHandler = async (ctx, next) => {
    throw Error(`execute script endpoint is optional in hub mode`);
  }

  onTermiateRequest: RequestHandler = async (ctx, next) => {
    throw Error(`termiate endpoint is optional in hub mode`);
  }

  onGetBestMatchRequest: RequestHandler = async (ctx, next) => {
    // TODO: implement when necessary
    throw Error(`best-match endpoint is optional in hub mode`);
  }

  onNewWebdriverSessionRequest: RequestHandler = async (ctx, next) => {
    const request = new RequestCapabilities(ctx.request);
    const result = await this.hubService.newWebdirverSession(request);
    setForwardResponse(ctx, result);
  }

  onDeleteWebdirverSessionRequest: RequestHandler = async (ctx, next) => {
    const { sessionId, path } = getSessionParams(ctx);
    const request = {
      ...toForwardRequest(ctx),
    };
    const result = await this.hubService.deleteWebdriverSession(sessionId, path, request);
    setForwardResponse(ctx, result);
  }

  onWebdirverSessionCommandRqeust: RequestHandler = async (ctx, next) => {
    const { sessionId, path } = getSessionParams(ctx);
    const request = {
      ...toForwardRequest(ctx),
    };
    const result = await this.hubService.forwardWebdriverRequest(sessionId, path, request);
    setForwardResponse(ctx, result);
  }

  onAutoCmdRequest: RequestHandler = async (ctx, next) => {
    const request = {
      ...toForwardRequest(ctx),
    };
    const result = await this.hubService.forwardAutoCmd(ctx.params || {}, request);
    setForwardResponse(ctx, result);
  }

  onAutoCmdRequestToNode: RequestHandler = this.onAutoCmdRequest;
  onAutoCmdRequestToSession: RequestHandler = this.onAutoCmdRequest;

  onFileRequestToSession: RequestHandler = async (ctx, next) => {
    const { sessionId } = ctx.params;
    const path = '/' + (ctx.params[0] || '');
    const request = {
      ...toForwardRequest(ctx),
    };
    const result = await this.hubService.forwardFileRequest(sessionId, path, request);
    setForwardResponse(ctx, result);
  }

  onWebsocketUpgrade = async (req: IncomingMessage, socket: Duplex, header: Buffer) => {
    throw Error(`hub mode won't handle websocket proxy`);
  }

  onNodeRegiester: RequestHandler = async (ctx, next) => {
    const registerRequest = registerDtoSchema.validateSync(ctx.request.body);
    const nodeUrl = format(registerRequest.registerAs, ctx.request.ip);
    await this.hubService.onRegister(nodeUrl);
    ctx.status = 201;
  }

  onGetNodesRequest: RequestHandler = async (ctx, next) => {
    const nodes: NodeDto[] = this.hubService.getNodes().map(node => node.node);
    setHttpResponse(ctx, {
      status: 200,
      body: nodes,
    });
  }
}

export class LocalController implements IController {

  private provisionTaskLock = new Semaphore(1);

  constructor(
    private readonly config: Configuration,
    private readonly localService: LocalService,
    private proxy: Server,
  ) {
    this.proxy.on('error', (err) => console.error(err));
    this.proxy.on('econnreset', (err) => console.error(err));
  }

  onRunProvisionTask: RequestHandler = async (ctx, next) => {
    await this.provisionTaskLock.withLock(async () => {
      const task = await provisionTaskSchema.validate(ctx.request.body);
      console.log(`start to run provision task`, task);
      const downloadFolder = join(this.config.tmpFolder, `ad-hoc-provision-${nanoid()}`);
      await fs.promises.mkdir(downloadFolder, { recursive: true });
      let result: TaskResult;
      try {
        result = await runProvisionTask(task, { downloadFolder });
      } finally {
        await fs.promises.rm(downloadFolder, { recursive: true, force: true })
      }
      setHttpResponse(ctx, {
        status: 200,
        body: result,
      });
    });
  }

  onTermiateRequest: RequestHandler = async (ctx, next) => {
    const query = ctx.request.query;
    await this.localService.terminate(queryToTerminateOptions(query));
    setHttpResponse(ctx, {
      status: 200,
      body: renderTerminatePage({
        version: this.config.version,
        startTime: this.config.startTime,
      })
    });
  }

  onNewWebdriverSessionRequest: RequestHandler = async (ctx, next) => {
    const request = new RequestCapabilities(ctx.request);
    const result = await this.localService.newWebdirverSession(request);
    result.ifLeft(err => {
      setHttpResponse(ctx, {
        status: err.code,
        body: { value: err },
      });
    }).ifRight(response => {
      setHttpResponse(ctx, {
        status: 200,
        body: response.jsonObject,
      });
    });
  }

  onGetBestMatchRequest: RequestHandler = async (ctx, next) => {
    const request = new RequestCapabilities(ctx.request);
    const driver = this.localService.getBestAvailableWebdirver(request);
    if (driver) {
      setHttpResponse(ctx, {
        status: 200,
        body: driver.jsonObject,
      });
    } else {
      setHttpResponse(ctx, {
        status: 404,
        body: 'no availabe capbilities could be found',
      });
    }
  }

  onDeleteWebdirverSessionRequest: RequestHandler = async (ctx, next) => {
    const { sessionId } = getSessionParams(ctx);
    await this.localService.deleteWebdirverSession(sessionId);
    setHttpResponse(ctx, {
      status: 200,
      body: { value: null },
    });
  }

  onWebdirverSessionCommandRqeust: RequestHandler = async (ctx, next) => {
    const { sessionId, path } = getSessionParams(ctx);
    const request = {
      ...toForwardRequest(ctx),
    };
    const result = await this.localService.forwardWebdriverRequest(sessionId, path, request);
    setForwardResponse(ctx, result);
  }

  onGetNodesRequest: RequestHandler = async (ctx, next) => {
    const nodes = this.localService.getNodeDtos();
    setHttpResponse(ctx, {
      status: 200,
      body: nodes,
    });
  }

  onWebsocketUpgrade = async (req: IncomingMessage, socket: Duplex, header: Buffer) => {
    const sessionId = this.getSessionIdFromCdpPath(req.url);
    if (!sessionId) {
      socket.destroy();
      return;
    }
    const cdpEndpoint = await this.localService.getCdpEndpointBySessionId(sessionId);
    if (!cdpEndpoint) {
      socket.destroy();
      return;
    }
    // capture socket error, it happens when webdirver close socket connection
    socket.on('error', (err) => console.error(err));
    logMessage(`create websocket proxy to ${cdpEndpoint}`);

    // this.proxy.on('proxyReqWs', (proxyReq) => { });

    const targetUrl = new URL(cdpEndpoint);
    this.proxy.ws(req, socket, header, {
      target: cdpEndpoint,
      ignorePath: true,
      ws: true,
      headers: {
        host: targetUrl.host,
      }
    });

  }

  onAutoCmdRequest: RequestHandler = async (ctx, next) => {
    const request = {
      ...toForwardRequest(ctx),
    };
    const result = await this.localService.forwardAutoCmdRequest(request);
    setForwardResponse(ctx, result);
  }
  onAutoCmdRequestToNode: RequestHandler = this.onAutoCmdRequest;
  onAutoCmdRequestToSession: RequestHandler = this.onAutoCmdRequest;

  onFileRequestToSession: RequestHandler = async (ctx, next) => {
    const { sessionId } = getSessionParams(ctx);
    const session = this.localService.getWebdriverSessionById(sessionId);
    if (!session) {
      return setHttpResponse(ctx, {
        ...WEBDRIVER_ERRORS.INVALID_SESSION_ID,
        body: `session id ${sessionId} is invalid`,
      });
    }
    const root = session?.downloadFolder as string;
    if (ctx.method !== 'GET' && ctx.method !== 'DELETE') return;
    if (ctx.method === "GET") {
      return await getFile(ctx, root);
    }
    if (ctx.method === "DELETE") {
      return await deleteFile(ctx, root);
    }
  }

  onExecuteScriptToSession: RequestHandler = async (ctx, next) => {
    await this.provisionTaskLock.withLock(async () => {
      const task = await provisionTaskSchema.validate(ctx.request.body);
      console.log(`start to run provision task`, task);
      const result = await runProvisionTask(task);
      setHttpResponse(ctx, {
        status: 200,
        body: result,
      });
    });
  }

  onNodeRegiester: RequestHandler = (ctx, next) => {
    throw Error(`register endpoint is not supported in local mode`);
  }

  private cdpPathPattern = match<{ sessionId: string }>(`/wd/hub/session/:sessionId/se/cdp`, { decode: decodeURIComponent });

  private getSessionIdFromCdpPath(pathname?: string) {
    if (!pathname) return;
    const match = this.cdpPathPattern(pathname);
    return match ? match?.params?.sessionId : undefined;
  }

}

export const onError: RequestHandler = (ctx, next) => {
  next().catch(e => {
    ctx.status = 500,
      ctx.body = JSON.stringify(
        {
          ...WEBDRIVER_ERRORS.UNKNOWN_ERROR,
          message: e?.message || '',
          stacktrace: e?.stack || '',
        }
      )
  });
}

export function serveStatic(root: string): RequestHandler {
  return async (ctx, next) => {
    if (ctx.method !== 'HEAD' && ctx.method !== 'GET') return;
    await getFile(ctx, root, false);
  }
}

export const setHttpResponse = (ctx: Context, response: Partial<HttpResponse>) => {
  if (response.status) {
    ctx.status = response.status;
  }
  if (response.headers) {
    ctx.set(response.headers);
  }
  if ('object' === typeof (response.body)) {
    ctx.body = JSON.stringify(response.body);
  } else {
    ctx.body = response.body;
  }
}

function toForwardRequest(ctx: Context): AxiosRequestConfig {
  const fromRequest: Request = ctx.request;
  const headers = { ...fromRequest.headers };
  delete headers['host'];
  delete headers['content-length'];
  return {
    method: fromRequest.method as any,
    data: fromRequest.rawBody,
    headers,
    params: fromRequest.query,
    timeout: LONG_TIMEOUT_IN_MS,
  };
}

function setForwardResponse(ctx: Context, result: Either<WebdriverError, AxiosResponse>) {
  result.ifLeft(err => {
    setHttpResponse(ctx, {
      status: err.code,
      body: { value: err },
    });
  }).ifRight(response => {
    const headers = { ...response.headers };
    delete headers['content-length'];
    setHttpResponse(ctx, {
      status: response.status,
      body: response.data,
      headers,
    });
  });
}

const getSessionParams = (ctx: Context) => {
  const params = ctx?.params;
  const sessionId = params?.sessionId;
  if (!sessionId) {
    throw new Error(`sessionId is empty`);
  }
  return { sessionId, path: params[0] ? '/' + params[0] : '' };
}

function queryToTerminateOptions(query: ParsedUrlQuery): TerminateOptions {
  const options: TerminateOptions = {
    confirmed: '1' === query.confirmed,
    force: '1' === query.force,
    cancel: '1' === query.cancel,
  };
  return options;
}

function renderTerminatePage(data: { version: string, startTime: string }) {
  return [
    `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"><html>`,
    `<title>Terminate Service</title>`,
    `<body>`,
    `<h2>Termiate Service</h2>`,
    `<hr>`,
    `<ul>`,
    `<li>Click <a href="/terminate?confirmed=1">here</a> to teriminated the service gracefully (waiting for all sessions exited, cancelable) </li>`,
    `<li>Click <a href="/terminate?cancel=1">here</a> to cancel the termination</li>`,
    `<li>Click <a href="/terminate?confirmed=1&force=1">here</a> to teriminated the service immediately (current sessions will be aborted)</li>`,
    `</ul>`,
    `<hr>`,
    `<ul>`,
    `<li>Version: ${data.version}</li>`,
    `<li>Start Time: ${data.startTime}</li>`,
    `</ul>`,
    `</body>`,
    `</html>`,
  ].join('\n');
}
