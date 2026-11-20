export const defaultShortcuts = { palette: "CmdOrCtrl+P", terminal: "CmdOrCtrl+T" };

const reserved = new Set([
  ...["A", "B", "C", "F", "H", "K", "M", "N", "Q", "R", "V", "W", "X", "Z"].map((key) => "CmdOrCtrl+" + key),
  "CmdOrCtrl+Shift+B", "CmdOrCtrl+Shift+Z", "CmdOrCtrl+Alt+I", "Alt+Shift+Left", "Alt+Shift+Right",
  "Ctrl+CmdOrCtrl+F", "CmdOrCtrl+Ctrl+F",
]);

export function validateShortcuts(value) {
  const valid = /^(?:(?:CmdOrCtrl|Ctrl|Alt)\+(?:Shift\+)?|(?:CmdOrCtrl|Ctrl)\+Alt\+(?:Shift\+)?)(?:[A-Z0-9]|F[1-9]|F1[0-2])$/;
  const { palette, terminal } = value ?? {};
  if (![palette, terminal].every((shortcut) => typeof shortcut === "string" && valid.test(shortcut)))
    throw Error("Use a letter, number, or function key with Command, Control, or Option.");
  if (palette === terminal) throw Error("Command Palette and Quick Terminal must use different shortcuts.");
  if ([palette, terminal].some((shortcut) => reserved.has(shortcut)))
    throw Error("That shortcut is already used by RunHuddle or an editing command.");
  return { palette, terminal };
}

export function shortcutForInput(input, isMac) {
  const key = /^Key[A-Z]$/.test(input.code) ? input.code.slice(3)
    : /^Digit[0-9]$/.test(input.code) ? input.code.slice(5) : input.key?.toUpperCase();
  const command = isMac ? input.meta : input.control;
  if (!key || (!command && !input.alt && !input.control) || (!isMac && input.meta) || (isMac && command && input.control)) return "";
  return [command ? "CmdOrCtrl" : isMac && input.control ? "Ctrl" : "",
    input.alt ? "Alt" : "", input.shift ? "Shift" : "", key].filter(Boolean).join("+");
}
