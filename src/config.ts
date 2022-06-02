import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import { Configuration, configurationSchema } from './types';
import { isHttpUrl, readPathOrUrl, saveUrlToFile } from './utils';
import * as fs from 'fs';
import { join } from 'path';
import { basename } from 'path';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';

const jsonStringify = require('json-stringify-deterministic');

export const argv = yargs(process.argv.slice(2)).
  usage('start selenium-federation service').
  options({
    c: { type: 'string', demandOption: true, description: 'configuration, it can be loaded from a local file or an http(s) URL' },
  }).argv;


let _config: Configuration;

export async function getAndInitConfig(): Promise<Configuration> {
  if (!_config) {
    const pathOrUrl = argv.c;

    console.log(`> read config from: ${pathOrUrl}`);
    const data = await readPathOrUrl(pathOrUrl, { encoding: 'utf-8' });
    console.log(data);
    _config = configurationSchema.validateSync(parse(data));

    console.log(`> prepare tmpFolder: ${_config.tmpFolder}`);
    const webdriverFolder = join(_config.tmpFolder, 'webdrivers');
    const downloadFolder = join(_config.tmpFolder, 'downloads');
    await fs.promises.mkdir(_config.tmpFolder, { recursive: true });
    await fs.promises.mkdir(webdriverFolder, { recursive: true });
    await fs.promises.mkdir(downloadFolder, { recursive: true });

    console.log(`> prepare file server root`);
    if (_config.fileServer && !_config.fileServer.disable) {
      await fs.promises.mkdir(_config.fileServer.root, { recursive: true });
    }

    console.log(`> download webdrivers...`);
    for (const driver of _config.drivers) {
      if (!isHttpUrl(driver.webdriver.path)) continue;
      const webdriverUrl = driver.webdriver.path;
      const fileName = getFileNameFromUrl(webdriverUrl);
      const filePath = join(webdriverFolder, fileName);
      if (fs.existsSync(filePath)) {
        console.log(`>> file ${filePath} already exists, skip download ${webdriverUrl}`);
        console.log(`>>> you need to remove the old file or suggest a new name by append "#some_new_file_name" to the url to workaround`);
      } else {
        console.log(`>> start to download ${webdriverUrl} to ${filePath}`);
        const tmpFilePath = join(webdriverFolder, `${nanoid()}.tmp`);
        await saveUrlToFile(webdriverUrl, tmpFilePath);
        await fs.promises.rename(tmpFilePath, filePath);
        await fs.promises.chmod(filePath, 0o755);  // grant execution permission to downloaded drivers
        console.log(`>> success to download ${filePath}`);
      }
      driver.webdriver.path = filePath;
    }

    console.log('> execute provision tasks...');
    const digest = createHash('sha256')
      .update(jsonStringify(_config.provision))
      .digest()
    const digestFile = join(_config.tmpFolder, `provision-${digest}.sha256.digest`);

    if (fs.existsSync(digestFile) && !_config.provision.force) {
      console.log(`>> detect ${digestFile}, skip provision tasks`);
      console.log(`>>> you may set provision.force to true or remove ${digestFile} to run tasks`);
    } else {
      if (_config.provision.tasks.length > 0) {
        for (const task of _config.provision.tasks) {
          console.log(`>> start to run task:`);
          console.log(jsonStringify(task));
          // TODO: execute task


        }
        console.log(`all ${_config.provision.tasks.length} task(s) success, create ${digestFile} to skip uncessary rerun next time.`)
        await fs.promises.writeFile(digestFile, Date().toString());
      } else {
        console.log(`>> no tasks to run`)
      }
    }
  }

  return _config;
}


function getFileNameFromUrl(url: string) {
  const urlObj = new URL(url);
  if(urlObj.hash) {
    return urlObj.hash.slice(1);
  }
  return basename(urlObj.pathname);
}
