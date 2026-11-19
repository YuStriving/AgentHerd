// Files dropped on the desktop pet (ADR 0082). They are already on this computer, so nothing is
// copied: a picture the model can look at goes in as an image of the owner's message, as one sent
// in Feishu would; anything else (a document, a folder, a large picture) goes in as a line with its
// full path, which the Herder and its tasks can open.

import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { InboundImage, Locale } from "@agentherd/protocol";
import { PET_DROP_MAX } from "./api.ts";

/** Larger pictures go in as a path, like any file. */
export const PET_DROP_PICTURE_MAX = 10 * 1024 * 1024;

export interface Dropped {
  images: InboundImage[];
  /** One line per file or folder that goes in by its path. */
  lines: string[];
}

/** The picture type of some bytes, by their first bytes; undefined when not a picture. */
export function droppedPictureType(data: Uint8Array): string | undefined {
  const b = data;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

const PICTURE = /\.(png|jpe?g|gif|webp)$/i;

export interface DropDisk {
  stat(path: string): { isFile: boolean; isDirectory: boolean; size: number } | undefined;
  read(path: string): Uint8Array;
}

const DISK: DropDisk = {
  stat(path) {
    try {
      const s = statSync(path);
      return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size };
    } catch {
      return undefined;
    }
  },
  read: (path) => readFileSync(path),
};

/** What the owner dropped, as a message's images and path lines. Throws for what is not there. */
export function droppedFiles(paths: readonly string[], locale: Locale, disk = DISK): Dropped {
  if (paths.length > PET_DROP_MAX) {
    throw new Error(
      locale === "en"
        ? `at most ${PET_DROP_MAX} files at once`
        : `一次最多拖 ${PET_DROP_MAX} 个文件`,
    );
  }
  const images: InboundImage[] = [];
  const lines: string[] = [];
  for (const path of [...new Set(paths)]) {
    const missing = locale === "en" ? `cannot find ${path}` : `找不到 ${path}`;
    if (!isAbsolute(path)) throw new Error(missing);
    const s = disk.stat(path);
    if (s === undefined || (!s.isFile && !s.isDirectory)) throw new Error(missing);
    const name = basename(path) || path;
    if (s.isFile && PICTURE.test(path) && s.size > 0 && s.size <= PET_DROP_PICTURE_MAX) {
      const data = disk.read(path);
      const mimeType = droppedPictureType(data);
      if (mimeType !== undefined) {
        images.push({ mimeType, data });
        continue;
      }
    }
    lines.push(droppedLine(name, path, s.isDirectory, locale));
  }
  return { images, lines };
}

/** The line a dropped file or folder becomes, with its full path. */
export function droppedLine(name: string, path: string, folder: boolean, locale: Locale): string {
  if (locale === "en") {
    return `[The owner dropped the ${folder ? "folder" : "file"} "${name}" on the pet: ${path}]`;
  }
  return `[主人拖来${folder ? "文件夹" : "文件"}「${name}」：${path}]`;
}
