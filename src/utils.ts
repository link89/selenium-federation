import Bluebird from "bluebird";

import { promisify } from 'util';
import fs from 'fs';

interface IRetryOption {
  max?: number;
  interval?: number;
  condition?: (e: any) => boolean;
}

export async function retry<T>(cb: () => Promise<T> | T, option: IRetryOption = {}): Promise<T | undefined> {
  const max = option.max || 10;
  const interval = option.interval || 1e3;
  for (let i = 0; i < max; i++) {
    try {
      return await cb();
    } catch (e) {
      if ((!option.condition || option.condition(e)) && i < max - 1) {
        console.warn(`[warning] ${String(e)} retry...`);
        await Bluebird.delay(interval);
        continue;
      }
      throw e;
    }
  }
}

export class Semaphore {
  queue: ((value?: any) => void)[] = [];

  constructor(private size: number) { }

  async wait() {
    if (this.size - 1 < 0) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.size -= 1;
  }

  signal() {
    this.size += 1;
    const resolve = this.queue.shift();
    if (resolve) resolve();
  }
}

export class Watchdog {

  private timestamp: number = 0;
  private timer: NodeJS.Timeout;

  constructor(private onTimeout: () => any, private timeout: number = 60, interval: number = 5e3) {
    this.feed();
    this.timer = setInterval(() => {
      if (this.timestamp < Date.now()) {
        console.log('Watchdog timeout!');
        this.stop();
        this.onTimeout();
      }
    }, interval);
  }

  feed() {
    this.timestamp = Date.now() + this.timeout * 1e3;
  }

  stop() {
    clearInterval(this.timer);
  }
}

export function getW3CPlatformName() {
  switch (process.platform) {
    case "win32": return "windows";
    case "darwin": return "mac";
    default: return "linux";
  }
}

export function getDefaultRebootCommand() {
  switch (process.platform) {
    case "win32": return `shutdown /r`;
    case "darwin": return `osascript -e 'tell app "System Events" to restart'`;
    default: return `sudo reboot`;
  }
}

export function logMessage(s: string) {
  console.log(s);
}

export function logException(e: Error) {
  console.error(e);
}

export const rmAsync = promisify(fs.rm);
export const alwaysTrue = () => true;
export const identity = (i: any) => i;