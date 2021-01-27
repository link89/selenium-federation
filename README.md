# Selenium Federation
A lightweight alternative to selenium-grid.

## Usage

### Install
```bash
npm install -g selenium-federation

# testing
selenium-federation --help
selenium-federation-pm2-start --help
```


### Start Local Service
Prepare configuration file `local.yaml` with the following content.

> CAUTIONS: The relative path in the configuration file is relative to the `current working directory` , a.k.a. the path where you run the `selenium-federation` or `selenium-federation-pm2-start` commands.

```yaml
port: 4444
browserIdleTimeout: 60  # browser processes will be killed after session inactive after browserIdleTimeout
maxSessions: 5  # limit the max sessions, default to Math.max(1, os.cpus().length - 1)

registerTo: http://localhost:5555/wd/hub  # optional, register to a remote service
registerAs: http://192.168.1.2:4444/wd/hub  # optional, accessible URL to this service, useful when selenium-federation service behind proxy or inside docker

autoRebootThreshold: 1000  # optional, auto reboot the host machine after start this many sessions, default is 0 (disable)
autoRebootCommand: shutdown /r  # optional, customize auto reboot command, default command depends on the operating system

# sentryDSN: # optional, upload message and exception to sentry

localDrivers:
  - browserName: firefox
    maxSessions: 2  # limit the max session of specific driver, default value is 1
    webdriverPath: geckodriver # Support global webdriver command.

  - browserName: safari
    maxSessions: 1
    webdriverPath: safaridriver

  - browserName: MicrosoftEdge
    maxSessions: 2
    webdriverPath: msedgedriver

  - browserName: chrome
    browserVersion: stable # support customized version value
    maxSessions: 2
    webdriverPath: ./chromedriver-stable  # Also support relative/absolute path to webdriver.

  - browserName: chrome
    browserVersion: beta
    maxSessions: 2
    webdriverPath: ./chromedriver-beta
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta

  - browserName: chrome
    browserVersion: canary
    maxSessions: 2
    webdriverPath: ./chromedriver-canary
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

If there are local driver services register to the remote service by setting `registerTo: http://localhost:5555/wd/hub`, you can find them in `http://localhost:5555/wd/hub/statuses`.

Once there are nodes registered, you can access the selenium compatible service via
`http://localhost:5555/wd/hub`.


### Start Service in pm2

`pm2` is a powerful process management tool, but it is tedious to start service with it, especially on Windows system.

Now you can start `selenium-federation` service in `pm2` with the following command

```bash
npm install -g pm2  # ensure you have pm2 installed
pm2 startup  # auto start pm2 on boot
selenium-federation-pm2-start -c ./local.yaml
pm2 save  # dump current apps so that they will be brought up automatically after rebooting
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
    browserVersion: canary
    tags:
      - canary
    webdriverPath: ./chromedriver-canary
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary
```

Address this [limitation](https://github.com/SeleniumHQ/selenium/issues/8745) of selenium.

### Restart host machine automatically

Errors are found after a host machine running as a selenium node for a long time. `selenium-federation` provide an auto reboot mechanism to work around this problem by setting the `autoRebootThreshold` and `autoRebootCommand`.


### Matching with Tags

`tags` fields can be used in `localDrivers` to distinguish the configuration items with same `browserName`. The client-side can set the `extOptions.tags` in capabilities to make use of this feature.

You can also use `browserVersion` fields for the same purpose, but `tags` mechanism provides more flexibility.

The below script is an example of using this feature with `webdriver.io`.


```typescript
import { remote } from "webdriverio";
const opt = {
  hostname: 'localhost', port: 4444, path: '/wd/hub',
  capabilities: {
    browserName: 'chrome',
    browserVersion: 'canary',  // example of using browserVersion
    extOptions: {
      tags: ['canary'],  // example of using tags
    }
  }
};
const url = "https://github.com";
void (async () => {
  const driver = await remote(opt);
  await driver.navigateTo(url);
})();
```

### Customize Environment Variables

When specific environment variables need to be set when starting webdriver process or browsers, for example, to enable firefox WebRender by setting `MOZ_WEBRENDER=1`, you can either setting the `localDriver.webdriverEnvs` field in the configuration file, or setting the `envOptions.envs` field in the capabilities.

```typescript
import { remote } from "webdriverio";
const opt = {
  hostname: 'localhost', port: 4444, path: '/wd/hub',
  capabilities: {
    browserName: 'firefox',
    extOptions: {
      envs: {
        MOZ_WEBRENDER: '1',
      }
    }
  }
};
const url = "https://github.com";
void (async () => {
  const driver = await remote(opt);
  await driver.navigateTo(url);
})();
```

You can find `force_enabled by user: Force enabled by envvar` in the `about:support` page of firefox. More [detail](https://wiki.archlinux.org/index.php/Firefox/Tweaks#Enable_WebRender_compositor).

This feature is also useful when you test electron based app that configurable via environment variables.


### Others
* `browserVersion` can be arbitrary string like `alpha`, `beta`, etc, the restriction of some webdrivers is ignored.
* Read statuses of clusters from the `/wd/hub/statuses` endpoint.

## [FAQ](/FAQ.md)