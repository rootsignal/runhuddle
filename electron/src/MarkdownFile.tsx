import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

export default function MarkdownFile({ text }: { text: string }) {
  const [linkError, setLinkError] = useState("");
  return <div className="dashboard-markdown-file">
    <Markdown skipHtml remarkPlugins={plugins} components={{
      table: ({ children }) => <div className="dashboard-markdown-table"><table>{children}</table></div>,
      img: ({ alt }) => alt ? <span>{alt}</span> : null,
      a: ({ href, children, id, title, "aria-label": label }) => {
        if (href?.startsWith("#")) return <a href={href} id={id} aria-label={label}>{children}</a>;
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
    }}>{text}</Markdown>
    {linkError && <p role="alert">{linkError}</p>}
  </div>;
}
