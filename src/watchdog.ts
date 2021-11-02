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