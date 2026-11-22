import { useEffect, useRef, useState, type CSSProperties } from "react";

export function AppAccentDialog({ accent, onClose }: { accent: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(accent);
  const [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog ref={dialog} className="app-accent-dialog" aria-label="Custom accent color"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        try {
          await window.runhuddle.setAppAccent(value);
          onClose();
        } catch (reason) {
          setError(String(reason));
        }
      }}>
        <h2>Custom accent color</h2>
        <label>Accent color <input type="color" value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <div className="app-accent-sample" style={{ "--app-accent-base": value } as CSSProperties} aria-label="Accent preview">
          <span className="accent-sample-selection">Selection</span>
          <span className="accent-sample-focus">Focus</span>
          <span className="accent-sample-primary">Primary action</span>
        </div>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit">Apply color</button>
        </footer>
      </form>
    </dialog>
  );
}
