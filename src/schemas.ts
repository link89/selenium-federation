import * as yup from 'yup';
import * as os from 'os';
import { getDefaultRebootCommand, getW3CPlatformName } from './utils';
import { v4 as uuidv4 } from 'uuid';

const BROWSER_NAMES = ['chrome', 'firefox', 'safari', 'MicrosoftEdge'];

export const localDriverConfigurationSchema = yup.object({
  browserName: yup.string().oneOf(BROWSER_NAMES).defined(),
  browserVersion: yup.string().defined(),
  browserIdleTimeout: yup.number(),
  platformName: yup.string().default(getW3CPlatformName()),
  uuid: yup.string().default(() => uuidv4()),
  tags: yup.array(yup.string().defined()).default([]),
  webdriverPath: yup.string().defined(),
  webdriverArgs: yup.array(yup.string().defined()).default([]),
  webdriverEnvs: yup.object().default({}),
  maxSessions: yup.number().default(1),
  defaultCapabilities: yup.object().default({}),
  cleanData: yup.boolean().default(true),
}).defined();

export const remoteDriverConfigurationSchema = yup.object({
  url: yup.string().defined(),
  registerAt: yup.number().defined(),
}).defined();

export const configurationSchema = yup.object({
  port: yup.number().default(4444),
  host: yup.string().default('0.0.0.0'),
  uuid: yup.string().default(() => uuidv4()),
  browserIdleTimeout: yup.number().default(60),
  localDrivers: yup.array(localDriverConfigurationSchema).optional(),
  maxSessions: yup.number().default(Math.max(1, os.cpus().length - 1)),

  registerTimeout: yup.number().default(60),
  registerTo: yup.string().optional(),
  registerAs: yup.string().optional(),

  sentryDSN: yup.string().optional(),
  sentryDebug: yup.boolean().default(false),

  autoCmdCommand: yup.string().optional(),
}).defined();

export interface Configuration extends yup.Asserts<typeof configurationSchema> { };
export interface LocalDriverConfiguration extends yup.Asserts<typeof localDriverConfigurationSchema> { };
export interface RemoteDriverConfiguration extends yup.Asserts<typeof remoteDriverConfigurationSchema> { };
export type Driver = LocalDriverConfiguration | RemoteDriverConfiguration;

export interface DriverMatchCriteria {
  browserName?: string;
  platformName?: string;
  browserVersion?: string;
  uuid?: string;
  tags: string[];
}

export interface SessionPathParams {
  sessionId: string,
  suffix?: string,
}

export interface SessionDto {
  id: string;
  option: any;
}

export type DriverStats = LocalDriverConfiguration & { sessions: SessionDto[], stats: SessionStats };

export interface NodeStatus {
  remoteUrl?: string;
  configuration: Partial<Configuration>;
  systemInfo: any;
  drivers: DriverStats[];
}

export interface SessionStats {
  total: number;
  failed: number;
}