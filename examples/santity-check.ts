import axios from "axios";
import Bluebird from "bluebird";
import { flatMap } from "lodash";
import { remote } from "webdriverio";

const opt = {
  hostname: 'localhost',
  port: 5555,
  path: '/wd/hub',
};

void (async () => {
  const getNodesUrl = `http://localhost:${opt.port}/wd/hub/nodes`;
  const res = await axios.get(getNodesUrl);

  await Bluebird.map(flatMap(res.data, node => node.drivers), async (browser: any) => {
    try {
      const browserName = browser.config.browserName;
      const driver = await remote({ ...opt, capabilities: { browserName, 'sf:browserUUID': browser.config.uuid } });

      await driver.url(`https://baidu.com`);
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

    } catch (e) {
      console.error(e);
    }
  }, { concurrency: 3 });
})();
