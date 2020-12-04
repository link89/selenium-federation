import Koa from "koa";
import Router from "koa-router";
import bodyParser from 'koa-bodyparser';

import { config } from "./config";
import { handleCreateSessionRequest, handleQueryAvailableSessions, handleSessionRequest } from "./controllers";


const router = new Router();
router.get('/wd/hub/available-sessions', handleQueryAvailableSessions);
router.post('/wd/hub/session', handleCreateSessionRequest);
router.all([
  '/wd/hub/session/:sessionId',
  '/wd/hub/session/:sessionId/(.*)',
], handleSessionRequest);

const app = new Koa();
app.use(bodyParser());
app.use(router.routes()).use(router.allowedMethods());

app.listen(config.port, () => {
  console.log(`selenium-federation is starting at port ${config.port}`);
});