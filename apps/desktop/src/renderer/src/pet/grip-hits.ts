import type { PetRegion } from "../../../shared/bridge";

/** Masks by picture, box size, tilt and source crop: built once, reused on every report. */
const masks = new Map<string, PetRegion[]>();
/** Room around the box for pixels a tilt moves outside it. */
const PAD = 64;

/**
 * Reads the edge-grip picture at display size, as drawn for the right edge, and returns one
 * region per opaque run of each row, relative to the figure's box. The picture is tilted by
 * `data-tilt` degrees about the box's bottom-right corner; `data-sw` and `data-sh` crop the
 * source from its top-left corner (one atlas cell) instead of drawing all of it.
 */
function maskOf(figure: HTMLElement, img: HTMLImageElement): PetRegion[] | undefined {
  const width = figure.offsetWidth;
  const height = figure.offsetHeight;
  const tilt = Number(figure.dataset.tilt ?? 0);
  const sw = Number(img.dataset.sw ?? img.naturalWidth);
  const sh = Number(img.dataset.sh ?? img.naturalHeight);
  if (!width || !height || !sw || !sh) return undefined;
  const key = `${img.src}|${width}x${height}|${tilt}|${sw}x${sh}`;
  const known = masks.get(key);
  if (known) return known;
  const canvas = document.createElement("canvas");
  canvas.width = width + 2 * PAD;
  canvas.height = height + 2 * PAD;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.translate(PAD + width, PAD + height);
  ctx.rotate((tilt * Math.PI) / 180);
  ctx.translate(-width, -height);
  ctx.drawImage(img, 0, 0, sw, sh, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask: PetRegion[] = [];
  // A run that continues one of the row above with the same span grows that region instead,
  // which keeps the list sent to main short.
  let above = new Map<string, PetRegion>();
  for (let y = 0; y < canvas.height; y++) {
    const row = new Map<string, PetRegion>();
    let start = 0;
    for (let x = 0; x <= canvas.width; x++) {
      if (x < canvas.width && (pixels[(y * canvas.width + x) * 4 + 3] ?? 0) >= 24) continue;
      if (x > start) {
        const span = `${start},${x}`;
        const grown = above.get(span);
        if (grown) grown.height += 1;
        const region = grown ?? { x: start - PAD, y: y - PAD, width: x - start, height: 1 };
        if (!grown) mask.push(region);
        row.set(span, region);
      }
      start = x + 1;
    }
    above = row;
  }
  masks.set(key, mask);
  return mask;
}

/** The regions that take the mouse in the edge grip: the figure's opaque pixels and its controls. */
export function gripHits(root: HTMLElement): PetRegion[] | undefined {
  const stage = root.querySelector<HTMLElement>("[data-grip]");
  const figure = stage?.querySelector<HTMLElement>(".pet-figure");
  const img = figure?.querySelector("img");
  if (!stage || !figure || !img) return undefined;
  const base = root.getBoundingClientRect();
  const controls = Array.from(stage.querySelectorAll(".pet-dot-task, .pet-badge"), (control) => {
    const r = control.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height };
  });
  if (!img.complete || !img.naturalWidth) return controls;
  let mask: PetRegion[] | undefined;
  try {
    mask = maskOf(figure, img);
  } catch {
    // An unreadable picture: only the controls take the mouse, not the whole box.
    mask = undefined;
  }
  if (!mask) return controls;
  const left = stage.dataset.grip === "left";
  // The box itself is mirrored on the left edge but not rotated (only its picture is), so its
  // client rectangle is its layout box, moved by the entry slide.
  const box = figure.getBoundingClientRect();
  const x = Math.round(box.left - base.left);
  const y = Math.round(box.top - base.top);
  const width = figure.offsetWidth;
  return mask
    .map((r) => ({
      ...r,
      x: x + (left ? width - r.x - r.width : r.x),
      y: y + r.y,
    }))
    .concat(controls);
}
