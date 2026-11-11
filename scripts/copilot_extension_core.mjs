// RunHuddle Copilot replies — local, exact-session message bridge.
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_PACKET = 256000;
export function createHandler(session) {
    const sessionID = session.sessionId;
    const pending = new Set();
    let ended = false;
    let sending = false;
    let activity = "idle";
    function observe(event) {
        const family = event.type?.split('.')[0];
        if (['permission', 'user_input', 'exit_plan_mode', 'elicitation'].includes(family)) {
            const id = event.data?.requestId;
            if (typeof id === 'string') {
                const key = family + ':' + id;
                if (event.type.endsWith('.requested')) pending.add(key);
                if (event.type.endsWith('.completed')) pending.delete(key);
            }
        }
        if (!event.agentId) {
            if (['user.message', 'assistant.turn_start'].includes(event.type)) activity = 'working';
            if (['session.idle', 'assistant.turn_end'].includes(event.type)) activity = 'idle';
        }
        if (event.type === 'session.shutdown') ended = true;
    }
    async function handle(request) {
        const identity = { sessionID, extensionPID: process.pid, ownerPID: process.ppid, protocol: 1, state: ended ? 'saved' : pending.size ? 'needsInput' : activity };
        const result = (outcome, message, extra = {}) => ({ ...identity, outcome, message, ...extra });
        if (request.sessionID !== sessionID || session.sessionId !== sessionID || ended)
            return result('unavailable', 'This Copilot session has changed or closed. Refresh before sending.');
        if (pending.size) return result('unavailable', 'Answer the pending question or approval in Copilot’s terminal first.');
        if (request.action === 'check') return result('ready', 'Connected to this Copilot session. Approvals stay in its terminal.');
        if (request.action !== 'send' || typeof request.text !== 'string' || !request.text.trim() || request.text.includes('\0') || Buffer.byteLength(request.text) > 32000)
            return result('notSent', 'Enter a message up to 32 KB without null characters.');
        if (sending) return result('notSent', 'Another message is still being submitted. Wait before sending again.');
        sending = true;
        try {
            // Do not override model, permission handlers, or agent mode.
            const messageID = await session.send({ prompt: request.text, mode: 'enqueue' });
            if (typeof messageID !== 'string' || !messageID)
                return result('uncertain', 'Copilot did not return a message receipt. Check its terminal before sending again.');
            return result('queued', 'Queued in Copilot. It will run when this session is ready.', { messageID });
        } catch {
            return result('uncertain', 'Copilot delivery could not be confirmed. Check its terminal before sending again.');
        } finally { sending = false; }
    }
    return { handle, observe };
}

export async function startBridge(session) {
    const sid = session.sessionId;
    if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new Error('Invalid Copilot session identity');
    const bridge = createHandler(session);
    const buffered = [];
    let initialized = false;
    session.on(event => { if (initialized) bridge.observe(event); else buffered.push(event); });
    const read = session.getEvents ?? session.getMessages;
    if (typeof read !== 'function') throw new Error('Update Copilot to support RunHuddle replies');
    // A resumed conversation may contain the previous process's shutdown.
    // Only the live event stream can close this connection.
    for (const event of await read.call(session)) {
        if (event.type !== 'session.shutdown') bridge.observe(event);
    }
    for (const event of buffered) bridge.observe(event);
    initialized = true;
    const root = path.join(os.homedir(), '.runhuddle');
    const folder = path.join(root, 'copilot');
    for (const directory of [root, folder]) {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const info = await fs.lstat(directory);
        if (!info.isDirectory() || info.uid !== process.getuid()) throw new Error('Unsafe channel directory');
        await fs.chmod(directory, 0o700);
    }
    const name = crypto.createHash('sha256').update(sid).digest('hex').slice(0, 24) + '-' + process.pid + '.sock';
    const socketPath = path.join(folder, name);
    // Remove only a stale endpoint bearing this process's own PID.
    await fs.unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const server = net.createServer(connection => {
        let data = Buffer.alloc(0), handled = false;
        connection.setTimeout(15000, () => connection.destroy());
        connection.on('error', () => {});
        connection.on('data', chunk => {
            if (handled) return;
            data = Buffer.concat([data, chunk]);
            if (data.length > MAX_PACKET) { handled = true; connection.destroy(); return; }
            if (!data.includes(10)) return;
            handled = true;
            let request;
            try {
                request = JSON.parse(data.subarray(0, data.indexOf(10)).toString('utf8'));
                if (!request || Array.isArray(request) || typeof request !== 'object') throw new Error();
            } catch { connection.destroy(); return; }
            bridge.handle(request).then(result => connection.end(JSON.stringify(result) + '\n'), () => connection.destroy());
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
    });
    await fs.chmod(socketPath, 0o600);
    server.on('error', error => console.error('RunHuddle connection:', error.message));
    const close = () => {
        server.close();
        fs.unlink(socketPath).catch(() => {}).finally(() => process.exit(0));
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
    return server;
}
