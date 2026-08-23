import { startServer, shutdown, socketRevocation } from '../../src/server.js';

await socketRevocation.start();
const server = startServer(0);
await new Promise((resolve) => server.once('listening', resolve));
process.send?.({ type: 'ready', port: server.address().port, state: socketRevocation.state });

process.on('message', async (message) => {
  if (message?.type === 'stop-monitor') {
    await socketRevocation.stop();
    process.send?.({ type: 'monitor-stopped', state: socketRevocation.state });
  }
  if (message?.type === 'start-monitor') {
    await socketRevocation.start();
    process.send?.({ type: 'monitor-started', state: socketRevocation.state });
  }
  if (message?.type === 'break-listener') {
    socketRevocation.config.databaseUrl = 'postgresql://invalid:invalid@127.0.0.1:1/invalid';
    await socketRevocation.client?.end();
    process.send?.({ type: 'listener-broken', state: socketRevocation.state });
  }
  if (message?.type === 'state') process.send?.({ type: 'state', state: socketRevocation.state });
  if (message?.type === 'shutdown') {
    await shutdown('test');
    process.exit(0);
  }
});
