import * as yup from 'yup';

const BROWSER_NAMES = ['chrome', 'firefox', 'safari', 'MicrosoftEdge'];

const remoteDriverSchema = yup.object({
  url: yup.string().defined(),
  maxSessions: yup.number().default(1).defined(),
}).defined();

export const localDriverSchema = yup.object({
  browserName: yup.string().oneOf(BROWSER_NAMES).defined(),
  tags: yup.array(yup.string().defined()).default([]),
  webdriverPath: yup.string().defined(),
  args: yup.array(yup.string().defined()).default([]),
  maxSessions: yup.number().default(1).defined(),
  defaultCapabilities: yup.object().default({}).defined(),
}).defined();

export const configurationSchema = yup.object({
  port: yup.number().default(4444).defined(),
  browserIdleTimeout: yup.number().default(60).defined(),
  maxSessions: yup.number().default(5).defined(),
  localDrivers: yup.array(localDriverSchema).default([]).defined(),
  remoteDrivers: yup.array(remoteDriverSchema).default([]).defined(),
}).defined();

export type Configuration = yup.InferType<typeof configurationSchema>;
export type LocalDriver = yup.InferType<typeof localDriverSchema>;
export type RemoteDriver = yup.InferType<typeof remoteDriverSchema>;
export type Driver = LocalDriver | RemoteDriver;

export interface DriverMatchCriteria {
  browserName: string;
  tags: string[];
}

export interface SessionPathParams {
  sessionId: string,
  suffix?: string,
}