import CDP from 'chrome-remote-interface';
import axios from "axios";
import * as fs from 'fs';

(async () => {

  const res = await axios.request({
    method: 'POST',
    url: 'http://127.0.0.1:4444/wd/hub/session/',
    data: {
      desiredCapabilities: {
        browserName: 'nodejs',
      }
    }
  });

  const protocol = JSON.parse(fs.readFileSync(`${__dirname}/cdp-protocol.json`, 'utf-8'));
  const cdpUrl = res.data?.value?.capabilities?.['se:cdp'] || res.data?.value?.['se:cdp'];
  console.log(cdpUrl);

  try {
    const options = {
      protocol,
      target: { webSocketDebuggerUrl: cdpUrl},
    } as CDP.Options;

    const cdp = await CDP(options);

    await cdp.Runtime.evaluate({
      expression: `console.log("hello world")`,
    });

    await new Promise(resolve => setTimeout(resolve, 5e3));

  } catch (e) {
    console.error(e);
  } finally {
    await axios.request({
      method: 'DELETE',
      url: `http://localhost:4444/wd/hub/session/${res.data.sessionId}`,
    })
  }

})();
