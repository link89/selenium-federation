import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import { Configuration, configurationSchema } from './types';
import { isHttpUrl, readPathOrUrl, saveUrlToFile } from './utils';
import * as fs from 'fs';
import { join } from 'path';
import { basename } from 'path';
import { nanoid } from 'nanoid';

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
    const installerFolder = join(_config.tmpFolder, 'installers');
    await fs.promises.mkdir(_config.tmpFolder, { recursive: true });
    await fs.promises.mkdir(webdriverFolder, { recursive: true });
    await fs.promises.mkdir(installerFolder, { recursive: true });

    console.log(`> prepare file server root`);
    if (_config.fileServer && !_config.fileServer.disable) {
      await fs.promises.mkdir(_config.fileServer.root, { recursive: true });
    }

    console.log(`> download webdrivers ...`);
    for (const driver of _config.drivers) {
      if (!isHttpUrl(driver.webdriver.path)) continue;
      const webdriverUrl = driver.webdriver.path;
      const fileName = getFileNameFromUrl(webdriverUrl);
      const filePath = join(webdriverFolder, fileName);
      if (fs.existsSync(filePath)) {
        console.log(`>> file ${filePath} already exists, skip download ${webdriverUrl}`);
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