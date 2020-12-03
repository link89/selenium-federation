import { config } from "config";
import { DriverService, LocalDriverService } from "services";


export const localDriverService = new LocalDriverService(config.localDrivers, config.browserIdleTimeout);