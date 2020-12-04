import { config } from "./config";
import { Driver } from "./schemas";
import { DriverService, LocalDriverService, RemoteDriverService } from "./services";
import { Session } from "./sessions";


let driverService: DriverService<Driver, Session>
if (config.localDrivers.length > 0) {
  driverService = new LocalDriverService(config.localDrivers, config.browserIdleTimeout);
} else if (config.remoteDrivers.length > 0) {
  driverService = new RemoteDriverService(config.remoteDrivers, config.browserIdleTimeout);
} else {
  throw Error(`Fail to initiate DriverService!`);
}


export { driverService };