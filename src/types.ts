import * as yup from 'yup';
import * as os from 'os';
import { getW3CPlatformName } from './utils';
import { v4 as uuidv4 } from 'uuid';
import type { Context } from 'koa';

const BROWSER_NAMES = ['chrome', 'firefox', 'safari', 'MicrosoftEdge'];
const ROLES = ['hub', 'node'];


export const driverConfigurationSchema = yup.object({
  browserName: yup.string().oneOf(BROWSER_NAMES).defined(),
  browserVersion: yup.string().defined(),
  sessionTimeout: yup.number(),
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
  tags: yup.array(yup.string().defined()).default([]),
  uuid: yup.string().default(() => uuidv4()),
  platformName: yup.string().default(getW3CPlatformName()),

  sessionTimeout: yup.number().default(60),
  maxSessions: yup.number().default(Math.max(1, os.cpus().length - 1)),

  fileServer: yup.string().optional(),
  tmpFolder: yup.string().default(`tmp/`),
  configFilePath: yup.string().defined(),

  registerTimeout: yup.number().default(10),
  registerTo: yup.string().optional(),
  registerAs: yup.string().optional(),

  sentryDSN: yup.string().optional(),
  sentryDebug: yup.boolean().default(false),

  autoCmdHttp: yup.object({
    disable: yup.boolean().default(false),
    path: yup.string().defined(),
    args: yup.array(yup.string().defined()).default([]),
    maxSessions: yup.number().default(5),
  }).default(undefined),

  ansiblePlaybookCmd: yup.string().optional(),

  drivers: yup.array(driverConfigurationSchema).default([]),
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
  registerAs: yup.string().optional(),
}).defined();

export interface Configuration extends yup.Asserts<typeof configurationSchema> { };
export interface DriverConfiguration extends yup.Asserts<typeof driverConfigurationSchema> { };
export interface SessionDto extends yup.Asserts<typeof sessionDtoSchema> { };
export interface DriverDto extends yup.Asserts<typeof driverDtoSchema> { };
export interface NodeDto extends yup.Asserts<typeof nodeDtoSchema> { };
export interface RegisterDto extends yup.Asserts<typeof registerDtoSchema> { };

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
