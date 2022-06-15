import yargs from 'yargs/yargs';
import axios from "axios";
import Bluebird from "bluebird";
import { flatMap } from "lodash";
import { remote } from "webdriverio";
import _ from 'lodash';
import { NodeDto } from './types';


export const argv = yargs(process.argv.slice(2)).
  usage('test selenium-federation setup')
  .options({
    'sf-url': {
      description: 'service url of selenium-federation',
      string: true,
      required: false,
      default: 'http://localhost:4444',
    },
    'app-url': {
      description: 'app url to open in browser',
      string: true,
      required: false,
    },
    'concurrency': {
      description: 'concurrency of sending request',
      number: true,
      required: false,
      default: 1,
    },
    'timeout': {
      description: 'page loading timeout in seconds',
      number: true,
      required: false,
      default: 30,
    },
    'dry-run': {
      description: 'print message without test session',
      boolean: true,
      required: false,
      default: false,
    },
  }).strict().argv;


void (async () => {
  const sfUrl = new URL(argv['sf-url']);
  const appUrl = argv['app-url'];
  const dryRun = argv['dry-run'];
  const concurrency = argv['concurrency'];
  const timeoutInMs = argv['timeout'] * 1e3;

  const opt = {
    hostname: sfUrl.hostname,
    port: Number(sfUrl.port || 80),
    path: '/wd/hub',
  };

  const getNodesUrl = `${sfUrl.toString()}wd/hub/nodes`;
  const res = await axios.get(getNodesUrl);

  const nodes = res.data as NodeDto[];

  const nodeResults = nodes.map(node => {
    return {
      id: node.config.uuid,
      url: node.config.publicUrl,
      os: node.config.platformName,
      version: node.config.version,
      start: node.config.startTime,
    }
  })
  console.table(nodeResults);

  const driverResults = await Bluebird.map(flatMap(nodes, node => node.drivers.map(driver => ({ node, driver }))), async (data) => {
    const { node, driver } = data;
    const result = {
      node: node.config.uuid,
      browser: `${driver.config.browserName}@${node.config.platformName}`,
      'session#': `${driver.sessions.length}/${driver.config.maxSessions}`,
      status: 'DRY_RUN'
    };
    if (dryRun) return result;

    try {
      const capabilities = {
        browserName: driver.config.browserName,
        'sf:browserUUID': driver.config.uuid,
      }
      const browser = await remote({ ...opt, capabilities, logLevel: 'silent' });
      await browser.setTimeout({ pageLoad: timeoutInMs, script: timeoutInMs, implicit: timeoutInMs });

      if (appUrl) {
        await browser.url(appUrl);
      }
      await browser.getTitle();

      if (browser.capabilities['se:cdp']) {
        const pt = await browser.getPuppeteer();
      }
      await browser.deleteSession();

      return {
        ...result,
        browser: `${browser.capabilities.browserName}@${browser.capabilities.platformName}`,
        version: browser.capabilities.browserVersion,
        status: 'OK',
      }
    } catch (e) {
      return {
        ...result,
        status: 'ERROR',
        detail: String(e),
      }
    }
  }, { concurrency });

  console.table(driverResults);

})();
