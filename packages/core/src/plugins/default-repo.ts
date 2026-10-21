/** The pre-configured, signed Synoikia plugins repository (ADR-0013); added once, removal sticks. */
export const DEFAULT_PLUGIN_REPO = {
  url: 'https://github.com/synoikia-org/synoikia-core-plugins/releases/download/index/index.json',
  name: 'Synoikia plugins',
  publicKey: 'RWSDbQe7ylyyieEU0Yh/bxR53m+N/0VrVMru5WCzv1/Yvt5td92t/21e',
  /** Where it was published before; a repo still there with the same key moves to `url` (ADR-0013). */
  formerUrls: ['https://github.com/via-justa/synoikia-core-plugins/releases/download/index/index.json'],
};
