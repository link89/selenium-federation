import CDP from 'chrome-remote-interface';
import axios from "axios";

(async () => {
  const res = await axios.request({
    method: 'POST',
    url: 'http://localhost:4444/wd/hub/session',
    data: {
      desiredCapabilities: {
        browserName: 'nodejs',
      }
    }
  });
  console.log(res.data);
  try {
    const options = {
      target: { webSocketDebuggerUrl: res.data.capabilities['se:cdp'] as string }
    } as CDP.Options;
    const cdp = await CDP(options);

    await cdp.Runtime.evaluate({
      expression: `console.log("hello world")`,
    });

  } finally {
    await axios.request({
      method: 'DELETE',
      url: `http://localhost:4444/wd/hub/session/${res.data.sessionId}`,
    })
  }

})();
