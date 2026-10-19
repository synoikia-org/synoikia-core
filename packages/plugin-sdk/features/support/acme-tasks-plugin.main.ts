import { runPlugin } from '@synoikia/plugin-sdk';
import { acmeTasksPlugin } from './acme-tasks-plugin.js';

runPlugin(acmeTasksPlugin(process.env.ACME_PLUGIN_DIR ?? '.'));
