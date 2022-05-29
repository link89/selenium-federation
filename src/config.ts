import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import { Configuration, configurationSchema } from './types';
import { isHttpUrl, readPathOrUrl, saveUrl } from './utils';
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
    await fs.promises.mkdir(_config.tmpFolder, { recursive: true });

    console.log(`> fetch remote resources`);

    for (const driver of _config.drivers) {
      if (!isHttpUrl(driver.webdriver.path)) continue;
      const webdriverUrl = driver.webdriver.path;
      const fileName = getFileNameFromUrl(webdriverUrl);
      const filePath = join(_config.tmpFolder, fileName);
      if (fs.existsSync(filePath)) {
        console.log(`>> file ${filePath} already exists, skip download ${webdriverUrl}`);
      } else {
        console.log(`>> start to download ${webdriverUrl} to ${filePath}`);
        const tmpFilePath = join(_config.tmpFolder, `${nanoid(8)}.tmp`);
        await saveUrl(webdriverUrl, tmpFilePath);
        await fs.promises.rename(tmpFilePath, filePath);
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