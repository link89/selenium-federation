import axios from "axios";
import { remote } from "webdriverio";

const opt = {
  hostname: 'localhost',
  port: 5555,
  path: '/wd/hub',
  capabilities: {
    browserName: undefined,
  }
};

void (async () => {

  const res = await axios.get(`http://localhost:${opt.port}/wd/hub/nodes`);
  const browsers = res.data[0].drivers;

  for (const browser of browsers) {
    const browserName = browser.config.browserName;
    opt.capabilities.browserName = browserName;

    let driver;
    try {
      driver = await remote(opt);
    } catch (e) {
      console.error(e);
      continue;
    }

    await driver.url('https://bing.com');
    await driver.getTitle();

    if (driver.capabilities['se:cdp']) {
      console.log('Test CDP protocol');
      const pt = await driver.getPuppeteer();
      const page = (await pt.pages())[0];
      await page.coverage.startJSCoverage();
      await page.coverage.stopJSCoverage();
      await page.title()
    }

    await new Promise(resolve => setTimeout(resolve, 10e3));
    await driver.deleteSession();
  }
})();
