import { useEffect, useRef, useState } from "react";

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
    input.current?.select();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="appearance-dialog rename-session" aria-labelledby="rename-session-heading"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); onSave(value.trim()); }}>
      <h2 id="rename-session-heading">Rename session</h2>
      <label>Session name<input ref={input} value={value} maxLength={100} onChange={(event) => setValue(event.target.value)} /></label>
      <p>Leave blank to use the automatic title.</p>
      <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save name</button></footer>
    </form>
  </dialog>;
}
