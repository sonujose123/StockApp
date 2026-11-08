import { createApp } from './app.js';
import { createMailer } from './clients/mailer.js';
import { createStockClient } from './clients/stock.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createStore } from './store.js';
import { createLogger } from './util.js';
import { createWorker } from './worker.js';

const logger = createLogger(process.env.LOG_LEVEL || 'info');

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  logger.error('config.invalid', { error: error.message });
  process.exit(1);
}

const db = openDatabase(config.databasePath);
const store = createStore(db);
const stock = createStockClient({
  baseUrl: config.stockApiUrl,
  apiKey: config.stockApiKey,
  timeoutMs: config.stockTimeoutMs,
  logger,
});
const mailer = createMailer({
  baseUrl: config.resendBaseUrl,
  apiKey: config.resendApiKey,
  from: config.emailFrom,
  timeoutMs: config.mailTimeoutMs,
});
const worker = createWorker({ store, stock, mailer, config, logger });
const app = createApp({ config, store, stock, worker, logger });

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info('server.listening', {
    port: config.port,
    databasePath: config.databasePath,
    stockApiUrl: config.stockApiUrl,
    emailEndpoint: mailer.endpoint,
  });
});
server.requestTimeout = 30_000;

server.on('error', (error) => {
  logger.error('server.failed', { error: error.message });
  process.exit(1);
});

worker.start();
logger.info('worker.started', {
  intervalMs: config.workerIntervalMs,
  maxAttempts: config.maxAttempts,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.stopping', { signal });

  worker.stop();
  server.close(() => {
    store.close();
    logger.info('server.stopped');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('server.forced_shutdown');
    try {
      store.close();
    } catch {
      // already closed
    }
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
