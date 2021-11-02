import Koa from "koa";
import Router from "@koa/router";
import bodyparser from "koa-bodyparser";

import * as ws from 'ws';
import { config } from "./config";
import * as Sentry from "@sentry/node";

import { LocalService, LocalServiceController, ProcessManager } from "./refactor";

Sentry.init({
  dsn: config.sentryDSN,
  debug: config.sentryDebug,
});

const processManager = new ProcessManager();
const localService = LocalService.of(config, processManager);
localService.init();
const localServiceController = new LocalServiceController(localService);

const webdirverRouter = new Router();
webdirverRouter
  .post('/session/:sessionId/auto-cmd', () => null)
  .post('/node/:nodeId/auto-cmd', () => null)
  .post('/node/auto-cmd', () => null)

  .post('/session', localServiceController.onNewWebdriverSessionRequest)
  .delete('/session/:sessionId', localServiceController.onDeleteWebdirverSessionRequest)
  .all(['/session/:sessionId', '/session/:sessionId/(.*)'], localServiceController.onForwardWebdirverSessionRqeust)

  // TODO
  .get('/best-match')
  .get('/statuses');


const router = new Router()
router.use('/wd/hub', webdirverRouter.routes(), webdirverRouter.allowedMethods());

const app = new Koa();
app.use(bodyparser());
app.use(router.routes()).use(router.allowedMethods());
app.use(localServiceController.onError);

// set host to a ipv4 address or else request ip will be ipv6 format
// https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
const server = app.listen(config.port, config.host, () => {
  console.log(`selenium-federation is starting at port ${config.port}`);
});

// handle websocket connection
server.on('upgrade', localServiceController.onWebsocketUpgrade);