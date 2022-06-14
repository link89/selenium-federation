# Selenium Federation

## Introduction
`selenium-federation` is a cross-platform Selenium based testing solution that support browsers, electron apps and native apps automation for Desktop environment.

### Applicable scene
* You are in a development team that need to maintain a medium scale (less than 50 devices) test infrustructure by yourself.
* Your tests need to be executed on different OS and browsers.
* You have electron apps or native apps to test.
* You are a hacker that want to make your hands dirty to do something cool.

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

# Run the following command to read manuals
selenium-federation -h
sf-pm2-start -h
sf-test -h
```

### Run Service in Foreground

You can use the following command to start `selenium-federation` in foreground. It's suggested to create a dedicated workspace to run the service, as it may create some folders and download resources to the current working directory.

```bash
# Create workspace
mkdir sf-workspace
cd sf-workspace

# For Windows 
selenium-federation -c https://raw.githubusercontent.com/link89/selenium-federation/main/examples/sample-win-local-config.yaml 

# For Mac OSX
selenium-federation -c https://raw.githubusercontent.com/link89/selenium-federation/main/examples/sample-mac-local-config.yaml 
```

`selenium-federation` only have one option to load configuration from local file or remote URL. All configuration options can be found in [full-config-example](/examples/full-config-example.yaml)

And now your can run test on it with your favorite framework with the url `http://localhost:4444/wd/hub`. The base url `/wd/hub` is the same as `selenium-grid`'s for the sake of compatiblity. Here is a simple example written with `webdriver.io`.

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

Another way to verify the setup is to run the `sf-test` command,

```bash
sf-test --sf-url http://localhost:4444
```

### Run service in background with pm2

Foreground run is good for local debug as it prints logs in screen directly. But if you are to setup a test infrusturcture that will run for a long time, we provide another command to run service in `pm2`.

```bash
# Do forget to create workspace
mkdir sf-workspace
cd sf-workspace

# Run service in pm2
sf-pm2-start --name sf-local-01 -c local-config.yaml 

# check service status in pm2
pm2 ps
```

Compare with the previous example, everything is the same except a requirement field `--name` to specify an app name in the `pm2`. If you want to set more `pm2 start` options, you can pass them after `--`, for example

```bash
sf-pm2-start --name sf-local-01 -c local-config.yaml -- --restart-delay=3000
```

### Start hub service

To start a hub service is very simple, here is a typeical configuration of hub.
```yaml
role: hub
host: 0.0.0.0
port: 4444

fileServer: 
  root: .
```
Here we also start a `fileServer` with the hub node, you can access the file service via http://localhost:4444/fs/


### Use Provision Task to Download Webdriver Binary

`provision task` is one of the key features of `selenium-federation` to simplify the OPS tasks. The most common use case is to download webdriver binary automatically. For example,

```yaml
drivers:
  - browserName: chrome
    browserVersion: stable
    maxSessions: 2
    command:
      path: ./chromedriver.exe  # reference to the binary file that download and unpacked by provision task
      args: ["--verbose"]

  - browserName: MicrosoftEdge
    maxSessions: 2
    command:
      path: ./msedgedriver.exe

  - browserName: firefox
    maxSessions: 2
    command:
      path: ./geckodriver.exe

provision:
  tasks:
    - download: https://registry.npmmirror.com/-/binary/chromedriver/101.0.4951.41/chromedriver_win32.zip
      cmds:
        - powershell Expand-Archive {download_file_path} -Force -DestinationPath .  # unpack to workspace

    - download: https://repo.huaweicloud.com/geckodriver/v0.31.0/geckodriver-v0.31.0-win64.zip 
      cmds:
        - powershell Expand-Archive {download_file_path} -Force -DestinationPath .

    - download: https://msedgedriver.azureedge.net/102.0.1245.30/edgedriver_win64.zip
      cmds:
        - powershell Expand-Archive {download_file_path} -Force -DestinationPath .
```

Here we define 3 tasks to download webdirver binary for `Chrome`, `Firefox` and `Microsoft Edge` browsers and use them in `drivers[n].webdirver.path`.
More example could be found in [provision-task-gallery](/examples/provision-tasks-gallery.yaml).
