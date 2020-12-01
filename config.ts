import yargs from 'yargs/yargs';
import { parse } from 'yaml';
import fs from 'fs';
import { defaultsDeep } from 'lodash';
import { Configuration } from 'types';


export const argv = yargs(process.argv.slice(2)).options({
  config: { type: 'string', demandOption: false},
}).argv;

const DEFAULT_CONFIG: Configuration = {
  port: 4444,
  browsers: [],
};

export const config: Configuration =  argv.config ? defaultsDeep(parse(fs.readFileSync(argv.config, 'utf-8')), DEFAULT_CONFIG) : DEFAULT_CONFIG;
