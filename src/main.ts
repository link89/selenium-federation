import Koa from "koa";
import Router from "@koa/router";
import bodyparser from "koa-bodyparser";
import logger from  "koa-logger";

import { config } from "./config";
import * as Sentry from "@sentry/node";

import { LocalService } from "./service";
import { LocalController } from "./controllers";
import { ProcessManager } from "./process";

Sentry.init({
  dsn: config.sentryDSN,
  debug: config.sentryDebug,
});

// Get started
(async () => {

  const processManager = new ProcessManager(config);
  await processManager.init();

  const localService = LocalService.of(config, processManager);
  localService.init();
  const localServiceController = new LocalController(localService);

  const webdirverRouter = new Router();
  webdirverRouter
    // auto-cmd
    .post('/session/:sessionId/auto-cmd', localServiceController.onAutoCmdRequest)
    .post('/nodes/:nodeId/auto-cmd', localServiceController.onAutoCmdRequest)
    .all('/auto-cmd', localServiceController.onAutoCmdRequest)
    // webdriver session
    .post('/session', localServiceController.onNewWebdriverSessionRequest)
    .delete('/session/:sessionId', localServiceController.onDeleteWebdirverSessionRequest)
    .all(['/session/:sessionId', '/session/:sessionId/(.*)'], localServiceController.onWebdirverSessionCommandRqeust)
    // data model
    .get('/drivers', localServiceController.onGetDriversRequest);


  const router = new Router()
  router.use('/wd/hub', webdirverRouter.routes(), webdirverRouter.allowedMethods());

  const app = new Koa();
  app.use(bodyparser());
  app.use(logger());
  app.use(router.routes()).use(router.allowedMethods());
  app.use(localServiceController.onError);

  // set host to a ipv4 address or else request ip will be ipv6 format
  // https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
  const server = app.listen(config.port, config.host, () => {
    console.log(`selenium-federation is starting at port ${config.port}`);
  });

  // handle websocket connection
  server.on('upgrade', localServiceController.onWebsocketUpgrade);

})();
