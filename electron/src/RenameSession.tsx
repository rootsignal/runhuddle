import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

export function RenameSession({ name, onSave, onClose }: {
  name: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    input.current?.select();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="appearance-dialog rename-session" aria-labelledby="rename-session-heading"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); onSave(value.trim()); }}>
      <header>
        <h2 id="rename-session-heading">Rename session</h2>
        <button type="button" aria-label="Close rename dialog" onClick={onClose}><Icon name="close" size={17} /></button>
      </header>
      <div className="session-name-field">
        <label htmlFor="rename-session-name">Session name</label>
        <input id="rename-session-name" ref={input} value={value} maxLength={100} placeholder="Automatic title"
          aria-describedby="rename-session-help" onChange={(event) => setValue(event.target.value)} />
        <small id="rename-session-help">Enter a fixed name or leave blank for an automatic title.</small>
      </div>
      <footer>
        {name && <button className="rename-reset" type="button" onClick={() => onSave("")}>Use automatic title</button>}
        <button type="button" onClick={onClose}>Cancel</button>
        <button className="primary">Save name</button>
      </footer>
    </form>
  </dialog>;
}
