# selenium-federation 推荐设置

## 简介

`selenium-federation` 是针对Web自动化和桌面应用自动化的测试环境搭建提供的一个解决方案. 该方案主要

* 满足跨平台的 Web 自动化, 桌面应用自动化以及二者混合自动化的执行需求
* 适合由项目团队独立维护一个中小规模(<50节点)的桌面测试集群
* 兼容大部分 `selenium-grid` 和 `selenoid` 接口, 可以直接迁移使用
* 支持 `webdriver`, `puppeteer`, `playwright`, `testcafe` 等测试框架
* 通过 `auto-cmd` 支持桌面端自动化

但也需要指出, 在一些情况下`selenium-federation`未必是更好的选择, 这些情况包括

* 全自动环境配置(自动检测浏览器版本, 自动下载资源, etc), 开箱即用: 这种情况下推荐使用: [webdriver-manager](https://github.com/angular/webdriver-manager), [selenium-standalone](https://github.com/vvo/selenium-standalone)
* 企业级部署, 或者无桌面端测试需求: 这种情况下 `selenium-grid`, `selenoid` 会是更好的选则.

`selenium-federation` 存在的目的不是为了替代已有的工具, 而是在尽可能保持功能兼容的前提下, 以简化运维, 保障可靠性为基本原则, 提供额外的特性, 其中关键特性包括

* 支持远程加载配置文件和资源
* 更好的进程管理和临时文件清理
* 更灵活的匹配机制
* 支持预设 `webdriver` capabilities
* 提供支持 web 测试与桌面测试的能力 (通过集成 `auto-cmd` 实现)

本文档接下来以配置一个简单的集群为例, 介绍如何使用这些特性来搭建一个桌面测试集群.

## 安装

`selenium-federation` 自身只依赖于 `nodejs`, 只需要确保设备安装了正确版本的 `nodejs`, 即可通过以下命令进行安装

```bash
npm install -g selenium-federation pm2
```

该命令同时安装了 `pm2` 用于进程管理(推荐, 但非必要).

如果同时需要使用 `auto-cmd` 所提供的桌面测试能力, 还需要确保安装 `Python3.8` 以及 `auto-cmd`, 该部分内容会在之后完善. (TODO)


## 配置

`selenium-federation` 中包括两种类型的节点

* local 节点: 浏览器所在节点, 用于实际执行测试, 可独立使用, 也可以注册到 hub 节点上使用.
* hub 节点: 转发请求到相应的 local 节点, 多个 local 节点注册到 hub 节点上即构成一个测试集群.

本文以搭建一个包括一个 hub 节点和一个 local 节点为例来说明推荐的使用方式. 为了方便, 这里假定它们的 IP 地址如下

* hub: 192.168.1.100
* local01: 192.168.1.101

### 配置 hub 节点

hub 节点不负责实际的测试执行, 因此它的配置十分简单, 推荐配置如下:

```yaml
role: hub
host: 0.0.0.0  # 监听地址
port: 5555  # 监听端口

fileServer: # 文件服务, 可以通过 http://192.168.1.100/fs/ 访问
  root: .  # 提供文件服务的路径, 保存此路径下的文件可通过上述地址被访问到
```

建议创建一个专门的工作目录, 将配置文件保存在该目录下一个名为 `hub-config.yaml` 的文件中. 然后进入到该目录后, 执行以下命令启动 hub 节点

```bash
# 推荐: 通过 pm2 启动并管理服务
selenium-federation-pm2-start --name hub -c ./hub-config.yaml

# 另一种方式: 将服务启动于前台运行, 通常只在调试中使用
selenium-federation -c ./hub-config.yaml
```
此处使用推荐的方式由 `pm2` 来启动并管理进程. 到此 hub 节点的配置就完成了.









