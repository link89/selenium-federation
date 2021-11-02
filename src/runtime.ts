import { config } from "./config";
import { Driver } from "./schemas";
import { DriverService, LocalDriverService, RemoteDriverService } from "./services";
import { Session } from "./sessions";

let driverService: DriverService<Driver, Session>

if (config.localDrivers && config.localDrivers!.length > 0) {
  driverService = new LocalDriverService(config.localDrivers, config);
} else {
  driverService = new RemoteDriverService([], config);
}

driverService.init();

export { driverService };