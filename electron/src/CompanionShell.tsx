import { useState } from "react";
import type { ReactNode } from "react";
import { SplitView } from "./SplitView";
import { TerminalPane } from "./Terminal";
import type { TerminalInfo } from "./types";

export function CompanionShell({
  owner,
  terminal,
  visible,
  active,
  connected,
  children,
  onHide,
  onCreate,
  onEnd,
  onError,
}: {
  owner: TerminalInfo;
  terminal?: TerminalInfo;
  visible: boolean;
  active: boolean;
  connected: boolean;
  children: ReactNode;
  onHide: () => void;
  onCreate: () => void;
  onEnd: () => void;
  onError: (message: string) => void;
}) {
  const [ratio, setRatio] = useState(
    () => Number(localStorage.getItem("companion-ratio:" + owner.id)) || 65,
  );
  const [focused, setFocused] = useState(false);
  if (!visible) return <>{children}</>;
  return (
    <SplitView
      axis="right"
      ratio={ratio}
      onRatio={(next) => {
        setRatio(next);
        localStorage.setItem("companion-ratio:" + owner.id, String(next));
      }}
    >
      {children}
      <section
        className="companion-shell"
        aria-label="Companion shell"
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
      >
        <header>
          <strong>Shell</strong>
          <span title={owner.cwd}>{owner.cwd}</span>
          <button onClick={onHide} title="Hide shell · keeps running">
            Hide shell
          </button>
          {terminal && <button onClick={onEnd}>End shell</button>}
        </header>
        <div className="pane-body">
          {!terminal || terminal.exited || terminal.unavailable ? (
            <div className="empty-small">
              <p>
                {terminal ? "Shell ended or disconnected." : "Opening shell…"}
              </p>
              {terminal && <button onClick={onCreate}>Restart shell</button>}
            </div>
          ) : !connected ? (
            <p className="empty-small">Reconnecting to shell…</p>
          ) : (
            <TerminalPane
              id={terminal.id}
              visible={true}
              active={active}
              focused={focused}
              onError={onError}
              onTitle={() => {}}
            />
          )}
        </div>
      </section>
    </SplitView>
  );
}
