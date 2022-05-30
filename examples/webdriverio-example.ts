import { remote } from "webdriverio";

const opt = {
  hostname: 'localhost',
  port: 5555,
  path: '/wd/hub',
  capabilities: {
    browserName: 'chrome',
  }
};

void (async () => {
  const driver = await remote(opt);
  await driver.url('https://bing.com');

  const pt = await driver.getPuppeteer();
  const page = (await pt.pages())[0];

  await page.coverage.startJSCoverage();
  await page.coverage.stopJSCoverage();
  await page.title()
  await new Promise(resolve => setTimeout(resolve, 120e3));
  await driver.deleteSession();
})();

