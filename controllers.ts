import { AxiosResponse } from "axios";
import { Context } from "koa";
import { localDriverService } from "runtime";
import { SessionPathParams } from "schemas";

type RequestHandler = (ctx: Context, next: () => Promise<any>) => Promise<void>;

export const handleCreateSessionRequest: RequestHandler = async (ctx, next)=> {
  logRequest(ctx);
  const response = await localDriverService.createSession(ctx.request);
  setResponse(ctx, response);
  next();
}

export const handleSessionRequest: RequestHandler = async (ctx, next) => {
  logRequest(ctx);
  const params = sanitizeSessionParams(ctx.params);
  const response = await localDriverService.forward(ctx.request, params);
  ctx.set(response?.headers);
  ctx.body = JSON.stringify(response?.data);
  ctx.status = response?.status!;
  next();

  if ('DELETE' === ctx.method.toUpperCase() && !params.suffix) {
    await localDriverService.deleteSession(params.sessionId);
  }
}

export const handleQueryAvailableSessions: RequestHandler = async (ctx, next) => {
  ctx.body = JSON.stringify(localDriverService.getAvailableDrivers());
  ctx.status = 200;
  next();
}


const sanitizeSessionParams = (obj: any): SessionPathParams => {
  if (!obj.sessionId) throw Error(`sessionId is required!`);
  return { sessionId: obj.sessionId, suffix: obj[0] };
}

const setResponse = (ctx: Context, response: AxiosResponse) => {
  const data = response?.data;
  ctx.set(response?.headers || {});
  ctx.body = data ? JSON.stringify(data) : data;
  ctx.status = response?.status || 500;
}

const logRequest = (ctx: Context) => {
  console.log(JSON.stringify({ ...ctx.request.toJSON(), body: ctx.request.body }, null, 2));
}
