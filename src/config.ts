import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import fs from 'fs';
import { configurationSchema } from './schemas';

export const argv = yargs(process.argv.slice(2)).
  usage('start selenium-federation service').
  options({
    c: { type: 'string', demandOption: true, description: 'configuration file' },
  }).argv;

const rawConfig = argv.c ? parse(fs.readFileSync(argv.c, 'utf-8')) : {}
export const config = configurationSchema.validateSync(rawConfig);
