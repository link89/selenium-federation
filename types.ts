export interface Configuration {
  port: number;
  browsers: Browser[];
}

export interface Browser {
  name: string;
  alias?: string;
  defaultCapabilities: any;
}