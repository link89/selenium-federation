import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import fs from 'fs';
import path from 'path';
import { configurationSchema } from './schemas';

export const argv = yargs(process.argv.slice(2)).
  usage('start selenium-federation service').
  options({
    c: { type: 'string', demandOption: true, description: 'configuration file' },
  }).argv;

const configFilePath = path.resolve(argv.c);
console.log(configFilePath)
const data = fs.readFileSync(argv.c, 'utf-8')

const rawConfig = parse(fs.readFileSync(argv.c, 'utf-8'));
rawConfig.configFilePath = configFilePath;

export const config = configurationSchema.validateSync(rawConfig);
