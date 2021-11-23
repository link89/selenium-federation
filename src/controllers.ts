import { Context } from "koa";



export type RequestHandler = (ctx: Context, next: () => Promise<any>) => Promise<void> | void;
