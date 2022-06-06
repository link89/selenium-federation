import { remote } from "webdriverio";

const opt = {
  hostname: 'localhost',
  port: 4444,
  path: '/wd/hub',
  capabilities: {
    browserName: 'chrome',
  }
};

(async () => {
  const driver = await remote(opt);
  await driver.url(`https://html5test.com/`);

  await new Promise(resolve => setTimeout(resolve, 5e3));
  await driver.deleteSession();

})();
