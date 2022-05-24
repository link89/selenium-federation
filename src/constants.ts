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