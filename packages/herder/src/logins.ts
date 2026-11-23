// Model subscriptions (ADR 0068): the owner signs in with an account (ChatGPT, Claude, Copilot…)
// instead of giving a key. pi-ai runs each vendor's sign-in and refresh; the credential stays in
// the host's SecretStore under modelLoginAccount(). Every request asks for a fresh short-lived
// token, so long tasks never hold an expired one and no agent sees the refresh token.

import type { ModelService, SecretStore } from "@agentherd/core";
import { isSubscription, modelLoginAccount } from "@agentherd/core";
import {
  type Api,
  type AuthInteraction,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  createAssistantMessageEventStream,
  type Model,
  type ModelAuth,
  type MutableModels,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { modelFetch } from "./model-fetch.ts";

/** Field on a resolved model naming the subscription service it belongs to. Agents read it too. */
export const LOGIN_FIELD = "agentherdLogin";

export interface SubscriptionProvider {
  provider: string;
  name: string;
  /** pi-ai marks some sign-ins as backed by a paid plan (ChatGPT Plus, Claude Max…). */
  subscription: boolean;
  models: { id: string; name: string }[];
}

let catalog: MutableModels | undefined;
function catalogModels(): MutableModels {
  catalog ??= builtinModels();
  return catalog;
}

/** Every vendor pi-ai can sign in to, with its catalog models. */
export function subscriptionProviders(): SubscriptionProvider[] {
  const models = catalogModels();
  const out: SubscriptionProvider[] = [];
  for (const p of models.getProviders()) {
    const oauth = p.auth.oauth;
    if (oauth === undefined) continue;
    const list = models
      .getModels(p.id)
      .filter((m) => m.type === undefined || m.type === "chat")
      .map((m) => ({ id: m.id, name: m.name }));
    if (list.length === 0) continue;
    out.push({
      provider: p.id,
      name: oauth.name,
      subscription: oauth.isSubscription === true,
      models: list,
    });
  }
  return out;
}

/** A catalog model of a subscription vendor, or a new id on the vendor's first model's endpoint. */
export function subscriptionModel(provider: string, modelId: string): Model<Api> | undefined {
  const known = catalogModels().getModels(provider);
  const model = known.find((m) => m.id === modelId);
  if (model !== undefined) return model;
  const base = known[0];
  if (base === undefined) return undefined;
  return { ...base, id: modelId, name: modelId, reasoning: false, thinkingLevelMap: undefined };
}

/**
 * One service's sign-in, stored as JSON in the SecretStore. pi-ai keys credentials by provider
 * id; this store holds exactly one, for the service's provider. `modify` calls run one at a time,
 * so two requests that both find the token expired refresh it once.
 */
export class SecretCredentials implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly secrets: SecretStore;
  private readonly serviceId: string;

  constructor(secrets: SecretStore, serviceId: string) {
    this.secrets = secrets;
    this.serviceId = serviceId;
  }

  private get account(): string {
    return modelLoginAccount(this.serviceId);
  }

  private load(): Credential | undefined {
    const raw = this.secrets.get(this.account);
    if (raw === undefined || raw === "") return undefined;
    try {
      return JSON.parse(raw) as Credential;
    } catch {
      return undefined;
    }
  }

  async read(): Promise<Credential | undefined> {
    return this.load();
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [];
  }

  modify(
    _providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const run = this.chain.then(async () => {
      const next = await fn(this.load());
      if (next === undefined) this.secrets.delete(this.account);
      else this.secrets.set(this.account, JSON.stringify(next));
      return next;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async delete(): Promise<void> {
    this.secrets.delete(this.account);
  }
}

export interface LoginResult {
  /** Models the account offers, newest list from the vendor when it has one. */
  models: string[];
}

/** Sign-ins of one SecretStore, one pi-ai `Models` per service. */
export class ModelLogins {
  private readonly perService = new Map<string, MutableModels>();
  private readonly secrets: SecretStore;

  constructor(secrets: SecretStore) {
    this.secrets = secrets;
  }

  private modelsFor(serviceId: string): MutableModels {
    let models = this.perService.get(serviceId);
    if (models === undefined) {
      models = builtinModels({ credentials: new SecretCredentials(this.secrets, serviceId) });
      this.perService.set(serviceId, models);
    }
    return models;
  }

  signedIn(serviceId: string): boolean {
    const raw = this.secrets.get(modelLoginAccount(serviceId));
    return raw !== undefined && raw !== "";
  }

  /**
   * Runs the vendor's sign-in for a new or existing service. The credential is saved under the
   * service id; the caller saves the service itself.
   */
  async login(
    serviceId: string,
    provider: string,
    interaction: AuthInteraction,
  ): Promise<LoginResult> {
    const models = this.modelsFor(serviceId);
    if (models.getProvider(provider)?.auth.oauth === undefined) {
      throw new Error(`pi-ai cannot sign in to "${provider}"`);
    }
    await models.login(provider, "oauth", interaction, { agentName: "AgentHerd" });
    let ids: string[];
    try {
      await models.refresh({ providers: [provider], allowNetwork: true, force: true });
      ids = (await models.getAvailable(provider)).map((m) => m.id);
    } catch {
      ids = [];
    }
    if (ids.length === 0) ids = models.getModels(provider).map((m) => m.id);
    return { models: ids };
  }

  logout(serviceId: string): void {
    this.secrets.delete(modelLoginAccount(serviceId));
    this.perService.delete(serviceId);
  }

  /**
   * A token for one request (pi-ai refreshes it when it is about to expire).
   * @throws When the service is not signed in or the vendor refused the refresh.
   */
  async auth(service: ModelService): Promise<ModelAuth> {
    if (!isSubscription(service) || service.provider === undefined) {
      throw new Error(`service "${service.id}" does not use a subscription`);
    }
    if (!this.signedIn(service.id)) throw new Error(`service "${service.id}" is not signed in`);
    const result = await this.modelsFor(service.id).getAuth(service.provider);
    if (result === undefined) throw new Error(`service "${service.id}" is not signed in`);
    return result.auth;
  }
}

const bySecrets = new WeakMap<SecretStore, ModelLogins>();

/** The sign-ins kept in `secrets` (one instance per store, so refreshes are shared). */
export function loginsFor(secrets: SecretStore): ModelLogins {
  let logins = bySecrets.get(secrets);
  if (logins === undefined) {
    logins = new ModelLogins(secrets);
    bySecrets.set(secrets, logins);
  }
  return logins;
}

/** The service id a resolved model signs in through, if any. */
export function loginOf(model: Model<Api>): string | undefined {
  const id = (model as unknown as Record<string, unknown>)[LOGIN_FIELD];
  return typeof id === "string" ? id : undefined;
}

/** Request options with a subscription token applied (and the model's endpoint, if the account has its own). */
export function withAuth(
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
  auth: ModelAuth,
): { model: Model<Api>; options: SimpleStreamOptions } {
  const headers = { ...(options?.headers ?? {}), ...(auth.headers ?? {}) };
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.Authorization ?? headers.authorization ?? "")?.[1];
  const apiKey = auth.apiKey ?? bearer ?? options?.apiKey;
  return {
    model: auth.baseUrl === undefined ? model : { ...model, baseUrl: auth.baseUrl },
    options: {
      ...options,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
    },
  };
}

/** A stream that fails at once, the way a provider reports a request it could not send. */
export function failedStream(model: Model<Api>, message: string): ReturnType<typeof streamSimple> {
  const stream = createAssistantMessageEventStream();
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  stream.push({
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zero },
      stopReason: "error",
      errorMessage: message,
      timestamp: Date.now(),
    },
  });
  return stream;
}

/**
 * `streamSimple` that signs subscription models in per request. Other models pass through.
 * `services` gives the current services (settings may change while running).
 */
export function loginStream(
  secrets: SecretStore,
  services: () => readonly ModelService[],
): (
  model: Model<Api>,
  context: Parameters<typeof streamSimple>[1],
  options?: SimpleStreamOptions,
) => ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>> {
  return async (model, context, options) => {
    // Every model request of the Herder and its tasks goes through the system proxy when there
    // is one (ADR 0098).
    let doFetch: typeof fetch;
    try {
      doFetch = options?.fetch ?? modelFetch();
    } catch (error) {
      return failedStream(model, (error as Error).message);
    }
    const requested = { ...options, fetch: doFetch };
    const id = loginOf(model);
    if (id === undefined) return streamSimple(model, context, requested);
    const service = services().find((s) => s.id === id);
    if (service === undefined) return failedStream(model, `no service "${id}"`);
    let auth: ModelAuth;
    try {
      auth = await loginsFor(secrets).auth(service);
    } catch (error) {
      return failedStream(model, `sign-in of "${id}" failed: ${(error as Error).message}`);
    }
    const signed = withAuth(model, requested, auth);
    return streamSimple(signed.model, context, signed.options);
  };
}
