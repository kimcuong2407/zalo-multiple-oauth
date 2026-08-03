import express from "express";

function responseLimit(value, fallback) {
  return Math.min(parseInt(value, 10) || fallback, 500);
}

export function createMessageRouter({ accountManager, messageStore }) {
  const router = express.Router();

  router.get("/accounts/:id/messages", (req, res) => {
    const { id } = req.params;
    const { since, limit = "50" } = req.query;
    const messages = messageStore.listMessages(id, {
      since,
      limit: responseLimit(limit, 50),
    });

    res.json({ accountId: id, count: messages.length, messages });
  });

  router.get("/messages", (req, res) => {
    const { since, limit = "100" } = req.query;
    const result = {};

    for (const account of accountManager.list()) {
      const messages = messageStore.listMessages(account.id, {
        since,
        limit: responseLimit(limit, 100),
      });
      if (messages.length > 0) result[account.id] = messages;
    }

    res.json(result);
  });

  return router;
}
