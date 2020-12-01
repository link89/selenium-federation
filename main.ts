import Koa from "koa";
import Router from "koa-router";
import { config } from "./config";


const app = new Koa();

app.listen(config.port, () => {
  console.log(`selenium-federation is starting at port ${config.port}`);
});