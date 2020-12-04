import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import fs from 'fs';
import { configurationSchema } from './schemas';

export const argv = yargs(process.argv.slice(2)).options({
  c: { type: 'string', demandOption: false },
}).argv;

const rawConfig = argv.c ? parse(fs.readFileSync(argv.c, 'utf-8')) : {}

configurationSchema.validateSync(rawConfig);
export const config = configurationSchema.cast(rawConfig);

if (config.localDrivers.length > 1 && config.remoteDrivers.length > 1) {
  throw Error("Unable to support remote and local drivers at the same time!");
}