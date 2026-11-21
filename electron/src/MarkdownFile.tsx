import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

export default function MarkdownFile({ text, reply = false, linksAsLabels = false, onFileReference }: {
  text: string; reply?: boolean; linksAsLabels?: boolean; onFileReference?: (file: string) => void;
}) {
  const [linkError, setLinkError] = useState("");
  const citations = new Map<string, string>();
  const content = reply ? text.replace(/:codex-file-citation\{((?:[\w-]+="(?:[^"\\\r\n]|\\.)*"\s*)+)\}/g, (markup, attributes) => {
    const field = attributes.match(/(?:^|\s)path=("(?:[^"\\]|\\.)*")/);
    if (!field) return markup;
    let file: string;
    try { file = JSON.parse(field[1]); } catch { return markup; }
    if (!file.trim() || /[\x00-\x1f\x7f]/.test(file)) return markup;
    const label = (file.split(/[\\/]/).at(-1) || file).replace(/[\\[\]`*_<>]/g, "\\$&");
    if (!onFileReference) return label;
    const href = "#runhuddle-file-citation-" + citations.size;
    citations.set(href, file);
    return `[${label}](${href})`;
  }) : text;
  return <div className={reply ? "dashboard-markdown-file dashboard-markdown-reply" : "dashboard-markdown-file"}>
    <Markdown skipHtml remarkPlugins={plugins} components={{
      table: ({ children }) => <div className="dashboard-markdown-table"><table>{children}</table></div>,
      img: ({ alt }) => alt ? <span>{alt}</span> : null,
      a: ({ href, children, id, title, "aria-label": label }) => {
        const file = href && citations.get(href);
        if (file && onFileReference) return <button type="button" className="dashboard-file-citation" title={file}
          onClick={() => onFileReference(file)}>{children}</button>;
        if (linksAsLabels && !href?.startsWith("#")) return <span>{children}</span>;
        if (href?.startsWith("#")) return <a href={href} id={id} aria-label={label} onClick={(event) => {
          event.preventDefault();
          const target = document.getElementById(href.slice(1));
          if (target && event.currentTarget.closest(".dashboard-markdown-file")?.contains(target))
            target.scrollIntoView({ block: "nearest" });
        }} onAuxClick={(event) => event.preventDefault()}>{children}</a>;
        const url = href && URL.parse(href);
        if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password)
          return <span>{children}</span>;
        return <a href={url.href} title={title} onClick={(event) => {
          event.preventDefault();
          setLinkError("");
          void window.runhuddle.openTerminalLink(url.href).catch((error) => {
            setLinkError(String(error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
          });
        }} onAuxClick={(event) => event.preventDefault()}>{children}</a>;
      },
    }}>{content}</Markdown>
    {linkError && <p role="alert">{linkError}</p>}
  </div>;
}
