import Koa, { Context, DefaultState } from "koa";
import Router from "koa-router";
import bodyParser from 'koa-bodyparser';
import views from 'koa-views';
import path from 'path';

import { config } from "./config";
import { handleRegisterRequest, handleCreateSessionRequest, handleQueryAvailableDriversRequest, handleSessionRequest, handleGetStatusesRequest, RequestHandler, handleGetStatusesUi } from "./controllers";
import { handleError } from "./error";
import * as Sentry from "@sentry/node";
import { logMessage } from "./utils";

Sentry.init({
  dsn: config.sentryDSN,
  debug: config.sentryDebug,
});

const render = views(path.join(__dirname, '/../views'), {
  map: {
    html: 'swig'
  }
});

const router = new Router<DefaultState, Context>();
router
  .get('/', handleGetStatusesUi)
  .get('/available-drivers', handleQueryAvailableDriversRequest)
  .get('/statuses', handleGetStatusesRequest)
  .post('/register', handleRegisterRequest)
  .post('/session', handleCreateSessionRequest)
  .all([
    '/session/:sessionId',
    '/session/:sessionId/(.*)',
  ], handleSessionRequest);

const baseRouter = new Router<DefaultState, Context>();
baseRouter.use('/wd/hub', router.routes(), router.allowedMethods());

const app = new Koa();
app.use(render as RequestHandler);
app.use(handleError);
app.use(bodyParser());
app.use(baseRouter.routes()).use(baseRouter.allowedMethods());

// set host to a ipv4 address or else request ip will be ipv6 format
// https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
app.listen(config.port, config.host, () => {
  logMessage(`selenium-federation is starting at port ${config.port}`);
});