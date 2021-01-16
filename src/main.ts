import Koa from "koa";
import Router from "koa-router";
import bodyParser from 'koa-bodyparser';

import { config } from "./config";
import { handleRegisterRequest, handleCreateSessionRequest, handleQueryAvailableDriversRequest , handleSessionRequest, handleGetStatusesRequest } from "./controllers";
import { handleError } from "./error";


const router = new Router();
router
  .get('/available-drivers', handleQueryAvailableDriversRequest)
  .get('/statuses', handleGetStatusesRequest)
  .post('/register', handleRegisterRequest)
  .post('/session', handleCreateSessionRequest)
  .all([
    '/session/:sessionId',
    '/session/:sessionId/(.*)',
  ], handleSessionRequest);

const baseRouter = new Router()
baseRouter.use('/wd/hub', router.routes(), router.allowedMethods());

const app = new Koa();
app.use(handleError);
app.use(bodyParser());
app.use(baseRouter.routes()).use(baseRouter.allowedMethods());

// set host to a ipv4 address or else request ip will be ipv6 format
// https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
app.listen(config.port, config.host, () => {
  console.log(`selenium-federation is starting at port ${config.port}`);
});