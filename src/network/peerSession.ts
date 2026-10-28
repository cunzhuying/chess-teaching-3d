import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { isNetMessage, type NetMessage } from './protocol';

export type PeerRole = 'host' | 'guest';
export type PeerStatus =
  | 'creating'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface PeerSessionCallbacks {
  onStatus: (status: PeerStatus, detail?: string) => void;
  onCode: (code: string) => void;
  onConnected: (role: PeerRole) => void;
  onMessage: (message: NetMessage) => void;
  onError: (message: string) => void;
  onDisconnected: () => void;
}

/**
 * PeerJS 只负责“握手 + DataChannel”，棋局规则仍由主机上的 chess.js 决定。
 * - 主机：用 chess-xxxxxx 作为 Peer ID，等待一个客人；
 * - 客人：随机 Peer ID，连接主机的房间号；
 * - 所有业务消息都在 protocol.ts 中，主机收到 move 后必须自己校验。
 */
export class PeerSession {
  private readonly role: PeerRole;
  private readonly callbacks: PeerSessionCallbacks;
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private code: string | null = null;
  private closed = false;
  private hostRetries = 0;
  private joinTimer: number | null = null;

  constructor(
    role: PeerRole,
    callbacks: PeerSessionCallbacks,
    code?: string,
  ) {
    this.role = role;
    this.callbacks = callbacks;
    if (role === 'host') {
      this.createHost();
    } else {
      this.code = code ?? null;
      this.connectGuest();
    }
  }

  get roomCode(): string | null {
    return this.code;
  }

  send(message: NetMessage): boolean {
    if (!this.connection?.open) return false;
    try {
      this.connection.send(message);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.closed = true;
    this.clearJoinTimer();
    this.connection?.close();
    this.connection = null;
    this.peer?.destroy();
    this.peer = null;
  }

  private createHost(): void {
    if (this.closed) return;
    this.code = randomRoomCode();
    this.callbacks.onCode(this.code);
    this.callbacks.onStatus('creating');

    const peer = new Peer(`chess-${this.code}`, { debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      if (this.closed) return;
      this.callbacks.onStatus('waiting');
    });

    peer.on('connection', (connection) => {
      if (this.closed) return;
      if (this.connection) {
        // 只允许一个对手；第二个连接直接拒绝，避免双主机。
        connection.close();
        return;
      }
      this.attach(connection);
    });

    peer.on('error', (error) => {
      if (this.closed) return;
      const type = (error as { type?: string }).type;
      if (type === 'unavailable-id' && this.hostRetries < 4) {
        this.hostRetries += 1;
        peer.destroy();
        this.peer = null;
        this.createHost();
        return;
      }
      this.fail(mapPeerError(error));
    });

    peer.on('disconnected', () => {
      if (this.closed) return;
      // 信令断开不一定影响已建立的数据通道；只有还没有客人时才提示。
      if (!this.connection) this.callbacks.onStatus('waiting', '信令服务器断开，正在等待');
    });
  }

  private connectGuest(): void {
    if (this.closed) return;
    if (!this.code || !/^\d{6}$/.test(this.code)) {
      this.fail('请输入 6 位数字房间号');
      return;
    }

    this.callbacks.onStatus('connecting');
    const peer = new Peer({ debug: 0 });
    this.peer = peer;

    this.joinTimer = window.setTimeout(() => {
      if (this.closed || this.connection?.open) return;
      this.fail('连接超时。请确认房主在线，或换一个网络再试。');
    }, 12_000);

    peer.on('open', () => {
      if (this.closed) return;
      const connection = peer.connect(`chess-${this.code}`, {
        reliable: true,
        serialization: 'json',
      });
      this.attach(connection);
    });

    peer.on('error', (error) => {
      if (this.closed) return;
      const type = (error as { type?: string }).type;
      if (type === 'peer-unavailable') {
        this.fail('房间不存在，或房主已经离开。请确认房间号。');
        return;
      }
      this.fail(mapPeerError(error));
    });
  }

  private attach(connection: DataConnection): void {
    this.connection = connection;

    connection.on('data', (data) => {
      if (this.closed) return;
      if (!isNetMessage(data)) return;
      this.callbacks.onMessage(data);
    });

    connection.on('close', () => {
      if (this.closed) return;
      this.connection = null;
      this.callbacks.onStatus('disconnected');
      this.callbacks.onDisconnected();
    });

    connection.on('error', (error) => {
      if (this.closed) return;
      this.fail(`连接异常：${error.message || '未知错误'}`);
    });

    if (connection.open) {
      this.handleOpen();
    } else {
      connection.on('open', () => this.handleOpen());
    }
  }

  private handleOpen(): void {
    if (this.closed) return;
    this.clearJoinTimer();
    this.callbacks.onStatus('connected');
    this.callbacks.onConnected(this.role);
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.callbacks.onStatus('error', message);
    this.callbacks.onError(message);
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) {
      window.clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
  }
}

function randomRoomCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

function mapPeerError(error: Error): string {
  const type = (error as { type?: string }).type;
  switch (type) {
    case 'network':
    case 'server-error':
      return '无法连接 PeerJS 信令服务器，请检查网络后重试。';
    case 'webrtc':
      return 'WebRTC 连接失败，可能是当前网络/NAT 限制了 P2P。';
    case 'peer-unavailable':
      return '房间不存在，或房主已经离开。';
    case 'unavailable-id':
      return '房间号被占用，请重新创建。';
    default:
      return error.message || '联机连接失败。';
  }
}
