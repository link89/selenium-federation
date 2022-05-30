import Koa from "koa";
import Router from "@koa/router";
import bodyparser from "koa-bodyparser";
import logger from  "koa-logger";

import { getAndInitConfig } from "./config";
import * as Sentry from "@sentry/node";

import { HubService, LocalService } from "./service";
import { serveStatic, LocalController, onError, IController, HubController } from "./controllers";
import { ProcessManager } from "./process";
import axios from "axios";

process.on('uncaughtException', function (err) {
  console.error(`suppress uncaughtException:`);
  console.error(err);
});


// Get started
(async () => {
  const config = await getAndInitConfig();

  if (config.sentry) {
    Sentry.init({
      dsn: config.sentry.dsn,
      debug: config.sentry.debug,
    });
  }

  let controller: IController;

  if ('local' === config.role) {
    const processManager = new ProcessManager(config);
    await processManager.init();

    const localService = LocalService.of(config, processManager);
    localService.init();
    controller = new LocalController(localService);
  } else if ('hub' === config.role) {
    const hubService = new HubService(config, axios.create({}));
    controller = new HubController(hubService);
  } else {
    throw Error(`Invalid role: ${config.role}`);
  }

  const wdHubRouter = new Router();
  wdHubRouter
    // auto-cmd
    .post('/session/:sessionId/auto-cmd', controller.onAutoCmdRequestToSession)
    .post('/nodes/:nodeId/auto-cmd', controller.onAutoCmdRequestToNode)
    // webdriver session
    .post('/session', controller.onNewWebdriverSessionRequest)
    .delete(['/session/:sessionId', '/session/:sessionId/'], controller.onDeleteWebdirverSessionRequest)
    .all(['/session/:sessionId', '/session/:sessionId/(.*)'], controller.onWebdirverSessionCommandRqeust)
    // data model
    .post('/best-match', controller.onGetBestMatchRequest)
    .get('/nodes', controller.onGetNodesRequest)
    .post('/register', controller.onNodeRegiester)

  const rootRouter = new Router();
  rootRouter
    // hub endpoint
    .use('/wd/hub', wdHubRouter.routes(), wdHubRouter.allowedMethods())
    // utils
    .post('/auto-cmd', controller.onAutoCmdRequest)
    .get('/terminate', controller.onTermiateRequest)

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
  server.on('upgrade', controller.onWebsocketUpgrade);

  // default is 5000, which will lead to ECONNRESET error in some client (got, for example)
  // set to a larger value to workaround this problem,
  server.keepAliveTimeout = 60e3;
  // ref: https://stackoverflow.com/a/68922692/3099733, https://github.com/nodejs/node/issues/27363
  server.headersTimeout = 60e3 + 1e3;
})();
