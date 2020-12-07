import Koa from "koa";
import Router from "koa-router";
import bodyParser from 'koa-bodyparser';

import { config } from "./config";
import { handleRegisterRequest, handleCreateSessionRequest, handleQueryAvailableDrivers, handleSessionRequest } from "./controllers";


const router = new Router();
router
  .post('/register', handleRegisterRequest)
  .get('/available-drivers', handleQueryAvailableDrivers)
  .post('/session', handleCreateSessionRequest)
  .all([
    '/session/:sessionId',
    '/session/:sessionId/(.*)',
  ], handleSessionRequest);

const baseRouter = new Router()
baseRouter.use('/wd/hub', router.routes(), router.allowedMethods());

const app = new Koa();
app.use(bodyParser());
app.use(baseRouter.routes()).use(baseRouter.allowedMethods());

app.listen(config.port, () => {
  console.log(`selenium-federation is starting at port ${config.port}`);
});