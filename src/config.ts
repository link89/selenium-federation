import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import { Configuration, configurationSchema } from './types';
import { getFileNameFromUrl, isHttpUrl, readPathOrUrl, runProvisionTask, saveUrlToFile } from './utils';
import * as fs from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import chalk from 'chalk';

const jsonStringify = require('json-stringify-deterministic');
const log = console.log;

export const argv = yargs(process.argv.slice(2)).
  usage('start selenium-federation service').
  options({
    c: { type: 'string', demandOption: true, description: 'configuration, it can be loaded from a local file or an http(s) URL' },
  }).argv;


let _config: Configuration;

export async function getAndInitConfig(): Promise<Configuration> {
  if (!_config) {
    const pathOrUrl = argv.c;

    log(chalk.blue.bold(`> read config from: ${pathOrUrl}`));
    const data = await readPathOrUrl(pathOrUrl, { encoding: 'utf-8' });
    log(chalk.green(data));

    _config = configurationSchema.validateSync({
      ...parse(data),
      version: require('../package.json').version,
      startTime: new Date().toString(),
    });

    log(chalk.blue.bold(`> prepare tmpFolder: ${_config.tmpFolder}`));
    const webdriverFolder = join(_config.tmpFolder, 'webdrivers');
    const downloadFolder = join(_config.tmpFolder, 'downloads');
    const provisionFolder = join(_config.tmpFolder, 'provisions');
    await fs.promises.mkdir(_config.tmpFolder, { recursive: true });
    await fs.promises.mkdir(webdriverFolder, { recursive: true });
    await fs.promises.mkdir(downloadFolder, { recursive: true });
    await fs.promises.mkdir(provisionFolder, { recursive: true });

    log(chalk.blue.bold(`> prepare downloadFolder: ${_config.downloadFolder}`));

    log(chalk.blue.bold(`> prepare file server root`));
    if (_config.fileServer && !_config.fileServer.disable) {
      await fs.promises.mkdir(_config.fileServer.root, { recursive: true });
    }

    log(chalk.blue.bold(`> download webdrivers...`));
    for (const driver of _config.drivers) {
      if (!isHttpUrl(driver.command.path)) continue;
      const webdriverUrl = driver.command.path;
      const fileName = getFileNameFromUrl(webdriverUrl);
      const filePath = join(webdriverFolder, fileName);
      if (fs.existsSync(filePath)) {
        log(chalk.yellow(`>> file ${filePath} already exists, will be overwritten with ${webdriverUrl}`));
      }
      log(chalk.green(`>> start to download ${webdriverUrl} to ${filePath}`));
      await saveUrlToFile(webdriverUrl, filePath);
      await fs.promises.chmod(filePath, 0o755);  // grant execution permission
      log(chalk.green(`>> success to download ${filePath}`));
      driver.command.path = filePath;
    }

    log(chalk.blue.bold('> execute provision tasks...'));
    for (const task of _config.provision.tasks) {
      const taskString = jsonStringify(task);
      const taskDigest = createHash('sha256').update(taskString).digest().toString('hex');
      const taskDigestFile = join(provisionFolder, `provision-task-${taskDigest}.sha256.digest`);
      if (fs.existsSync(taskDigestFile) && !task.neverSkip) {
        log(chalk.yellow(`>> detect ${taskDigestFile}, skip task: ${taskString}`));
        log(chalk.yellowBright(`>>> you may set neverSkip to true or remove ${taskDigestFile} to run this task`));
        continue;
      }
      log(chalk.green(`>> start to run task: ${taskString}`));
      const result = await runProvisionTask(task, { downloadFolder });
      if (!result.isSuccess) {
        log(chalk.redBright(`>> fail to run task, exit selenium-federation`));
        process.exit(1);
      }
      log(chalk.green(`>> create digest file ${taskDigestFile} to skip this task next time`));
      await fs.promises.writeFile(taskDigestFile, taskString);
    }
  }
  return _config;
}
