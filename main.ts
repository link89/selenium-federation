import Koa from "koa";
import Router from "koa-router";
import bodyParser from 'koa-bodyparser';

import { config } from "./config";
import { handleCreateSessionRequest, handleQueryAvailableDrivers, handleSessionRequest } from "./controllers";


const baseRouter = new Router()

const router = new Router();
router
  .get('/available-drivers', handleQueryAvailableDrivers)
  .post('/session', handleCreateSessionRequest)
  .all([
    '/session/:sessionId',
    '/session/:sessionId/(.*)',
  ], handleSessionRequest);

baseRouter.use('/wd/hub', router.routes(), router.allowedMethods());

const app = new Koa();
app.use(bodyParser());
app.use(baseRouter.routes()).use(baseRouter.allowedMethods());

app.listen(config.port, () => {
  console.log(`selenium-federation is starting at port ${config.port}`);
});