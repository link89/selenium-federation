import { AxiosRequestConfig } from "axios";
import { LocalService } from "./refactor";
import { RequestCapabilities } from "./session";
import { Context, Request } from 'koa';
import { createProxyServer } from 'http-proxy';
import { Duplex } from "stream";
import { IncomingMessage } from 'http';
import { match } from "path-to-regexp";
import { logMessage } from "./utils";
import { WEBDRIVER_ERRORS } from "./constants";

export type RequestHandler = (ctx: Context, next: () => Promise<any>) => Promise<void> | void;

interface HttpResponse {
  headers: { [key: string]: string };
  body: string;
  jsonBody: any;
  status: number;
}



export class LocalServiceController {

  constructor(
    private readonly localService: LocalService,
  ) { }

  onNewWebdriverSessionRequest: RequestHandler = async (ctx, next) => {
    const request = new RequestCapabilities(ctx.request);
    const result = await this.localService.newWebdirverSession(request);
    result.ifLeft(err => {
      this.setHttpResponse(ctx, {
        status: err.code,
        jsonBody: { value: err },
      });
    }).ifRight(response => {
      this.setHttpResponse(ctx, {
        status: 200,
        jsonBody: response.jsonObject,
      });
    });
  }

  onDeleteWebdirverSessionRequest: RequestHandler = async (ctx, next) => {
    const { sessionId } = this.getSessionParams(ctx);
    await this.localService.deleteWebdirverSession(sessionId);
    this.setHttpResponse(ctx, {
      status: 200,
      jsonBody: { value: null },
    });
  }

  onWebdirverSessionRqeust: RequestHandler = async (ctx, next) => {
    const { sessionId, path } = this.getSessionParams(ctx);
    const fromRequest: Request = ctx.request;
    const toRequest: AxiosRequestConfig = {
      method: fromRequest.method as any,
      data: fromRequest.rawBody,
      headers: fromRequest.headers,
      params: fromRequest.query,
      timeout: 30e3,
    };

    const result = await this.localService.forwardWebdriverRequest(sessionId, path, toRequest);
    result.ifLeft(err => {
      this.setHttpResponse(ctx, {
        status: err.code,
        jsonBody: { value: err },
      });
    }).ifRight(response => {
      this.setHttpResponse(ctx, {
        status: 200,
        body: response.data,
        headers: response.headers,
      });
    });
  }

  onError: RequestHandler = (ctx, next) => {
    next().catch(e => {
      this.setHttpResponse(ctx, {
        status: 500,
        jsonBody: {
          ...WEBDRIVER_ERRORS.UNKNOWN_ERROR,
          message: e.message || '',
          stacktrace: e.stack || '',
        }
      });
    });
  }

  onWebsocketUpgrade = async (req: IncomingMessage, socket: Duplex, header: Buffer) => {
    const sessionId = this.getSessionIdFromCdpPath(req.url);
    if (!sessionId) {
      return socket.destroy();
    }
    const cdpEndpoint = await this.localService.getCdpEndpointBySessionId(sessionId);
    if (!cdpEndpoint) {
      return socket.destroy();
    }
    // FIXME: I'am not should if the proxy will get reclaimed by the system.
    // Potential memory leak risk alert!
    const proxy = createProxyServer({
      target: cdpEndpoint,
    });
    logMessage(`create websocket proxy to ${cdpEndpoint}`);
    proxy.ws(req, socket, header);
  }

  onAutoCmdRequest: RequestHandler = async (ctx, next) => {
    const fromRequest: Request = ctx.request;
    const toRequest: AxiosRequestConfig = {
      method: fromRequest.method as any,
      data: fromRequest.rawBody,
      headers: fromRequest.headers,
      params: fromRequest.query,
      timeout: 30e3,
    }

    const result = await this.localService.forwardAutoCmdRequest(toRequest);
    result.ifLeft(err => {
      this.setHttpResponse(ctx, {
        status: err.code,
        jsonBody: { value: err },
      });
    }).ifRight(response => {
      this.setHttpResponse(ctx, {
        status: 200,
        body: response.data,
        headers: response.headers,
      });
    });
  }

  private cdpPathPattern = match<{ sessionId: string }>('/wd/hub/session/:sessionId/se/cdp', { decode: decodeURIComponent });

  private getSessionIdFromCdpPath(pathname?: string) {
    if (!pathname) return;
    const match = this.cdpPathPattern(pathname);
    return match ? match?.params?.sessionId : undefined;
  }

  private setHttpResponse = (ctx: Context, response: Partial<HttpResponse>) => {
    if (response.status) {
      ctx.status = response.status;
    }
    if (response.headers) {
      ctx.set(response.headers);
    }
    if (void 0 != response.body) {
      ctx.body = response.body;
    } else if (response.jsonBody) {
      ctx.body = JSON.stringify(response.jsonBody);
    }
  }

  private getSessionParams = (ctx: Context) => {
    const params = ctx?.params;
    const sessionId = params?.sessionId;
    if (!sessionId) {
      throw new Error(`sessionId is empty`);
    }
    return { sessionId, path: params[0] ? '/' + params[0] : '' };
  }
}