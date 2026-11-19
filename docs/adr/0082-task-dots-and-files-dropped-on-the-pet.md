# ADR 0082: Task dots on the pet, and files dropped on it

- Status: Accepted
- Date: 2026-11-19
- Changes: [0070](0070-a-desktop-pet.md) (the figure showed only one mood for all tasks; the pet
  took typed words only), [0078](0078-the-pet-has-pages.md) (the 任务 page)

## Context

- The owner asked for the first six items of the pet research (2026-11-19, 「前六个感觉都可以做」).
  The last two are here: seeing at a glance which tasks run and which wait, without opening the
  pet; and handing the Herder a file by dragging it onto the pet, as in Feishu.
- The figure has one mood for everything: 「在做」 does not say whether one task or four run, nor
  that one of them waits on the owner. The 任务 page says it, but needs a click.
- In Feishu the owner can send a picture or a file to the Herder; in the pet they could only type.
  The files they mean are usually already on this computer (a screenshot, a PDF on the desktop).

## Decision

1. **One dot per running task over the pet's head**, at most 5 and 「+N」 for the rest, in the
   order of the 任务 page (waiting on the owner first): amber 等你, red 卡住了, blue 在做, grey
   排队中. Hovering a dot names the task and its stage; a click opens the pet on 任务. No dots when
   nothing runs.
2. **Files dropped on the pet wait above the input** as chips (🖼️ for a picture, 📎 otherwise, ×
   to take one back), up to 6, and go with the next message; words are optional. Dropping on the
   figure, the folded dot or the open panel all work, and open the conversation.
3. **Nothing is copied.** The pet hands the host the files' paths (Electron
   `webUtils.getPathForFile`); the host checks each is there:
   - a png, jpg, gif or webp of at most 10 MB whose bytes are a picture goes in as an image of
     the owner's message, exactly like a picture sent in Feishu (saved under attachments, seen by
     the model);
   - anything else — a document, a folder, a larger picture — goes in as a line with its full path,
     「[主人拖来文件「plan.pdf」：/Users/…/plan.pdf]」, which the Herder and its tasks can open.
   A path that is gone, or one that is not a full path, is refused with 「找不到 …」.
4. The owner's line in the pet shows the words and the files' names; the echo in Feishu notes how
   many pictures came along.

## Alternatives

- **Copy every dropped file into attachments**, like Feishu files. They are on this computer
  already; a copy of a large file or a folder costs space and time for nothing.
- **Tasks as small figures around the pet.** More art for the same information; dots are enough
  at a glance, the 任务 page has the rest.
- **Read the file's text into the message.** The Herder decides what to read; a path keeps the
  message small and works for any kind of file.

## Consequences

- A file moved or deleted after it was sent is gone for the task too.
- On Windows, dropping works where the pet is drawn; the transparent rest of its window lets clicks
  through as before.

## Tests

- `apps/desktop/test/pet-state.test.ts`: dots in order with their colours and 「+N」; dropped files
  kept once each, up to the limit, with their names (also Windows paths).
- `packages/host/test/pet.test.ts`: a picture becomes an image and other files and folders lines
  with their paths; what is missing, relative or too many is refused; dropped files reach
  AgentHerd as the owner's message, with no words needed.
