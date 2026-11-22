import { useEffect, useRef, useState } from "react";
import { GitHubPRControl } from "./GitHubPRControl";
import { Icon } from "./Icons";
import type { GitBranchAction, GitChanges, GitCheckoutOptions, GitRepositoryActions } from "./types";

const branchLabel = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, "");
type Action = GitBranchAction | "push";
type Panel = "branch" | "remote";

export function GitBar({ cwd, data, busy, active, prRefresh, compareTarget, onAction, onOpenPullRequest, onDraft }: {
  cwd: string;
  data: GitChanges;
  busy: boolean;
  active: boolean;
  prRefresh: number;
  compareTarget?: string;
  onDraft?: (text: string) => boolean;
  onAction: (action: Action, options: GitCheckoutOptions) => Promise<void>;
  onOpenPullRequest: () => void;
}) {
  const [panel, setPanel] = useState<Panel>();
  const [repository, setRepository] = useState<GitRepositoryActions>();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const [base, setBase] = useState("HEAD");
  const [remote, setRemote] = useState("");
  const [creating, setCreating] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const checkout = useRef(data.branch);
  const selection = useRef(0);
  useEffect(() => {
    const modal = dialog.current;
    if (panel && modal && !modal.open) modal.showModal();
    return () => { if (modal?.open) modal.close(); };
  }, [panel]);

  async function open(next: Panel) {
    const ticket = ++selection.current;
    checkout.current = data.branch;
    setPanel(next);
    setRepository(undefined);
    setName("");
    setRef("");
    setBase("HEAD");
    setCreating(false);
    setError("");
    try {
      const result = await window.runhuddle.gitRepositoryActions(cwd);
      if (ticket !== selection.current) return;
      setRepository(result);
      const upstreamRemote = result.remotes.find((item) => data.upstream?.startsWith(item + "/"));
      setRemote(upstreamRemote || (result.remotes.includes("origin") ? "origin" : result.remotes[0]) || "");
    } catch (reason) {
      if (ticket === selection.current) setError(String(reason).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    }
  }
  function close() {
    ++selection.current;
    setPanel(undefined);
  }
  async function run(action: Action, options: GitCheckoutOptions = {}) {
    const ticket = selection.current;
    setError("");
    try {
      await onAction(action, { ...options, expectedBranch: checkout.current, confirmCheckout: true });
      if (ticket === selection.current) close();
    } catch (reason) {
      if (ticket === selection.current) setError(String(reason).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    }
  }

  const working = repository?.sessions.some((session) => session.working);
  const changed = data.branch !== checkout.current;
  const disabled = busy || !repository || changed;
  const attached = data.branch !== "HEAD" && data.branch !== "New repository";
  const localRefs = repository?.refs.filter((item) => item.startsWith("refs/heads/") && branchLabel(item) !== data.branch);
  const remoteRefs = repository?.refs.filter((item) => item.startsWith("refs/remotes/"));
  const remotePrimary = !data.upstream ? "publish"
    : data.behind && !working ? "pull"
    : data.ahead && !data.behind ? "push" : "fetch";
  const sharedCheckout = repository && repository.sessions.length > 0 && <details
    className="git-checkout-sessions" data-working={working} open={working || undefined}>
    <summary>Sessions sharing this checkout <span>{repository.sessions.length}</span></summary>
    <p>{working
      ? panel === "branch" ? "Wait for working sessions before switching branches." : "Wait for working sessions before pulling."
      : panel === "branch" ? "Switching branches changes the files these sessions see." : "Pulling changes the files these sessions see."}</p>
    <ul>{repository.sessions.map((session, index) => <li key={index}>{session.title}
      {session.working && <span>Working</span>}</li>)}</ul>
  </details>;
  return <footer className="changes-git-bar" aria-label="Git actions">
    <button className="git-branch-button" type="button" aria-label={`Git branch: ${data.branch}`}
      title="Switch or create a branch" onClick={() => void open("branch")} disabled={busy}>
      <Icon name="branch" size={15} /><span>{data.branch}</span><Icon name="chevron" size={15} />
    </button>
    <button type="button" aria-label="Git remote actions" title={data.upstream ? `Upstream: ${data.upstream} at last fetch` : "Fetch or publish a branch"}
      onClick={() => void open("remote")} disabled={busy}>
      {data.upstream ? `↑${data.ahead ?? 0} ↓${data.behind ?? 0}` : attached ? "Publish branch…" : "Remote actions…"}
    </button>
    {data.upstream && <GitHubPRControl key={JSON.stringify([cwd, data.branch, compareTarget])} cwd={cwd} branch={data.branch} target={compareTarget} active={active}
      busy={busy} refreshKey={prRefresh} onPrepare={onOpenPullRequest} onDraft={onDraft} />}
    {panel && <dialog ref={dialog} className="appearance-dialog git-actions-dialog" aria-label={panel === "branch" ? "Git branches" : "Git remote actions"}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close(); }}>
      <header><h2>{panel === "branch" ? "Git branches" : "Git remote actions"}</h2>
        <button type="button" aria-label="Close Git actions" onClick={close}><Icon name="close" size={18} /></button></header>
      <div className="git-action-checkout" aria-label="Current checkout">
        <div><span>Current checkout</span><strong title={data.branch}><Icon name="branch" size={15} />{data.branch}</strong></div>
        <div><span>Upstream</span><strong title={data.upstream}>{data.upstream || "Unpublished"}</strong></div>
        {data.upstream && <small>{data.ahead || data.behind
          ? `${data.ahead ?? 0} ahead · ${data.behind ?? 0} behind at last fetch`
          : "Up to date at last fetch"}</small>}
      </div>
      {error && <p role="alert">{error}</p>}
      {!repository ? !error && <p role="status">Reading repository…</p> : <>
        {changed && <p role="alert">The branch changed. Reopen these actions for the current branch.</p>}
        {panel === "branch" ? <form onSubmit={(event) => {
          event.preventDefault();
          if (disabled || working || (creating ? !name.trim() : !ref)) return;
          void run(creating ? "create-branch" : "switch-branch", creating ? { name, ref: base } : { ref });
        }}>
          {creating ? <>
            <label>Branch name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="feature/my-change" maxLength={240} /></label>
            <label>Start from<select value={base} onChange={(event) => setBase(event.target.value)}>
              <option value="HEAD">Current checkout · {data.branch}</option>
              {repository.refs.map((item) => <option key={item} value={item}>{branchLabel(item)}</option>)}
            </select></label>
          </> : <label>Switch to<select value={ref} onChange={(event) => setRef(event.target.value)}>
            <option value="">Choose a branch</option>
            <optgroup label="Local branches">{localRefs?.map((item) => <option key={item} value={item}>{branchLabel(item)}</option>)}</optgroup>
            <optgroup label="Remote branches">{remoteRefs?.map((item) => <option key={item} value={item}>{branchLabel(item)}</option>)}</optgroup>
          </select></label>}
          {!!data.uncommittedFiles && <small>{data.uncommittedFiles} {data.uncommittedFiles === 1 ? "file has" : "files have"} uncommitted changes. Git will stop if switching would overwrite them.</small>}
          {sharedCheckout}
          <div className="git-branch-actions">
            <button type="button" onClick={() => setCreating(!creating)}>{creating ? "Back to branches" : "New branch…"}</button>
            <button className="primary" disabled={disabled || working || (creating ? !name.trim() : !ref)}>
              {creating ? "Create and switch" : "Switch branch"}
            </button>
          </div>
        </form> : <div className="git-remote-controls">
          <label>{data.upstream ? "Remote to fetch" : "Remote to fetch or publish to"}<select value={remote} onChange={(event) => setRemote(event.target.value)}>
            {!repository.remotes.length && <option value="">No remotes configured</option>}
            {repository.remotes.map((item) => <option key={item}>{item}</option>)}
          </select></label>
          {data.upstream && sharedCheckout}
          <div className="git-remote-actions">
            <button type="button" className={remotePrimary === "fetch" ? "primary" : undefined}
              disabled={disabled || !remote} onClick={() => void run("fetch", { remote })}>Fetch</button>
            {data.upstream ? <>
              <button type="button" className={remotePrimary === "pull" ? "primary" : undefined}
                disabled={disabled || working} title="Fetch and fast-forward the checked-out branch"
                onClick={() => void run("pull")}>Pull</button>
              <button type="button" className={remotePrimary === "push" ? "primary" : undefined}
                disabled={disabled || !data.ahead || !!data.behind} onClick={() => void run("push")}>Push</button>
            </> : <button type="button" className="primary" disabled={disabled || !remote || !attached}
              onClick={() => void run("publish", { remote })}>Publish branch</button>}
          </div>
        </div>}
      </>}
      {busy && <p role="status">Git action running…</p>}
    </dialog>}
  </footer>;
}
