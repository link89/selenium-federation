# selenium-federation 推荐设置

## 简介

`selenium-federation` 是针对Web自动化和桌面应用自动化的测试环境搭建提供的一个解决方案. 该方案主要

* 满足跨平台的 Web 自动化, 桌面应用自动化以及二者混合自动化的执行需求
* 适合由项目团队以较小的代价独立维护一个中小规模(<50节点)的桌面测试集群
* 兼容部分 `selenium-grid` 和 `selenoid` 接口, 如 CDP 代理, 多数情况下可无需更改代码使用 
* 支持 `webdriver`, `puppeteer`, `playwright`, `testcafe` 等测试框架
* 通过 `auto-cmd` 支持桌面端自动化
* 易于二次开发 (欢迎 fork 并自由地进行改造)

但也需要指出, 在一些情况下`selenium-federation`未必是更好的选择, 这些情况包括

* 零配置开箱即用(自动检测浏览器版本, 自动下载资源, etc), 推荐使用: [webdriver-manager](https://github.com/angular/webdriver-manager), [selenium-standalone](https://github.com/vvo/selenium-standalone)
* 企业级的大规模部署和管理, 或者无桌面功能相关的测试需求: 这种情况下 `selenium-grid`, `selenoid` 会是更好的选择.

`selenium-federation` 存在的意义不是为了替代已有的工具, 而是在尽量与`selenium`保持功能兼容的前提下, 以简化运维, 保障可靠性为原则, 以研发团队可用较小的代价自行维护为目标, 提供一些必要的特性, 这些特性包括

* 支持远程加载配置文件和资源
* 更好的进程回收和临时文件清理, 保障长时间运行的可靠性
* 更灵活的匹配机制
* 支持预设 capabilities 
* 提供桌面测试的能力 (通过集成 `auto-cmd` 实现)

本文档将以配置一个简单的集群为例, 介绍如何高效地使用这一工具.

## 安装

`selenium-federation` 自身只依赖于 `nodejs`, 只需要确保设备安装了正确版本的 `nodejs`, 即可通过以下命令进行安装

```bash
npm install -g selenium-federation pm2
```

该命令在安装`selenium-federation` 同时安装了 `pm2` 用于进程管理(推荐, 但非必要).

安装成功后, 将会增加以下两个全局命令,

```bash
selenium-federation --help
selenium-federation-pm2-start --help
```

如果同时需要使用 `auto-cmd` 所提供的桌面测试能力, 还需要确保安装 `Python3.8` 以及 `auto-cmd`, 这部分内容会在之后完善. (TODO)

## 配置

`selenium-federation`  定义了两种类型的节点

* local 节点: 浏览器所在节点, 用于实际执行测试, 可独立使用, 也可以注册到 hub 节点上使用.
* hub 节点: 转发请求到相应的 local 节点, 多个 local 节点注册到 hub 节点上即构成一个测试集群.

本文以搭建一个包括一个 hub 节点和一个 local 节点为例来说明推荐的使用方式. 为了方便, 这里假定它们的 IP 地址如下

* hub: 192.168.1.100
* local-01: 192.168.1.101

### 配置 hub 节点

hub 节点不负责实际的测试执行, 因此它的配置十分简单, 推荐配置如下:

```yaml
role: hub  # 指定角色为 hub

host: 0.0.0.0  # 监听地址
port: 5555  # 监听端口

fileServer: # 文件服务, 可以通过 http://192.168.1.100/fs/ 访问
  root: .  # 提供文件服务的路径, 保存此路径下的文件可通过上述地址被访问到
```

 接下来需要创建一个专门的工作目录, 将配置保存在该目录下一个名为 `hub-config.yaml` 的文件中. 然后进入到该目录后, 执行以下命令启动 hub 节点

```bash
# 推荐: 通过 pm2 启动并管理服务
selenium-federation-pm2-start --name sf-hub -c ./hub-config.yaml

# 另一种方式: 将服务启动于前台运行, 通常只在调试中使用
selenium-federation -c ./hub-config.yaml
```
此处使用推荐的方式由 `pm2` 来启动并管理进程. 到此 hub 节点的配置就完成了.


### 配置 local 节点

local 节点由于需要负责实际的执行工作, 因此配置会略为复杂, 完整的配置文件如下

```yaml
role: local # 指定角色为 local

host: 0.0.0.0
port: 4444

tags:  # 此标签可在创建 session 时通过 sf:platformTags 匹配
  - mac
  - mac-intel
  - osx-11

sessionIdleTimeout: 60  # 全局的session超时设置, session不被使用的时间超过该值(秒)时会被强制关闭
maxSessions: 5  # 该节点的最大session总数, 默认为 #cpu - 1

registerTo: http://192.168.1.100:5555  # 注册到 hub 节点地址

drivers:
  - browserName: chrome
    browserVersion: stable  # browserVersion 字段支持任意字符串
    sessionIdleTime: 120  # 该浏览器的超时设置, 优先级高于全局设置
    maxSessions: 2  # 该浏览器的最大并发 session 数
    tags:  # 此标签可在创建 session 时通过 sf:browserTags 匹配
      - primary
    webdriver:
      path: http://192.168.1.100:5555/fs/webdrivers/mac-intel/chromedriver-100  # 指定远程位置,会自动进行下载和使用

  - browserName: chrome
    browserVersion: beta
    maxSessions: 2
    webdriver:
      path: http://192.168.1.100:5555/fs/webdrivers/mac-intel/chromedriver-101 
    defaultCapabilities:  # 设定缺省的 capabilities 字段, 典型使用场景包括指定不同版本 chrome 路径, 或者 electron 应用所在路径
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta

  - browserName: chrome
    browserVersion: canary
    maxSessions: 2
    webdriver:
      path: http://192.168.1.100:5555/fs/webdrivers/mac-intel/chromedriver-102
    defaultCapabilities:
      "goog:chromeOptions":
        binary: /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary

  - browserName: MicrosoftEdge
    maxSessions: 2
    webdriver:
      path: http://192.168.1.100:5555/fs/webdrivers/mac-intel/msedgedriver-100

  - browserName: firefox
    maxSessions: 2
    webdriver:
      path: http://192.168.1.100:5555/fs/webdrivers/mac-intel/geckodriver-0.31.0

  - browserName: safari
    maxSessions: 1  # safari 该值需要填写1
    webdriver:
      path: safaridriver  # 也可以使用全局命令或者相对/绝对路径
```

各配置项的用途可查看注解. 这里你会留意到在配置文件里推荐 `webdriver.path` 通过 url 指定, `selenium-federation` 会自动下载和使用. 再仔细观察则会发现, 这里的资源地址都位于 `http://192.168.1.100:5555/fs/` 位置下, 回顾上一节的 hub 配置你会发现该文件服务是由 hub 节点提供的, 这是为何 `selenium-federation` 内置了文件服务的原因: 免除您额外安装和配置 nginx/apache 的烦恼. 除了使用内置的文件服务外, 推荐的文件服务包括:

* 公司内部的 gitlab 仓库 (最推荐, 便于跟踪变更, 注意权限需要设置为开放否则无法下载)
* `selenium-federation` hub 节点的文件服务 (最简单, 无需额外安装其它工具或服务)
* 对象存储服务, 如 s3, minio, seafile, etc (注意权限)

不仅如此, 启动命令时也支持读取远程的配置文件, 这也是推荐的使用方式, 这样一来在 local 节点上可以无需手动下载任何资源文件.

同样的, 在执行命令前, 我们推荐创建一个专门的工作目录并进入到该目录中, 然后执行

```bash
selenium-federation-pm2-start --name sf-local-01 -c http://192.168.1.100:5555/fs/configs/local-01-config.yaml
```

(To be continue...)