import { useEffect, useRef, useState } from "react";
import type { GitChanges, GitFile } from "./types";
export function ChangesPanel({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<GitChanges | null>(null);
  const [selected, setSelected] = useState<GitFile | null>(null);
  const [diff, setDiff] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const generation = useRef(0),
    request = useRef(0);
  async function preview(file: GitFile, version = generation.current) {
    const token = ++request.current;
    setSelected(file);
    setDiff("");
    setReading(true);
    try {
      const text = await window.runhuddle.gitDiff(cwd, file.path, file.area);
      if (version === generation.current && token === request.current)
        setDiff(
          text.length > 512000 || text.split("\n").length > 4000
            ? text.slice(0, 512000).split("\n").slice(0, 4000).join("\n") +
                "\n… Preview truncated. Open the file locally to review the remaining content."
            : text,
        );
    } catch (e) {
      if (version === generation.current && token === request.current)
        setDiff(String(e));
    } finally {
      if (version === generation.current && token === request.current)
        setReading(false);
    }
  }
  async function refresh() {
    const version = ++generation.current;
    ++request.current;
    setLoading(true);
    setError("");
    setDiff("");
    setReading(false);
    if (!cwd) {
      setData(null);
      setSelected(null);
      setLoading(false);
      return;
    }
    try {
      const next = await window.runhuddle.gitChanges(cwd);
      if (version !== generation.current) return;
      setData(next);
      const file =
        next.files.find(
          (f) => f.path === selected?.path && f.area === selected.area,
        ) || next.files[0];
      setSelected(file || null);
      if (file) void preview(file, version);
    } catch (e) {
      if (version === generation.current) {
        setError(String(e).replace(/^Error: /, ""));
        setData(null);
        setSelected(null);
      }
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setData(null);
    setSelected(null);
    void refresh();
    return () => {
      ++generation.current;
      ++request.current;
    };
  }, [cwd]);
  return (
    <aside className="changes-panel" aria-label="Workspace changes">
      <header>
        <strong>Changes</strong>
        <button disabled={loading || !cwd} onClick={refresh}>
          Refresh changes
        </button>
        <button aria-label="Close changes" onClick={onClose}>
          ×
        </button>
      </header>
      {!cwd ? (
        <p>Select a workspace or session to review its repository.</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading changes…</p>
      ) : (
        data && (
          <>
            <div className="changes-repo">
              <strong>{data.branch}</strong>
              <small title={data.root}>{data.root}</small>
              <small>Refresh to see the latest changes.</small>
            </div>
            {!data.files.length ? (
              <p role="status">Working tree clean.</p>
            ) : (
              <>
                <nav className="changed-files" aria-label="Changed files">
                  {(["staged", "unstaged", "untracked"] as const).map(
                    (area) => {
                      const files = data.files.filter((f) => f.area === area);
                      return (
                        files.length > 0 && (
                          <section key={area}>
                            <h3>
                              {area} · {files.length}
                            </h3>
                            {files.map((file) => (
                              <button
                                key={file.path}
                                title={
                                  file.previous
                                    ? `${file.previous} → ${file.path}`
                                    : file.path
                                }
                                className={
                                  selected?.path === file.path &&
                                  selected.area === area
                                    ? "selected"
                                    : ""
                                }
                                onClick={() => preview(file)}
                              >
                                <span className="file-status">
                                  {file.status}
                                </span>
                                <span>{file.path}</span>
                              </button>
                            ))}
                          </section>
                        )
                      );
                    },
                  )}
                </nav>
                <div className="diff-heading">
                  {selected?.path} <small>{selected?.area}</small>
                </div>
                <pre className="git-diff" aria-label="File diff" tabIndex={0}>
                  {reading
                    ? "Loading diff…"
                    : diff.split("\n").map((line, i) => (
                        <span
                          key={i}
                          className={
                            line.startsWith("+") && !line.startsWith("+++")
                              ? "added"
                              : line.startsWith("-") && !line.startsWith("---")
                                ? "removed"
                                : line.startsWith("@@")
                                  ? "hunk"
                                  : ""
                          }
                        >
                          {line}
                          {"\n"}
                        </span>
                      ))}
                </pre>
              </>
            )}
          </>
        )
      )}
    </aside>
  );
}
