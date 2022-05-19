# Motivation and Road Map

## Motivation

Though there are modern tools like `cypress` and `playwright`, `webdriver` is still the best choice when your tests need to be run on the most modern browsers and even desktop applications that build on top of `electron`. Tools like `Selenium`, `Selenoid` and `Go Grid Router` are created to build browsers cluster, which is essential to make testing scalable.

I had used `Selenium` for a while and there are several issues (https://github.com/SeleniumHQ/selenium/issues/8745, https://github.com/SeleniumHQ/selenium/issues/8928, https://github.com/SeleniumHQ/selenium/issues/8706) make me have to give it up.

Before there are ready made solutions to address those issues and requirements, I try to make this light weight solution to make my work move forward.

## Architecture
