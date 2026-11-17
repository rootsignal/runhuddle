import { useEffect, useState } from "react";

type LocalFont = { family: string };
type FontChoice = { family: string; mono: boolean };
let cached: Promise<FontChoice[]> | undefined;
function installedFonts(refresh = false) {
  if (refresh) cached = undefined;
  if (!cached)
    cached = (async () => {
      const query = (
        window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }
      ).queryLocalFonts;
      if (!query)
        throw Error(
          "Font discovery is unavailable. You can enter an installed font below.",
        );
      const fonts = await query.call(window);
      const context = document.createElement("canvas").getContext("2d")!;
      return [...new Set(fonts.map((f) => f.family))]
        .sort((a, b) => a.localeCompare(b))
        .map((family) => {
          context.font = `20px ${JSON.stringify(family)}, monospace`;
          const widths = ["iiiiiiii", "WWWWWWWW", "00000000", "........"].map(
            (s) => context.measureText(s).width,
          );
          return {
            family,
            mono: Math.max(...widths) - Math.min(...widths) < 0.1,
          };
        });
    })().catch((e) => {
      cached = undefined;
      throw e;
    });
  return cached;
}
export function FontPicker({
  value,
  systemFont,
  onChange,
}: {
  value: string;
  systemFont: string;
  onChange: (v: string) => void;
}) {
  const [fonts, setFonts] = useState<FontChoice[]>([]);
  const [query, setQuery] = useState("");
  const [mono, setMono] = useState(true);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    installedFonts()
      .then((f) => {
        if (active) setFonts(f);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const options = fonts.filter(
    (f) =>
      (!mono || f.mono) && f.family.toLowerCase().includes(query.toLowerCase()),
  );
  const known =
    value === systemFont ||
    fonts.some((f) => JSON.stringify(f.family) === value);
  return (
    <div className="font-picker">
      <label htmlFor="font-choice">Font family</label>
      <input
        type="search"
        aria-label="Search installed fonts"
        placeholder="Search installed fonts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        id="font-choice"
        aria-label="Terminal font family"
        value={custom || (!known && !loading) ? "__custom" : value}
        onChange={(e) => {
          if (e.target.value === "__custom") setCustom(true);
          else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value={systemFont}>System monospace</option>
        {value !== systemFont &&
          !options.some((f) => JSON.stringify(f.family) === value) && (
            <option value={value}>{value.replace(/^"|"$/g, "")}</option>
          )}
        {options.map((f) => (
          <option key={f.family} value={JSON.stringify(f.family)}>
            {f.family}
          </option>
        ))}
        <option value="__custom">Enter a font name…</option>
      </select>
      <label className="font-filter">
        <input
          type="checkbox"
          checked={mono}
          onChange={(e) => setMono(e.target.checked)}
        />
        Monospaced fonts only
      </label>
      <small>
        {loading
          ? "Loading installed fonts…"
          : `${options.length} matching fonts · prompt symbols included`}
      </small>
      {(custom || (!known && !loading)) && (
        <input
          aria-label="Custom font family"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Installed font name"
        />
      )}
      {error && <small role="status">{error}</small>}
      <button
        className="refresh-fonts"
        onClick={async () => {
          setLoading(true);
          setError("");
          try {
            setFonts(await installedFonts(true));
          } catch (e) {
            setError(String(e));
          } finally {
            setLoading(false);
          }
        }}
      >
        Refresh installed fonts
      </button>
    </div>
  );
}
