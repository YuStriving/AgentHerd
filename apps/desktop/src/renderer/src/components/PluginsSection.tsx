// 应用连接 › 插件 (ADR 0094): Claude Code plugins and Gemini CLI extensions. The owner picks one
// from the official library or pastes a GitHub link, sees what it would run and which keys it
// needs, then installs it. Each installed plugin can be turned off, given keys, shared with the
// Herder (off by default) or removed.

import type { PluginCatalogEntry, PluginPreview, PluginView } from "@agentherd/host/api";
import { ExternalLink, Link2, Puzzle, Search, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { catalogCategories, filterCatalog, pluginBadge, pluginLine } from "../plugins";
import { call, useApp } from "../store";
import { ConnectionRow, RowActions } from "./ConnectionRow";
import { Modal } from "./Modal";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Group,
  IconTile,
  inputClass,
  Section,
  Switch,
} from "./ui";

/** Shows the plugin list after loading it once; events keep it fresh. */
export function PluginsSection() {
  const plugins = useApp((s) => s.plugins);
  const [library, setLibrary] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [preview, setPreview] = useState<PluginPreview | undefined>(undefined);
  const [looking, setLooking] = useState<string | undefined>(undefined);

  useEffect(() => {
    void call((h) => h.plugins()).then((list) => list && useApp.setState({ plugins: list }));
  }, []);

  const look = async (source: string) => {
    setLooking(source);
    const p = await call((h) => h.previewPlugin(source));
    setLooking(undefined);
    if (p !== undefined) {
      setLibrary(false);
      setLinkOpen(false);
      setPreview(p);
    }
  };

  return (
    <Section
      title="插件"
      hint="Claude Code 插件和 Gemini CLI 扩展：任务里的 Agent 能用它们的工具和技能，会改东西的工具先问你"
      actions={
        <>
          <Button size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 size={13} /> 从链接装
          </Button>
          <Button size="sm" variant="primary" onClick={() => setLibrary(true)}>
            <Store size={13} /> 插件库
          </Button>
        </>
      }
    >
      <Group>
        {plugins === undefined ? null : plugins.length === 0 ? (
          <EmptyState
            icon={<Puzzle size={18} />}
            text="还没有插件。从 Claude Code 官方插件库挑一个，或者贴一个 GitHub 链接。"
          />
        ) : (
          plugins.map((p) => <PluginRow key={p.id} plugin={p} />)
        )}
      </Group>
      {library && (
        <LibraryDialog looking={looking} onLook={look} onClose={() => setLibrary(false)} />
      )}
      {linkOpen && (
        <LinkDialog
          looking={looking !== undefined}
          onLook={look}
          onClose={() => setLinkOpen(false)}
        />
      )}
      {preview !== undefined && (
        <ConsentDialog preview={preview} onClose={() => setPreview(undefined)} />
      )}
    </Section>
  );
}

function PluginRow({ plugin: p }: { plugin: PluginView }) {
  const badge = pluginBadge(p);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const save = async (patch: Parameters<typeof setPluginPatch>[1]) => {
    setBusy(true);
    await setPluginPatch(p.id, patch);
    setBusy(false);
  };
  return (
    <ConnectionRow
      icon={
        <IconTile tone={badge.tone === "green" ? "green" : badge.tone === "red" ? "red" : "gray"}>
          <Puzzle size={14} />
        </IconTile>
      }
      name={p.name}
      badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
      subtitle={pluginLine(p)}
      alert={p.enabled && p.state === "failed"}
      action={
        <Switch
          checked={p.enabled}
          disabled={busy}
          label={`${p.enabled ? "关掉" : "打开"} ${p.name}`}
          onChange={(enabled) => void save({ enabled })}
        />
      }
    >
      <div className="space-y-1 text-ink-2 text-sm">
        {p.link !== "" && (
          <a
            className="inline-flex items-center gap-1 text-accent-text hover:underline"
            href={p.link}
            target="_blank"
            rel="noreferrer"
          >
            {p.link.replace(/^https:\/\//, "")} <ExternalLink size={12} />
          </a>
        )}
        {p.servers.map((s) => (
          <div key={s.name} className="truncate">
            <span className="text-ink-muted">{s.kind === "stdio" ? "运行" : "连接"} </span>
            <code className="rounded bg-control-hover px-1">{s.run}</code>
          </div>
        ))}
        {p.skills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">技能</span>
            {p.skills.map((s) => (
              <Badge key={s.name}>{s.name}</Badge>
            ))}
          </div>
        )}
      </div>
      {p.keys.length > 0 && (
        <div className="space-y-2">
          {p.keys.map((k) => (
            <Field
              key={k}
              label={k}
              hint={p.keysSet.includes(k) ? "已保存；填新的会替换" : "还没填"}
            >
              <input
                className={inputClass}
                type="password"
                value={keys[k] ?? ""}
                placeholder={p.keysSet.includes(k) ? "••••••" : "粘贴 Key"}
                onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
              />
            </Field>
          ))}
          <Button
            size="sm"
            disabled={busy || Object.values(keys).every((v) => v.trim() === "")}
            onClick={() => void save({ keys }).then(() => setKeys({}))}
          >
            保存 Key
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-md bg-control-hover px-3 py-2">
        <div className="min-w-0">
          <div className="font-medium text-ink text-sm">主管也能用</div>
          <div className="text-ink-muted text-xs">
            主管自己回答问题时能用它的只读工具和技能；默认关着，只有任务里的 Agent 能用
          </div>
        </div>
        <Switch
          checked={p.herder}
          disabled={busy || !p.enabled}
          label="主管也能用"
          onChange={(herder) => void save({ herder })}
        />
      </div>
      <RowActions>
        {confirm ? (
          <>
            <span className="text-ink-2 text-sm">删掉插件文件和它的 Key？</span>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => void removePlugin(p.id)}
            >
              删除
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              取消
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            删除插件
          </Button>
        )}
      </RowActions>
    </ConnectionRow>
  );
}

async function setPluginPatch(
  id: string,
  patch: { enabled?: boolean; herder?: boolean; keys?: Record<string, string> },
): Promise<void> {
  const list = await call((h) => h.setPlugin(id, patch));
  if (list !== undefined) useApp.setState({ plugins: list });
}

async function removePlugin(id: string): Promise<void> {
  const list = await call((h) => h.removePlugin(id));
  if (list !== undefined) useApp.setState({ plugins: list });
}

function LibraryDialog({
  looking,
  onLook,
  onClose,
}: {
  looking: string | undefined;
  onLook: (source: string) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<PluginCatalogEntry[] | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | undefined>(undefined);
  useEffect(() => {
    void call((h) => h.pluginCatalog()).then((list) => setEntries(list ?? []));
  }, []);
  const categories = useMemo(() => catalogCategories(entries ?? []), [entries]);
  const shown = useMemo(
    () => filterCatalog(entries ?? [], query, category),
    [entries, query, category],
  );
  return (
    <Modal
      size="large"
      title="Claude Code 官方插件库"
      description={
        entries === undefined
          ? "正在读取…"
          : `${entries.length} 个插件，来自 anthropics/claude-plugins-official`
      }
      onClose={onClose}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-ink-muted" />
          <input
            className={`${inputClass} pl-8!`}
            placeholder="搜名字或用途，比如 github、docs、database"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={category === undefined ? "primary" : "ghost"}
            onClick={() => setCategory(undefined)}
          >
            全部
          </Button>
          {categories.slice(0, 8).map((c) => (
            <Button
              key={c}
              size="sm"
              variant={category === c ? "primary" : "ghost"}
              onClick={() => setCategory(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-surface">
        {shown.length === 0 && entries !== undefined && (
          <div className="p-6 text-center text-ink-muted text-md">没有找到</div>
        )}
        {shown.map((e) => (
          <div key={e.name} className="flex items-start gap-3 border-line px-4 py-3 [&+&]:border-t">
            <IconTile>
              <Puzzle size={14} />
            </IconTile>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{e.title}</span>
                {e.category !== undefined && <Badge>{e.category}</Badge>}
                {e.author !== undefined && (
                  <span className="text-ink-muted text-xs">{e.author}</span>
                )}
              </div>
              <div className="mt-0.5 line-clamp-2 text-ink-2 text-sm">{e.description}</div>
              {e.why !== undefined && (
                <div className="mt-1 text-ink-muted text-xs">装不了：{e.why}</div>
              )}
            </div>
            {e.installed ? (
              <Badge tone="green">已装</Badge>
            ) : e.source !== undefined ? (
              <Button
                size="sm"
                disabled={looking !== undefined}
                onClick={() => onLook(e.source as string)}
              >
                {looking === e.source ? "下载中…" : "看看"}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function LinkDialog({
  looking,
  onLook,
  onClose,
}: {
  looking: boolean;
  onLook: (source: string) => void;
  onClose: () => void;
}) {
  const [link, setLink] = useState("");
  return (
    <Modal
      title="从 GitHub 链接装插件"
      description="贴仓库或插件文件夹的链接。先下载下来给你看它会运行什么，确认后才装"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={looking || link.trim() === ""}
            onClick={() => onLook(link.trim())}
          >
            {looking ? "下载中…" : "看看"}
          </Button>
        </>
      }
    >
      <Field label="链接" hint="比如 https://github.com/upstash/context7，或者 owner/repo/文件夹">
        <input
          className={inputClass}
          value={link}
          placeholder="https://github.com/owner/repo"
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && link.trim() !== "" && !looking) onLook(link.trim());
          }}
        />
      </Field>
    </Modal>
  );
}

/** What the plugin would run and need, before anything is kept (ADR 0094). */
function ConsentDialog({ preview: p, onClose }: { preview: PluginPreview; onClose: () => void }) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    const list = await call((h) => h.installPlugin(p.source, keys));
    setBusy(false);
    if (list !== undefined) {
      useApp.setState({ plugins: list });
      onClose();
    }
  };
  return (
    <Modal
      wide
      title={`安装 ${p.name}${p.version === undefined ? "" : ` ${p.version}`}`}
      description={
        <>
          {p.author === undefined ? "" : `${p.author} · `}
          {p.format === "gemini" ? "Gemini CLI 扩展" : "Claude Code 插件"}
          {p.link !== "" && (
            <>
              {" · "}
              <a
                className="text-accent-text hover:underline"
                href={p.link}
                target="_blank"
                rel="noreferrer"
              >
                看源码
              </a>
            </>
          )}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void install()}>
            {busy ? "安装中…" : p.installedId === undefined ? "安装" : "重新安装"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-md">
        {p.description !== "" && <p className="text-ink-2">{p.description}</p>}
        <div className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-text">
          插件来自第三方，代码会在这台电脑上运行。装之前看一下它会运行什么；任务用它会改东西的工具时，还会先问你
        </div>
        <Part title="会运行" empty="没有工具服务">
          {p.servers.map((s) => (
            <div key={s.name} className="space-y-0.5">
              <div className="text-ink-2 text-sm">
                {s.name} · {s.kind === "stdio" ? "在这台电脑上运行" : "连到网上的服务"}
              </div>
              <code className="block break-all rounded bg-control-hover px-2 py-1 text-xs">
                {s.run}
              </code>
            </div>
          ))}
        </Part>
        <Part title="技能" empty="没有技能">
          {p.skills.map((s) => (
            <div key={s.name} className="text-sm">
              <span className="font-medium text-ink">{s.name}</span>
              {s.description !== "" && <span className="text-ink-2"> · {s.description}</span>}
            </div>
          ))}
        </Part>
        {p.keys.length > 0 && (
          <Part title="要的 Key" empty="">
            {p.keys.map((k) => (
              <Field
                key={k}
                label={k}
                hint="存在本机的密钥文件里，只给这个插件用；现在不填也行，以后在插件里补"
              >
                <input
                  className={inputClass}
                  type="password"
                  value={keys[k] ?? ""}
                  placeholder="粘贴 Key"
                  onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
                />
              </Field>
            ))}
          </Part>
        )}
        {(p.ignored.length > 0 || p.problems.length > 0) && (
          <Part title="AgentHerd 用不上的部分" empty="">
            {[...p.ignored, ...p.problems].map((t) => (
              <div key={t} className="text-ink-2 text-sm">
                · {t}
              </div>
            ))}
          </Part>
        )}
      </div>
    </Modal>
  );
}

function Part({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[] | React.ReactNode;
}) {
  const list = Array.isArray(children) ? children : [children];
  return (
    <div className="space-y-1.5">
      <div className="font-medium text-ink-2 text-sm">{title}</div>
      {list.length === 0 && empty !== "" ? (
        <div className="text-ink-muted text-sm">{empty}</div>
      ) : (
        children
      )}
    </div>
  );
}
