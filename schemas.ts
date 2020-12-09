import * as yup from 'yup';
import * as os from 'os';
import { getW3CPlatformName } from './utils';
import { v4 as uuidv4 } from 'uuid';


const BROWSER_NAMES = ['chrome', 'firefox', 'safari', 'MicrosoftEdge'];

export const localDriverSchema = yup.object({
  browserName: yup.string().oneOf(BROWSER_NAMES).defined(),
  platformName: yup.string().default(getW3CPlatformName()).defined(),
  uuid: yup.string().default(() => uuidv4()).defined(),
  version: yup.string(),
  tags: yup.array(yup.string().defined()).default([]),
  webdriverPath: yup.string().defined(),
  args: yup.array(yup.string().defined()).default([]),
  maxSessions: yup.number().default(1).defined(),
  defaultCapabilities: yup.object().default({}).defined(),
}).defined();

export const remoteDriverSchema = yup.object({
  url: yup.string().defined(),
  registerAt: yup.number().defined(),
}).defined();

export const configurationSchema = yup.object({
  port: yup.number().default(4444).defined(),
  browserIdleTimeout: yup.number().default(60).defined(),
  localDrivers: yup.array(localDriverSchema).default([]).defined(),
  maxSessions: yup.number().default(Math.max(2, os.cpus().length - 1)).defined(),
  registerTimeout: yup.number().default(60).defined(),
  registerTo: yup.string().optional(),
  registerAs: yup.string().optional(),
}).defined();

export type Configuration = yup.InferType<typeof configurationSchema>;
export type LocalDriver = yup.InferType<typeof localDriverSchema>;
export type RemoteDriver = yup.InferType<typeof remoteDriverSchema>;
export type Driver = LocalDriver | RemoteDriver;

export interface DriverMatchCriteria {
  browserName: string;
  platformName?: string;
  version?: string;
  uuid?: string;
  tags: string[];
}

export interface SessionPathParams {
  sessionId: string,
  suffix?: string,
}
