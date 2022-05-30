import Koa from "koa";
import Router from "@koa/router";
import bodyparser from "koa-bodyparser";
import logger from  "koa-logger";

import { getAndInitConfig } from "./config";
import * as Sentry from "@sentry/node";

import { LocalService } from "./service";
import { serveStatic, LocalController, onError } from "./controllers";
import { ProcessManager } from "./process";


// Get started
(async () => {
  const config = await getAndInitConfig();

  if (config.sentry) {
    Sentry.init({
      dsn: config.sentry.dsn,
      debug: config.sentry.debug,
    });
  }

  const processManager = new ProcessManager(config);
  await processManager.init();

  const localService = LocalService.of(config, processManager);
  localService.init();
  const localServiceController = new LocalController(localService);

  const wdHubRouter = new Router();
  wdHubRouter
    // auto-cmd
    .post('/session/:sessionId/auto-cmd', localServiceController.onAutoCmdRequestToSession)
    .post('/nodes/:nodeId/auto-cmd', localServiceController.onAutoCmdRequestToNode)
    // webdriver session
    .post('/session', localServiceController.onNewWebdriverSessionRequest)
    .delete(['/session/:sessionId', '/session/:sessionId/'], localServiceController.onDeleteWebdirverSessionRequest)
    .all(['/session/:sessionId', '/session/:sessionId/(.*)'], localServiceController.onWebdirverSessionCommandRqeust)
    // data model
    .post('/best-match', localServiceController.onGetBestMatchRequest)
    .get('/nodes', localServiceController.onGetNodesRequest)

  const rootRouter = new Router();
  rootRouter
    // hub endpoint
    .use('/wd/hub', wdHubRouter.routes(), wdHubRouter.allowedMethods())

    // utils
    .post('/auto-cmd', localServiceController.onAutoCmdRequest)
    .get('/terminate', localServiceController.onTermiateRequest)

  if (config.fileServer && !config.fileServer.disable) {
    rootRouter.all('/fs/(.*)', serveStatic(config.fileServer.root));
  }

  const app = new Koa();
  app
    .use(bodyparser())
    .use(rootRouter.routes())
    .use(rootRouter.allowedMethods())
    .use(logger())
    .use(onError);

  // set host to a ipv4 address or else request ip will be ipv6 format
  // https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
  const server = app.listen(config.port, config.host, () => {
    console.log(`selenium-federation is starting at port ${config.port}`);
  });

  // handle websocket connection
  server.on('upgrade', localServiceController.onWebsocketUpgrade);
})();
