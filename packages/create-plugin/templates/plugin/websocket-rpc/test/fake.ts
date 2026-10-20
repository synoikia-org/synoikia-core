import { CREDENTIALS } from './fake-auth.js';
import { startFake{{Pascal}}, UPSTREAM_SECRET } from './fake-upstream.js';

/** The fake that test/compliance.yaml names: its `url`, the connection's credentials and the upstream's secret. */
export async function start() {
  const fake = await startFake{{Pascal}}();
  return { ...CREDENTIALS, url: fake.url, secret: UPSTREAM_SECRET, close: () => fake.close() };
}
