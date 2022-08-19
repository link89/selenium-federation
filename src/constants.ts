export const WEBDRIVER_ERRORS = {
  UNKNOWN_COMMAND: {
    code: 404,
    error: 'unknown command'
  },
  INVALID_SESSION_ID: {
    code: 404,
    error: 'invalid session id'
  },
  SESSION_NOT_CREATED: {
    code: 500,
    error: 'session not created',
  },
  INVALID_NODE_ID: {
    code: 404,
    error: 'invalid node id'
  },
  INVALID_ENDPOINT: {
    code: 400,
    error: 'invalid endpoint',
  },
  UNKNOWN_ERROR: {
    code: 500,
    error: 'unknown error',
  },
};

export const AUTO_CMD_ERRORS = {
  NOT_SUPPORTED: {
    code: 500,
    error: 'not supported'
  },
  UNKNOWN_ERROR: {
    code: 500,
    error: 'unknown error',
  },
}

export const FILE_STATUS = {
  INVALID_ROOT_PATH: {
    code: 404,
    error: 'invalid root path'
  },
  INVALID_PATH: {
    code: 404,
    error: 'invalid path'
  },
  DELETE_FAILED: {
    code: 404,
    error: 'delete failed'
  },
  NOT_SUPPORTED_METHOD: {
    code: 400,
    error: 'not support method'
  },
}

export const SF_CAPS_FIELDS = {
  BROWSER_TAGS: 'sf:browserTags',
  BROWSER_UUID: 'sf:browserUUID',
  NODE_UUID: 'sf:nodeUUID',
  NODE_TAGS: 'sf:nodeTags',
  CLEAN_USER_DATA: 'sf:cleanUserData',
  ENVS: 'sf:envs',
};

export const REGISTER_TIMEOUT_IN_MS = 30e3;
export const LONG_TIMEOUT_IN_MS = 300e3;