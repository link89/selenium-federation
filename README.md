# Selenium Federation

## Introduction
`selenium-federation` is a cross-platform Selenium based testing solution that support browsers, electron apps and native apps automation for Desktop environment.

### Applicable scene
* You are in a small/medium development team that have to maintain a test infrustructure by yourself.
* You need to run your test on different OS and browsers.
* You need to test electron apps or native apps.

### Alternatives
* If you are finding a zero configuraion tool, you should try [webdriver-manager](https://github.com/angular/webdriver-manager) or [selenium-standalone](https://github.com/vvo/selenium-standalone).
* You should use `selenium-grid` or `selenoid` if 
  * You are to setup an enterprise scale cluster that gonna to be use by multiple project teams.
  * You are not to test electron apps or native apps but just web apps.

## Fetures
* Compatible with Selenium Webdriver protocol.
* Support CDP proxy (compatible with `selenium-grid v4`).
* Support popular test tools/frameworks like `webdriver.io`, `testcafe`, `puppeteer`, etc.
* Support `ansible` style self-provisioning tasks.
* Support native apps automation via `auto-cmd`.


## Installation
```bash
npm install -g selenium-federation pm2

# testing
selenium-federation --help
sf-pm2-start --help
```

