const sessionKey = (row) => row.provider + ":" + row.sessionID;

export function createSessionAlerts({ isViewing, deliver, dismiss }) {
  let previous = new Map();
  function update(rows, baseline = false) {
    const current = new Map(
      rows
        .filter((row) => row.terminalId && !row.simulated)
        .map((row) => [sessionKey(row), row]),
    );
    for (const [key, row] of current) {
      const old = previous.get(key);
      if (
        baseline ||
        old?.terminalId !== row.terminalId ||
        old.state === row.state
      )
        continue;
      if (old.state === "needsInput" || row.state === "working") dismiss(key);
      const kind =
        row.state === "needsInput"
          ? "input"
          : row.state === "idle" && old.state === "working" && !row.interrupted
            ? "completion"
            : null;
      if (kind && !isViewing(row.terminalId)) {
        deliver(
          key,
          {
            provider: row.provider,
            sessionID: row.sessionID,
            title:
              kind === "input"
                ? `${row.provider} needs input`
                : `${row.provider} is ready for review`,
            body: row.title || "Open session",
          },
          kind,
        );
      }
    }
    for (const [key, old] of previous) {
      if (
        old.state === "needsInput" &&
        current.get(key)?.terminalId !== old.terminalId
      )
        dismiss(key);
    }
    previous = current;
  }
  return { update, seed: (rows) => update(rows, true) };
}
