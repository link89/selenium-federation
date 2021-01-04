import { RequestHandler } from './controllers';
const HTTP_ERROR_TYPE = Symbol();


class HttpError extends Error {
  public readonly __type__ = HTTP_ERROR_TYPE;
  public statusCode: number = 500 ;
  public data: any;
}

export const newHttpError = (statusCode: number, message: string, data?: any) => {
  const error = new HttpError(message);
  error.statusCode = statusCode;
  error.data = data;
  return error;
}

// type guard
export const isHttpError = (err: Error | HttpError): err is HttpError => {
  return (err as HttpError).__type__ === HTTP_ERROR_TYPE;
}

export const handleError: RequestHandler = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(err);
    // respect W3C standard: https://www.w3.org/TR/webdriver/#errors
    if (isHttpError(err)) {
      ctx.status = err.statusCode;
      ctx.body = {
        value: {
          error: err.message,
          message: err.message,
          stacktrace: err.stack,
          data: err.data,
        }
      }
    } else {
      ctx.status = 500;
      ctx.body = {
        value: {
          error: err.message,
          message: err.message,
          stacktrace: err.stack,
        }
      };
    }
  }
}