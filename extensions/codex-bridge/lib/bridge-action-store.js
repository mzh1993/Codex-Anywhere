import { normalizeBridgeActionOwner } from "./bridge-action-model.js";

export function createBridgeActionRecord(input) {
  const status = input.status ?? "created";
  const createdAt = input.createdAt;
  return {
    actionId: input.actionId,
    locale: input.locale,
    senderId: input.senderId,
    accountId: input.accountId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    cwd: input.cwd,
    kind: input.kind,
    operation: input.operation ?? null,
    target: input.target ?? null,
    requestText: input.requestText ?? "",
    status,
    owner: normalizeBridgeActionOwner(input.owner ?? null, status),
    approvalToken: input.approvalToken ?? null,
    createdAt,
    startedAt: input.startedAt ?? null,
    updatedAt: input.updatedAt ?? createdAt,
    finishedAt: input.finishedAt ?? null,
    resultStatus: input.resultStatus ?? null,
    resultText: input.resultText ?? null,
    error: input.error ?? null,
  };
}

export function serializeBridgeActionForStorage(action) {
  return { ...action };
}

export function createBridgeActionPersistence({ bridgeActionsRoot, readJson, writeJson, safeFileName }) {
  function actionPath(actionId) {
    return `${bridgeActionsRoot}/${safeFileName(actionId)}.json`;
  }

  return {
    actions: {
      async create(action) {
        await writeJson(actionPath(action.actionId), serializeBridgeActionForStorage(action));
        return action;
      },
      async read(actionId) {
        return readJson(actionPath(actionId), null);
      },
      async update(actionId, updates) {
        const current = await this.read(actionId);
        if (!current) return null;
        const next = createBridgeActionRecord({ ...current, ...updates, actionId });
        await writeJson(actionPath(actionId), serializeBridgeActionForStorage(next));
        return next;
      },
      async write(action) {
        await writeJson(actionPath(action.actionId), serializeBridgeActionForStorage(action));
        return action;
      },
    },
  };
}
