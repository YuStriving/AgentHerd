// A grid of the pet's figures, each showing its first frame, with where the chosen one comes from
// under it (ADR 0070, ADR 0092). Used by 设置 → 桌宠 and by the first run.

import { PET_FIGURES, type PetFigure } from "@agentherd/host/api";
import { creditOf, FIGURES } from "../pet/figures";
import { ATLAS, CELL } from "../pet/sprite";

export function FigurePicker({
  figure,
  pick,
  disabled = false,
  scale = 0.42,
}: {
  figure: PetFigure;
  pick: (figure: PetFigure) => void;
  disabled?: boolean;
  scale?: number;
}) {
  const width = Math.round(CELL.width * scale);
  const height = Math.round(CELL.height * scale);
  const chosen = FIGURES[figure];
  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${width + 24}px, 1fr))` }}
      >
        {PET_FIGURES.map((id) => {
          const on = id === figure;
          const f = FIGURES[id];
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              title={f.work === undefined ? f.name : `${f.name}（${f.work}）`}
              onClick={() => pick(id)}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 px-1 pt-2 pb-1.5 transition-colors ${
                on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"
              }`}
            >
              <span
                aria-hidden
                className="block"
                style={{
                  width,
                  height,
                  backgroundImage: `url(${f.atlas})`,
                  backgroundSize: `${width * ATLAS.columns}px ${height * ATLAS.rows}px`,
                  backgroundPosition: "0 0",
                }}
              />
              <span className={`text-xs ${on ? "font-medium text-ink" : "text-ink-2"}`}>
                {f.name}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-ink-dim text-xs">
        {creditOf(figure)}。
        <a
          href={chosen.link}
          target="_blank"
          rel="noreferrer"
          className="text-accent-text hover:underline"
        >
          查看原图
        </a>
      </p>
    </div>
  );
}
