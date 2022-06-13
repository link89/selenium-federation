import * as yup from 'yup';
import * as os from 'os';
import { getW3CPlatformName } from './utils';
import { v4 as uuidv4 } from 'uuid';
import type { Context } from 'koa';

const BROWSER_NAMES = ['chrome', 'firefox', 'safari', 'MicrosoftEdge', 'nodejs'];
const ROLES = ['local', 'hub'];

const stringArray = yup.array(yup.string().required()).default([]);
const provisionTask = yup.object({
  download: yup.string().optional(),
  cmds: stringArray,
  neverSkip: yup.boolean().default(false),
}).defined();

export const driverConfigurationSchema = yup.object({
  browserName: yup.string().oneOf(BROWSER_NAMES).defined(),
  browserVersion: yup.string().optional(),
  sessionIdleTimeout: yup.number(),
  uuid: yup.string().default(() => uuidv4()),
  tags: yup.array(yup.string().defined()).default([]),
  webdriver: yup.object({
    path: yup.string().defined(),
    args: yup.array(yup.string().defined()).default([]),
    envs: yup.object().default({}),
  }).defined(),
  maxSessions: yup.number().default(1),
  defaultCapabilities: yup.object().default({}),
  cleanUserData: yup.boolean().default(true),
}).defined();

export const configurationSchema = yup.object({
  role: yup.string().oneOf(ROLES).defined(),
  port: yup.number().default(4444),
  host: yup.string().default('0.0.0.0'),
  publicUrl: yup.string().optional(),
  tags: stringArray,
  uuid: yup.string().default(() => uuidv4()),
  platformName: yup.string().default(getW3CPlatformName()),

  sessionIdleTimeout: yup.number().default(60),
  maxSessions: yup.number().default(Math.max(1, os.cpus().length - 1)),

  drivers: yup.array(driverConfigurationSchema).default([]),

  provision: yup.object({
    tasks: yup.array(provisionTask).default([]),
  }).optional(),

  registerTo: yup.string().optional(),
  tmpFolder: yup.string().default(`./tmp`),

  sentry: yup.object({
    dsn: yup.string().defined(),
    debug: yup.boolean().default(false),
  }).default(undefined),

  autoCmdHttp: yup.object({
    disable: yup.boolean().default(false),
    path: yup.string().defined(),
    args: stringArray,
  }).default(undefined),

  fileServer: yup.object({
    disable: yup.boolean().default(false),
    root: yup.string().defined(),
  }).default(undefined),

}).defined();

export const sessionDtoSchema = yup.object({
  id: yup.string().defined(),
  responseCapabilities: yup.object().optional(),
}).defined();

export const driverDtoSchema = yup.object({
  config: driverConfigurationSchema,
  sessions: yup.array(sessionDtoSchema).default([]),
}).defined();

export const nodeDtoSchema = yup.object({
  config: configurationSchema,
  drivers: yup.array(driverDtoSchema).default([]),
}).defined();

export const registerDtoSchema = yup.object({
  registerAs: yup.string().required(),
}).defined();

export interface Configuration extends yup.Asserts<typeof configurationSchema> { };
export interface DriverConfiguration extends yup.Asserts<typeof driverConfigurationSchema> { };
export interface SessionDto extends yup.Asserts<typeof sessionDtoSchema> { };
export interface DriverDto extends yup.Asserts<typeof driverDtoSchema> { };
export interface NodeDto extends yup.Asserts<typeof nodeDtoSchema> { };
export interface RegisterDto extends yup.Asserts<typeof registerDtoSchema> { };
export interface ProvisionTask extends yup.Asserts<typeof provisionTask> { };

export interface SessionPathParams {
  sessionId: string,
  suffix?: string,
}

export interface WebdriverError<T = unknown> {
  code: number;
  error: string;
  message: string;
  stacktrace: string;
  data?: T;
}

export interface AutoCmdError<T = unknown> extends WebdriverError<T> { }

export type RequestHandler = (ctx: Context, next: () => Promise<any>) => Promise<void> | void;
