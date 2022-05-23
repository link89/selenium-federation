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

class CacheNode<K, V> {
  constructor(
    public readonly key?: K,
    public value?: V,
    public prev?: CacheNode<K, V>,
    public next?: CacheNode<K, V>,
  ) { }
}

export class LruCache<K, V> {

  private map = new Map<K, CacheNode<K, V>>();
  private head = new CacheNode<K, V>(undefined, undefined);

  constructor(
    private maxSize: number,
  ) { }

  set(key: K, value: V) {
    if (this.map.size >= this.maxSize) {
      const node = this.getTailNode();
      if (node) {
        this.map.delete(node.key!);
        this.removeNode(node);
      }
    }
    let node = this.map.get(key);
    if (node) {
      this.removeNode(node);
      node.value = value;
    } else {
      node = new CacheNode<K, V>(key, value)
    }
    this.map.set(key, node);
    this.insertHead(node);
  }

  get(key: K) {
    const node = this.map.get(key)
    if (!node) return;

    this.removeNode(node);
    this.insertHead(node);
    return node.value;
  }

  private insertHead(node: CacheNode<K, V>) {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next = node;
  }

  private removeNode(node: CacheNode<K, V>) {
    node.prev!.next = node.next;
    if (node.next) {
      node.next.prev = node.prev;
    }
  }

  private getTailNode() {
    if (!this.head.next) return
    let node = this.head;
    while (node.next) {
      node = node.next;
    }
    return node;
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