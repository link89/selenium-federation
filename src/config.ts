import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import { Configuration, configurationSchema } from './types';
import { readPathOrUrl } from './utils';

export const argv = yargs(process.argv.slice(2)).
  usage('start selenium-federation service').
  options({
    c: { type: 'string', demandOption: true, description: 'configuration, it can be loaded from a local file or an http(s) URL' },
  }).argv;


let _config: Configuration;

export async function getConfig(): Promise<Configuration> {
  if (!_config) {
    const pathOrUrl = argv.c;
    console.log(`read config from: ${pathOrUrl}`)
    const data = await readPathOrUrl(pathOrUrl, { encoding: 'utf-8' });
    console.log(data);
    _config = configurationSchema.validateSync(parse(data));
  }
  return _config;
}