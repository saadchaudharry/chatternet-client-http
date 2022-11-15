import * as Messages from "./messages.js";
import { get } from "lodash-es";

export interface Server {
  url: string;
  knownIds: Set<string>;
}

export function newServer(url: string): Server {
  const knownIds: Set<string> = new Set();
  return { url, knownIds };
}

async function postMessage(
  message: Messages.Message,
  did: string,
  server: string
): Promise<Response> {
  const url = new URL(`/${did}/actor/outbox`, server);
  const request = new Request(url, {
    method: "POST",
    body: JSON.stringify(message),
    headers: { "Content-Type": "application/json" },
  });
  return await fetch(request);
}

async function postObjectDoc(objetDoc: Messages.ObjectDoc, server: string): Promise<Response> {
  const url = new URL(`/${objetDoc.id}`, server);
  const request = new Request(url, {
    method: "POST",
    body: JSON.stringify(objetDoc),
    headers: { "Content-Type": "application/json" },
  });
  return await fetch(request);
}

async function getInbox(did: string, server: string, after?: string): Promise<Response> {
  const url = new URL(`/${did}/actor/inbox`, server);
  if (after) url.searchParams.set("after", after);
  const request = new Request(url, {
    method: "GET",
  });
  return await fetch(request);
}

async function getObjectDoc(id: string, server: string): Promise<Response> {
  const url = new URL(`/${id}`, server);
  const request = new Request(url, {
    method: "GET",
  });
  return await fetch(request);
}

export class Servers {
  constructor(readonly urlsServer: Map<string, Server>) {}

  static fromUrls(urls: string[]): Servers {
    return new Servers(new Map(urls.map((x) => [x, newServer(x)])));
  }

  async postMessage(message: Messages.MessageWithId, did: string) {
    // keep the servers in sync by sharing all processed messages
    for (const { url, knownIds } of this.urlsServer.values()) {
      if (knownIds.has(message.id)) continue;
      await postMessage(message, did, url);
      knownIds.add(message.id);
    }
  }

  async postObjectDoc(objectDoc: Messages.ObjectDocWithId) {
    // keep the servers in sync by sharing all processed messages
    for (const { url, knownIds } of this.urlsServer.values()) {
      if (knownIds.has(objectDoc.id)) continue;
      await postObjectDoc(objectDoc, url);
      knownIds.add(objectDoc.id);
    }
  }

  async getObjectDoc(id: string): Promise<Messages.ObjectDocWithId | undefined> {
    // want to iterate starting with most likely to have doc
    const servers = [...this.urlsServer.values()];
    servers.sort((a, b) => {
      // a is known, not b: sort a before b
      if (a.knownIds.has(id) && !b.knownIds.has(id)) return -1;
      // b is known, not a: sort b before a
      if (!a.knownIds.has(id) && b.knownIds.has(id)) return +1;
      return 0;
    });

    for (const server of servers) {
      const response = await getObjectDoc(id, server.url);
      if (!response.ok) continue;
      const objectDoc: unknown = await response.json();
      if (!Messages.isObjectDocWithId(objectDoc)) continue;
      server.knownIds.add(objectDoc.id);
      return objectDoc;
    }
  }

  async getInbox(url: string, did: string, after?: string): Promise<Messages.MessageWithId[]> {
    const server = this.urlsServer.get(url);
    if (!server) throw Error("server URL is not known");
    const response = await getInbox(did, url, after);
    if (!response.ok) throw Error("unable to get inbox");
    const page: unknown = await response.json();
    const messages: unknown = get(page, "orderedItems");
    if (!Array.isArray(messages)) throw Error("inbox message are incorrectly formatted");
    const messagesWithId = messages.filter(Messages.isMessageWithId);
    // side effects
    for (const message of messagesWithId) server.knownIds.add(message.id);
    return messages;
  }
}