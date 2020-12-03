# Selenium Federation
A lightweight alternative to selenium-grid.

## Usage

### Install
```bash
npm install selenium-federation
```

### Start Local Service
Prepare configuration file `local.yaml` with the following content.

```yaml
port: 4444
browserIdleTimeout: 60

localDrivers:
  - browserName: firefox
    webdriverPath: geckodriver # Support global webdriver command.

  - browserName: safari
    webdriverPath: safaridriver

  - browserName: MicrosoftEdge
    webdriverPath: msedgedriver

  - browserName: chrome
    webdriverPath: ./chromedriver88  # Also support relative/absolute path to webdriver.

  - browserName: chrome
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

Prepare configuration file `remote.yaml` with the following content.

```yaml
port: 5555
browserIdleTimeout: 60

remoteDrivers:
  - url: http://localhost:4444/wd/hub  # The URL to local service.
  - url: http://192.168.1.2:4444/wd/hub
  - url: http://192.168.1.3:4444/wd/hub
```

Then start the server with following command.
```bash
selenium-federation -c remote.yaml
```

Now you can access the selenium compatible service via
`http://localhost:5555/wd/hub`.
