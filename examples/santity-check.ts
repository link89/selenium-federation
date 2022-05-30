import axios from "axios";
import { remote } from "webdriverio";

const opt = {
  hostname: 'localhost',
  port: 4444,
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

    const driver = await remote(opt);
    await driver.url('https://bing.com');

    if (browserName === 'chrome' || browserName === 'MicrosoftEdge') {
      console.log('Test CDP protocol');
      const pt = await driver.getPuppeteer();
      const page = (await pt.pages())[0];
      await page.coverage.startJSCoverage();
      await page.coverage.stopJSCoverage();
      await page.title()
    }

    await new Promise(resolve => setTimeout(resolve, 5e3));
    await driver.deleteSession();
  }

})();
