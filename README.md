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
* Compatible popular test tools/frameworks like `webdriver.io`, `testcafe`, `puppeteer`, etc.
* Support `ansible` style self-provisioning tasks.
* Support native apps automation via `auto-cmd`.


## Installation
```bash
npm install -g selenium-federation pm2

# print help
selenium-federation --help
sf-pm2-start --help
```

### Quick Start



## 