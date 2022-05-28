import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import { Configuration, configurationSchema } from './types';
import { readPathOrUrl } from './utils';
import * as fs from 'fs';
import { basename } from 'path';

export const argv = yargs(process.argv.slice(2)).
  usage('start selenium-federation service').
  options({
    c: { type: 'string', demandOption: true, description: 'configuration, it can be loaded from a local file or an http(s) URL' },
  }).argv;


let _config: Configuration;

export async function getAndInitConfig(): Promise<Configuration> {
  if (!_config) {
    const pathOrUrl = argv.c;
    console.log(`read config from: ${pathOrUrl}`);
    const data = await readPathOrUrl(pathOrUrl, { encoding: 'utf-8' });
    console.log(data);
    _config = configurationSchema.validateSync(parse(data));

    console.log(`prepare tmpFolder: ${_config.tmpFolder}`);
    await fs.promises.mkdir(_config.tmpFolder, { recursive: true });

    console.log(`fetch remote resources`);
  }
  return _config;
}


async function saveUrlToFolder(url: string, folder: string) {
}

function getFileNameFromUrl(url: string) {
  const urlObj = new URL(url);
  if(urlObj.hash) {
    return urlObj.hash.slice(1);
  }
  return basename(urlObj.pathname);
}