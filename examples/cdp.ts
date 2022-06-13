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
  const sessionId = res.data?.value?.sessionId || res.data?.sessionId;
  const caps = res.data?.value?.capabilities || res.data?.value;
  const cdpUrl = caps?.['se:cdp'];
  console.log(cdpUrl);

  try {
    const options = {
      protocol,
      target: { webSocketDebuggerUrl: cdpUrl},
    } as CDP.Options;

    const cdp = await CDP(options);
    await new Promise(resolve => setTimeout(resolve, 5e3));

    await cdp.Runtime.evaluate({
      expression: `console.log("hello world")`,
    });

    await new Promise(resolve => setTimeout(resolve, 5e3));

  } catch (e) {
    console.error(e);
  } finally {
    await axios.request({
      method: 'DELETE',
      url: `http://localhost:4444/wd/hub/session/${sessionId}`,
    })
  }

})();
