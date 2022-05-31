import axios from "axios";
import Bluebird from "bluebird";
import { remote } from "webdriverio";

const opt = {
  hostname: 'localhost',
  port: 5555,
  path: '/wd/hub',
};

void (async () => {
  const getNodesUrl = `http://localhost:${opt.port}/wd/hub/nodes`;

  const res = await axios.get(getNodesUrl);
  const browsers = res.data[0].drivers;

  await Bluebird.map(browsers, async (browser: any) => {
    const browserName = browser.config.browserName;

    let driver;
    try {
      driver = await remote({ ...opt, capabilities: { browserName } });
    } catch (e) {
      console.error(e);
      return;
    }

    await driver.url(getNodesUrl);
    await driver.getTitle();

    if (driver.capabilities['se:cdp']) {
      console.log('Test CDP protocol');
      const pt = await driver.getPuppeteer();
      const page = (await pt.pages())[0];
      await page.coverage.startJSCoverage();
      await page.coverage.stopJSCoverage();
      await page.title()
    }

    await new Promise(resolve => setTimeout(resolve, 1e3));
    await driver.deleteSession();
  }, { concurrency: 2 });
})();
