# Selenium Federation
A lightweight alternative to `selenium4`.

## Introduction
`selenium-federation` is a lightweight solution to set up a cross-platform browser farm that is 95% compatible with `selenium4`.

### Highlights
* CDP proxy (compatible with `selenium4`)
* Extend desktop support with `auto-cmd`

**The followings are the major goals of this project:**

* Simple: It should be easy enough to run or make contributions to this project.
* Lightweight: It is designed to support a browser farm with at most 20 nodes.
* Unblock limitations of existed solutions: see [here](#differentiation-from-selenium-4).

**The following are *NOT* this project's main focus (at least for now):**

* Zero-configuration: You should try [webdriver-manager](https://github.com/angular/webdriver-manager) or [selenium-standalone](https://github.com/vvo/selenium-standalone) instead. They are great tools to start a local service to run tests.
* Distributed architecture: The project chooses federated architecture for simplicity's sake. It's good enough to run a farm with at most 20 nodes.
  * I guess it won't be hard to support the distributed mode via `etcd` when there are requirements in the future.

## Usage

### Install
```bash
npm install -g selenium-federation

# testing
selenium-federation --help
selenium-federation-check --help
selenium-federation-pm2-start --help
```

### Start Local Service
Prepare configuration file `local.yaml` with the following content.

```yaml
port: 4444
browserIdleTimeout: 60  # browser processes will be killed after session inactive after browserIdleTimeout
maxSessions: 5  # limit the max sessions, default to Math.max(1, os.cpus().length - 1)

registerTo: http://localhost:5555/wd/hub  # optional, register to a remote service
registerAs: http://192.168.1.2:4444/wd/hub  # optional, accessible URL to this service, useful when selenium-federation service behind proxy or inside docker

sentryDSN: # optional, upload error to sentry

autoCmdPath: auto-cmd-http  # optional, use with auto-cmd

localDrivers:
  - browserName: firefox
    maxSessions: 2  # limit the max session of specific driver, default value is 1
    webdriverPath: geckodriver 

  - browserName: safari
    maxSessions: 1
    webdriverPath: safaridriver

  - browserName: MicrosoftEdge
    maxSessions: 2
    webdriverPath: msedgedriver # Support global webdriver command (can be found in PATH envvar)

  - browserName: chrome
    browserVersion: stable # support customized version value (or you can use tags)
    maxSessions: 2
    tags: [95]
    webdriverPath: ./chromedriver-stable  # support relative (to CWD) path to webdriver (start with ./)

  - browserName: chrome
    browserVersion: beta
    tags: [96]
    maxSessions: 2
    webdriverPath: //chromedriver-beta  # support relative to THIS configuration file (start with //)
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta

  - browserName: chrome
    browserVersion: canary
    tags: [97]
    maxSessions: 2
    webdriverPath: /usr/local/bin/chromedriver-canary  # support absolute path
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary
```

And start the server with the following command.
```bash
selenium-federation -c local.yaml
```

Now you can access the selenium compatible service via
`http://localhost:4444/wd/hub`.

It is suggested to run the health check to validate the setup.
```bash
selenium-federation-check
```

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


It is suggested to run the health check to validate the setup.
```bash
selenium-federation-check --url http://localhost:5555/wd/hub
```

### Start Service in pm2

`pm2` is a powerful process management tool, but it is tedious to start service with it, especially on Windows system.

Now you can start `selenium-federation` service in `pm2` with the following command

```bash
npm install -g pm2  # ensure you have pm2 installed
pm2 startup  # auto start pm2 on boot
selenium-federation-pm2-start -c ./local.yaml
pm2 save  # dump current apps so that they will be brought up automatically after rebooting
```


## Differentiation from Selenium4 and other solutions

### Support provider specificed capabilities (start with sf:)
Currently support:
* sf:tags: use tags for matching
* sf:envs: set environment variable for browser or electron app

The detail can be found in the foloowing sections.


### Default Capabilities

The `defaultCapabilities` will be merged with the `desiredCapabilities` received from the client-side before firing the NEW_SESSION request. This is useful when you need to hide the server-side detail from clients.

The below configuration is a real-world example to use this feature to support `ChromeCanary`.

```yaml
port: 4444
browserIdleTimeout: 60

localDrivers:
  - browserName: chrome
    browserVersion: canary
    tags: [97]
    webdriverPath: //chromedriver-canary
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary
```

Address this [limitation](https://github.com/SeleniumHQ/selenium/issues/8745) of selenium.

### Matching with Tags

`tags` fields can be used in `localDrivers` to distinguish the configuration items with same `browserName`. The client-side can set the `sf:tags` in capabilities to make use of this feature.

You can also use `browserVersion` fields for the same purpose, but `tags` mechanism provides more flexibility.

The below script is an example of using this feature with `webdriver.io`.


```typescript
import { remote } from "webdriverio";
const opt = {
  hostname: 'localhost', port: 4444, path: '/wd/hub',
  capabilities: {
    browserName: 'chrome',
    browserVersion: 'canary',  // example of using browserVersion as tag
    "sf:tags": [97],             // example of using tags
  }
};
const url = "https://github.com";
void (async () => {
  const driver = await remote(opt);
  await driver.navigateTo(url);
})();
```

### Customize Environment Variables

When specific environment variables need to be set when starting webdriver process or browsers, for example, to enable firefox WebRender by setting `MOZ_WEBRENDER=1`, you can either setting the `localDriver.webdriverEnvs` field in the configuration file, or setting the `sf:envs` field in the capabilities.

```typescript
import { remote } from "webdriverio";
const opt = {
  hostname: 'localhost', port: 4444, path: '/wd/hub',
  capabilities: {
    browserName: 'firefox',
    "sf:envs": {
      MOZ_WEBRENDER: '1',
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
* `browserVersion` can be an arbitrary string like `alpha`, `beta`, etc, the restriction of some webdrivers is ignored.
* Read statuses of clusters from the `/wd/hub/statuses` endpoint.

## Know Limitations
* Using `deleteSession` instead of `closeWindows` or else the service will consider the session still active.


## [FAQ](/FAQ.md)