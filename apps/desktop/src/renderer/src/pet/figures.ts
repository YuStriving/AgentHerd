// The figures that come with the app. Each is an atlas of 192×208 cells laid out as in sprite.ts,
// cut from community Codex pet sprite sheets: two from llm-pet (ADR 0070) and sixteen anime
// figures from awesome-codex-pet (ADR 0092). None of them is under AgentHerd's MIT license; where
// each comes from is below and in figures/NOTICE.md.

import type { PetFigure } from "@agentherd/host/api";
import bocchiAtlas from "./figures/bocchi.webp";
import chiikawaAtlas from "./figures/chiikawa.webp";
import claudeAtlas from "./figures/claude.webp";
import deepseekAtlas from "./figures/deepseek.webp";
import emiliaAtlas from "./figures/emilia.webp";
import frierenAtlas from "./figures/frieren.webp";
import hachiwareAtlas from "./figures/hachiware.webp";
import hanliAtlas from "./figures/hanli.webp";
import kitaAtlas from "./figures/kita.webp";
import luoxiaoheiAtlas from "./figures/luoxiaohei.webp";
import mikotoAtlas from "./figures/mikoto.webp";
import mikuAtlas from "./figures/miku.webp";
import nijikaAtlas from "./figures/nijika.webp";
import rezeAtlas from "./figures/reze.webp";
import ryoAtlas from "./figures/ryo.webp";
import toothlessAtlas from "./figures/toothless.webp";
import tushansusuAtlas from "./figures/tushansusu.webp";
import wukongAtlas from "./figures/wukong.webp";

export interface Figure {
  name: string;
  /** The work the character comes from; none for figures of a model. */
  work?: string;
  atlas: string;
  /** Who made the sprite sheet, and how ("绘制", "用 AI 生成", …), as its source says. */
  author: string;
  made: string;
  /** The project it comes from, and the page of this figure there. */
  project: string;
  link: string;
  /** The terms the author gave, in short. */
  terms: string;
}

const LLM_PET = "https://github.com/savanna0425/llm-pet/tree/main/pets/";
const AWESOME = "https://github.com/legeling/awesome-codex-pet/tree/main/pets/";

const llmPet = (name: string, atlas: string, folder: string): Figure => ({
  name,
  atlas,
  author: "ZipZipPipe",
  made: "绘制",
  project: "llm-pet",
  link: LLM_PET + folder,
  terms: "署名，仅限非商用",
});

const awesome = (
  name: string,
  work: string,
  atlas: string,
  author: string,
  folder: string,
  terms = "CC BY-NC 4.0，署名，仅限非商用",
  made = "用 AI 生成",
): Figure => ({
  name,
  work,
  atlas,
  author,
  made,
  project: "awesome-codex-pet",
  link: AWESOME + folder,
  terms,
});

export const FIGURES: Record<PetFigure, Figure> = {
  deepseek: llmPet("大肥鱼", deepseekAtlas, "deepseek-chibi"),
  claude: llmPet("Claude 娘", claudeAtlas, "claude-chibi"),
  frieren: awesome(
    "芙莉莲",
    "葬送的芙莉莲",
    frierenAtlas,
    "legeling",
    "frieren--lingxiaotian",
    "CC BY-NC 4.0，署名，仅限非商用",
    "制作的同人图",
  ),
  bocchi: awesome(
    "波奇",
    "孤独摇滚！",
    bocchiAtlas,
    "legeling",
    "bocchi--lingxiaotian",
    "CC BY-NC 4.0，署名，仅限非商用",
    "制作的同人图",
  ),
  nijika: awesome(
    "伊地知虹夏",
    "孤独摇滚！",
    nijikaAtlas,
    "Amiaね",
    "nijika--amia",
    "署名 Amiaね，可非商用使用和转载",
    "制作的同人图",
  ),
  kita: awesome(
    "喜多郁代",
    "孤独摇滚！",
    kitaAtlas,
    "legeling",
    "kita-ikuyo--legeling",
    "仅限非商用",
  ),
  ryo: awesome(
    "山田凉",
    "孤独摇滚！",
    ryoAtlas,
    "zhou-jianwen",
    "ryo-yamada--zhou-jianwen",
    "仅限非商用",
    "制作的同人图",
  ),
  emilia: awesome(
    "爱蜜莉雅",
    "Re:从零开始的异世界生活",
    emiliaAtlas,
    "zhou-jianwen",
    "emilia--zhou-jianwen",
    "署名 zhou-jianwen，仅限非商用使用和转载",
  ),
  reze: awesome("蕾塞", "电锯人", rezeAtlas, "legeling", "reze--legeling", "仅限非商用"),
  mikoto: awesome(
    "御坂美琴",
    "某科学的超电磁炮",
    mikotoAtlas,
    "legeling",
    "mikoto--lingxiaotian",
    "CC BY-NC 4.0，署名，仅限非商用",
    "制作的同人图",
  ),
  miku: awesome(
    "初音未来",
    "虚拟歌手",
    mikuAtlas,
    "legeling",
    "miku--lingxiaotian",
    "CC BY-NC 4.0，署名，仅限非商用",
    "制作的同人图",
  ),
  chiikawa: awesome(
    "吉伊",
    "Chiikawa",
    chiikawaAtlas,
    "godxxy1229",
    "chiikawa--godxxy1229",
    "仅限非商用",
    "手工矢量重绘",
  ),
  hachiware: awesome(
    "小八",
    "Chiikawa",
    hachiwareAtlas,
    "godxxy1229",
    "hachiware--godxxy1229",
    "仅限非商用",
    "手工矢量重绘",
  ),
  toothless: awesome(
    "无牙仔",
    "驯龙高手",
    toothlessAtlas,
    "legeling",
    "toothless--legeling",
    "仅限非商用",
  ),
  luoxiaohei: awesome(
    "罗小黑",
    "罗小黑战记",
    luoxiaoheiAtlas,
    "legeling",
    "luo-xiaohei--legeling",
    "CC BY-NC 4.0，署名，仅限非商用",
  ),
  tushansusu: awesome(
    "涂山苏苏",
    "狐妖小红娘",
    tushansusuAtlas,
    "legeling",
    "tushan-susu--legeling",
    "仅限非商用",
  ),
  hanli: awesome("韩立", "凡人修仙传", hanliAtlas, "legeling", "han-li--legeling", "仅限非商用"),
  wukong: awesome(
    "孙悟空",
    "大闹天宫",
    wukongAtlas,
    "legeling",
    "classic-wukong--legeling",
    "仅限非商用",
  ),
};

/** One line on where a figure comes from, shown under the choice. */
export function creditOf(figure: PetFigure): string {
  const f = FIGURES[figure];
  const who = f.work === undefined ? f.name : `${f.name}（${f.work}）`;
  const rights = f.work === undefined ? "" : "；角色版权归原作";
  return `${who}：${f.author} ${f.made}，来自 ${f.project}，${f.terms}${rights}`;
}
