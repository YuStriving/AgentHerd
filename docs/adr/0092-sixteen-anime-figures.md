# 0092. Sixteen anime figures, each with its source

- Status: Accepted
- Date: 2026-11-20
- Changes: [0070](0070-a-desktop-pet.md) (more figures; a grid picker instead of two buttons)

## Context

The pet had two figures from llm-pet (大肥鱼, Claude 娘). The owner wanted more, anime rather
than game characters (「动漫的，不想要游戏的」), asked for other sources, and then: 「全都加进去吧。」
「然后写清楚来源」.

The largest source is [legeling/awesome-codex-pet](https://github.com/legeling/awesome-codex-pet):
104 pets under "Anime Characters", in the same Codex pet format (192×208 cells; v1 sheets of 9
rows or v2 sheets of 11). Its code is MIT; its art is CC BY-NC 4.0 unless a pet's
`submission.json` says otherwise, and many do. Of the 34 well-known non-game characters picked:

- 16 allow non-commercial use (and redistribution, by attribution where asked);
- 11 allow distribution only through awesome-codex-pet;
- 7 allow personal use only.

AgentHerd is a public repository, so shipping an image in it redistributes it. Asked how to handle
the difference, the owner chose to add only the 16.
[chenxin-dlut/codex-anime-pets](https://github.com/chenxin-dlut/codex-anime-pets) (Anya, Conan, …)
allows personal non-commercial use only and was left out for the same reason.

## Decision

1. **Sixteen built-in figures** besides the two of ADR 0070: 芙莉莲, 波奇, 伊地知虹夏, 喜多郁代,
   山田凉, 爱蜜莉雅, 蕾塞, 御坂美琴, 初音未来, 吉伊, 小八, 无牙仔, 罗小黑, 涂山苏苏, 韩立, 孙悟空.
   Each sheet is re-laid out into the atlas of `pet/sprite.ts` (idle, running, waiting, jumping,
   failed, one sleeping frame = failed column 4, waving, review, running right, running left) and
   saved as WebP (quality 90, ~0.25–0.9 MB each, 9.9 MB for the sixteen). `PET_FIGURES` in
   `packages/host/src/api.ts` lists them; the default stays 大肥鱼.
2. **The source of every figure is written down where it is used.** `pet/figures.ts` keeps, per
   figure, the character and its work, the maker and how it was made (drawn, fan art, AI-generated,
   hand-made vector redraw, as its `submission.json` says), the project and the link to its folder,
   and the terms in short. Under the picker a line reads, for example, 「芙莉莲（葬送的芙莉莲）：legeling
   制作的同人图，来自 awesome-codex-pet，CC BY-NC 4.0，署名，仅限非商用；角色版权归原作。查看原图」.
   `figures/NOTICE.md` has the full table with each pet's terms as written, and the README points
   to it.
3. **A grid picker.** Two-option buttons do not hold 18 figures. `components/FigurePicker.tsx`
   shows every figure's first frame with its name, in 设置 → 桌宠 → 形象 and in the first run.

## Alternatives

- **All 34 in the repository.** Simplest, but 18 would be redistributed against their makers'
  terms.
- **Download on first use** from awesome-codex-pet for the 18 that cannot be shipped. Keeps the
  repository clean, but needs a downloader, network and a picker state for "not yet here". The
  owner chose to leave them out.
- **An import button** for any Codex pet folder. Still a good later step for figures the owner
  finds elsewhere; not needed for this list.

## Consequences

- The app grows by about 10 MB of images.
- All built-in figures forbid commercial use; NOTICE.md and the README say so. A commercial build
  must drop them or get permission.
- The characters belong to their original works; these are unofficial fan works.
