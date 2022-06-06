# Selenium Federation

## Introduction
`selenium-federation` is a cross-platform Selenium based testing solution that support browsers, electron apps and native apps automation for Desktop environment.

### Applicable scene
* You are in a development team that need to maintain a medium scale (less than 50 devices) test infrustructure by yourself.
* Your tests need to be executed on different OS and browsers.
* You have electron apps or native apps to test.

If those are not your cases, then you may consider other tools that implement the Selenium protocol.

### Alternatives
* If you are finding a zero configuraion tool, you should try [webdriver-manager](https://github.com/angular/webdriver-manager) or [selenium-standalone](https://github.com/vvo/selenium-standalone).
* You should use `selenium-grid` or `selenoid` if 
  * You are to setup an enterprise scale cluster that gonna to be used by multiple project teams.
  * You only have web apps to test.
  * You have mobile apps to test.

## Fetures
* Compatible with Selenium Webdriver protocol.
* Support CDP proxy (compatible with `selenium-grid v4`'s).
* Compatible with popular test tools/frameworks like `webdriver.io`, `testcafe`, `puppeteer`, `playwright` etc.
* Support `ansible` style self-provisioning tasks.
* Support native apps automation via `auto-cmd`.


## Quick Start

### Installation

```bash
npm install -g selenium-federation pm2

# print help
selenium-federation --help
sf-pm2-start --help
```

### Run Service in Foreground

You can use the following command to start `selenium-federation` in foreground. It's suggested to create a dedicated workspace to run the service, as it may create some folders and download resources to the current directory.

```bash
# Create workspace
mkdir sf-workspace
cd sf-workspace

# For Windows 
selenium-federation -c https://raw.githubusercontent.com/link89/selenium-federation/main/examples/sample-win-local-config.yaml 

# For Mac OSX
selenium-federation -c https://raw.githubusercontent.com/link89/selenium-federation/main/examples/sample-mac-local-config.yaml 
```

And now your can run test on it with your favorite framework with the url `http://localhost:4444/wd/hub`. The base url `/wd/hbb` is the same as `selenium-grid`'s for the sake of compatiblity. Here is a simple example written with `webdriver.io`.

```typescript
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

```