// RunHuddle-owned Copilot reply extension. Do not request tokens or override permissions.
import { joinSession } from '@github/copilot-sdk/extension';
import { startBridge } from './bridge.mjs';
const session = await joinSession();
await startBridge(session);
