import binding from 'node-gyp-build';
import { version } from '../package.json';

import { resolve } from 'path';

const {
  LockRequest,
  snapshot
} = binding(resolve(__dirname, '../..'));

const GRANTED = 0;
const NOT_AVAILABLE = 1;
const CANCELED = 2;

interface Lock {
  name : string;
  mode : string;
  release() : void;
}

interface AbortSignalEventTargetAddOptions {
  once : boolean;
}

interface AbortSignalEventTarget {
  addEventListener : (
    name : 'abort',
    listener : () => void,
    options? : AbortSignalEventTargetAddOptions) => void;
  removeEventListener : (
    name : 'abort',
    listener : () => void,
    options? : AbortSignalEventTargetAddOptions) => void;
  aborted? : boolean;
}
interface AbortSignalEventEmitter {
  once : (name : 'abort', listener : () => void) => void;
  off : (name : 'abort', listener : () => void) => void;
}
type AbortSignalAny = AbortSignalEventTarget | AbortSignalEventEmitter;
function onabort (abortSignal : AbortSignalAny, listener : () => void) {
  if ('addEventListener' in abortSignal) {
    abortSignal.addEventListener('abort', listener, { once: true });
  } else {
    abortSignal.once('abort', listener);
  }
}

function clearAbort (abortSignal : AbortSignalAny, listener : () => void) {
  if ('addEventListener' in abortSignal) {
    abortSignal.removeEventListener('abort', listener, { once: true });
  } else {
    abortSignal.off('abort', listener);
  }
}

class AbortError extends Error {
  constructor () {
    super('The task has been aborted');
  }

  get name () { return 'AbortError'; }
}

interface RequestOptions {
  mode? : 'exclusive' | 'shared';
  ifAvailable? : boolean;
  steal? : boolean;
  signal? : AbortSignalAny;
}

interface FilledRequestOptions extends RequestOptions {
  mode: 'exclusive' | 'shared';
  ifAvailable: boolean;
  steal: boolean;
  signal? : AbortSignalAny;
}

const kDefaultRequestOptions : FilledRequestOptions = {
  mode: 'exclusive',
  ifAvailable: false,
  steal: false,
  signal: undefined
};

type LockCallback = (lock? : Lock | null) => void;

async function request (
  name : string,
  options? : RequestOptions | LockCallback,
  callback? : LockCallback) : Promise<any> {
  if (typeof options === 'function') {
    callback = options as LockCallback;
    options = kDefaultRequestOptions;
  }

  name = `${name}`;

  if (typeof callback !== 'function') {
    throw new TypeError('Callback must be a function');
  }

  if (options == null || typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }

  options = { ...kDefaultRequestOptions, ...options };

  let request : typeof LockRequest | undefined;

  const abortListener = () => request.cancel();

  if (options.mode !== 'exclusive' && options.mode !== 'shared') {
    throw new RangeError('Invalid mode');
  }

  if (typeof options.ifAvailable !== 'boolean') {
    throw new TypeError('options.ifAvailable must be a boolean');
  }

  if (typeof options.steal !== 'boolean') {
    throw new TypeError('options.steal must be a boolean');
  }

  if (options.signal != null) {
    if ((options.signal as AbortSignalEventTarget).aborted) {
      return Promise.reject(new AbortError());
    }
    onabort(options.signal, abortListener);
  }

  const lock : Lock | null = await new Promise((resolve, reject) => {
    request = new LockRequest(
      name,
      (options as RequestOptions).mode === 'exclusive' ? 0 : 1,
      Boolean((options as RequestOptions).ifAvailable),
      Boolean((options as RequestOptions).steal),
      (status : number, lock : Lock) => {
        if ((options as RequestOptions).signal != null) {
          clearAbort(
            (options as RequestOptions).signal as AbortSignalAny,
            abortListener);
        }
        request = undefined;
        switch (status) {
          case GRANTED: return resolve(lock);
          case NOT_AVAILABLE: return resolve(null);
          case CANCELED: return reject(new AbortError());
        }
      });
  });

  try {
    return await (callback(lock) as any);
  } finally {
    if (lock != null) {
      lock.release();
    }
  }
}

function query () {
  return snapshot();
}

export = {
  request,
  query,
  version
};
