import crypto from 'node:crypto'
import type { WebSocket } from 'ws'
import type { WsServerMessage } from './protocol.js'

interface ClientRecord {
  id: string
  socket: WebSocket
  schedulerSubscribed: boolean
  activeChatRequestIds: Set<string>
}

export function createWsHub() {
  const clients = new Map<string, ClientRecord>()

  function addClient(socket: WebSocket): ClientRecord {
    const client: ClientRecord = {
      id: crypto.randomUUID(),
      socket,
      schedulerSubscribed: false,
      activeChatRequestIds: new Set(),
    }
    clients.set(client.id, client)
    return client
  }

  function removeClient(clientId: string) {
    clients.delete(clientId)
  }

  function getClient(clientId: string): ClientRecord | undefined {
    return clients.get(clientId)
  }

  function send(client: ClientRecord, message: WsServerMessage) {
    if (client.socket.readyState !== client.socket.OPEN) {
      return
    }
    client.socket.send(JSON.stringify(message))
  }

  function broadcast(message: WsServerMessage, predicate?: (client: ClientRecord) => boolean) {
    for (const client of clients.values()) {
      if (predicate && !predicate(client)) {
        continue
      }
      send(client, message)
    }
  }

  function broadcastScheduler(message: WsServerMessage) {
    broadcast(message, (client) => client.schedulerSubscribed)
  }

  return {
    addClient,
    removeClient,
    getClient,
    send,
    broadcast,
    broadcastScheduler,
  }
}
