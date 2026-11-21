import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import extensions from "../main/preview-file-types.json";
import { Icon } from "./Icons";
import type { ProjectFilePreview, Session } from "./types";

const MarkdownFile = lazy(() => import("./MarkdownFile"));

function replyReferences(text: string) {
  const references = new Map<string, { target: string; label: string; web: boolean }>();
  const suffixes = extensions.join("|");
  const files = new RegExp(`(?:^|[\\s(])((?:[\\w.~/\\\\:-]+\\.)+(?:${suffixes}))(?=$|[\\s),;:!?]|\\.(?:\\s|$))`, "gi");
  const add = (target: string, label?: string) => {
    if (references.size >= 12) return;
    target = target.trim().replace(/^<|>$/g, "");
    if (!target || /[\x00-\x1f\x7f]/.test(target)) return;
    if (/^https?:\/\//i.test(target)) {
      const url = URL.parse(target);
      if (url && !url.username && !url.password) references.set(url.href, {
        label: references.get(url.href)?.label ?? (label || url.hostname), target: url.href, web: true,
      });
    } else {
      if (/^(?:[a-z][a-z0-9+.-]*:\/\/|~)/i.test(target)) return;
      try { target = decodeURIComponent(target); } catch {}
      target = target.replace(/(?:#L\d+(?:-L\d+)?|:\d+(?::\d+)?)$/i, "");
      if (!extensions.includes(target.split(".").at(-1)?.toLowerCase() ?? "")) return;
      const key = target.replace(/^\.\//, "");
      if (!references.has(key)) references.set(key, { target, label: label || key.split(/[\\/]/).at(-1) || key, web: false });
    }
  };
  const prose = text.replace(/\[([^\]\n]+)\]\((<[^>\n]+>|[^\s)]+)\)/g, (_match, label, target) => {
    add(target, label);
    return " ";
  });
  const withoutCode = prose.replace(/(?:^|[^\x60])\x60([^\x60\n]+)\x60(?!\x60)/g, (_match, target) => {
    add(target);
    return " ";
  });
  const withoutLinks = withoutCode.replace(/https?:\/\/[^\s<>\x60]+/gi, (url) => {
    add(url.replace(/[.,;!?)\]]+$/, ""));
    return " ";
  });
  for (const match of withoutLinks.matchAll(files)) add(match[1]);
  return [...references.values()];
}

export function ReplyReferences({ answer, onFile, onBrowser }: {
  answer: string;
  onFile: (file: string) => void;
  onBrowser: (url: string) => Promise<void>;
}) {
  const references = replyReferences(answer);
  const [error, setError] = useState("");
  async function open(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (reason) {
      setError((reason instanceof Error ? reason.message : String(reason))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    }
  }
  if (!references.length) return null;
  return <section className="dashboard-reply-references" aria-label="Referenced files and links">
    <h3>Referenced files and links</h3>
    <ul>{references.map(({ target, label, web }) => <li key={target}>
      <span className="dashboard-reference-icon"><Icon name={web ? "browser" : "notes"} size={17} /></span>
      <span className="dashboard-reference-label" title={target}><strong>{label}</strong><small>{target}</small></span>
      {web ? <>
        <button className="dashboard-tool-icon" aria-label={`Open ${label} in RunHuddle Browser`} data-tooltip="Open in RunHuddle Browser"
          onClick={() => void open(() => onBrowser(target))}><Icon name="browser" size={17} /></button>
        <button className="dashboard-tool-icon" aria-label={`Open ${label} in default browser`} data-tooltip="Open in default browser"
          onClick={() => void open(() => window.runhuddle.openTerminalLink(target))}><Icon name="open-workspace" size={17} /></button>
      </> : <button className="secondary" aria-label={`View ${label}`} onClick={() => onFile(target)}>View file</button>}
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ProjectFileDialog({ source, file, onClose }: {
  source: Pick<Session, "provider" | "sessionID">;
  file: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<ProjectFilePreview>();
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    let active = true;
    void window.runhuddle.previewProjectFile(source.provider, source.sessionID, file).then((value) => {
      if (active) setPreview(value);
    }, (reason) => {
      if (active) setError(String(reason).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    });
    return () => { active = false; dialog.close(); };
  }, [source.provider, source.sessionID, file]);
  return <dialog ref={ref} aria-label="File preview" className="appearance-dialog dashboard-file-preview"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header><div><small>File preview</small><h2>{preview?.path ?? file}</h2></div>
      <button autoFocus onClick={onClose} aria-label="Close file preview"><Icon name="close" size={18} /></button>
    </header>
    {error ? <p role="alert">{error}</p> : preview ? <article>
      {preview.markdown ? <Suspense fallback={<p role="status">Formatting Markdown…</p>}>
        <MarkdownFile text={preview.text} />
      </Suspense> : <pre>{preview.text}</pre>}
      {preview.truncated && <p>Preview limited to the first 256 KB.</p>}
    </article> : <p role="status">Opening file…</p>}
  </dialog>;
}
