import { useEffect, useState } from "react";
import { useBranding } from "../branding/context";
import { CUSTOM_SKIN_ID, PALETTES, SKINS, type PaletteId } from "../branding/skins";

const field =
  "w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500";

export default function BrandingSettings({ onClose }: { onClose: () => void }) {
  const { branding, save } = useBranding();
  const [name, setName] = useState(branding.name);
  const [emoji, setEmoji] = useState(branding.emoji);
  const [palette, setPalette] = useState<PaletteId>(branding.paletteId);
  const [gmailLabel, setGmailLabel] = useState(branding.gmailLabel);

  // Re-seed the editor when the active skin changes (e.g. after picking a preset),
  // but not while typing in custom mode (skinId stays "custom").
  useEffect(() => {
    setName(branding.name);
    setEmoji(branding.emoji);
    setPalette(branding.paletteId);
    setGmailLabel(branding.gmailLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding.skinId]);

  const isCustom = branding.skinId === CUSTOM_SKIN_ID;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-neutral-200">Appearance & branding</div>
        <p className="mt-1 text-xs text-neutral-500">
          Pick a theme or make your own. Changes apply instantly and save to your account.
        </p>

        <div className="mt-4 text-xs uppercase tracking-wider text-neutral-500">Theme</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SKINS.map((s) => {
            const active = branding.skinId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => void save({ skinId: s.id })}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left ${
                  active ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-700 hover:border-neutral-600"
                }`}
              >
                <span className="inline-block h-4 w-4 shrink-0 rounded-full" style={{ background: PALETTES[s.palette].scale[5] }} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-neutral-200">{s.emoji} {s.name}</span>
                  <span className="block truncate text-[11px] text-neutral-500">{s.tagline}</span>
                </span>
              </button>
            );
          })}
          <button
            onClick={() => void save({ skinId: CUSTOM_SKIN_ID, name, emoji, paletteId: palette, gmailLabel })}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left ${
              isCustom ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-700 hover:border-neutral-600"
            }`}
          >
            <span className="inline-block h-4 w-4 shrink-0 rounded-full" style={{ background: PALETTES[palette].scale[5] }} />
            <span className="block text-sm font-medium text-neutral-200">✨ Custom</span>
          </button>
        </div>

        {isCustom && (
          <div className="mt-4 space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <label className="block text-xs">
              <span className="mb-1 block text-neutral-400">App name</span>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BraaiBucks" />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-neutral-400">Logo mark (emoji, optional)</span>
              <input className={field} value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🔥" maxLength={4} />
            </label>
            <div className="text-xs">
              <span className="mb-1 block text-neutral-400">Accent colour</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PALETTES) as PaletteId[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPalette(p)}
                    title={PALETTES[p].label}
                    aria-label={PALETTES[p].label}
                    className={`h-7 w-7 rounded-full border-2 ${palette === p ? "border-white" : "border-transparent"}`}
                    style={{ background: PALETTES[p].scale[5] }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={() => void save({ skinId: CUSTOM_SKIN_ID, name: name.trim() || "My Money", emoji: emoji.trim(), paletteId: palette, gmailLabel: gmailLabel.trim() })}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Apply custom theme
            </button>
          </div>
        )}

        <div className="mt-5 text-xs uppercase tracking-wider text-neutral-500">Gmail auto-import label</div>
        <p className="mt-1 text-[11px] text-neutral-500">
          The Gmail label the import script watches. Label a statement or invoice email with this and it imports automatically.
        </p>
        <div className="mt-2 flex gap-2">
          <input className={field} value={gmailLabel} onChange={(e) => setGmailLabel(e.target.value)} placeholder={branding.name} />
          <button
            onClick={() => void save({ gmailLabel: gmailLabel.trim() })}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800"
          >
            Save
          </button>
        </div>

        <button onClick={onClose} className="mt-5 w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-300 hover:bg-neutral-800">
          Done
        </button>
      </div>
    </div>
  );
}
