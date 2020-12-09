# Selenium Federation
A lightweight alternative to selenium-grid.

## Usage

### Install
```bash
npm install -g selenium-federation

# testing
selenium-federation --help
selenium-federation-pm2-start --help
selenium-federation-wdm --help
```

### Start Local Service
Prepare configuration file `local.yaml` with the following content.

```yaml
port: 4444
browserIdleTimeout: 60
maxSessions: 5  # limit the max sessions, default to  (Math.max(2, os.cpus().length - 1))

registerTo: http://localhost:5555/wd/hub  # optional, register to a remote service
registerAs: http://192.168.1.2:4444/wd/hub  # required when `registerTo` is set, accessible URL to this service

localDrivers:
  - browserName: firefox
    maxSessions: 2
    webdriverPath: geckodriver # Support global webdriver command.

  - browserName: safari
    maxSessions: 1
    webdriverPath: safaridriver

  - browserName: MicrosoftEdge
    maxSessions: 2
    webdriverPath: msedgedriver

  - browserName: chrome
    maxSessions: 2
    webdriverPath: ./chromedriver88  # Also support relative/absolute path to webdriver.

  - browserName: chrome
    maxSessions: 2
    tags:
      - canary
    webdriverPath: ./chromedriver89
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary
```

And start the server with following command.
```bash
selenium-federation -c local.yaml
```

Now you can access the selenium compatible service via
`http://localhost:4444/wd/hub`.


### Start Remote Service

A remote service allows local services to register to. Prepare configuration file `remote.yaml` with the following content.

```yaml
port: 5555
browserIdleTimeout: 60
```

Then start the server with following command.
```bash
selenium-federation -c remote.yaml
```

If there are local driver services register to the remote service by setting `registerTo: http://localhost:5555/wd/hb`, you can find them in `http://localhost:5555/wd/hub/available-drivers`.

Once there are nodes registered, you can access the selenium compatible service via
`http://localhost:5555/wd/hub`.

### Start Service in pm2

`pm2` is powerful, but it is tedious to start service with it, especially on Windows system.

Now you can start `selenium-federation` service in `pm2` with the following command

```bash
npm install -g pm2  # ensure you have pm2 installed
selenium-federation-pm2-start -c ./local.yaml
```

## Differentiation from Selenium 4

### Default Capabilities

The `defaultCapabilities` will be merged with the `desiredCapabilities` received from the client-side before firing the NEW_SESSION request. This is useful when you need to hide the server-side detail from clients.

The below configuration is a real world example to use this feature to support `ChromeCanary`.

```yaml
port: 4444
browserIdleTimeout: 60

localDrivers:
  - browserName: chrome
    tags:
      - canary
    webdriverPath: ./chromedriver89
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary
```

Address this [issue](https://github.com/SeleniumHQ/selenium/issues/8745) of selenium.

### Matching with Tags

`tags` fields can be used in `localDrivers` to distinguish the configuration items with same `browserName`. The client-side can set the `extOptions.tags` in capabilities to make use of this feature.

The below script is an example of using this feature with `webdriver.io`.

```typescript
import { remote } from "webdriverio";

const opt = {
  hostname: 'localhost', port: 4444, path: '/wd/hub',
  capabilities: {
    browserName: 'chrome',
    extOptions: {
      tags: ['canary'],
    }
  }
};

const url = "https://github.com";
void (async () => {
  const driver = await remote(opt);
  await driver.navigateTo(url);
  await driver.deleteSession();
})();
```