import type { WsClientMessage, WsServerMessage } from '../ws/protocol.js'

type MessageHandler = (message: WsServerMessage) => void
type OpenHandler = () => void
type CloseHandler = () => void

class KrakenWsClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private messageHandlers = new Set<MessageHandler>()
  private openHandlers = new Set<OpenHandler>()
  private closeHandlers = new Set<CloseHandler>()
  private queuedMessages: WsClientMessage[] = []

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.flushQueue()
      this.startHeartbeat()
      for (const handler of this.openHandlers) {
        handler()
      }
    })

    socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as WsServerMessage
        for (const handler of this.messageHandlers) {
          handler(parsed)
        }
      } catch {
        return
      }
    })

    socket.addEventListener('close', () => {
      this.stopHeartbeat()
      for (const handler of this.closeHandlers) {
        handler()
      }
      this.scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      socket.close()
    })
  }

  send(message: WsClientMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queuedMessages.push(message)
      this.connect()
      return
    }
    this.socket.send(JSON.stringify(message))
  }

  request<T extends WsServerMessage>(
    message: WsClientMessage & { requestId: string },
    matcher: (message: WsServerMessage) => message is T,
    timeoutMs = 15000
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        unsubscribe()
        reject(new Error(`WebSocket request timed out: ${message.type}`))
      }, timeoutMs)

      const unsubscribe = this.subscribe((incoming) => {
        if (incoming.type === 'request:error' && incoming.requestId === message.requestId) {
          window.clearTimeout(timeout)
          unsubscribe()
          reject(new Error(incoming.error))
          return
        }
        if (!matcher(incoming)) {
          return
        }
        window.clearTimeout(timeout)
        unsubscribe()
        resolve(incoming)
      })

      this.send(message)
    })
  }

  subscribe(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }

  onOpen(handler: OpenHandler): () => void {
    this.openHandlers.add(handler)
    return () => {
      this.openHandlers.delete(handler)
    }
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler)
    return () => {
      this.closeHandlers.delete(handler)
    }
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    for (const message of this.queuedMessages.splice(0)) {
      this.socket.send(JSON.stringify(message))
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      this.send({
        type: 'heartbeat:ping',
        ts: Date.now(),
      })
    }, 20000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) {
      return
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 1500)
  }
}

export const wsClient = new KrakenWsClient()
