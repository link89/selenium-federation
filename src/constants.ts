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

export const SF_CAPS_FIELDS = {
  BROWSER_TAGS: 'sf:browserTags',
  BROWSER_UUID: 'sf:browserUuid',
  NODE_UUID: 'sf:nodeUuid',
  NODE_TAGS: 'sf:nodeTags',
  CLEAN_USER_DATA: 'sf:cleanUserData',
  ENVS: 'sf:envs',
};